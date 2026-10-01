import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { loadConfig, serverRoot } from '../server/src/config.js';
import { createDatabase } from '../server/src/db.js';
import { migrate } from '../server/scripts/migrate.js';
import { seed } from '../server/scripts/seed.js';
import { createApp } from '../server/src/app.js';

export async function fixture({ withSeed = true, configOverrides = {} } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'challenge-portal-test-'));
  const dbFile = path.join(directory, 'acceptance.sqlite');
  const demoFile = path.resolve(serverRoot, process.env.DB_FILE || './data/challenge_portal.sqlite');
  assert.notEqual(path.resolve(dbFile).toLowerCase(), demoFile.toLowerCase(), 'Tests must never open the demo database.');
  assert.equal(path.dirname(dbFile), directory);
  const passwords = Object.fromEntries(['admin', 'user1', 'user2'].map(name => [name, randomBytes(18).toString('hex')]));
  const config = {
    ...loadConfig({
      NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173', DB_FILE: dbFile,
      UPLOAD_DIR: path.join(directory, 'uploads'), SESSION_SECRET: randomBytes(32).toString('hex'),
      SEED_ADMIN_PASSWORD: passwords.admin, SEED_USER1_PASSWORD: passwords.user1,
      SEED_USER2_PASSWORD: passwords.user2, LOGIN_MAX: '1000', ANSWER_MAX: '1000',
    }),
    ...configOverrides,
  };
  assert.equal(config.dbFile, dbFile, 'Fixture DB_FILE must be the generated private test file.');
  await mkdir(config.uploadDir, { recursive: true });
  let db = createDatabase(config);
  migrate(db);
  if (withSeed) await seed(db, config);
  const apps = [];
  function app(options = {}) {
    const instance = createApp({ db, config, ...options });
    apps.push(instance);
    return instance;
  }
  function restart() {
    for (const instance of apps.splice(0)) instance.locals.sessionStore.close();
    db.close();
    db = createDatabase(config);
    return app();
  }
  async function close() {
    for (const instance of apps.splice(0)) instance.locals.sessionStore.close();
    if (db.open) db.close();
    // Delete only the exact, privately created temporary directory, never any
    // user-supplied DB_FILE or upload directory. Verify the final target first.
    const actual = await realpath(directory);
    assert.equal(path.dirname(actual).toLowerCase(), (await realpath(os.tmpdir())).toLowerCase());
    assert.ok(path.basename(actual).startsWith('challenge-portal-test-'));
    assert.equal(actual.toLowerCase(), path.resolve(directory).toLowerCase());
    await rm(actual, { recursive: true, force: true });
  }
  return { get db() { return db; }, directory, config, passwords, app, restart, close };
}

export async function login(app, config, username, password) {
  const agent = request.agent(app);
  const first = await agent.get('/api/auth/csrf').expect(200);
  assert.equal(first.headers['cache-control'], 'no-store');
  assert.equal(typeof first.body.csrfToken, 'string');
  const response = await agent.post('/api/auth/login').set('Origin', config.appOrigin)
    .set('X-CSRF-Token', first.body.csrfToken).send({ username, password }).expect(200);
  assert.notEqual(response.body.csrfToken, first.body.csrfToken, 'Login must rotate the CSRF token.');
  const cookie = response.headers['set-cookie']?.find(value => !value.includes('Expires=Thu, 01 Jan 1970'));
  assert.ok(cookie, 'Login must issue a fresh session cookie.');
  assert.notEqual(cookie.split(';')[0], first.headers['set-cookie'][0].split(';')[0], 'Login must regenerate the session.');
  return { agent, token: response.body.csrfToken, user: response.body.user, cookie: cookie.split(';')[0], response };
}

export function mutation(actor, config, method, url, body) {
  const outgoing = actor.agent[method](url).set('Origin', config.appOrigin).set('X-CSRF-Token', actor.token);
  return body === undefined ? outgoing : outgoing.send(body);
}

export function counts(db, userId, challengeId) {
  return {
    attempts: db.prepare('SELECT count(*) AS count FROM attempts WHERE user_id = ? AND challenge_id = ?').get(userId, challengeId).count,
    completions: db.prepare('SELECT count(*) AS count FROM completions WHERE user_id = ? AND challenge_id = ?').get(userId, challengeId).count,
  };
}

export function assertSafe(value) {
  const walk = object => {
    if (!object || typeof object !== 'object') return;
    for (const [key, child] of Object.entries(object)) {
      assert.doesNotMatch(key, /password|expected.?answer|answer.?hash|storage.?name|storage.?path|session.?secret/i);
      walk(child);
    }
  };
  walk(value);
  assert.doesNotMatch(JSON.stringify(value), /\$argon2(?:id|i|d)\$/);
}

export function challengePayload(overrides = {}) {
  return { title: 'Test challenge', summary: 'A controlled acceptance fixture.', question: 'Read this question.\nThen answer exactly.',
    expectedAnswer: 'exact value', difficulty: 'medium', displayOrder: 10, ...overrides };
}
