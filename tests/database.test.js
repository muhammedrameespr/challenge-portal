import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fixture } from './helpers.js';
import { seed } from '../server/scripts/seed.js';
import { backupDatabase } from '../server/scripts/backup.js';
import { loadConfig, projectRoot, serverRoot } from '../server/src/config.js';

test('private database paths, seed failure safety, schema constraints, and live WAL backups', { timeout: 30_000 }, async t => {
  const f = await fixture({ withSeed: false });
  t.after(() => f.close());

  await t.test('paths resolve from server and reject in-memory or public storage', () => {
    const env = { SESSION_SECRET: f.config.sessionSecret, DB_FILE: './data/local.sqlite', UPLOAD_DIR: './storage' };
    assert.equal(loadConfig(env).dbFile, path.join(serverRoot, 'data', 'local.sqlite'));
    assert.equal(loadConfig(env).uploadDir, path.join(serverRoot, 'storage'));
    for (const dbFile of [':memory:', 'file:memory?mode=memory', path.join(projectRoot, 'client', 'public', 'data.sqlite')]) {
      assert.throws(() => loadConfig({ ...env, DB_FILE: dbFile }));
    }
    assert.throws(() => loadConfig({ ...env, UPLOAD_DIR: path.join(projectRoot, 'client', 'dist', 'uploads') }));
    assert.throws(() => loadConfig({ ...env, SESSION_SECRET: 'replace_with_random_secret' }));
    assert.equal(loadConfig({ ...env, NODE_ENV: 'production', APP_ORIGIN: 'http://localhost:3000' }).secureCookies, false);
    assert.equal(loadConfig({ ...env, APP_ORIGIN: 'https://localhost:3000' }).secureCookies, true);
  });

  await t.test('missing seed password causes no partial account or challenge creation', async () => {
    await assert.rejects(seed(f.db, { ...f.config, seedPasswords: { ...f.passwords, user2: '' } }), /SEED_USER2_PASSWORD/);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM challenges').get().n, 0);
    assert.deepEqual(await seed(f.db, f.config), { accountsCreated: 3, challengesCreated: 3 });
    assert.ok(f.db.prepare('SELECT password_hash FROM users').all().every(row => row.password_hash.startsWith('$argon2id$')));
    assert.ok(f.db.prepare('SELECT answer_hash FROM challenges').all().every(row => row.answer_hash.startsWith('$argon2id$')));
  });

  await t.test('SQLite enforces booleans, relationships, bounds, and completion uniqueness', () => {
    const user = f.db.prepare("SELECT id FROM users WHERE username = 'user1'").get().id;
    const challenge = f.db.prepare('SELECT id FROM challenges ORDER BY id').get().id;
    assert.throws(() => f.db.prepare('UPDATE users SET is_active = 2 WHERE id = ?').run(user));
    assert.throws(() => f.db.prepare("UPDATE users SET role = 'OWNER' WHERE id = ?").run(user));
    assert.throws(() => f.db.prepare('UPDATE challenges SET display_order = -1 WHERE id = ?').run(challenge));
    assert.throws(() => f.db.prepare('UPDATE challenges SET display_order = 10000 WHERE id = ?').run(challenge));
    assert.throws(() => f.db.prepare('UPDATE challenges SET is_published = 2 WHERE id = ?').run(challenge));
    assert.throws(() => f.db.prepare('UPDATE challenges SET attachment_size = NULL WHERE id = ?').run(challenge));
    assert.throws(() => f.db.prepare('INSERT INTO attempts (user_id, challenge_id, is_correct) VALUES (?, ?, ?)').run(999999, challenge, 1));
    assert.throws(() => f.db.prepare('INSERT INTO attempts (user_id, challenge_id, is_correct) VALUES (?, ?, ?)').run(user, challenge, 2));
    f.db.prepare('INSERT INTO completions (user_id, challenge_id) VALUES (?, ?)').run(user, challenge);
    assert.throws(() => f.db.prepare('INSERT INTO completions (user_id, challenge_id) VALUES (?, ?)').run(user, challenge));
    assert.throws(() => f.db.prepare('INSERT INTO completions (user_id, challenge_id) VALUES (?, ?)').run(null, challenge));
    assert.throws(() => f.db.prepare('DELETE FROM challenges WHERE id = ?').run(challenge));
  });

  await t.test('backup includes committed WAL changes and refuses overwrite, source, or client target', async () => {
    f.db.prepare("UPDATE challenges SET title = 'Latest committed backup content' WHERE id = (SELECT min(id) FROM challenges)").run();
    const target = path.join(f.directory, 'backup.sqlite');
    assert.equal(await backupDatabase(f.db, f.config, target), target);
    const copy = new Database(target, { readonly: true, fileMustExist: true });
    try {
      assert.equal(copy.prepare('SELECT title FROM challenges ORDER BY id').get().title, 'Latest committed backup content');
      assert.equal(copy.prepare('SELECT count(*) AS n FROM completions').get().n, 1);
      assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    } finally { copy.close(); }
    await assert.rejects(backupDatabase(f.db, f.config, target));
    await assert.rejects(backupDatabase(f.db, f.config, f.config.dbFile), /differ/);
    await assert.rejects(backupDatabase(f.db, f.config, path.join(projectRoot, 'client', 'public', 'unsafe.sqlite')), /outside/);
  });
});
