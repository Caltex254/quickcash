// POST /api/change-tier
const { getPool } = require('./_lib/db');
const { TIERS } = require('./_lib/config');
const { authMiddleware } = require('./_lib/auth');
const { setCORS, sendJson, parseBody } = require('./_lib/utils');

module.exports = authMiddleware(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const { tier } = body;
    if (!TIERS[tier]) return sendJson(res, 400, { error: 'Invalid tier' });
    const pool = getPool();
    await pool.query('DELETE FROM tasks WHERE user_id = $1 AND status = $2', [req.user.id, 'pending']);
    await pool.query('UPDATE users SET tier = $1 WHERE id = $2', [tier, req.user.id]);
    const result = await pool.query(
      'SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1',
      [req.user.id]
    );
    return sendJson(res, 200, { message: 'Tier updated to ' + TIERS[tier].name, user: result.rows[0] });
  } catch (err) {
    return sendJson(res, 500, { error: 'Server error' });
  }
});
