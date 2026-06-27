const { ensureDB, getPool, JWT_SECRET } = require('../../../lib/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    await ensureDB();
    const { phone, password } = req.body || {};
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password are required' });
    }
    const pool = getPool();
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid phone number or password' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid phone number or password' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user.id, username: user.username, phone: user.phone,
        tier: user.tier, is_activated: user.is_activated,
        earnings: user.earnings, completed_tasks: user.completed_tasks
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
