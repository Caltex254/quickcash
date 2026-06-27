// Admin auth middleware - separate from user auth to enforce admin scope
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config');

// Hardcoded admin credentials (in production these would come from DB/env)
// Password is hashed with bcrypt at module load to avoid recomputation
const bcrypt = require('bcryptjs');
// Project uses phone numbers (not emails) as the primary identifier everywhere;
// admin login follows the same convention.
const ADMIN_PHONE = process.env.ADMIN_PHONE || '0700000000';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ||
  bcrypt.hashSync('waynekipkoech1', 10);

// Normalize phone: strip spaces, leading +, leading 254, leading 0 → bare local form
function normalizePhone(p) {
  if (!p) return '';
  let s = String(p).replace(/\s+/g, '').replace(/^\+/, '');
  if (s.startsWith('254')) s = '0' + s.substring(3);
  return s;
}

function adminLogin(phone, password) {
  if (!phone || !password) return null;
  if (normalizePhone(phone) !== normalizePhone(ADMIN_PHONE)) return null;
  try {
    const ok = bcrypt.compareSync(password, ADMIN_PASSWORD_HASH);
    if (!ok) return null;
  } catch {
    return null;
  }
  // Issue a 24h admin token
  const token = jwt.sign(
    { role: 'admin', phone: ADMIN_PHONE, iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  return token;
}

function adminMiddleware(handler) {
  return async (req, res) => {
    const auth = req.headers.authorization || req.headers.Authorization;
    const token = auth && auth.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Admin authentication required' });
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      req.admin = decoded;
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired admin token' });
    }
    return handler(req, res);
  };
}

module.exports = { adminLogin, adminMiddleware, ADMIN_PHONE };
