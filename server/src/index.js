import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { all, initializeDatabase, one, pool, query, transaction } from './db.js';
import { requireAuth, requireOwner, signToken, canAccessBranch } from './auth.js';
import { currentWeekRange, hoursBetween, isSunday, localDateKey, nowIso } from './time.js';

const app = express();
const port = Number(process.env.PORT || 5000);
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: false
}));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

const ready = initializeDatabase();
app.use('/api', asyncHandler(async (_req, _res, next) => { await ready; next(); }));

const safeText = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const asNumberOrNull = v => (v === '' || v === null || v === undefined ? null : Number(v));
const validStatus = v => ['available', 'low', 'finished'].includes(v) ? v : null;

async function assertBranch(req, res) {
  const branchId = Number(req.params.branchId);
  if (!Number.isInteger(branchId)) {
    res.status(400).json({ error: 'Invalid branch' });
    return null;
  }
  const branch = await one('SELECT id,name FROM branches WHERE id=$1', [branchId]);
  if (!branch) {
    res.status(404).json({ error: 'Branch not found' });
    return null;
  }
  if (!canAccessBranch(req.user, branchId)) {
    res.status(403).json({ error: 'You cannot access this branch' });
    return null;
  }
  return branch;
}

async function logActivity({ branchId = null, userId = null, action, details = '' }, client = pool) {
  await client.query(
    'INSERT INTO activity_logs(branch_id,user_id,action,details,created_at) VALUES ($1,$2,$3,$4,$5)',
    [branchId, userId, action, safeText(details, 1000), nowIso()]
  );
}

async function hydrateReport(row, client = pool) {
  if (!row) return null;
  const salesRows = await all(`
    SELECT mi.id, mi.name, rs.quantity
    FROM report_sales rs JOIN menu_items mi ON mi.id=rs.menu_item_id
    WHERE rs.report_id=$1 ORDER BY mi.sort_order, mi.name
  `, [row.id], client);
  const sales = Object.fromEntries(salesRows.map(x => [x.id, x.quantity]));
  return {
    id: row.id,
    branchId: row.branch_id,
    worker: row.worker_name,
    userId: row.user_id,
    reportDate: row.report_date,
    submittedAt: row.submitted_at,
    chicken: { status: row.chicken_status, kg: row.chicken_kg === null ? null : Number(row.chicken_kg) },
    beef: { status: row.beef_status, kg: row.beef_kg === null ? null : Number(row.beef_kg) },
    sauces: {
      shawarma: row.shawarma_jars === null ? null : Number(row.shawarma_jars),
      garlic: row.garlic_jars === null ? null : Number(row.garlic_jars)
    },
    refillBowlEmpty: Boolean(row.refill_bowl_empty),
    otherItems: row.other_items || '',
    notes: row.notes || '',
    totalSold: Number(row.total_sold || 0),
    sales,
    salesRows
  };
}

async function latestReport(branchId) {
  const row = await one(`
    SELECT dr.*, u.name AS worker_name
    FROM daily_reports dr JOIN users u ON u.id=dr.user_id
    WHERE dr.branch_id=$1 ORDER BY dr.submitted_at DESC LIMIT 1
  `, [branchId]);
  return hydrateReport(row);
}

async function createNeed(branchId, reportId, label, reason, priority = 'high') {
  const existing = await one('SELECT id FROM needs WHERE branch_id=$1 AND label=$2 AND resolved=FALSE', [branchId, label]);
  if (existing) return existing.id;
  const inserted = await one(`
    INSERT INTO needs(branch_id,source_report_id,label,reason,priority,resolved,created_at)
    VALUES ($1,$2,$3,$4,$5,FALSE,$6) RETURNING id
  `, [branchId, reportId, label, reason, priority, nowIso()]);
  return inserted.id;
}

