// POST /api/login
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool } = require('./_lib/db');
const { JWT_SECRET } = require('./_lib/config');
const { setCORS, sendJson, parseBody } = require('./_lib/utils');

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const { phone, password } = body;
    if (!phone || !password) return sendJson(res, 400, { error: 'Phone and password are required' });
    const pool = getPool();
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (result.rows.length === 0) return sendJson(res, 400, { error: 'Invalid phone number or password' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return sendJson(res, 400, { error: 'Invalid phone number or password' });
    const token = jwt.sign({ id: user.id, username: user.username, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });
    return sendJson(res, 200, {
      token,
      user: {
        id: user.id, username: user.username, phone: user.phone,
        tier: user.tier, is_activated: user.is_activated,
        earnings: user.earnings, completed_tasks: user.completed_tasks
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return sendJson(res, 500, { error: 'Server error' });
  }
};
