// POST /api/activate
// Optimized: shorter timeouts, race STK vs checkout, no sequential long waits.
const axios = require('axios');
const { getPool } = require('./_lib/db');
const { TIERS, PAYMENT_API_KEY, PAYMENT_BASE, PUBLIC_BASE_URL } = require('./_lib/config');
const { authMiddleware } = require('./_lib/auth');
const { setCORS, sendJson, parseBody, formatPhone, detectNetwork } = require('./_lib/utils');

const FAST_TIMEOUT = 12000; // 12s — was 30s, way too slow

function payHeaders() {
  return { 'X-API-Key': PAYMENT_API_KEY, 'Content-Type': 'application/json' };
}

// Try a single payment attempt. Returns normalized result object.
async function tryPayment(payload, label) {
  try {
    const resp = await axios.post(PAYMENT_BASE + '/payments/initiate', payload, {
      headers: payHeaders(),
      timeout: FAST_TIMEOUT
    });
    const d = resp.data || {};
    if (d.success) {
      return {
        ok: true,
        label,
        reference: d.reference,
        checkoutUrl: d.checkout_url || null,
        redirectUrl: d.redirect_url || null,
        orderTrackingId: d.order_tracking_id || null,
        pawaStatus: d.pawa_status || '',
        gateway: d.gateway || label
      };
    }
    return { ok: false, label, err: 'non-success', data: d };
  } catch (e) {
    const errData = e.response ? e.response.data : e.message;
    return { ok: false, label, err: errData };
  }
}

module.exports = authMiddleware(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  let reference = 'QCASH-ACT-' + Date.now();
  let orderTrackingId = null;
  let checkoutUrl = null;
  let redirectUrl = null;
  let stkPushSent = false;
  let usedGateway = '';
  let pawaStatus = '';
  let amount = 0;
  let tier = 'silver';
  let phone = '';
  let detectedNetwork = '';

  try {
    const body = await parseBody(req);
    phone = body.phone || '';
    if (!phone) return sendJson(res, 400, { error: 'Phone number required' });

    const pool = getPool();
    const user = await pool.query('SELECT is_activated, tier FROM users WHERE id = $1', [req.user.id]);
    if (!user.rows || user.rows.length === 0) return sendJson(res, 404, { error: 'User not found' });
    if (user.rows[0].is_activated) return sendJson(res, 400, { error: 'Account already activated' });

    tier = user.rows[0].tier;
    amount = TIERS[tier].activationFee;
    const formattedPhone = formatPhone(phone);
    detectedNetwork = detectNetwork(phone);
    const callbackUrl = PUBLIC_BASE_URL + '/api/payment-callback';
    const description = 'QuickCash ' + TIERS[tier].name + ' Activation Fee';

    // Fire STK push (mobile gateway) — primary attempt
    const stkResult = await tryPayment({
      amount, currency: 'KES', gateway: 'mobile',
      phone: formattedPhone, description, callback_url: callbackUrl
    }, 'pawapay');

    let chosen = null;

    if (stkResult.ok) {
      chosen = stkResult;
      // If STK was REJECTED/FAILED, immediately try pesapal iframe in parallel-ish (sequential but fast)
      if (stkResult.pawaStatus === 'REJECTED' || stkResult.pawaStatus === 'FAILED') {
        const pspResult = await tryPayment({
          amount, currency: 'KES', phone: formattedPhone,
          description, callback_url: callbackUrl
        }, 'pesapal');
        if (pspResult.ok && (pspResult.redirectUrl || pspResult.checkoutUrl)) {
          chosen = pspResult;
        }
      }
    } else {
      // STK push itself failed — try pesapal iframe checkout
      const pspResult = await tryPayment({
        amount, currency: 'KES', phone: formattedPhone,
        description, callback_url: callbackUrl
      }, 'pesapal');
      if (pspResult.ok) {
        chosen = pspResult;
      }
    }

    if (chosen) {
      reference = chosen.reference || reference;
      checkoutUrl = chosen.checkoutUrl;
      redirectUrl = chosen.redirectUrl;
      orderTrackingId = chosen.orderTrackingId;
      pawaStatus = chosen.pawaStatus;
      usedGateway = chosen.gateway;
      stkPushSent = (chosen.label === 'pawapay' && pawaStatus === 'ACCEPTED');
    }

    // Save payment record (non-blocking, swallow errors)
    try {
      await pool.query(
        'INSERT INTO payments (user_id, amount, phone, provider, reference, order_tracking_id, gateway, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [req.user.id, amount, phone, detectedNetwork, reference, orderTrackingId, usedGateway, 'pending']
      );
    } catch (dbErr) {
      console.error('Payment record insert error:', dbErr.message);
    }

    let userMessage;
    if (stkPushSent) {
      userMessage = 'STK push sent! Check your phone and enter your PIN to confirm payment.';
    } else if (redirectUrl) {
      userMessage = 'Payment checkout ready. Complete payment in the checkout page.';
    } else if (pawaStatus === 'REJECTED' || pawaStatus === 'FAILED') {
      userMessage = 'Direct push not available for your network. Please use the checkout page to complete payment.';
    } else if (chosen) {
      userMessage = 'Payment initiated. Please follow the instructions to complete.';
    } else {
      // Both attempts failed — return error so user can retry
      return sendJson(res, 502, {
        error: 'Payment provider is unavailable right now. Please try again in a moment.',
        details: JSON.stringify(stkResult.err).substring(0, 200)
      });
    }

    return sendJson(res, 200, {
      message: userMessage,
      reference: reference,
      orderTrackingId: orderTrackingId,
      amount: amount,
      tier: tier,
      redirectUrl: redirectUrl,
      checkoutUrl: checkoutUrl,
      stkPushSent: stkPushSent,
      pawaStatus: pawaStatus,
      gateway: usedGateway,
      network: detectedNetwork
    });
  } catch (err) {
    console.error('Activation error:', err.message, err.stack);
    try {
      const pool = getPool();
      await pool.query(
        'INSERT INTO payments (user_id, amount, phone, provider, reference, gateway, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [req.user.id, amount || 0, phone || '', detectedNetwork || '', reference, usedGateway || '', 'failed']
      );
    } catch (e) {}
    return sendJson(res, 500, { error: 'Payment could not be processed. Please try again.' });
  }
});
