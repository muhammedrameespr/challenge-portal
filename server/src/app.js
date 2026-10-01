import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { projectRoot } from './config.js';
import { SQLiteSessionStore } from './session-store.js';
import { hashSecret, verifySecret } from './hash.js';
import { HttpError, parse, parseId, requireJson, loginSchema, attemptSchema, createChallengeSchema, updateChallengeSchema } from './validation.js';
import { safeColumns, progressSql, safeChallenge, submitAttempt } from './challenges.js';
import { MAX_FILE_SIZE, validateFile, saveFile, removeFile, existingFile } from './files.js';

const sessionCall = (req, method) => new Promise((resolve, reject) => req.session[method](error => error ? reject(error) : resolve()));
const token = () => randomBytes(32).toString('hex');
const notFound = () => new HttpError(404, 'NOT_FOUND', 'Challenge not found.');

export function createApp({ db, config, verifyAnswer = verifySecret }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ?? false);
  app.use(helmet({
    strictTransportSecurity: config.secureCookies ? undefined : false,
    contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': config.secureCookies ? [] : null } },
  }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', (req, res) => {
    try { db.prepare('SELECT 1 FROM users LIMIT 1').get(); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable. Please retry.' } }); }
  });
  app.use('/api', express.json({ limit: '64kb', strict: true }));
  const store = new SQLiteSessionStore({ db });
  store.on('error', () => console.error('Session database operation failed.'));
  app.locals.sessionStore = store;
  const cookie = { httpOnly: true, sameSite: 'lax', secure: Boolean(config.secureCookies), path: '/', maxAge: 8 * 60 * 60 * 1000 };
  app.use('/api', session({ name: 'challenge.sid', secret: config.sessionSecret, store,
    resave: false, saveUninitialized: false, cookie }));
  const clearCookie = res => res.clearCookie('challenge.sid', { httpOnly: true, sameSite: 'lax', secure: cookie.secure, path: '/' });
  const csrf = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const provided = req.get('X-CSRF-Token');
    const expected = req.session?.csrfToken;
    if (req.get('Origin') !== config.appOrigin || typeof provided !== 'string' || typeof expected !== 'string'
      || !/^[a-f0-9]{64}$/.test(provided) || provided.length !== expected.length
      || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return next(new HttpError(403, 'CSRF_INVALID', 'Security check failed. Refresh and try again.'));
    }
    next();
  };
  const authenticate = async (req, res, next) => {
    const userId = req.session?.userId;
    const row = Number.isSafeInteger(userId) ? db.prepare('SELECT id, username, role, is_active FROM users WHERE id=?').get(userId) : null;
    if (!row?.is_active) {
      if (userId) { await sessionCall(req, 'destroy'); clearCookie(res); }
      throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    }
    req.user = { id: row.id, username: row.username, role: row.role };
    next();
  };
  const role = expected => (req, res, next) => req.user.role === expected ? next() : next(new HttpError(403, 'FORBIDDEN', 'You do not have access to this action.'));
  const limitOptions = { standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please retry after the cooldown.' } }) };
  const loginIpLimit = rateLimit({ ...limitOptions, windowMs: config.loginWindowMs ?? 900000, limit: config.loginMax ?? 10 });
  const loginNameLimit = rateLimit({ ...limitOptions, windowMs: config.loginWindowMs ?? 900000, limit: config.loginMax ?? 10,
    keyGenerator: req => typeof req.body?.username === 'string' ? req.body.username.toLowerCase().slice(0, 30) : 'invalid' });
  const answerLimit = rateLimit({ ...limitOptions, windowMs: config.answerWindowMs ?? 60000, limit: config.answerMax ?? 20, keyGenerator: req => String(req.user.id) });

  app.get('/api/auth/csrf', async (req, res) => {
    if (!req.session.csrfToken) req.session.csrfToken = token();
    await sessionCall(req, 'save');
    res.json({ csrfToken: req.session.csrfToken });
  });
  // A per-process dummy hash avoids a quick username-existence timing shortcut.
  const dummyHash = hashSecret(randomBytes(32).toString('hex'));
  app.post('/api/auth/login', csrf, requireJson, loginIpLimit, loginNameLimit, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const row = db.prepare('SELECT id, username, role, is_active, password_hash FROM users WHERE username=?').get(input.username.toLowerCase());
    const valid = await verifySecret(row?.password_hash ?? await dummyHash, input.password);
    // Re-read after asynchronous hashing, so deactivation/role edits take effect.
    const current = row && db.prepare('SELECT id, username, role, is_active, password_hash FROM users WHERE id=?').get(row.id);
    if (!valid || !current?.is_active || current.password_hash !== row.password_hash) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    await sessionCall(req, 'regenerate');
    req.session.userId = current.id;
    req.session.csrfToken = token();
    await sessionCall(req, 'save');
    res.json({ user: { id: current.id, username: current.username, role: current.role }, csrfToken: req.session.csrfToken });
  });
  app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/logout', authenticate, csrf, async (req, res) => {
    await sessionCall(req, 'destroy'); clearCookie(res); res.status(204).end();
  });
  app.get('/api/challenges', authenticate, (req, res) => {
    const rows = db.prepare(`SELECT ${safeColumns}, ${progressSql} FROM challenges c WHERE c.is_published=1 ORDER BY c.display_order,c.id`).all({ userId: req.user.id });
    res.json({ challenges: rows.map(row => safeChallenge(row)) });
  });
  app.get('/api/challenges/:id', authenticate, (req, res) => {
    const row = db.prepare(`SELECT ${safeColumns}, ${progressSql} FROM challenges c WHERE c.id=@id AND c.is_published=1`).get({ userId: req.user.id, id: parseId(req.params.id) });
    if (!row) throw notFound();
    res.json({ challenge: safeChallenge(row, { detail: true }) });
  });
  app.post('/api/challenges/:id/attempts', authenticate, role('USER'), csrf, answerLimit, requireJson, async (req, res) => {
    const id = parseId(req.params.id); const { answer } = parse(attemptSchema, req.body);
    res.json(await submitAttempt(db, req.user.id, id, answer, verifyAnswer));
  });
  app.get('/api/challenges/:id/attachment', authenticate, async (req, res, next) => {
    const row = db.prepare('SELECT is_published, attachment_storage_name, attachment_original_name, attachment_mime FROM challenges WHERE id=?').get(parseId(req.params.id));
    if (!row || (!row.is_published && req.user.role !== 'ADMIN') || !row.attachment_storage_name) throw notFound();
    const filePath = await existingFile(config.uploadDir, row.attachment_storage_name);
    res.type(row.attachment_mime).set('X-Content-Type-Options', 'nosniff');
    res.download(filePath, row.attachment_original_name, { dotfiles: 'deny' }, error => {
      if (!error) return;
      if (res.headersSent) { res.destroy(); return; }
      next(error.code === 'ENOENT' ? new HttpError(404, 'FILE_NOT_FOUND', 'Attachment unavailable.') : error);
    });
  });

  const admin = express.Router();
  admin.use(authenticate, role('ADMIN'), csrf);
  const readAdmin = id => {
    const row = db.prepare(`SELECT ${safeColumns} FROM challenges c WHERE c.id=?`).get(id);
    if (!row) throw notFound();
    return safeChallenge(row, { detail: true, admin: true });
  };
  admin.get('/challenges', (req, res) => {
    const rows = db.prepare(`SELECT ${safeColumns} FROM challenges c ORDER BY c.display_order,c.id`).all();
    res.json({ challenges: rows.map(row => safeChallenge(row, { admin: true })) });
  });
  admin.get('/challenges/:id', (req, res) => res.json({ challenge: readAdmin(parseId(req.params.id)) }));
  admin.post('/challenges', requireJson, async (req, res) => {
    const input = parse(createChallengeSchema, req.body);
    const answerHash = await hashSecret(input.expectedAnswer);
    const result = db.prepare(`INSERT INTO challenges (title,summary,question,answer_hash,difficulty,display_order,is_published,created_by)
      VALUES (?,?,?,?,?,?,?,?)`).run(input.title,input.summary,input.question,answerHash,input.difficulty,input.displayOrder,input.isPublished ? 1 : 0,req.user.id);
    res.status(201).json({ challenge: readAdmin(Number(result.lastInsertRowid)) });
  });
  admin.patch('/challenges/:id', requireJson, async (req, res) => {
    const id = parseId(req.params.id); const input = parse(updateChallengeSchema, req.body);
    readAdmin(id);
    const columns = { title: 'title', summary: 'summary', question: 'question', expectedAnswer: 'answer_hash', difficulty: 'difficulty', displayOrder: 'display_order', isPublished: 'is_published' };
    const values = { ...input };
    if (Object.hasOwn(input, 'expectedAnswer')) values.expectedAnswer = await hashSecret(input.expectedAnswer);
    if (Object.hasOwn(input, 'isPublished')) values.isPublished = input.isPublished ? 1 : 0;
    const keys = Object.keys(values);
    db.prepare(`UPDATE challenges SET ${keys.map(key => `${columns[key]}=?`).join(',')}, updated_at=? WHERE id=?`)
      .run(...keys.map(key => values[key]), new Date().toISOString(), id);
    res.json({ challenge: readAdmin(id) });
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 0, parts: 2 } }).single('file');
  const receiveUpload = (req, res, next) => upload(req, res, error => {
    if (error && !(error instanceof multer.MulterError) && /multipart|boundary|unexpected end of form|malformed part/i.test(error.message)) {
      return next(new HttpError(400, 'INVALID_FILE', 'Invalid upload. Choose one TXT or PDF file and retry.'));
    }
    next(error);
  });
  admin.post('/challenges/:id/attachment', (req, res, next) => {
    readAdmin(parseId(req.params.id)); next();
  }, receiveUpload, async (req, res) => {
    const id = parseId(req.params.id); const metadata = validateFile(req.file);
    let saved = false; let old;
    try {
      await saveFile(config.uploadDir, req.file, metadata); saved = true;
      old = db.transaction(() => {
        const row = db.prepare('SELECT attachment_storage_name FROM challenges WHERE id=?').get(id);
        if (!row) throw notFound();
        db.prepare(`UPDATE challenges SET attachment_storage_name=?,attachment_original_name=?,attachment_mime=?,attachment_size=?,updated_at=? WHERE id=?`)
          .run(metadata.storageName,metadata.name,metadata.mime,metadata.size,new Date().toISOString(),id);
        return row.attachment_storage_name;
      }).immediate();
    } catch (error) { if (saved) await removeFile(config.uploadDir, metadata.storageName); throw error; }
    await removeFile(config.uploadDir, old);
    res.json({ challenge: readAdmin(id) });
  });
  admin.delete('/challenges/:id/attachment', async (req, res) => {
    const id = parseId(req.params.id);
    const old = db.transaction(() => {
      const row = db.prepare('SELECT attachment_storage_name FROM challenges WHERE id=?').get(id);
      if (!row) throw notFound();
      db.prepare(`UPDATE challenges SET attachment_storage_name=NULL,attachment_original_name=NULL,attachment_mime=NULL,attachment_size=NULL,updated_at=? WHERE id=?`).run(new Date().toISOString(),id);
      return row.attachment_storage_name;
    }).immediate();
    await removeFile(config.uploadDir, old); res.status(204).end();
  });
  app.use('/api/admin', admin);
  app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }));
  const dist = path.join(projectRoot, 'client', 'dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, dotfiles: 'deny' }));
    app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error instanceof HttpError ? error.status : 503;
    let code = error instanceof HttpError ? error.code : 'SERVICE_UNAVAILABLE';
    let message = error instanceof HttpError ? error.message : 'Service unavailable. Please retry.';
    if (error instanceof multer.MulterError) {
      status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      code = error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_FILE';
      message = status === 413 ? 'Files must be 5 MiB or smaller.' : 'Upload exactly one file using the file field.';
    } else if (['entity.parse.failed', 'entity.too.large', 'charset.unsupported', 'encoding.unsupported', 'request.aborted', 'request.size.invalid'].includes(error.type)) {
      status = error.type === 'entity.too.large' ? 413 : 400; code = 'INVALID_INPUT'; message = 'Invalid JSON request body.';
    }
    if (status === 503) {
      res.set('Retry-After', '1');
      if (/^\/api\/challenges\/[^/]+\/attempts$/.test(req.path)) message = 'Could not check your answer. Please retry.';
    }
    res.status(status).json({ error: { code, message } });
  });
  return app;
}
