// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ghassan Dabane
//
// Admin commands, run inside the container:
//   docker compose exec spur npm run reset-password -- <username>
//   docker compose exec spur node src/cli.js list-users
//   docker compose exec spur node src/cli.js backup

import crypto from 'node:crypto';
import path from 'node:path';

import { hashPassword } from './auth.js';
import { openDb } from './db.js';
import { loadConfig } from './server.js';

const [cmd, arg] = process.argv.slice(2);
const { dbFile } = loadConfig();
const store = openDb(dbFile);

try {
  if (cmd === 'reset-password' && arg) {
    const user = store.userByName(arg);
    if (!user) {
      console.error(`No user called "${arg}".`);
      process.exitCode = 1;
    } else {
      const password = crypto.randomBytes(12).toString('base64url');
      store.setPassword(user.id, await hashPassword(password));
      store.deleteUserSessions(user.id);
      console.log(`New password for ${user.username}: ${password}`);
      console.log('Sign in with it, then change it in Settings.');
    }
  } else if (cmd === 'list-users') {
    for (const u of store.users()) {
      console.log(`${u.username}\t${u.runs} runs\tcreated ${u.createdAt.slice(0, 10)}`);
    }
  } else if (cmd === 'backup') {
    // A consistent copy of the live database, safe to take while spur runs.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const file = arg || path.join(path.dirname(dbFile), `spur-backup-${stamp}.db`);
    store.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    console.log(`Backup written to ${file}`);
  } else {
    console.log('Usage:\n  node src/cli.js reset-password <username>\n  node src/cli.js list-users\n  node src/cli.js backup [file]');
    process.exitCode = cmd ? 1 : 0;
  }
} finally {
  store.close();
}
