const { ensureDB, getPool } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  console.log('Payment callback received:', JSON.stringify(req.body));
  try {
    await ensureDB();
    const { reference, status, order_tracking_id, OrderTrackingId, OrderNotificationType } = req.body || {};
    const refToCheck = reference || order_tracking_id || OrderTrackingId;
    if (refToCheck && (status === 'completed' || status === 'success' || OrderNotificationType === 'PAYMENT_COMPLETED')) {
      const pool = getPool();
      const payment = await pool.query(
        'SELECT * FROM payments WHERE reference = $1 OR reference = $2 OR order_tracking_id = $3 OR order_tracking_id = $4',
        [refToCheck, 'TX-' + refToCheck, refToCheck, OrderTrackingId || '']
      );
      if (payment.rows.length > 0 && payment.rows[0].status !== 'completed') {
        await pool.query('UPDATE payments SET status = $1 WHERE id = $2', ['completed', payment.rows[0].id]);
        await pool.query('UPDATE users SET is_activated = true WHERE id = $1', [payment.rows[0].user_id]);
        console.log('User activated via callback:', payment.rows[0].user_id);
      }
    }
  } catch (err) {
    console.error('Callback error:', err.message);
  }
  res.json({ received: true });
};
