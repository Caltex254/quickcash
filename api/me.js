// GET /api/me
const { getPool } = require('./_lib/db');
const { authMiddleware } = require('./_lib/auth');
const { setCORS, sendJson } = require('./_lib/utils');

module.exports = authMiddleware(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) return sendJson(res, 404, { error: 'User not found' });
    return sendJson(res, 200, { user: result.rows[0] });
  } catch (err) {
    return sendJson(res, 500, { error: 'Server error' });
  }
});
