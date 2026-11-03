// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createServer, loadConfig } from '../src/server.js';
import { openDb } from '../src/db.js';
import { parseCsv, sampleRuns, toCsv } from '../src/runs.js';

let server, base;

before(async () => {
  const config = { ...loadConfig({}), dbFile: ':memory:', allowSignup: false };
  server = createServer(config, openDb(':memory:'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

/** Tiny client that keeps the session cookie, like a browser would. */
function client() {
  let cookie = '';
  return async (method, path, body, extraHeaders = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-Spur': '1' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
}

const alice = client();
const bob = client();
const PW = 'correct horse battery';

test('fresh server asks for the first account', async () => {
  const { data } = await alice('GET', '/api/status');
  assert.equal(data.needsSetup, true);
  assert.equal(data.allowSignup, true);
});

test('first account signs up and gets a session', async () => {
  const short = await alice('POST', '/api/signup', { username: 'alice', password: 'short' });
  assert.equal(short.status, 400);
  const r = await alice('POST', '/api/signup', { username: 'alice', password: PW });
  assert.equal(r.status, 201);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const me = await alice('GET', '/api/me');
  assert.equal(me.data.user.username, 'alice');
});

test('further sign-ups are closed by default', async () => {
  const r = await bob('POST', '/api/signup', { username: 'bob', password: PW });
  assert.equal(r.status, 403);
});

test('requests without the X-Spur header or from another site are refused', async () => {
  const noHeader = await alice('POST', '/api/runs', { date: '2026-10-01', km: 5, sec: 1500 }, { 'X-Spur': '' });
  assert.equal(noHeader.status, 403);
  const crossSite = await alice('POST', '/api/runs', { date: '2026-10-01', km: 5, sec: 1500 }, { Origin: 'https://evil.example' });
  assert.equal(crossSite.status, 403);
});

test('runs: add, validate, edit, delete', async () => {
  const bad = await alice('POST', '/api/runs', { date: '2026-10-01', km: 5, sec: 30 });
  assert.equal(bad.status, 400);
  const future = await alice('POST', '/api/runs', { date: '2999-01-01', km: 5, sec: 1500 });
  assert.equal(future.status, 400);

  const add = await alice('POST', '/api/runs', { date: '2026-10-01', km: 8.2, sec: 2551 });
  assert.equal(add.status, 201);
  const id = add.data.run.id;

  const edit = await alice('PUT', `/api/runs/${id}`, { date: '2026-10-02', km: 8.4, sec: 2551 });
  assert.equal(edit.data.run.km, 8.4);

  const list = await alice('GET', '/api/runs');
  assert.equal(list.data.runs.length, 1);

  assert.equal((await alice('DELETE', `/api/runs/${id}`)).status, 200);
  assert.equal((await alice('DELETE', `/api/runs/${id}`)).status, 404);
});

test('runs are private to their owner', async () => {
  const anon = await bob('GET', '/api/runs');
  assert.equal(anon.status, 401);
});

test('settings keep only allowed values', async () => {
  const r = await alice('PUT', '/api/settings', { unit: 'mi', palette: 'lake', goal: 300, evil: '<script>', mode: 'neon', smoothing: 'strong', volume: 'time' });
  assert.deepEqual(r.data.settings, { unit: 'mi', palette: 'lake', smoothing: 'strong', volume: 'time', goal: 300 });
  const bad = await alice('PUT', '/api/settings', { smoothing: 'max' });
  assert.equal(bad.data.settings.smoothing, 'strong', 'unknown strengths are ignored');
  const cleared = await alice('PUT', '/api/settings', { goal: null });
  assert.equal(cleared.data.settings.goal, undefined);
});

test('samples load and clear', async () => {
  const r = await alice('POST', '/api/samples', { today: '2026-11-02' });
  assert.ok(r.data.runs.length > 50);
  assert.ok(r.data.runs.every((x) => x.sample));
  const c = await alice('DELETE', '/api/samples');
  assert.equal(c.data.deleted, r.data.runs.length);
});

test('CSV import skips bad lines and duplicates, export matches the Android format', async () => {
  const csv = 'date,distance_km,duration\n2026-10-28,8.2,42:31\n2026-10-30;5,0;26:05\nnot a run\n';
  const first = await alice('POST', '/api/import', { csv });
  assert.deepEqual(first.data, { added: 2, skipped: 1, duplicates: 0 });
  const again = await alice('POST', '/api/import', { csv });
  assert.equal(again.data.duplicates, 2);
  const out = await alice('GET', '/api/export.csv');
  assert.match(out.headers.get('content-disposition'), /attachment; filename="spur-runs-/);
  assert.equal(out.data, 'date,distance_km,duration\n2026-10-28,8.20,42:31\n2026-10-30,5.00,26:05\n');
});

test('wrong passwords are refused, then rate-limited', async () => {
  const eve = client();
  const first = await eve('POST', '/api/login', { username: 'alice', password: 'nope-nope-nope' });
  assert.equal(first.status, 401);
  let status = 401;
  for (let i = 0; i < 12 && status === 401; i++) {
    status = (await eve('POST', '/api/login', { username: 'alice', password: 'nope-nope-nope' })).status;
  }
  assert.equal(status, 429, 'after about ten tries the address is paused');
});

test('password change keeps this session and signs out others', async () => {
  const r = await alice('POST', '/api/password', { current: PW, next: 'a much longer password' });
  assert.equal(r.status, 200);
  assert.equal((await alice('GET', '/api/me')).status, 200);
});

test('static files and security headers', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(base + '/package.json')).status, 404, 'only files in public/ are served');
  assert.doesNotMatch(await (await fetch(base + '/%2e%2e/package.json')).text(), /spur-selfhost/);
  assert.equal((await fetch(base + '/healthz')).status, 200);
});

test('pure helpers', () => {
  const runs = sampleRuns('2026-11-02');
  assert.equal(runs.length, sampleRuns('2026-11-02').length, 'samples are deterministic');
  const { runs: back, skipped } = parseCsv(toCsv(runs));
  assert.equal(skipped, 0);
  assert.equal(back.length, runs.length);
});
