import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { createApp } from './app.js';

let db;
try {
  const config = loadConfig();
  db = createDatabase(config);
  db.prepare('SELECT sid FROM sessions LIMIT 0').get();
  const app = createApp({ db, config });
  const server = createServer(app);
  server.listen(config.port, '127.0.0.1', () => console.log(`Challenge Portal listening at http://localhost:${config.port}\nDatabase: ${config.dbFile}`));
  let closing = false;
  const shutdown = () => {
    if (closing) return; closing = true;
    server.close(() => { app.locals.sessionStore.close(); if (db.open) db.close(); });
    server.closeIdleConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('error', () => { console.error('Could not start the server. Check the port and local configuration.'); app.locals.sessionStore.close(); if (db.open) db.close(); process.exitCode = 1; });
} catch {
  if (db?.open) db.close();
  console.error('Startup failed. Check server/.env and run npm run db:migrate.');
  process.exitCode = 1;
}