async function processReportNeeds(report) {
  const { branchId, id: reportId, chicken, beef, sauces, refillBowlEmpty, otherItems } = report;
  if (chicken.status === 'low') await createNeed(branchId, reportId, 'Chicken', 'Chicken was marked LOW.', 'high');
  if (chicken.status === 'finished') await createNeed(branchId, reportId, 'Chicken', 'Chicken was marked FINISHED.', 'urgent');
  if (beef.status === 'low') await createNeed(branchId, reportId, 'Beef', 'Beef was marked LOW.', 'high');
  if (beef.status === 'finished') await createNeed(branchId, reportId, 'Beef', 'Beef was marked FINISHED.', 'urgent');
  if (sauces.shawarma !== null && Number(sauces.shawarma) <= 1) {
    await createNeed(branchId, reportId, 'Shawarma Sauce', `${sauces.shawarma} jar(s) remaining.`, Number(sauces.shawarma) === 0 ? 'urgent' : 'high');
  }
  if (sauces.garlic !== null && Number(sauces.garlic) <= 1) {
    await createNeed(branchId, reportId, 'Garlic Sauce', `${sauces.garlic} jar(s) remaining.`, Number(sauces.garlic) === 0 ? 'urgent' : 'high');
  }

  const items = safeText(otherItems, 1000).split(/[,\n]/).map(x => x.trim()).filter(Boolean).slice(0, 20);
  for (const item of items) {
    await createNeed(branchId, reportId, item, 'Requested in the end-of-day report.', 'normal');
  }

  if (refillBowlEmpty && Number(sauces.shawarma) <= 1 && Number(sauces.garlic) <= 1) {
    const active = await one(`
      SELECT id FROM alerts
      WHERE branch_id=$1 AND acknowledged=FALSE AND restocked=FALSE AND message LIKE 'Urgent sauce stock:%'
    `, [branchId]);
    if (!active) {
      await query(`
        INSERT INTO alerts(branch_id,source_report_id,message,acknowledged,restocked,created_at)
        VALUES ($1,$2,$3,FALSE,FALSE,$4)
      `, [branchId, reportId, `Urgent sauce stock: Shawarma Sauce ${sauces.shawarma}/3 jar(s), Garlic Sauce ${sauces.garlic}/3 jar(s), and the refill bowl is empty.`, nowIso()]);
    }
  }
}

app.get('/api/health', asyncHandler(async (_req, res) => {
  await one('SELECT 1 AS ok');
  res.json({ ok: true, database: 'postgres' });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const username = safeText(req.body.username, 80).toLowerCase();
  const password = String(req.body.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  const user = await one(`
    SELECT id,username,password_hash,name,role,branch_id AS "branchId",active
    FROM users WHERE LOWER(username)=LOWER($1)
  `, [username]);
  if (!user || !user.active || !await bcrypt.compare(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = signToken(user);
  await logActivity({ branchId: user.branchId, userId: user.id, action: 'login', details: `${user.name} signed in` });
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role, branchId: user.branchId } });
}));

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

app.post('/api/auth/change-password', requireAuth, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const row = await one('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!row || !await bcrypt.compare(currentPassword, row.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
  await logActivity({ branchId: req.user.branchId, userId: req.user.id, action: 'password_changed', details: 'Password changed' });
  res.json({ ok: true });
}));

app.get('/api/branches', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role === 'owner') return res.json({ branches: await all('SELECT id,name FROM branches ORDER BY id') });
  const branch = await one('SELECT id,name FROM branches WHERE id=$1', [req.user.branchId]);
  res.json({ branches: branch ? [branch] : [] });
}));

app.post('/api/branches', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const name = safeText(req.body.name, 80);
  if (!name) return res.status(400).json({ error: 'Branch name is required' });
  try {
    const branch = await one('INSERT INTO branches(name) VALUES ($1) RETURNING id,name', [name]);
    await logActivity({ userId: req.user.id, action: 'branch_created', details: `Created branch ${name}` });
    res.status(201).json({ branch });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A branch with that name already exists' });
    throw err;
  }
}));

app.get('/api/menu', requireAuth, asyncHandler(async (_req, res) => {
  res.json({ items: await all('SELECT id,name FROM menu_items WHERE active=TRUE ORDER BY sort_order,name') });
}));

app.get('/api/branches/:branchId/staff', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  const staff = await all('SELECT id,username,name,role,active FROM users WHERE branch_id=$1 ORDER BY name', [branch.id]);
  res.json({ branch, staff });
}));

