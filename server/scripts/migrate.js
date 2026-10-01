import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, serverRoot } from '../src/config.js';
import { createDatabase } from '../src/db.js';

export function migrate(db) {
  // Migration SQL is trusted project source; all variable values are bound.
  return db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT`);
    const files = readdirSync(path.join(serverRoot, 'migrations'))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
    const existing = db.prepare('SELECT name FROM schema_migrations WHERE name = ?');
    const record = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');
    const applied = [];
    for (const name of files) {
      if (existing.get(name)) continue;
      db.exec(readFileSync(path.join(serverRoot, 'migrations', name), 'utf8'));
      record.run(name);
      applied.push(name);
    }
    return applied;
  }).immediate();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let db;
  try {
    db = createDatabase(loadConfig());
    const applied = migrate(db);
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Migrations are already up to date.');
  } catch (error) {
    if (!db && !error.code) console.error(error.message);
    else console.error('Migration failed. Check DB_FILE, local write permissions, and migration files.');
    process.exitCode = 1;
  } finally {
    if (db?.open) db.close();
  }
}
