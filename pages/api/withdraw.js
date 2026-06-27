const { ensureDB, getPool, verifyAuth, TIERS, MIN_WITHDRAWAL, PAYMENT_API_KEY, PAYMENT_BASE, formatPhone } = require('../../lib/db');
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
    const { amount, phone, provider } = req.body || {};
    if (!amount || !phone || !provider) {
      return res.status(400).json({ error: 'All fields required' });
    }
    const pool = getPool();
    const user = await pool.query('SELECT earnings, is_activated, tier FROM users WHERE id = $1', [auth.id]);
    if (!user.rows[0].is_activated) {
      const tier = user.rows[0].tier;
      return res.status(400).json({
        error: 'Activation required',
        needsActivation: true,
        activationFee: TIERS[tier].activationFee,
        tier: tier
      });
    }
    if (parseFloat(amount) < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: 'Minimum withdrawal is KES ' + MIN_WITHDRAWAL });
    }
    if (parseFloat(amount) > parseFloat(user.rows[0].earnings)) {
      return res.status(400).json({ error: 'Insufficient earnings' });
    }

    const wd = await pool.query(
      'INSERT INTO withdrawals (user_id, amount, phone, provider, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [auth.id, amount, phone, provider, 'processing']
    );

    const formattedPhone = formatPhone(phone);
    try {
      await axios.post(PAYMENT_BASE + '/withdrawals', {
        amount: parseFloat(amount),
        currency: 'KES',
        method: 'mobile_money',
        account_number: formattedPhone
      }, {
        headers: { 'X-API-Key': PAYMENT_API_KEY, 'Content-Type': 'application/json' },
        timeout: 30000
      });
    } catch (payErr) {
      console.error('Withdrawal payout error:', payErr.response ? payErr.response.data : payErr.message);
    }

    await pool.query('UPDATE users SET earnings = earnings - $1 WHERE id = $2', [amount, auth.id]);
    const updated = await pool.query(
      'SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1',
      [auth.id]
    );
    res.json({ message: 'Withdrawal initiated', withdrawal: wd.rows[0], user: updated.rows[0] });
  } catch (err) {
    console.error('Withdrawal error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