app.post('/api/branches/:branchId/staff', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  const name = safeText(req.body.name, 80);
  const username = safeText(req.body.username, 80).toLowerCase();
  const password = String(req.body.password || '');
  if (!name || !username || password.length < 8) return res.status(400).json({ error: 'Name, username and a password of at least 8 characters are required' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const worker = await one(`
      INSERT INTO users(username,password_hash,name,role,branch_id)
      VALUES ($1,$2,$3,'worker',$4)
      RETURNING id,username,name,role,branch_id AS "branchId"
    `, [username, hash, name, branch.id]);
    await logActivity({ branchId: branch.id, userId: req.user.id, action: 'worker_added', details: `Added ${name}` });
    res.status(201).json({ worker });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already in use' });
    throw err;
  }
}));

app.get('/api/attendance/today', requireAuth, asyncHandler(async (req, res) => {
  if (!req.user.branchId) return res.json({ shift: null, closed: isSunday() });
  const shift = await one('SELECT * FROM attendance WHERE user_id=$1 AND work_date=$2', [req.user.id, localDateKey()]);
  res.json({ shift: shift ? { ...shift, hours: shift.clock_out ? hoursBetween(shift.clock_in, shift.clock_out, shift.break_minutes) : null } : null, closed: isSunday() });
}));

app.post('/api/attendance/clock-in', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role === 'owner' || !req.user.branchId) return res.status(403).json({ error: 'Worker account required' });
  if (isSunday()) return res.status(400).json({ error: 'Freda’s is closed on Sunday' });
  const date = localDateKey();
  const existing = await one('SELECT * FROM attendance WHERE user_id=$1 AND work_date=$2', [req.user.id, date]);
  if (existing) return res.status(409).json({ error: existing.clock_out ? 'Today’s shift is already completed' : 'You are already clocked in' });
  const shift = await one(`
    INSERT INTO attendance(user_id,branch_id,work_date,clock_in) VALUES ($1,$2,$3,$4) RETURNING *
  `, [req.user.id, req.user.branchId, date, nowIso()]);
  await logActivity({ branchId: req.user.branchId, userId: req.user.id, action: 'clock_in', details: 'Clocked in' });
  res.status(201).json({ shift });
}));

app.post('/api/attendance/break-start', requireAuth, asyncHandler(async (req, res) => {
  const shift = await one('SELECT * FROM attendance WHERE user_id=$1 AND work_date=$2 AND clock_out IS NULL', [req.user.id, localDateKey()]);
  if (!shift) return res.status(400).json({ error: 'Clock in before starting a break' });
  if (shift.break_started_at) return res.status(409).json({ error: 'Break already started' });
  const updated = await one('UPDATE attendance SET break_started_at=$1 WHERE id=$2 RETURNING *', [nowIso(), shift.id]);
  await logActivity({ branchId: req.user.branchId, userId: req.user.id, action: 'break_start', details: 'Started break' });
  res.json({ shift: updated });
}));

app.post('/api/attendance/break-end', requireAuth, asyncHandler(async (req, res) => {
  const shift = await one('SELECT * FROM attendance WHERE user_id=$1 AND work_date=$2 AND clock_out IS NULL', [req.user.id, localDateKey()]);
  if (!shift || !shift.break_started_at) return res.status(400).json({ error: 'No active break' });
  const mins = Math.max(0, Math.round((Date.now() - new Date(shift.break_started_at).getTime()) / 60000));
  const updated = await one(`
    UPDATE attendance SET break_minutes=break_minutes+$1, break_started_at=NULL WHERE id=$2 RETURNING *
  `, [mins, shift.id]);
  await logActivity({ branchId: req.user.branchId, userId: req.user.id, action: 'break_end', details: `Ended break (${mins} min)` });
  res.json({ shift: updated });
}));

