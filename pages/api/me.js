const { ensureDB, getPool, verifyAuth } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = verifyAuth(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    await ensureDB();
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1',
      [user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
