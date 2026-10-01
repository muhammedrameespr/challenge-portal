import { closeSync, openSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, projectRoot, serverRoot } from '../src/config.js';
import { createDatabase } from '../src/db.js';

export async function backupDatabase(db, config, destination) {
  const target = path.resolve(serverRoot, destination || `./data/backups/challenge-portal-${Date.now()}.sqlite`);
  const client = path.join(projectRoot, 'client');
  const relative = path.relative(client, target);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Backup destination must be outside the client directory.');
  }
  if (target.toLowerCase() === path.resolve(config.dbFile).toLowerCase()) {
    throw new Error('Backup destination must differ from DB_FILE.');
  }
  await mkdir(path.dirname(target), { recursive: true });
  // Refuse to replace an existing backup (or any other existing file).
  closeSync(openSync(target, 'wx'));
  try {
    await db.backup(target);
    return target;
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let db;
  try {
    const config = loadConfig();
    db = createDatabase(config);
    const destination = await backupDatabase(db, config, process.argv[2]);
    console.log(`Database backup created: ${destination}`);
    console.log('Back up the private attachment directory as well. Pause content edits while coordinating both backups.');
  } catch (error) {
    if ((!db && !error.code) || error.message.startsWith('Backup destination')) console.error(error.message);
    else console.error('Backup failed. Choose a new private destination and check local read/write permissions.');
    process.exitCode = 1;
  } finally {
    if (db?.open) db.close();
  }
}
