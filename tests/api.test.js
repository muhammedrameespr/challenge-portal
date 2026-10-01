import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fixture, login, mutation, counts, assertSafe, challengePayload } from './helpers.js';
import { hashSecret, verifySecret } from '../server/src/hash.js';
import { migrate } from '../server/scripts/migrate.js';
import { seed } from '../server/scripts/seed.js';

test('file-backed SQLite API acceptance', { timeout: 180_000 }, async t => {
  const f = await fixture();
  t.after(() => f.close());
  let app = f.app();
  const config = f.config;
  const ids = f.db.prepare('SELECT id FROM challenges ORDER BY display_order, id').all().map(row => row.id);
  const [one, two, three] = ids;
  const admin = await login(app, config, 'ADMIN', f.passwords.admin);
  let user1 = await login(app, config, 'user1', f.passwords.user1);
  const user2 = await login(app, config, 'user2', f.passwords.user2);
  const submit = (actor, id, answer) => mutation(actor, config, 'post', `/api/challenges/${id}/attempts`, { answer });
  let created;

  await t.test('real database, safe health, repeatable migration, local HTTP headers', async () => {
    assert.equal(ids.length, 3);
    assert.equal(f.db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(f.db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(f.db.pragma('busy_timeout', { simple: true }), 5000);
    assert.equal(f.db.name, config.dbFile);
    assert.ok((await readFile(config.dbFile)).length > 0);
    migrate(f.db);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM challenges').get().n, 3);
    const health = await request(app).get('/api/health').expect(200);
    assertSafe(health.body);
    assert.equal(health.headers['strict-transport-security'], undefined);
    assert.ok(!health.headers['content-security-policy']?.includes('upgrade-insecure-requests'));
    const unknown = await request(app).get('/api/does-not-exist').expect(404);
    assert.match(unknown.headers['content-type'], /application\/json/);
    assert.equal(typeof unknown.body.error.message, 'string');
  });

  await t.test('A01 authentication is generic, regenerated, safe, and persistent', async () => {
    assert.deepEqual(Object.keys(admin.user).sort(), ['id', 'role', 'username']);
    assert.equal(admin.user.role, 'ADMIN');
    assert.equal(admin.user.username, 'admin');
    assert.equal(user1.user.role, 'USER');
    const cookie = user1.response.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\//i);
    assert.doesNotMatch(cookie, /; Secure/i);
    const me = await user1.agent.get('/api/auth/me').expect(200);
    assert.deepEqual(me.body.user, user1.user);
    assert.equal(me.headers['cache-control'], 'no-store');
    assertSafe(me.body);
    const guest = request.agent(app);
    const csrf = (await guest.get('/api/auth/csrf').expect(200)).body.csrfToken;
    const attemptLogin = body => guest.post('/api/auth/login').set('Origin', config.appOrigin).set('X-CSRF-Token', csrf).send(body);
    const missing = await attemptLogin({ username: 'not_an_account', password: 'unrecognised' }).expect(401);
    const wrong = await attemptLogin({ username: 'user1', password: 'unrecognised' }).expect(401);
    f.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(user2.user.id);
    const inactive = await attemptLogin({ username: 'user2', password: f.passwords.user2 }).expect(401);
    f.db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(user2.user.id);
    for (const response of [missing, wrong, inactive]) {
      assert.equal(response.body.error.message, 'Invalid username or password.');
      assertSafe(response.body);
    }
    await attemptLogin({ username: 'user1', password: f.passwords.user1, role: 'ADMIN' }).expect(400);
    await attemptLogin({ username: 'user1', password: `${f.passwords.user1} ` }).expect(401);
  });

  await t.test('A02 guests cannot reach any protected read or mutation', async () => {
    for (const url of ['/api/auth/me', '/api/challenges', `/api/challenges/${one}`, `/api/challenges/${one}/attachment`,
      '/api/admin/challenges', `/api/admin/challenges/${one}`]) {
      await request(app).get(url).expect(401);
    }
    const guest = request.agent(app);
    const token = (await guest.get('/api/auth/csrf')).body.csrfToken;
    for (const [method, url, body] of [
      ['post', `/api/challenges/${one}/attempts`, { answer: '123' }],
      ['post', '/api/admin/challenges', challengePayload()],
      ['patch', `/api/admin/challenges/${one}`, { isPublished: false }],
      ['delete', `/api/admin/challenges/${one}/attachment`, undefined],
      ['post', '/api/auth/logout', undefined],
    ]) await mutation({ agent: guest, token }, config, method, url, body).expect(401);
  });

  await t.test('A03 server enforces current roles and active-account status', async () => {
    const before = f.db.prepare('SELECT count(*) AS n FROM challenges').get().n;
    await user1.agent.get('/api/admin/challenges').expect(403);
    await user1.agent.get(`/api/admin/challenges/${one}`).expect(403);
    await mutation(user1, config, 'post', '/api/admin/challenges', challengePayload()).expect(403);
    await mutation(user1, config, 'patch', `/api/admin/challenges/${one}`, { isPublished: false }).expect(403);
    await mutation(user1, config, 'post', `/api/admin/challenges/${one}/attachment`).attach('file', Buffer.from('safe'), 'safe.txt').expect(403);
    await mutation(user1, config, 'delete', `/api/admin/challenges/${one}/attachment`).expect(403);
    await submit(admin, one, '123').expect(403);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM challenges').get().n, before);
    f.db.prepare("UPDATE users SET role = 'USER' WHERE id = ?").run(admin.user.id);
    await admin.agent.get('/api/admin/challenges').expect(403);
    f.db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = ?").run(admin.user.id);
    await admin.agent.get('/api/admin/challenges').expect(200);
    f.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(user1.user.id);
    await user1.agent.get('/api/challenges').expect(401);
    await submit(user1, one, '123').expect(401);
    f.db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(user1.user.id);
    user1 = await login(app, config, 'user1', f.passwords.user1);
  });

  await t.test('A17 session-bound CSRF and explicit exact Origin apply to mutations and uploads', async () => {
    const before = counts(f.db, user1.user.id, one);
    await user1.agent.post(`/api/challenges/${one}/attempts`).set('Origin', config.appOrigin).send({ answer: '123' }).expect(403);
    await user1.agent.post(`/api/challenges/${one}/attempts`).set('Origin', config.appOrigin).set('X-CSRF-Token', 'invalid').send({ answer: '123' }).expect(403);
    await user1.agent.post(`/api/challenges/${one}/attempts`).set('Origin', 'http://attacker.invalid').set('X-CSRF-Token', user1.token).send({ answer: '123' }).expect(403);
    await user1.agent.post(`/api/challenges/${one}/attempts`).set('X-CSRF-Token', user1.token).send({ answer: '123' }).expect(403);
    await user1.agent.post(`/api/challenges/${one}/attempts`).set('Origin', config.appOrigin).set('X-CSRF-Token', user2.token).send({ answer: '123' }).expect(403);
    await admin.agent.post(`/api/admin/challenges/${one}/attachment`).set('Origin', config.appOrigin).attach('file', Buffer.from('safe'), 'safe.txt').expect(403);
    await request(app).post('/api/auth/login').set('Origin', config.appOrigin).send({ username: 'admin', password: f.passwords.admin }).expect(403);
    assert.deepEqual(counts(f.db, user1.user.id, one), before);
  });

  await t.test('A04/A05/A18 published lists and detail select only safe account-local fields', async () => {
    const list = await user1.agent.get('/api/challenges').expect(200);
    assert.equal(list.body.challenges.length, 3);
    assert.deepEqual(list.body.challenges.map(item => item.id), ids);
    for (const item of list.body.challenges) {
      assert.equal(item.status, 'not_started');
      assert.equal(typeof item.displayOrder, 'number');
      assert.equal(item.question, undefined);
    }
    const detail = await user1.agent.get(`/api/challenges/${one}`).expect(200);
    assert.equal(typeof detail.body.challenge.question, 'string');
    assert.equal(detail.body.challenge.attachment.name, 'challenge-1.txt');
    assert.ok(detail.body.challenge.attachment.sizeBytes > 0);
    assert.equal(detail.body.challenge.attachment.downloadUrl, `/api/challenges/${one}/attachment`);
    assertSafe(list.body);
    assertSafe(detail.body);
    assertSafe((await admin.agent.get('/api/admin/challenges')).body);
    assertSafe((await admin.agent.get(`/api/admin/challenges/${one}`)).body);
    await user1.agent.get('/api/challenges/1%20OR%201=1').expect(400);
    await user1.agent.get('/api/challenges/999999999').expect(404);
  });

  await t.test('A06/A07 exact strings retain leading zeros, spaces, and capitalization', async () => {
    for (const answer of ['124', '0123', ' 123', '123 ', '123\t']) {
      const result = await submit(user1, one, answer).expect(200);
      assert.deepEqual(result.body, { correct: false, message: 'Fail. Incorrect answer. Try again.', status: 'attempted' });
    }
    const wrongCase = await submit(user1, two, 'hello').expect(200);
    assert.equal(wrongCase.body.correct, false);
    assert.equal((await submit(user1, two, 'HELLO').expect(200)).body.correct, true);
    const result = await submit(user1, one, '123').expect(200);
    assert.deepEqual(result.body, { correct: true, message: 'Success! Correct answer.', status: 'completed' });
  });

  await t.test('A08 malformed answers and authority injection never save attempts', async () => {
    const before = counts(f.db, user1.user.id, one);
    for (const answer of [123, null, [], {}, '', ' ', '\t', 'a'.repeat(201), '123\n', '123\r', 'x\u2028y', 'x\u2029y', 'x\0y']) {
      await submit(user1, one, answer).expect(400);
    }
    for (const body of [{}, { answer: '123', userId: user2.user.id }, { answer: '123', correct: true }, { answer: '123', role: 'ADMIN' }]) {
      await mutation(user1, config, 'post', `/api/challenges/${one}/attempts`, body).expect(400);
    }
    await mutation(user1, config, 'post', `/api/challenges/${one}/attempts`).set('Content-Type', 'application/json').send('{broken').expect(400);
    await mutation(user1, config, 'post', `/api/challenges/${one}/attempts`).type('form').send({ answer: '123' }).expect(400);
    assert.deepEqual(counts(f.db, user1.user.id, one), before);
    assert.ok(!f.db.prepare('PRAGMA table_info(attempts)').all().some(row => /answer/i.test(row.name)));
  });

  await t.test('A11/A12/A13 independent progress and concurrent correct submissions preserve one completion', async () => {
    assert.equal((await user2.agent.get(`/api/challenges/${one}`)).body.challenge.status, 'not_started');
    const replies = await Promise.all(Array.from({ length: 5 }, () => submit(user1, three, 'flag{demo_success}').expect(200)));
    assert.ok(replies.every(result => result.body.correct && result.body.status === 'completed'));
    assert.deepEqual(counts(f.db, user1.user.id, three), { attempts: 5, completions: 1 });
    const wrong = await submit(user1, one, '124').expect(200);
    assert.deepEqual(wrong.body, { correct: false, message: 'Fail. Incorrect answer. Try again.', status: 'completed' });
    const ownOnly = await user2.agent.get(`/api/challenges?userId=${user1.user.id}`).expect(200);
    assert.ok(ownOnly.body.challenges.every(challenge => challenge.status === 'not_started'));
  });

  await t.test('A15 protected sample download forces attachment and does not expose storage', async () => {
    const response = await user1.agent.get(`/api/challenges/${one}/attachment`).expect(200);
    assert.match(response.headers['content-disposition'], /^attachment;/i);
    assert.match(response.headers['content-disposition'], /challenge-1\.txt/);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.text, /123/);
    await user1.agent.get(`/api/challenges/${two}/attachment`).expect(404);
    for (const url of ['/storage/challenge-1.txt', '/data/challenge_portal.sqlite']) {
      const privatePath = await request(app).get(url);
      // A built SPA may serve its generic HTML fallback for an unknown path;
      // it must never serve the private attachment or SQLite bytes.
      assert.ok(privatePath.status === 404 || /text\/html/.test(privatePath.headers['content-type']));
      assert.doesNotMatch(privatePath.text ?? '', /SQLite format 3|three-character code is/i);
    }
  });

  await t.test('A14 admin create/update validates authoring and defaults to draft', async () => {
    for (const overrides of [
      { title: 'ab' }, { title: 'x'.repeat(101) }, { summary: ' ' }, { summary: 'x'.repeat(241) },
      { question: ' ' }, { question: 'x'.repeat(5001) }, { expectedAnswer: '' }, { expectedAnswer: ' a' },
      { expectedAnswer: 'a ' }, { expectedAnswer: 'a\nb' }, { expectedAnswer: 123 }, { expectedAnswer: 'x'.repeat(201) },
      { difficulty: 'extreme' }, { displayOrder: -1 }, { displayOrder: 10000 }, { displayOrder: 1.5 },
      { displayOrder: '1' }, { isPublished: 1 }, { createdBy: user1.user.id },
    ]) await mutation(admin, config, 'post', '/api/admin/challenges', challengePayload(overrides)).expect(400);
    const createdResponse = await mutation(admin, config, 'post', '/api/admin/challenges', challengePayload()).expect(201);
    created = createdResponse.body.challenge.id;
    assert.equal(createdResponse.body.challenge.isPublished, false);
    assertSafe(createdResponse.body);
    assert.equal((await admin.agent.get(`/api/admin/challenges/${created}`)).body.challenge.question, 'Read this question.\nThen answer exactly.');
    await user1.agent.get(`/api/challenges/${created}`).expect(404);
    await mutation(admin, config, 'patch', `/api/admin/challenges/${created}`, { expectedAnswer: '' }).expect(400);
    await mutation(admin, config, 'patch', `/api/admin/challenges/${created}`, {}).expect(400);
    await mutation(admin, config, 'patch', `/api/admin/challenges/${created}`, { answer_hash: 'untrusted' }).expect(400);
    await mutation(admin, config, 'delete', `/api/admin/challenges/${created}`).expect(404);
  });

  await t.test('A14 hiding and answer edits preserve history and omission preserves hash', async () => {
    const before = counts(f.db, user1.user.id, one);
    const hash = f.db.prepare('SELECT answer_hash FROM challenges WHERE id = ?').get(one).answer_hash;
    await mutation(admin, config, 'patch', `/api/admin/challenges/${one}`, { isPublished: false, question: 'An edited question.\nSame completion.' }).expect(200);
    assert.equal(f.db.prepare('SELECT answer_hash FROM challenges WHERE id = ?').get(one).answer_hash, hash);
    assert.ok(!(await user1.agent.get('/api/challenges')).body.challenges.some(row => row.id === one));
    await user1.agent.get(`/api/challenges/${one}`).expect(404);
    await user1.agent.get(`/api/challenges/${one}/attachment`).expect(404);
    await submit(user1, one, '123').expect(404);
    await admin.agent.get(`/api/admin/challenges/${one}`).expect(200);
    await admin.agent.get(`/api/challenges/${one}/attachment`).expect(200);
    assert.deepEqual(counts(f.db, user1.user.id, one), before);
    await mutation(admin, config, 'patch', `/api/admin/challenges/${one}`, { isPublished: true, expectedAnswer: 'updated answer' }).expect(200);
    assert.equal((await user1.agent.get(`/api/challenges/${one}`)).body.challenge.status, 'completed');
    assert.equal((await submit(user1, one, '123').expect(200)).body.correct, false);
    assert.equal((await submit(user1, one, 'updated answer').expect(200)).body.correct, true);
    assert.equal(counts(f.db, user1.user.id, one).completions, 1);
  });

  await t.test('A15/A16 TXT/PDF upload, replacement, validation, missing file, and removal', async () => {
    const endpoint = `/api/admin/challenges/${created}/attachment`;
    const upload = (bytes, filename, contentType) => mutation(admin, config, 'post', endpoint).attach('file', bytes, { filename, contentType });
    await upload(Buffer.from('A harmless fixture.\n'), 'guide.txt', 'text/plain').expect(200);
    const original = f.db.prepare('SELECT attachment_storage_name FROM challenges WHERE id = ?').get(created).attachment_storage_name;
    assert.notEqual(original, 'guide.txt');
    assert.equal(path.basename(original), original);
    await admin.agent.get(`/api/challenges/${created}/attachment`).expect(200);
    await user1.agent.get(`/api/challenges/${created}/attachment`).expect(404);
    const filesBefore = (await readdir(config.uploadDir)).sort();
    for (const [bytes, filename, type] of [
      [Buffer.from('not a PDF'), 'bad.pdf', 'application/pdf'],
      [Buffer.from([...Buffer.from('%PDF-1.7')].map(byte => byte | 0x80)), 'masked.pdf', 'application/pdf'],
      [Buffer.from([0, 1, 2, 3]), 'binary.txt', 'text/plain'],
      [Buffer.from([0xff, 0xfe, 0xff]), 'invalid-utf8.txt', 'text/plain'],
      [Buffer.from('safe text'), 'script.html', 'text/html'],
      [Buffer.from('safe text'), 'archive.zip', 'application/zip'],
    ]) await upload(bytes, filename, type).expect(415);
    await upload(Buffer.alloc(5 * 1024 * 1024 + 1, 'a'), 'large.txt', 'text/plain').expect(413);
    await mutation(admin, config, 'post', endpoint).attach('unexpected', Buffer.from('safe'), 'safe.txt').expect(400);
    await mutation(admin, config, 'post', endpoint).attach('file', Buffer.from('first'), 'one.txt').attach('file', Buffer.from('second'), 'two.txt').expect(400);
    await mutation(admin, config, 'post', endpoint).field('untrusted', 'value').attach('file', Buffer.from('safe'), 'safe.txt').expect(400);
    await mutation(admin, config, 'post', endpoint).set('Content-Type', 'multipart/form-data').send('missing boundary').expect(400);
    await mutation(admin, config, 'post', endpoint).set('Content-Type', 'multipart/form-data; boundary=unfinished')
      .send('--unfinished\r\nContent-Disposition: form-data; name="file"; filename="file.txt"\r\nContent-Type: text/plain\r\n\r\ntruncated').expect(400);
    assert.equal(f.db.prepare('SELECT attachment_storage_name FROM challenges WHERE id = ?').get(created).attachment_storage_name, original);
    assert.deepEqual((await readdir(config.uploadDir)).sort(), filesBefore);
    assert.match((await admin.agent.get(`/api/challenges/${created}/attachment`).expect(200)).text, /harmless/);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
    await upload(pdf, 'reference.pdf', 'application/pdf').expect(200);
    await assert.rejects(readFile(path.join(config.uploadDir, original)), { code: 'ENOENT' });
    await mutation(admin, config, 'patch', `/api/admin/challenges/${created}`, { isPublished: true }).expect(200);
    const downloaded = await user1.agent.get(`/api/challenges/${created}/attachment`).expect(200);
    assert.deepEqual(downloaded.body, pdf);
    assert.match(downloaded.headers['content-disposition'], /^attachment;/i);
    const replacement = f.db.prepare('SELECT attachment_storage_name FROM challenges WHERE id = ?').get(created).attachment_storage_name;
    f.db.prepare('UPDATE challenges SET attachment_storage_name = ? WHERE id = ?').run('../outside.txt', created);
    const traversal = await user1.agent.get(`/api/challenges/${created}/attachment`);
    assert.ok([404, 500, 503].includes(traversal.status));
    assert.doesNotMatch(JSON.stringify(traversal.body), /outside\.txt|[A-Z]:\\|stack/i);
    f.db.prepare('UPDATE challenges SET attachment_storage_name = ? WHERE id = ?').run(replacement, created);
    await unlink(path.join(config.uploadDir, replacement));
    const missing = await user1.agent.get(`/api/challenges/${created}/attachment`);
    assert.ok([404, 500, 503].includes(missing.status));
    assertSafe(missing.body);
    await mutation(admin, config, 'delete', endpoint).expect(204);
    assert.equal((await user1.agent.get(`/api/challenges/${created}`)).body.challenge.attachment, null);
    await user1.agent.get(`/api/challenges/${created}/attachment`).expect(404);
  });

  await t.test('Unicode is not normalized and internal answer spaces remain exact', async () => {
    const response = await mutation(admin, config, 'post', '/api/admin/challenges', challengePayload({ expectedAnswer: '\u00e9 x', isPublished: true })).expect(201);
    const id = response.body.challenge.id;
    assert.equal((await submit(user2, id, 'e\u0301 x').expect(200)).body.correct, false);
    assert.equal((await submit(user2, id, '\u00e9  x').expect(200)).body.correct, false);
    assert.equal((await submit(user2, id, '\u00e9 x').expect(200)).body.correct, true);
  });

  await t.test('seed rerun preserves account changes, authored content, attachments, and progress', async () => {
    const changedPasswordHash = await hashSecret('temporary-test-only-password');
    f.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(changedPasswordHash, user2.user.id);
    const before = f.db.prepare('SELECT * FROM challenges ORDER BY id').all();
    const attemptsBefore = f.db.prepare('SELECT count(*) AS n FROM attempts').get().n;
    const completionsBefore = f.db.prepare('SELECT count(*) AS n FROM completions').get().n;
    const rerun = await seed(f.db, { ...config, seedPasswords: {} });
    assert.deepEqual(rerun, { accountsCreated: 0, challengesCreated: 0 });
    assert.deepEqual(f.db.prepare('SELECT * FROM challenges ORDER BY id').all(), before);
    assert.equal(f.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user2.user.id).password_hash, changedPasswordHash);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM users').get().n, 3);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM attempts').get().n, attemptsBefore);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM completions').get().n, completionsBefore);
  });

  await t.test('A09/A10 actual close/reopen restores completion and unexpired sessions', async () => {
    app = f.restart();
    const restored = await request(app).get('/api/auth/me').set('Cookie', user1.cookie).expect(200);
    assert.deepEqual(restored.body.user, user1.user);
    const detail = await request(app).get(`/api/challenges/${one}`).set('Cookie', user1.cookie).expect(200);
    assert.equal(detail.body.challenge.status, 'completed');
    user1 = await login(app, config, 'user1', f.passwords.user1);
    assert.equal((await user1.agent.get(`/api/challenges/${one}`)).body.challenge.status, 'completed');
    assert.equal(counts(f.db, user1.user.id, one).completions, 1);
  });

  await t.test('A20 logout destroys session and obtains a fresh anonymous CSRF token', async () => {
    const oldCookie = user1.cookie;
    const oldToken = user1.token;
    await mutation(user1, config, 'post', '/api/auth/logout').expect(204);
    await user1.agent.get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Cookie', oldCookie).expect(401);
    const next = await user1.agent.get('/api/auth/csrf').expect(200);
    assert.notEqual(next.body.csrfToken, oldToken);
    await user1.agent.post('/api/auth/login').set('Origin', config.appOrigin).set('X-CSRF-Token', oldToken)
      .send({ username: 'user1', password: f.passwords.user1 }).expect(403);
  });
});

