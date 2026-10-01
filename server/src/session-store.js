import session from 'express-session';

export class SQLiteSessionStore extends session.Store {
  constructor({ db, ttlMs = 8 * 60 * 60 * 1000, cleanupIntervalMs = 15 * 60 * 1000 }) {
    super();
    this.db = db;
    this.ttlMs = ttlMs;
    if (cleanupIntervalMs > 0) {
      this.timer = setInterval(() => {
        try { this.cleanup(); } catch (error) { this.emit('error', error); }
      }, cleanupIntervalMs);
      this.timer.unref();
    }
  }
  expires(sessionData) {
    const cookie = sessionData.cookie ?? {};
    const value = cookie.expires != null ? new Date(cookie.expires).getTime()
      : Date.now() + (typeof cookie.maxAge === 'number' ? cookie.maxAge : this.ttlMs);
    if (!Number.isSafeInteger(value)) throw new Error('Invalid session expiry.');
    return value;
  }
  // Invoke outside the try/catch: an exception in a consumer callback must never
  // cause a second callback. All JSON/SQLite errors reach the original callback.
  complete(callback, operation) {
    let error = null; let result;
    try { result = operation(); } catch (failure) { error = failure; }
    queueMicrotask(() => callback?.(error, result));
  }
  get(sid, callback) {
    this.complete(callback, () => {
      const row = this.db.prepare('SELECT data, expires_at FROM sessions WHERE sid=?').get(sid);
      if (!row) return null;
      if (row.expires_at <= Date.now()) {
        this.db.prepare('DELETE FROM sessions WHERE sid=? AND expires_at<=?').run(sid, Date.now());
        return null;
      }
      const data = JSON.parse(row.data);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid session data.');
      return data;
    });
  }
  set(sid, data, callback) {
    this.complete(callback, () => {
      const serialized = JSON.stringify(data);
      if (!serialized || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid session data.');
      const expiresAt = this.expires(data);
      if (expiresAt <= Date.now()) { this.db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); return; }
      this.db.prepare('INSERT INTO sessions (sid,data,expires_at) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at')
        .run(sid, serialized, expiresAt);
    });
  }
  destroy(sid, callback) {
    this.complete(callback, () => { this.db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); });
  }
  touch(sid, data, callback) {
    this.complete(callback, () => {
      this.db.prepare('UPDATE sessions SET expires_at=? WHERE sid=? AND expires_at>?').run(this.expires(data), sid, Date.now());
    });
  }
  cleanup() { this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now()); }
  close() { clearInterval(this.timer); this.timer = undefined; }
}
