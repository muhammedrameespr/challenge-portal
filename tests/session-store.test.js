import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './helpers.js';
import { SQLiteSessionStore } from '../server/src/session-store.js';

async function call(store, method, ...args) {
  let count = 0;
  const result = await new Promise(resolve => {
    store[method](...args, (error, value) => {
      count += 1;
      resolve({ error, value });
    });
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, 1, `${method} must call its callback exactly once.`);
  return result;
}

test('SQLite express-session Store contracts use a private file database', { timeout: 30_000 }, async t => {
  const f = await fixture({ withSeed: false });
  const store = new SQLiteSessionStore({ db: f.db, cleanupIntervalMs: 0 });
  t.after(async () => { store.close(); await f.close(); });
  const data = { cookie: { expires: new Date(Date.now() + 60_000).toISOString(), maxAge: 60_000 }, userId: 1, csrfToken: 'test-token' };

  await t.test('set/get restores JSON; replacement updates only its own SID', async () => {
    assert.equal((await call(store, 'set', 'one', data)).error, null);
    assert.deepEqual((await call(store, 'get', 'one')).value, data);
    assert.equal((await call(store, 'get', 'missing')).value, null);
    const replacement = { ...data, userId: 2 };
    assert.equal((await call(store, 'set', 'one', replacement)).error, null);
    assert.equal((await call(store, 'get', 'one')).value.userId, 2);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions WHERE sid = ?').get('one').n, 1);
    assert.equal(f.db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').get('one').expires_at, Date.parse(data.cookie.expires));
  });

  await t.test('expiry uses cookie maxAge or configured TTL, and expired get is missing', async () => {
    const now = Date.now();
    await call(store, 'set', 'max-age', { cookie: { maxAge: 12_345 }, userId: 1 });
    const maxAgeExpiry = f.db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').get('max-age').expires_at;
    assert.ok(maxAgeExpiry >= now + 12_345 && maxAgeExpiry < Date.now() + 12_346);
    await call(store, 'set', 'default-ttl', { userId: 1 });
    const ttlExpiry = f.db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').get('default-ttl').expires_at;
    assert.ok(ttlExpiry >= now + 8 * 60 * 60 * 1000);
    f.db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(Date.now() - 1, 'one');
    assert.equal((await call(store, 'get', 'one')).value, null);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions WHERE sid = ?').get('one').n, 0);
    await call(store, 'set', 'already-expired', { cookie: { expires: new Date(Date.now() - 1) } });
    assert.equal((await call(store, 'get', 'already-expired')).value, null);
  });

  await t.test('touch extends only existing unexpired rows and preserves serialized data', async () => {
    await call(store, 'set', 'touch', data);
    const before = f.db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get('touch');
    const future = new Date(Date.now() + 120_000).toISOString();
    assert.equal((await call(store, 'touch', 'touch', { cookie: { expires: future }, userId: 999 })).error, null);
    const after = f.db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get('touch');
    assert.equal(after.data, before.data);
    assert.equal(after.expires_at, Date.parse(future));
    f.db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(Date.now() - 1, 'touch');
    await call(store, 'touch', 'touch', { cookie: { expires: future } });
    assert.ok(f.db.prepare('SELECT expires_at FROM sessions WHERE sid = ?').get('touch').expires_at < Date.now());
    assert.equal((await call(store, 'get', 'touch')).value, null);
    await call(store, 'touch', 'never-created', data);
    assert.equal((await call(store, 'get', 'never-created')).value, null);
    await call(store, 'set', 'destroyed', data);
    assert.equal((await call(store, 'destroy', 'destroyed')).error, null);
    await call(store, 'touch', 'destroyed', data);
    assert.equal((await call(store, 'get', 'destroyed')).value, null);
    assert.equal((await call(store, 'destroy', 'destroyed')).error, null);
  });

  await t.test('JSON and invalid expiry errors reach callbacks exactly once', async () => {
    const circular = { cookie: {} };
    circular.self = circular;
    for (const invalid of [circular, undefined, null, [], 'text', { cookie: { expires: 'not-a-date' } }]) {
      assert.ok((await call(store, 'set', 'invalid', invalid)).error instanceof Error);
    }
    // The migration normally prevents corrupt JSON. Temporarily bypass only
    // that CHECK in this private fixture to exercise the adapter error path.
    f.db.pragma('ignore_check_constraints = ON');
    f.db.prepare('INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)').run('corrupt', '{invalid', Date.now() + 60_000);
    f.db.pragma('ignore_check_constraints = OFF');
    assert.ok((await call(store, 'get', 'corrupt')).error instanceof Error);
    f.db.prepare('INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)').run('not-object', 'null', Date.now() + 60_000);
    assert.ok((await call(store, 'get', 'not-object')).error instanceof Error);
    assert.ok((await call(store, 'touch', 'max-age', { cookie: { expires: 'invalid' } })).error instanceof Error);
  });

  await t.test('periodic cleanup is unrefed and close clears its timer', async () => {
    const timed = new SQLiteSessionStore({ db: f.db, cleanupIntervalMs: 10 });
    try {
      assert.equal(timed.timer.hasRef(), false);
      f.db.prepare('INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)').run('cleanup', '{}', Date.now() - 1);
      await delay(40);
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM sessions WHERE sid = ?').get('cleanup').n, 0);
    } finally {
      timed.close();
    }
    assert.equal(timed.timer, undefined);
  });

  await t.test('database errors from each adapter method reach callbacks exactly once', async () => {
    f.db.close();
    for (const [method, args] of [['get', ['one']], ['set', ['one', data]], ['destroy', ['one']], ['touch', ['one', data]]]) {
      assert.ok((await call(store, method, ...args)).error instanceof Error);
    }
  });
});