test('verification races, transactional rollback, and rate limits', { timeout: 120_000 }, async t => {
  const f = await fixture();
  t.after(() => f.close());
  const config = f.config;
  const one = f.db.prepare('SELECT id FROM challenges ORDER BY display_order, id').get().id;
  let hook = async () => {};
  const app = f.app({ verifyAnswer: async (hash, value) => {
    assert.equal(f.db.inTransaction, false, 'Argon2 must run outside a synchronous transaction.');
    const correct = await verifySecret(hash, value);
    await hook();
    return correct;
  } });
  const user = await login(app, config, 'user1', f.passwords.user1);
  const submit = () => mutation(user, config, 'post', `/api/challenges/${one}/attempts`, { answer: '123' });

  await t.test('hidden challenge during asynchronous verification returns 404 without an attempt', async () => {
    hook = async () => { f.db.prepare('UPDATE challenges SET is_published = 0 WHERE id = ?').run(one); };
    await submit().expect(404);
    assert.deepEqual(counts(f.db, user.user.id, one), { attempts: 0, completions: 0 });
    f.db.prepare('UPDATE challenges SET is_published = 1 WHERE id = ?').run(one);
  });
  await t.test('answer replacement during verification returns retryable 409 without an attempt', async () => {
    const original = f.db.prepare('SELECT answer_hash FROM challenges WHERE id = ?').get(one).answer_hash;
    const changed = await hashSecret('replacement');
    hook = async () => { f.db.prepare('UPDATE challenges SET answer_hash = ? WHERE id = ?').run(changed, one); };
    const result = await submit().expect(409);
    assert.equal(result.body.error.message, 'Challenge changed. Refresh and try again.');
    assert.deepEqual(counts(f.db, user.user.id, one), { attempts: 0, completions: 0 });
    f.db.prepare('UPDATE challenges SET answer_hash = ? WHERE id = ?').run(original, one);
    hook = async () => {};
  });
  await t.test('A19 failed completion write rolls back preceding attempt and returns service error', async () => {
    f.db.exec("CREATE TRIGGER test_fail_completion BEFORE INSERT ON completions BEGIN SELECT RAISE(ABORT, 'isolated test write failure'); END");
    try {
      const result = await submit();
      assert.ok([500, 503].includes(result.status));
      assert.equal(result.body.correct, undefined);
      assert.equal(result.body.error.message, 'Could not check your answer. Please retry.');
      assert.doesNotMatch(JSON.stringify(result.body), /SQLITE|TRIGGER|test write failure|stack|INSERT/i);
      assert.deepEqual(counts(f.db, user.user.id, one), { attempts: 0, completions: 0 });
    } finally {
      f.db.exec('DROP TRIGGER test_fail_completion');
    }
    const retried = await submit().expect(200);
    assert.equal(retried.body.correct, true);
    assert.deepEqual(counts(f.db, user.user.id, one), { attempts: 1, completions: 1 });
  });
  await t.test('login and answer limits return 429 with retry interval and save no excess attempt', async () => {
    const limited = f.app({ config: { ...config, loginMax: 1, answerMax: 1 } });
    const actor = await login(limited, config, 'user2', f.passwords.user2);
    const first = await mutation(actor, config, 'post', `/api/challenges/${one}/attempts`, { answer: '124' }).expect(200);
    assert.equal(first.body.correct, false);
    const throttled = await mutation(actor, config, 'post', `/api/challenges/${one}/attempts`, { answer: '123' }).expect(429);
    assert.ok(Number(throttled.headers['retry-after']) > 0);
    assert.deepEqual(counts(f.db, actor.user.id, one), { attempts: 1, completions: 0 });
    const guest = request.agent(limited);
    const token = (await guest.get('/api/auth/csrf')).body.csrfToken;
    const outgoing = () => guest.post('/api/auth/login').set('Origin', config.appOrigin).set('X-CSRF-Token', token)
      .send({ username: 'unknown_account', password: 'unrecognised' });
    const result = await outgoing();
    // An IP-wide limiter may already include the successful user2 login.
    assert.ok([401, 429].includes(result.status));
    const loginThrottled = await outgoing().expect(429);
    assert.ok(Number(loginThrottled.headers['retry-after']) > 0);
  });
});
