// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane
//
// spur self-hosted server: a small JSON API plus the web app's static files.
// Uses only Node.js built-ins.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openDb } from './db.js';
import { RateLimiter, burnTime, checkCredentials, hashPassword, hashToken, newToken, verifyPassword } from './auth.js';
import { checkRun, cleanSettings, newRunId, parseCsv, sampleRuns, toCsv, todayIso, validDate } from './runs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const COOKIE = 'spur_session';
/** How many accounts one browser can stay signed in to at once. */
export const MAX_ACCOUNTS = 6;
const USERNAME = /^[A-Za-z0-9._-]{2,32}$/;

export function loadConfig(env = process.env) {
  const bool = (v, d) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
  const dataDir = env.SPUR_DATA_DIR || path.join(ROOT, 'data');
  return {
    port: Number(env.PORT || 4219),
    host: env.HOST || '0.0.0.0',
    dbFile: env.SPUR_DB || path.join(dataDir, 'spur.db'),
    allowSignup: bool(env.SPUR_ALLOW_SIGNUP, false),
    trustProxy: bool(env.SPUR_TRUST_PROXY, false),
    cookieSecure: String(env.SPUR_COOKIE_SECURE || 'auto').toLowerCase(),
    sessionDays: Math.max(1, Number(env.SPUR_SESSION_DAYS || 90)),
  };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createServer(config, store = openDb(config.dbFile)) {
  const loginLimiter = new RateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

  const clientIp = (req) => {
    if (config.trustProxy) {
      const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress || 'unknown';
  };

  const isHttps = (req) =>
    req.socket.encrypted || (config.trustProxy && String(req.headers['x-forwarded-proto'] || '').startsWith('https'));

  const secureCookie = (req) =>
    config.cookieSecure === 'true' ? true : config.cookieSecure === 'false' ? false : isHttps(req);

  const cookies = (req) =>
    Object.fromEntries(
      String(req.headers.cookie || '')
        .split(';')
        .map((c) => c.trim().split('='))
        .filter((kv) => kv.length >= 2)
        .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
    );

  const headers = (res) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  };

  const send = (res, status, body, extra = {}) => {
    const json = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    });
    res.end(json);
  };

  const readJson = (req, limit = 2 * 1024 * 1024) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, 'That is too much data for one request.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new HttpError(400, 'The request was not valid JSON.'));
        }
      });
      req.on('error', reject);
    });

  // One browser can be signed in to several accounts. The session cookie holds
  // their tokens joined by dots, the active account first. Only hashes of the
  // tokens are stored on the server.
  const cookieTokens = (req) =>
    String(cookies(req)[COOKIE] || '')
      .split('.')
      .filter((t) => /^[A-Za-z0-9_-]{20,64}$/.test(t))
      .slice(0, MAX_ACCOUNTS);

  /** The browser's live sessions, active first, one per account. */
  const signedIn = (req) => {
    if (req.spurSessions) return req.spurSessions;
    const out = [], seen = new Set();
    for (const token of cookieTokens(req)) {
      const user = store.sessionUser(hashToken(token));
      if (user && !seen.has(user.id)) {
        seen.add(user.id);
        out.push({ token, user });
      }
    }
    return (req.spurSessions = out);
  };

  const writeSessions = (req, res, tokens) => {
    const maxAge = config.sessionDays * 86400;
    res.setHeader(
      'Set-Cookie',
      tokens.length
        ? `${COOKIE}=${tokens.join('.')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie(req) ? '; Secure' : ''}`
        : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  };

  /** Signs userId in and makes it the active account, keeping the other accounts signed in. */
  const startSession = (req, res, userId) => {
    const token = newToken();
    store.createSession(hashToken(token), userId, Date.now() + config.sessionDays * 86400 * 1000);
    const others = [];
    for (const s of signedIn(req)) {
      if (s.user.id === userId || others.length >= MAX_ACCOUNTS - 1) store.deleteSession(hashToken(s.token));
      else others.push(s.token);
    }
    writeSessions(req, res, [token, ...others]);
  };

  /** Signs out the active account (or all of them); returns who is active afterwards. */
  const endSession = (req, res, { all = false } = {}) => {
    const live = signedIn(req);
    const gone = all ? live : live.slice(0, 1);
    for (const s of gone) store.deleteSession(hashToken(s.token));
    for (const t of cookieTokens(req)) if (!live.some((s) => s.token === t)) store.deleteSession(hashToken(t));
    const rest = all ? [] : live.slice(1);
    writeSessions(req, res, rest.map((s) => s.token));
    return rest[0]?.user ?? null;
  };

  const sessionUser = (req) => signedIn(req)[0]?.user ?? null;

  const signupAllowed = () => {
    const v = store.meta('allow_signup');
    return v == null ? config.allowSignup : v === '1';
  };

  const settingsOf = (user) => {
    try {
      return JSON.parse(user.settings || '{}');
    } catch {
      return {};
    }
  };

  const me = (user) => ({ user: { username: user.username, isAdmin: !!user.is_admin }, settings: settingsOf(user) });

  const accountsOf = (req) =>
    signedIn(req).map((s, i) => ({ username: s.user.username, name: settingsOf(s.user).name || '', active: i === 0 }));

  const adminView = () => ({
    allowSignup: signupAllowed(),
    signupFromEnv: store.meta('allow_signup') == null,
    users: store.users().map((u) => {
      let name = '';
      try { name = JSON.parse(u.settings || '{}').name || ''; } catch {}
      return { username: u.username, name, isAdmin: u.isAdmin, createdAt: u.createdAt, runs: u.runs, lastRun: u.lastRun };
    }),
  });

  const targetUser = (raw) => {
    let name;
    try { name = decodeURIComponent(raw); } catch { name = ''; }
    const u = USERNAME.test(name) ? store.userByName(name) : null;
    if (!u) throw new HttpError(404, 'There is no account with that username.');
    return u;
  };

  // -------------------------------------------------------------------------

  async function api(req, res, method, p) {
    // Cross-site request protection: browsers can't add this header to a
    // cross-site form post, and SameSite=Lax keeps the cookie off it anyway.
    if (method !== 'GET' && method !== 'HEAD') {
      if (req.headers['x-spur'] !== '1') throw new HttpError(403, 'This request is missing the X-Spur header.');
      const origin = req.headers.origin;
      if (origin && origin !== 'null') {
        const host = (config.trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
        let ok = false;
        try {
          ok = new URL(origin).host === host;
        } catch {}
        if (!ok) throw new HttpError(403, 'Requests from other sites are not allowed.');
      }
    }

    const route = `${method} ${p}`;

    if (route === 'GET /api/status') {
      const user = sessionUser(req);
      const count = store.userCount();
      return send(res, 200, {
        version: VERSION,
        needsSetup: count === 0,
        allowSignup: count === 0 || signupAllowed(),
        user: user ? { username: user.username } : null,
        accounts: accountsOf(req).length,
        maxAccounts: MAX_ACCOUNTS,
      });
    }

    if (route === 'POST /api/signup') {
      const first = store.userCount() === 0;
      if (!first && !signupAllowed()) throw new HttpError(403, 'New accounts are turned off on this server. Ask its admin to add you.');
      const wait = loginLimiter.hit(clientIp(req));
      if (wait) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.`);
      const { username, password } = await readJson(req);
      const problem = checkCredentials(username, password);
      if (problem) throw new HttpError(400, problem);
      if (store.userByName(username)) throw new HttpError(409, 'That username is taken.');
      const id = store.createUser(username, await hashPassword(password), { admin: first });
      startSession(req, res, id);
      return send(res, 201, me(store.userById(id)));
    }

    if (route === 'POST /api/login') {
      const ip = clientIp(req);
      const wait = loginLimiter.hit(ip);
      if (wait) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.`);
      const { username, password } = await readJson(req);
      const user = typeof username === 'string' ? store.userByName(username) : null;
      let ok = false;
      if (user && typeof password === 'string') ok = await verifyPassword(password, user.pw_hash);
      else await burnTime(String(password ?? ''));
      if (!ok) throw new HttpError(401, 'Wrong username or password.');
      loginLimiter.clear(ip);
      startSession(req, res, user.id);
      return send(res, 200, me(user));
    }

    if (route === 'POST /api/logout') {
      const { all } = await readJson(req);
      const next = endSession(req, res, { all: all === true });
      return send(res, 200, next ? { ok: true, ...me(next) } : { ok: true, user: null });
    }

    if (route === 'GET /api/accounts') return send(res, 200, { accounts: accountsOf(req), maxAccounts: MAX_ACCOUNTS });

    if (route === 'POST /api/accounts/switch') {
      const { username } = await readJson(req);
      const live = signedIn(req);
      const i = live.findIndex((s) => typeof username === 'string' && s.user.username.toLowerCase() === username.toLowerCase());
      if (i < 0) throw new HttpError(404, 'That account is not signed in here. Sign in to it first.');
      const order = [live[i], ...live.filter((_, j) => j !== i)];
      writeSessions(req, res, order.map((s) => s.token));
      return send(res, 200, me(live[i].user));
    }

    // Everything below needs a signed-in user.
    const user = sessionUser(req);
    if (!user) throw new HttpError(401, 'Please sign in.');
    const uid = user.id;

    if (route === 'GET /api/me') return send(res, 200, me(user));

    if (route === 'PUT /api/settings') {
      const merged = { ...settingsOf(user), ...cleanSettings(await readJson(req)) };
      for (const k of ['goal', 'heightCm']) if (merged[k] === null) delete merged[k];
      if (merged.name === '') delete merged.name;
      store.setSettings(uid, merged);
      return send(res, 200, { settings: merged });
    }

    if (route === 'POST /api/password') {
      const { current, next } = await readJson(req);
      if (typeof current !== 'string' || !(await verifyPassword(current, user.pw_hash))) {
        throw new HttpError(400, 'Your current password is not right.');
      }
      const problem = checkCredentials(user.username, next);
      if (problem) throw new HttpError(400, problem);
      store.setPassword(uid, await hashPassword(next));
      store.deleteOtherSessions(uid, hashToken(signedIn(req)[0].token));
      return send(res, 200, { ok: true });
    }

    if (route === 'DELETE /api/account') {
      const { password } = await readJson(req);
      if (typeof password !== 'string' || !(await verifyPassword(password, user.pw_hash))) {
        throw new HttpError(400, 'That password is not right.');
      }
      const next = endSession(req, res);
      store.deleteUser(uid);
      return send(res, 200, next ? { ok: true, ...me(store.userById(next.id)) } : { ok: true, user: null });
    }

    // ----- account management, for admins -----
    if (p === '/api/admin' || p.startsWith('/api/admin/')) {
      if (!user.is_admin) throw new HttpError(403, 'Only an admin of this server can manage accounts.');

      if (route === 'GET /api/admin') return send(res, 200, adminView());

      if (route === 'PUT /api/admin/signup') {
        const { allow } = await readJson(req);
        if (typeof allow !== 'boolean') throw new HttpError(400, 'Say whether new accounts are allowed.');
        store.setMeta('allow_signup', allow ? '1' : '0');
        return send(res, 200, adminView());
      }

      if (route === 'POST /api/admin/users') {
        const { username, password, admin } = await readJson(req);
        const problem = checkCredentials(username, password);
        if (problem) throw new HttpError(400, problem);
        if (store.userByName(username)) throw new HttpError(409, 'That username is taken.');
        store.createUser(username, await hashPassword(password), { admin: admin === true });
        return send(res, 201, adminView());
      }

      const m = p.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (m && method === 'PUT') {
        const target = targetUser(m[1]);
        const { password, admin } = await readJson(req);
        if (password !== undefined) {
          const problem = checkCredentials(target.username, password);
          if (problem) throw new HttpError(400, problem);
          store.setPassword(target.id, await hashPassword(password));
          if (target.id !== uid) store.deleteUserSessions(target.id);
          else store.deleteOtherSessions(uid, hashToken(signedIn(req)[0].token));
        }
        if (admin !== undefined) {
          if (typeof admin !== 'boolean') throw new HttpError(400, 'Say whether the account is an admin.');
          if (target.id === uid) throw new HttpError(400, "You can't change your own admin rights. Ask another admin.");
          store.setAdmin(target.id, admin);
        }
        return send(res, 200, adminView());
      }
      if (m && method === 'DELETE') {
        const target = targetUser(m[1]);
        if (target.id === uid) throw new HttpError(400, 'To delete your own account, use Delete account under Account.');
        store.deleteUser(target.id);
        return send(res, 200, adminView());
      }
      throw new HttpError(404, 'Not found.');
    }

    if (route === 'GET /api/runs') return send(res, 200, { runs: store.runs(uid) });

    if (route === 'POST /api/runs') {
      const { run, error } = checkRun(await readJson(req));
      if (error) throw new HttpError(400, error);
      return send(res, 201, { run: store.addRun(uid, { id: newRunId(), ...run }) });
    }

    if (route === 'DELETE /api/runs') return send(res, 200, { deleted: store.deleteAllRuns(uid) });

    const one = p.match(/^\/api\/runs\/([A-Za-z0-9_-]{1,64})$/);
    if (one && method === 'PUT') {
      const { run, error } = checkRun(await readJson(req));
      if (error) throw new HttpError(400, error);
      const updated = store.updateRun(uid, one[1], run);
      if (!updated) throw new HttpError(404, 'That run no longer exists.');
      return send(res, 200, { run: updated });
    }
    if (one && method === 'DELETE') {
      if (!store.deleteRun(uid, one[1])) throw new HttpError(404, 'That run no longer exists.');
      return send(res, 200, { ok: true });
    }

    if (route === 'POST /api/samples') {
      const { today } = await readJson(req);
      const day = validDate(today) ? today : todayIso();
      store.tx(() => {
        store.deleteSamples(uid);
        for (const r of sampleRuns(day)) store.addRun(uid, r);
      });
      return send(res, 200, { runs: store.runs(uid) });
    }

    if (route === 'DELETE /api/samples') return send(res, 200, { deleted: store.deleteSamples(uid) });

    if (route === 'GET /api/export.csv') {
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="spur-runs-${todayIso()}.csv"`,
        'Cache-Control': 'no-store',
      });
      return res.end(toCsv(store.runs(uid)));
    }

    if (route === 'POST /api/import') {
      const { csv } = await readJson(req);
      const { runs, skipped } = parseCsv(csv);
      let added = 0, duplicates = 0;
      store.tx(() => {
        for (const r of runs) {
          if (store.hasRun(uid, r)) duplicates++;
          else {
            store.addRun(uid, { id: newRunId(), ...r });
            added++;
          }
        }
      });
      return send(res, 200, { added, skipped, duplicates });
    }

    throw new HttpError(404, 'Not found.');
  }

  // -------------------------------------------------------------------------

  function serveStatic(req, res, p) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
    let rel;
    try {
      rel = decodeURIComponent(p);
    } catch {
      return send(res, 400, { error: 'Bad path.' });
    }
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, { error: 'Not found.' });
    let stat;
    try {
      stat = fs.statSync(file);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(file);
    const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
    const longCache = ext === '.woff2' || (ext === '.png' && rel.startsWith('/icons/'));
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', longCache ? 'public, max-age=604800' : 'no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  // -------------------------------------------------------------------------

  const server = http.createServer(async (req, res) => {
    headers(res);
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end('ok');
      }
      if (p.startsWith('/api/')) return await api(req, res, req.method, p);
      return serveStatic(req, res, p);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong on the server. Check its logs.' });
      else res.end();
    }
  });

  const purge = setInterval(() => store.purgeSessions(), 3600 * 1000);
  purge.unref();
  server.on('close', () => clearInterval(purge));
  server.store = store;
  return server;
}

// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const config = loadConfig();
  const server = createServer(config);
  server.store.purgeSessions();
  server.listen(config.port, config.host, () => {
    console.log(`spur ${VERSION} listening on http://${config.host}:${config.port}`);
    console.log(`database: ${config.dbFile}`);
    const stored = server.store.meta('allow_signup');
    const open = stored == null ? config.allowSignup : stored === '1';
    console.log(`new accounts: ${open ? 'anyone can sign up' : 'added by an admin'}${stored == null ? '' : ' (set in the app)'}`);
  });
  const stop = () => {
    console.log('shutting down');
    server.close(() => {
      server.store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
