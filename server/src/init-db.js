import 'dotenv/config';
import { initializeDatabase, pool } from './db.js';

try {
  await initializeDatabase();
  console.log('Freda\'s PostgreSQL schema is ready and seed data is present.');
} finally {
  await pool.end();
}
