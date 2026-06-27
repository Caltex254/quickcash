const { ensureDB, getPool, verifyAuth, PAYMENT_API_KEY, PAYMENT_BASE } = require('../../../lib/db');
const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    await ensureDB();
    const { reference } = req.query;
    const pool = getPool();
    const payment = await pool.query('SELECT * FROM payments WHERE reference = $1 AND user_id = $2', [reference, auth.id]);
    if (payment.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    if (payment.rows[0].status === 'completed') {
      const updated = await pool.query(
        'SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1',
        [auth.id]
      );
      return res.json({ status: 'completed', activated: true, user: updated.rows[0] });
    }
    try {
      const verifyResp = await axios.get(PAYMENT_BASE + '/payments/' + reference + '/status', {
        headers: { 'X-API-Key': PAYMENT_API_KEY },
        timeout: 15000
      });
      const apiStatus = verifyResp.data.status;
      if (apiStatus === 'completed' || apiStatus === 'success') {
        await pool.query('UPDATE payments SET status = $1 WHERE id = $2', ['completed', payment.rows[0].id]);
        await pool.query('UPDATE users SET is_activated = true WHERE id = $1', [auth.id]);
        const updated = await pool.query(
          'SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1',
          [auth.id]
        );
        console.log('User activated via polling:', auth.id);
        return res.json({ status: 'completed', activated: true, user: updated.rows[0] });
      } else if (apiStatus === 'failed') {
        await pool.query('UPDATE payments SET status = $1 WHERE id = $2', ['failed', payment.rows[0].id]);
        return res.json({ status: 'failed', activated: false });
      }
      return res.json({ status: apiStatus || 'processing', activated: false });
    } catch (vErr) {
      console.error('Payment status check error:', vErr.message);
      return res.json({ status: 'processing', activated: false });
    }
  } catch (err) {
    console.error('Payment-status error:', err);
    res.status(500).json({ error: 'Status check failed' });
  }
};
