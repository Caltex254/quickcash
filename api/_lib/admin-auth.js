// Admin auth middleware - separate from user auth to enforce admin scope
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config');

// Hardcoded admin credentials (in production these would come from DB/env)
// Password is hashed with bcrypt at module load to avoid recomputation
const bcrypt = require('bcryptjs');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@quickcash.com';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ||
  bcrypt.hashSync('waynekipkoech1', 10);

function adminLogin(email, password) {
  if (!email || !password) return null;
  if (email.toLowerCase().trim() !== ADMIN_EMAIL.toLowerCase()) return null;
  try {
    const ok = bcrypt.compareSync(password, ADMIN_PASSWORD_HASH);
    if (!ok) return null;
  } catch {
    return null;
  }
  // Issue a 24h admin token
  const token = jwt.sign(
    { role: 'admin', email: ADMIN_EMAIL, iat: Math.floor(Date.now() / 1000) },
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

module.exports = { adminLogin, adminMiddleware, ADMIN_EMAIL };