app.post('/api/attendance/clock-out', requireAuth, asyncHandler(async (req, res) => {
  const shift = await one('SELECT * FROM attendance WHERE user_id=$1 AND work_date=$2 AND clock_out IS NULL', [req.user.id, localDateKey()]);
  if (!shift) return res.status(400).json({ error: 'No active shift' });
  let extraBreak = 0;
  if (shift.break_started_at) extraBreak = Math.max(0, Math.round((Date.now() - new Date(shift.break_started_at).getTime()) / 60000));
  const done = await one(`
    UPDATE attendance
    SET clock_out=$1, break_minutes=break_minutes+$2, break_started_at=NULL
    WHERE id=$3 RETURNING *
  `, [nowIso(), extraBreak, shift.id]);
  const hours = hoursBetween(done.clock_in, done.clock_out, done.break_minutes);
  await logActivity({ branchId: req.user.branchId, userId: req.user.id, action: 'clock_out', details: `Clocked out after ${hours} h` });
  res.json({ shift: { ...done, hours } });
}));

app.get('/api/branches/:branchId/attendance', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  const { start, end } = currentWeekRange();
  const from = safeText(req.query.from, 10) || start;
  const to = safeText(req.query.to, 10) || end;
  const rows = (await all(`
    SELECT a.*, u.name AS worker_name
    FROM attendance a JOIN users u ON u.id=a.user_id
    WHERE a.branch_id=$1 AND a.work_date BETWEEN $2 AND $3
    ORDER BY a.work_date DESC, a.clock_in DESC
  `, [branch.id, from, to])).map(x => ({ ...x, hours: x.clock_out ? hoursBetween(x.clock_in, x.clock_out, x.break_minutes) : null }));
  res.json({ rows, from, to });
}));

app.post('/api/branches/:branchId/reports', requireAuth, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  if (req.user.role === 'owner') return res.status(403).json({ error: 'Use a worker account to submit a daily report' });
  if (isSunday()) return res.status(400).json({ error: 'Freda’s is closed on Sunday' });

  const todayAttendance = await one('SELECT id FROM attendance WHERE user_id=$1 AND work_date=$2', [req.user.id, localDateKey()]);
  if (!todayAttendance) return res.status(400).json({ error: 'Clock in before submitting the end-of-day report' });

  const chickenStatus = validStatus(req.body.chickenStatus);
  const beefStatus = validStatus(req.body.beefStatus);
  const shawarmaJars = asNumberOrNull(req.body.shawarmaJars);
  const garlicJars = asNumberOrNull(req.body.garlicJars);
  if (!chickenStatus || !beefStatus) return res.status(400).json({ error: 'Chicken and Beef status are required' });
  if (shawarmaJars === null || garlicJars === null || shawarmaJars < 0 || shawarmaJars > 3 || garlicJars < 0 || garlicJars > 3) {
    return res.status(400).json({ error: 'Sauce jars must be recorded between 0 and 3' });
  }

  const sales = req.body.sales && typeof req.body.sales === 'object' ? req.body.sales : {};
  const menu = await all('SELECT id FROM menu_items WHERE active=TRUE');
  const allowed = new Set(menu.map(x => String(x.id)));
  let totalSold = 0;
  const normalizedSales = [];
  for (const [key, raw] of Object.entries(sales)) {
    if (!allowed.has(String(key))) continue;
    const qty = Math.max(0, Math.min(999, Math.floor(Number(raw) || 0)));
    totalSold += qty;
    normalizedSales.push([Number(key), qty]);
  }

  const reportDate = localDateKey();
  const submittedAt = nowIso();
  const reportId = await transaction(async client => {
    const result = await client.query(`
      INSERT INTO daily_reports(
        branch_id,user_id,report_date,submitted_at,chicken_status,chicken_kg,beef_status,beef_kg,
        shawarma_jars,garlic_jars,refill_bowl_empty,other_items,notes,total_sold
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id
    `, [
      branch.id, req.user.id, reportDate, submittedAt,
      chickenStatus, asNumberOrNull(req.body.chickenKg), beefStatus, asNumberOrNull(req.body.beefKg),
      shawarmaJars, garlicJars, Boolean(req.body.refillBowlEmpty), safeText(req.body.otherItems, 1000),
      safeText(req.body.notes, 2000), totalSold
    ]);
    const id = result.rows[0].id;
    for (const [menuId, qty] of normalizedSales) {
      await client.query('INSERT INTO report_sales(report_id,menu_item_id,quantity) VALUES ($1,$2,$3)', [id, menuId, qty]);
    }
    return id;
  });

  const row = await one(`SELECT dr.*,u.name AS worker_name FROM daily_reports dr JOIN users u ON u.id=dr.user_id WHERE dr.id=$1`, [reportId]);
  const report = await hydrateReport(row);
  await processReportNeeds(report);
  await logActivity({ branchId: branch.id, userId: req.user.id, action: 'report_submitted', details: `Submitted end-of-day report (${totalSold} items sold)` });
  res.status(201).json({ report });
}));

