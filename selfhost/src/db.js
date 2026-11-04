// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane
//
// SQLite storage, using the database engine built into Node.js, so spur has
// no third-party dependencies.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_hash    TEXT NOT NULL,
    settings   TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    id         TEXT NOT NULL,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    km         REAL NOT NULL,
    sec        INTEGER NOT NULL,
    sample     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS runs_by_user_date ON runs(user_id, date);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return new Store(db);
}

/** Brings databases made by older versions up to date. */
function migrate(db) {
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')").run();
  const version = Number(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value);
  if (version < 2) {
    // 1.0.1 had admin accounts and an in-app sign-up switch; 1.0.2 drops both.
    // Its is_admin column may remain in the users table, unused.
    db.prepare("UPDATE meta SET value = '2' WHERE key = 'schema_version'").run();
  }
  db.prepare("DELETE FROM meta WHERE key = 'allow_signup'").run();
}

const now = () => new Date().toISOString();

const toRun = (r) => ({ id: r.id, date: r.date, km: r.km, sec: r.sec, ...(r.sample ? { sample: true } : {}) });

export class Store {
  constructor(db) {
    this.db = db;
    const q = (sql) => db.prepare(sql);
    this.q = {
      userCount: q('SELECT COUNT(*) AS n FROM users'),
      userByName: q('SELECT * FROM users WHERE username = ?'),
      userById: q('SELECT * FROM users WHERE id = ?'),
      insertUser: q('INSERT INTO users (username, pw_hash, created_at) VALUES (?, ?, ?)'),
      userList: q(`SELECT u.id, u.username, u.created_at,
                          COUNT(r.id) AS runs, MAX(r.date) AS last_run
                     FROM users u LEFT JOIN runs r ON r.user_id = u.id AND r.sample = 0
                    GROUP BY u.id ORDER BY u.username COLLATE NOCASE`),
      setPassword: q('UPDATE users SET pw_hash = ? WHERE id = ?'),
      setSettings: q('UPDATE users SET settings = ? WHERE id = ?'),
      deleteUser: q('DELETE FROM users WHERE id = ?'),

      insertSession: q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
      sessionUser: q(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                      WHERE s.token_hash = ? AND s.expires_at > ?`),
      deleteSession: q('DELETE FROM sessions WHERE token_hash = ?'),
      deleteUserSessions: q('DELETE FROM sessions WHERE user_id = ?'),
      deleteOtherSessions: q('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
      purgeSessions: q('DELETE FROM sessions WHERE expires_at <= ?'),

      runs: q('SELECT * FROM runs WHERE user_id = ? ORDER BY date, created_at'),
      runById: q('SELECT * FROM runs WHERE user_id = ? AND id = ?'),
      insertRun: q(`INSERT INTO runs (id, user_id, date, km, sec, sample, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`),
      updateRun: q('UPDATE runs SET date = ?, km = ?, sec = ?, sample = 0 WHERE user_id = ? AND id = ?'),
      deleteRun: q('DELETE FROM runs WHERE user_id = ? AND id = ?'),
      deleteSamples: q('DELETE FROM runs WHERE user_id = ? AND sample = 1'),
      deleteAllRuns: q('DELETE FROM runs WHERE user_id = ?'),
      runKey: q('SELECT 1 FROM runs WHERE user_id = ? AND date = ? AND ABS(km - ?) < 0.005 AND sec = ?'),
    };
  }

  close() {
    this.db.close();
  }

  tx(fn) {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // users
  userCount() { return Number(this.q.userCount.get().n); }
  userByName(name) { return this.q.userByName.get(name); }
  userById(id) { return this.q.userById.get(id); }
  createUser(name, pwHash) { return Number(this.q.insertUser.run(name, pwHash, now()).lastInsertRowid); }
  users() {
    return this.q.userList.all().map((u) => ({
      id: u.id, username: u.username, createdAt: u.created_at, runs: Number(u.runs), lastRun: u.last_run ?? null,
    }));
  }
  setPassword(id, pwHash) { this.q.setPassword.run(pwHash, id); }
  setSettings(id, settings) { this.q.setSettings.run(JSON.stringify(settings), id); }
  deleteUser(id) { this.q.deleteUser.run(id); }

  // sessions
  createSession(tokenHash, userId, expiresAt) { this.q.insertSession.run(tokenHash, userId, expiresAt); }
  sessionUser(tokenHash) { return this.q.sessionUser.get(tokenHash, Date.now()); }
  deleteSession(tokenHash) { this.q.deleteSession.run(tokenHash); }
  deleteUserSessions(userId) { this.q.deleteUserSessions.run(userId); }
  deleteOtherSessions(userId, keepHash) { this.q.deleteOtherSessions.run(userId, keepHash); }
  purgeSessions() { this.q.purgeSessions.run(Date.now()); }

  // runs
  runs(userId) { return this.q.runs.all(userId).map(toRun); }
  run(userId, id) { const r = this.q.runById.get(userId, id); return r ? toRun(r) : null; }
  addRun(userId, { id, date, km, sec, sample = false }) {
    this.q.insertRun.run(id, userId, date, km, sec, sample ? 1 : 0, now());
    return this.run(userId, id);
  }
  updateRun(userId, id, { date, km, sec }) {
    const res = this.q.updateRun.run(date, km, sec, userId, id);
    return res.changes ? this.run(userId, id) : null;
  }
  deleteRun(userId, id) { return this.q.deleteRun.run(userId, id).changes > 0; }
  deleteSamples(userId) { return Number(this.q.deleteSamples.run(userId).changes); }
  deleteAllRuns(userId) { return Number(this.q.deleteAllRuns.run(userId).changes); }
  hasRun(userId, { date, km, sec }) { return !!this.q.runKey.get(userId, date, km, sec); }
}
