const { ensureDB, getPool, TIERS, JWT_SECRET } = require('../../../lib/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureDB();
    const { username, phone, password, tier } = req.body || {};
    if (!username || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const selectedTier = TIERS[tier] ? tier : 'silver';
    const pool = getPool();
    const existing = await pool.query('SELECT id FROM users WHERE phone = $1 OR username = $2', [phone, username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Phone number or username already registered' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, phone, password, tier) VALUES ($1, $2, $3, $4) RETURNING id, username, phone, tier, is_activated, earnings, completed_tasks',
      [username, phone, hashedPassword, selectedTier]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