app.get('/api/branches/:branchId/reports', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 30)));
  const rows = await all(`
    SELECT dr.*,u.name AS worker_name
    FROM daily_reports dr JOIN users u ON u.id=dr.user_id
    WHERE dr.branch_id=$1 ORDER BY dr.submitted_at DESC LIMIT $2
  `, [branch.id, limit]);
  const reports = [];
  for (const row of rows) reports.push(await hydrateReport(row));
  res.json({ reports });
}));

app.get('/api/branches/:branchId/needs', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  const rows = await all(`
    SELECT * FROM needs WHERE branch_id=$1 AND resolved=FALSE
    ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, created_at DESC
  `, [branch.id]);
  res.json({ needs: rows });
}));

app.patch('/api/needs/:needId/resolve', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const need = await one('SELECT * FROM needs WHERE id=$1', [Number(req.params.needId)]);
  if (!need) return res.status(404).json({ error: 'Need not found' });
  await query('UPDATE needs SET resolved=TRUE,resolved_at=$1 WHERE id=$2', [nowIso(), need.id]);
  await logActivity({ branchId: need.branch_id, userId: req.user.id, action: 'need_resolved', details: `Resolved ${need.label}` });
  res.json({ ok: true });
}));

app.get('/api/branches/:branchId/alerts', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  res.json({ alerts: await all('SELECT * FROM alerts WHERE branch_id=$1 AND restocked=FALSE ORDER BY created_at DESC', [branch.id]) });
}));

app.patch('/api/alerts/:alertId', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const alert = await one('SELECT * FROM alerts WHERE id=$1', [Number(req.params.alertId)]);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const acknowledged = req.body.acknowledged ? true : Boolean(alert.acknowledged);
  const restocked = req.body.restocked ? true : Boolean(alert.restocked);
  await query('UPDATE alerts SET acknowledged=$1,restocked=$2 WHERE id=$3', [acknowledged, restocked, alert.id]);
  if (restocked) {
    await query(`
      UPDATE needs SET resolved=TRUE,resolved_at=$1
      WHERE branch_id=$2 AND resolved=FALSE AND label IN ('Shawarma Sauce','Garlic Sauce')
    `, [nowIso(), alert.branch_id]);
  }
  await logActivity({ branchId: alert.branch_id, userId: req.user.id, action: restocked ? 'alert_restocked' : 'alert_acknowledged', details: alert.message });
  res.json({ ok: true });
}));

app.get('/api/branches/:branchId/expenses', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  const rows = await all(`
    SELECT e.*,u.name AS recorded_by FROM expenses e JOIN users u ON u.id=e.user_id
    WHERE e.branch_id=$1 ORDER BY e.created_at DESC LIMIT 200
  `, [branch.id]);
  res.json({ expenses: rows });
}));

app.post('/api/branches/:branchId/expenses', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  const category = safeText(req.body.category, 80);
  const item = safeText(req.body.item, 120);
  const amount = Number(req.body.amount);
  if (!category || !item || !Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Category, item and a valid amount are required' });
  const expense = await one(`
    INSERT INTO expenses(branch_id,user_id,expense_date,category,item,amount,note,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
  `, [branch.id, req.user.id, localDateKey(), category, item, amount, safeText(req.body.note, 500), nowIso()]);
  await logActivity({ branchId: branch.id, userId: req.user.id, action: 'expense_added', details: `${item} €${amount.toFixed(2)}` });
  res.status(201).json({ expense });
}));

