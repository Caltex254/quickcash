const { ensureDB, getPool, verifyAuth, PAYMENT_API_KEY, PAYMENT_BASE } = require('../../lib/db');
const axios = require('axios');

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
    const { reference } = req.body || {};
    const pool = getPool();
    const payment = await pool.query('SELECT * FROM payments WHERE reference = $1 AND user_id = $2', [reference, auth.id]);
    if (payment.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    try {
      const verifyResp = await axios.get(PAYMENT_BASE + '/payments/' + reference + '/status', {
        headers: { 'X-API-Key': PAYMENT_API_KEY },
        timeout: 15000
      });
      console.log('Payment status response:', JSON.stringify(verifyResp.data));
      const status = verifyResp.data.status;
      if (status === 'completed' || status === 'success') {
        await pool.query('UPDATE payments SET status = $1 WHERE id = $2', ['completed', payment.rows[0].id]);
        await pool.query('UPDATE users SET is_activated = true WHERE id = $1', [auth.id]);
        const updated = await pool.query(
          'SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1',
          [auth.id]
        );
        return res.json({ success: true, message: 'Account activated successfully! You can now withdraw.', user: updated.rows[0] });
      }
    } catch (vErr) {
      console.error('Verify check error:', vErr.message);
    }
    res.json({ success: false, message: 'Payment not yet confirmed. Please try again in a moment.' });
  } catch (err) {
    console.error('Verify-payment error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
};
