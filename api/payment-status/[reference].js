// GET /api/payment-status/:reference
const axios = require('axios');
const { getPool } = require('../_lib/db');
const { PAYMENT_API_KEY, PAYMENT_BASE } = require('../_lib/config');
const { authMiddleware } = require('../_lib/auth');
const { setCORS, sendJson } = require('../_lib/utils');

module.exports = authMiddleware(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const reference = req.query.reference;
    const pool = getPool();
    const payment = await pool.query('SELECT * FROM payments WHERE reference = $1 AND user_id = $2', [reference, req.user.id]);
    if (payment.rows.length === 0) return sendJson(res, 404, { error: 'Payment not found' });

    // Already completed? Return immediately.
    if (payment.rows[0].status === 'completed') {
      const updated = await pool.query('SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1', [req.user.id]);
      return sendJson(res, 200, { status: 'completed', activated: true, user: updated.rows[0] });
    }

    // Poll payment API for current status
    try {
      const verifyResp = await axios.get(PAYMENT_BASE + '/payments/' + reference + '/status', {
        headers: { 'X-API-Key': PAYMENT_API_KEY },
        timeout: 15000
      });
      const apiStatus = verifyResp.data.status;
      if (apiStatus === 'completed' || apiStatus === 'success') {
        await pool.query('UPDATE payments SET status = $1 WHERE id = $2', ['completed', payment.rows[0].id]);
        await pool.query('UPDATE users SET is_activated = true WHERE id = $1', [req.user.id]);
        const updated = await pool.query('SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1', [req.user.id]);
        return sendJson(res, 200, { status: 'completed', activated: true, user: updated.rows[0] });
      } else if (apiStatus === 'failed') {
        await pool.query('UPDATE payments SET status = $1 WHERE id = $2', ['failed', payment.rows[0].id]);
        return sendJson(res, 200, { status: 'failed', activated: false });
      }
      return sendJson(res, 200, { status: apiStatus || 'processing', activated: false });
    } catch (vErr) {
      console.error('Payment status check error:', vErr.message);
      return sendJson(res, 200, { status: 'processing', activated: false });
    }
  } catch (err) {
    return sendJson(res, 500, { error: 'Status check failed' });
  }
});