app.get('/api/branches/:branchId/activity', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  const rows = await all(`
    SELECT a.*,COALESCE(u.name,'System') AS worker_name
    FROM activity_logs a LEFT JOIN users u ON u.id=a.user_id
    WHERE a.branch_id=$1 ORDER BY a.created_at DESC LIMIT 50
  `, [branch.id]);
  res.json({ activities: rows });
}));

app.get('/api/branches/:branchId/overview', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  const staff = await one('SELECT COUNT(*)::int AS c FROM users WHERE branch_id=$1 AND active=TRUE', [branch.id]);
  const report = await latestReport(branch.id);
  const needs = await one('SELECT COUNT(*)::int AS c FROM needs WHERE branch_id=$1 AND resolved=FALSE', [branch.id]);
  const alerts = await one('SELECT COUNT(*)::int AS c FROM alerts WHERE branch_id=$1 AND acknowledged=FALSE AND restocked=FALSE', [branch.id]);
  res.json({ branch, staffCount: staff.c, latestReport: report, unresolvedNeeds: needs.c, activeAlerts: alerts.c });
}));

app.get('/api/branches/:branchId/reports/weekly', requireAuth, requireOwner, asyncHandler(async (req, res) => {
  const branch = await assertBranch(req, res); if (!branch) return;
  const { start, end } = currentWeekRange();
  const reportRows = await all(`
    SELECT dr.*,u.name AS worker_name FROM daily_reports dr JOIN users u ON u.id=dr.user_id
    WHERE dr.branch_id=$1 AND dr.report_date BETWEEN $2 AND $3 ORDER BY dr.submitted_at DESC
  `, [branch.id, start, end]);
  const reports = [];
  for (const row of reportRows) reports.push(await hydrateReport(row));
  const expenses = await all('SELECT * FROM expenses WHERE branch_id=$1 AND expense_date BETWEEN $2 AND $3 ORDER BY created_at DESC', [branch.id, start, end]);
  const attendance = (await all(`
    SELECT a.*,u.name AS worker_name FROM attendance a JOIN users u ON u.id=a.user_id
    WHERE a.branch_id=$1 AND a.work_date BETWEEN $2 AND $3 ORDER BY a.work_date,u.name
  `, [branch.id, start, end])).map(x => ({ ...x, hours: x.clock_out ? hoursBetween(x.clock_in, x.clock_out, x.break_minutes) : 0 }));

  const menuTotals = new Map();
  reports.forEach(r => r.salesRows.forEach(s => menuTotals.set(s.name, (menuTotals.get(s.name) || 0) + Number(s.quantity))));
  const topItem = [...menuTotals.entries()].sort((a,b) => b[1] - a[1])[0] || null;
  const staffSummary = {};
  attendance.forEach(a => {
    if (!staffSummary[a.worker_name]) staffSummary[a.worker_name] = { shifts: 0, hours: 0 };
    if (a.clock_out) staffSummary[a.worker_name].shifts += 1;
    staffSummary[a.worker_name].hours += a.hours || 0;
  });
  Object.values(staffSummary).forEach(s => s.hours = Number(s.hours.toFixed(2)));

  res.json({
    branch,
    range: { start, end },
    totals: {
      itemsSold: reports.reduce((a, r) => a + r.totalSold, 0),
      expenses: Number(expenses.reduce((a, e) => a + Number(e.amount), 0).toFixed(2)),
      staffHours: Number(attendance.reduce((a, s) => a + Number(s.hours || 0), 0).toFixed(2))
    },
    topItem: topItem ? { name: topItem[0], quantity: topItem[1] } : null,
    latestStock: reports[0] || null,
    staffSummary,
    reports,
    expenses,
    attendance
  });
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.message === 'Origin not allowed by CORS') return res.status(403).json({ error: 'Origin not allowed' });
  res.status(500).json({ error: 'Server error' });
});

ready.then(() => {
  app.listen(port, () => console.log(`Freda's API running on http://localhost:${port}`));
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
