// POST /api/signup
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool } = require('./_lib/db');
const { TIERS, JWT_SECRET } = require('./_lib/config');
const { setCORS, sendJson, parseBody } = require('./_lib/utils');

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const { username, phone, password, tier } = body;
    if (!username || !phone || !password) return sendJson(res, 400, { error: 'All fields are required' });
    const selectedTier = TIERS[tier] ? tier : 'silver';
    const pool = getPool();
    const existing = await pool.query('SELECT id FROM users WHERE phone = $1 OR username = $2', [phone, username]);
    if (existing.rows.length > 0) return sendJson(res, 400, { error: 'Phone number or username already registered' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, phone, password, tier) VALUES ($1, $2, $3, $4) RETURNING id, username, phone, tier, is_activated, earnings, completed_tasks',
      [username, phone, hashedPassword, selectedTier]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });
    return sendJson(res, 200, { token, user });
  } catch (err) {
    console.error('Signup error:', err.message);
    return sendJson(res, 500, { error: 'Server error' });
  }
};
