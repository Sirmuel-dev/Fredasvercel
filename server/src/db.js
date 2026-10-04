import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required. Use the Supabase connection string from Project Settings > Database > Connect.');
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
export const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX || 1),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

export async function query(text, params = [], client = pool) {
  return client.query(text, params);
}

export async function one(text, params = [], client = pool) {
  const result = await client.query(text, params);
  return result.rows[0] || null;
}

export async function all(text, params = [], client = pool) {
  const result = await client.query(text, params);
  return result.rows;
}

export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const schema = `
CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','worker')),
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));

CREATE TABLE IF NOT EXISTS menu_items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  break_started_at TIMESTAMPTZ,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, work_date)
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  chicken_status TEXT CHECK(chicken_status IN ('available','low','finished')),
  chicken_kg NUMERIC,
  beef_status TEXT CHECK(beef_status IN ('available','low','finished')),
  beef_kg NUMERIC,
  shawarma_jars NUMERIC,
  garlic_jars NUMERIC,
  refill_bowl_empty BOOLEAN NOT NULL DEFAULT FALSE,
  other_items TEXT,
  notes TEXT,
  total_sold INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS report_sales (
  report_id INTEGER NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(report_id, menu_item_id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  category TEXT NOT NULL,
  item TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS needs (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  source_report_id INTEGER REFERENCES daily_reports(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  reason TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('normal','high','urgent')),
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  source_report_id INTEGER REFERENCES daily_reports(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  restocked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_branch_date ON attendance(branch_id, work_date);
CREATE INDEX IF NOT EXISTS idx_reports_branch_date ON daily_reports(branch_id, report_date);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON expenses(branch_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_needs_branch_resolved ON needs(branch_id, resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_branch ON alerts(branch_id, acknowledged, restocked);
`;

async function ensureBranch(name) {
  await query(`INSERT INTO branches(name) VALUES ($1) ON CONFLICT(name) DO NOTHING`, [name]);
  return one(`SELECT id,name FROM branches WHERE name=$1`, [name]);
}

async function ensureUser({ username, password, name, role, branchId = null }) {
  const existing = await one(`SELECT id FROM users WHERE LOWER(username)=LOWER($1)`, [username]);
  if (existing) return;
  const hash = await bcrypt.hash(password, 12);
  await query(`INSERT INTO users(username,password_hash,name,role,branch_id) VALUES ($1,$2,$3,$4,$5)`, [username, hash, name, role, branchId]);
}

export async function seedDatabase() {
  const vilnius = await ensureBranch('Vilnius');
  await ensureBranch('Kaunas');
  await ensureBranch('Klaipėda');

  await ensureUser({ username: 'owner', password: process.env.SEED_OWNER_PASSWORD || 'Owner123!', name: 'Owner', role: 'owner' });
  await ensureUser({ username: 'samuel', password: process.env.SEED_WORKER_PASSWORD || 'Worker123!', name: 'Samuel', role: 'worker', branchId: vilnius.id });
  await ensureUser({ username: 'clemence', password: process.env.SEED_WORKER_PASSWORD || 'Worker123!', name: 'Clemence', role: 'worker', branchId: vilnius.id });

  const items = [
    'XXL Šavarma komplektas','XXL kebabo komplektas','Šavarma komplektas','Kebabo komplektas',
    'Komplektas prancūziškoje duonoje','Kebabas XXL','Kebabas S','Šavarma XXL','Šavarma S',
    'BBQ sparneliai','BBQ sparnelių komplektas','Freda’s Soul bulvytės','Turkiškos salotos',
    'Prancūziškoje duonoje','Klasikinės salotos'
  ];
  for (let i = 0; i < items.length; i++) {
    await query(`INSERT INTO menu_items(name,sort_order) VALUES ($1,$2) ON CONFLICT(name) DO NOTHING`, [items[i], i + 1]);
  }
}

export async function initializeDatabase() {
  await query(schema);
  await seedDatabase();
}

export async function resetDatabase() {
  await query(`TRUNCATE TABLE report_sales, daily_reports, attendance, expenses, needs, alerts, activity_logs, users, menu_items, branches RESTART IDENTITY CASCADE`);
  await seedDatabase();
}
