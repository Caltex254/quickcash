// POST /api/withdraw
const axios = require('axios');
const { getPool } = require('./_lib/db');
const { TIERS, MIN_WITHDRAWAL, PAYMENT_API_KEY, PAYMENT_BASE } = require('./_lib/config');
const { authMiddleware } = require('./_lib/auth');
const { setCORS, sendJson, parseBody, formatPhone } = require('./_lib/utils');

module.exports = authMiddleware(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const { amount, phone, provider } = body;
    if (!amount || !phone || !provider) return sendJson(res, 400, { error: 'All fields required' });
    const pool = getPool();
    const user = await pool.query('SELECT earnings, is_activated, tier FROM users WHERE id = $1', [req.user.id]);
    if (!user.rows[0].is_activated) {
      const tier = user.rows[0].tier;
      return sendJson(res, 400, {
        error: 'Activation required',
        needsActivation: true,
        activationFee: TIERS[tier].activationFee,
        tier: tier
      });
    }
    if (parseFloat(amount) < MIN_WITHDRAWAL) return sendJson(res, 400, { error: 'Minimum withdrawal is KES ' + MIN_WITHDRAWAL });
    if (parseFloat(amount) > parseFloat(user.rows[0].earnings)) return sendJson(res, 400, { error: 'Insufficient earnings' });

    const wd = await pool.query(
      'INSERT INTO withdrawals (user_id, amount, phone, provider, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.id, amount, phone, provider, 'processing']
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

    await pool.query('UPDATE users SET earnings = earnings - $1 WHERE id = $2', [amount, req.user.id]);
    const updated = await pool.query('SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1', [req.user.id]);
    return sendJson(res, 200, { message: 'Withdrawal initiated', withdrawal: wd.rows[0], user: updated.rows[0] });
  } catch (err) {
    console.error('Withdrawal error:', err.message);
    return sendJson(res, 500, { error: 'Server error' });
  }
});
