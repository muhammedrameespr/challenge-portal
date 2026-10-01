import pg from 'pg';

export function createPool(config) {
  const pool = new pg.Pool(config.pg);
  // An idle connection can fail independently of a request. Do not print
  // connection details, SQL, or raw driver errors containing local settings.
  pool.on('error', () => console.error('An idle database connection failed.'));
  return pool;
}
