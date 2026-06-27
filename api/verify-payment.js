// POST /api/verify-payment
const axios = require('axios');
const { getPool } = require('./_lib/db');
const { PAYMENT_API_KEY, PAYMENT_BASE } = require('./_lib/config');
const { authMiddleware } = require('./_lib/auth');
const { setCORS, sendJson, parseBody } = require('./_lib/utils');

module.exports = authMiddleware(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const { reference } = body;
    const pool = getPool();
    const payment = await pool.query('SELECT * FROM payments WHERE reference = $1 AND user_id = $2', [reference, req.user.id]);
    if (payment.rows.length === 0) return sendJson(res, 404, { error: 'Payment not found' });

    try {
      const verifyResp = await axios.get(PAYMENT_BASE + '/payments/' + reference + '/status', {
        headers: { 'X-API-Key': PAYMENT_API_KEY },
        timeout: 8000
      });
      const status = verifyResp.data.status;
      if (status === 'completed' || status === 'success') {
        await pool.query('UPDATE payments SET status = $1 WHERE id = $2', ['completed', payment.rows[0].id]);
        await pool.query('UPDATE users SET is_activated = true WHERE id = $1', [req.user.id]);
        const updated = await pool.query('SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1', [req.user.id]);
        return sendJson(res, 200, { success: true, message: 'Account activated successfully! You can now withdraw.', user: updated.rows[0] });
      }
    } catch (vErr) {
      console.error('Verify check error:', vErr.message);
    }
    return sendJson(res, 200, { success: false, message: 'Payment not yet confirmed. Please try again in a moment.' });
  } catch (err) {
    return sendJson(res, 500, { error: 'Verification failed' });
  }
});
