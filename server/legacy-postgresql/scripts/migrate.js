import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, serverRoot } from '../src/config.js';
import { createPool } from '../src/db.js';

export async function migrate(pool) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('BEGIN');
    // Serialize migration runners without creating or changing a database.
    await client.query('SELECT pg_advisory_xact_lock($1)', [715420601]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(path.join(serverRoot, 'migrations')))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
    for (const name of files) {
      const existing = await client.query('SELECT name FROM schema_migrations WHERE name = $1', [name]);
      if (existing.rowCount) continue;
      const sql = await readFile(path.join(serverRoot, 'migrations', name), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      applied.push(name);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let pool;
  try {
    const config = loadConfig();
    pool = createPool(config);
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Migrations are already up to date.');
  } catch (error) {
    if (!pool) console.error(error.message);
    else console.error('Migration failed. Check PostgreSQL availability, credentials, database permissions, and migration files.');
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
}
