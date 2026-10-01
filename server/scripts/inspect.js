import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db.js';

export function inspectDatabase(db) {
  // The allowlist intentionally excludes arbitrary SQL or row contents.
  const tables = ['schema_migrations', 'users', 'challenges', 'attempts', 'completions', 'sessions', 'seed_fixtures'];
  const exists = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?");
  return tables.map((table) => ({
    table,
    rows: exists.get(table) ? db.prepare(`SELECT count(*) AS count FROM "${table}"`).get().count : 'not migrated',
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let db;
  try {
    const config = loadConfig();
    db = createDatabase(config);
    console.log(`Database: ${config.dbFile}`);
    console.table(inspectDatabase(db));
  } catch (error) {
    if (!db && !error.code) console.error(error.message);
    else console.error('Inspection failed. Check DB_FILE and local database permissions.');
    process.exitCode = 1;
  } finally {
    if (db?.open) db.close();
  }
}
