// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane

import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt$N$r$p$salt$hash, all base64url. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem,
  });
  return crypto.timingSafeEqual(expected, got);
}

/** Used so a login for an unknown user takes as long as a wrong password. */
let dummy;
export async function burnTime(password) {
  dummy ??= await hashPassword('spur-dummy-password');
  await verifyPassword(password, dummy);
}

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('base64url');

export function checkCredentials(username, password) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9._@+-]{2,64}$/.test(username)) {
    return 'Use 2 to 64 letters or numbers for your username, without spaces (an email address works too).';
  }
  if (typeof password !== 'string' || password.length < 10) return 'Use a password of at least 10 characters.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

/** Simple fixed-window limiter for sign-in attempts, per client address. */
export class RateLimiter {
  constructor({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** Returns seconds to wait, or 0 if allowed. */
  hit(key) {
    const nowMs = Date.now();
    let e = this.hits.get(key);
    if (!e || e.reset <= nowMs) {
      e = { count: 0, reset: nowMs + this.windowMs };
      this.hits.set(key, e);
    }
    e.count++;
    if (this.hits.size > 10000) {
      for (const [k, v] of this.hits) if (v.reset <= nowMs) this.hits.delete(k);
    }
    return e.count > this.max ? Math.ceil((e.reset - nowMs) / 1000) : 0;
  }

  clear(key) {
    this.hits.delete(key);
  }
}
