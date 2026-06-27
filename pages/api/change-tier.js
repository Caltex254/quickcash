const { ensureDB, getPool, verifyAuth, TIERS } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    await ensureDB();
    const { tier } = req.body || {};
    if (!TIERS[tier]) {
      return res.status(400).json({ error: 'Invalid tier' });
    }
    const pool = getPool();
    await pool.query('DELETE FROM tasks WHERE user_id = $1 AND status = $2', [auth.id, 'pending']);
    await pool.query('UPDATE users SET tier = $1 WHERE id = $2', [tier, auth.id]);
    const result = await pool.query(
      'SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1',
      [auth.id]
    );
    res.json({ message: 'Tier updated to ' + TIERS[tier].name, user: result.rows[0] });
  } catch (err) {
    console.error('Change-tier error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
