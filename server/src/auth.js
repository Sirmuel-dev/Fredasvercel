import jwt from 'jsonwebtoken';
import { one } from './db.js';

function secret() {
  const value = process.env.JWT_SECRET || 'dev-only-secret-change-me';
  if (process.env.NODE_ENV === 'production' && value === 'dev-only-secret-change-me') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return value;
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, secret(), { expiresIn: '12h' });
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const payload = jwt.verify(token, secret());
    const user = await one(`SELECT id,username,name,role,branch_id AS "branchId",active FROM users WHERE id=$1`, [payload.sub]);
    if (!user || !user.active) return res.status(401).json({ error: 'Account is not active' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  next();
}

export function canAccessBranch(user, branchId) {
  return user.role === 'owner' || Number(user.branchId) === Number(branchId);
}
