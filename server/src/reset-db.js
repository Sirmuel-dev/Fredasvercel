import 'dotenv/config';
import { initializeDatabase, resetDatabase, pool } from './db.js';

try {
  await initializeDatabase();
  await resetDatabase();
  console.log('Freda\'s database reset. Operational data is empty; Vilnius has Samuel and Clemence only.');
} finally {
  await pool.end();
}
