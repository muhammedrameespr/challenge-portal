import path from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';

export function createDatabase(config) {
  mkdirSync(path.dirname(config.dbFile), { recursive: true });
  const db = new Database(config.dbFile, { timeout: 5000 });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
