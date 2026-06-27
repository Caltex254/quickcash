// POST /api/activate
const axios = require('axios');
const { getPool } = require('./_lib/db');
const { TIERS, PAYMENT_API_KEY, PAYMENT_BASE, PUBLIC_BASE_URL } = require('./_lib/config');
const { authMiddleware } = require('./_lib/auth');
const { setCORS, sendJson, parseBody, formatPhone, detectNetwork } = require('./_lib/utils');

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

    // STRATEGY: Try pawapay STK push first (gateway: "mobile") for ALL networks
    // If ACCEPTED -> STK push sent to phone (works for Safaricom)
    // If REJECTED -> Fall back to pesapal iframe checkout (works for Airtel/Telkom)
    try {
      const stkPayload = {
        amount: amount,
        currency: 'KES',
        gateway: 'mobile',
        phone: formattedPhone,
        description: 'QuickCash ' + TIERS[tier].name + ' Activation Fee',
        callback_url: callbackUrl
      };
      const stkResp = await axios.post(PAYMENT_BASE + '/payments/initiate', stkPayload, {
        headers: { 'X-API-Key': PAYMENT_API_KEY, 'Content-Type': 'application/json' },
        timeout: 30000
      });

      if (stkResp.data && stkResp.data.success) {
        reference = stkResp.data.reference || reference;
        checkoutUrl = stkResp.data.checkout_url || null;
        pawaStatus = stkResp.data.pawa_status || '';
        usedGateway = stkResp.data.gateway || 'pawapay';

        if (pawaStatus === 'ACCEPTED') {
          stkPushSent = true;
        } else if (pawaStatus === 'REJECTED' || pawaStatus === 'FAILED') {
          // Try pesapal iframe checkout fallback
          try {
            const pesapalResp = await axios.post(PAYMENT_BASE + '/payments/initiate', {
              amount: amount, currency: 'KES', phone: formattedPhone,
              description: 'QuickCash ' + TIERS[tier].name + ' Activation Fee',
              callback_url: callbackUrl
            }, { headers: { 'X-API-Key': PAYMENT_API_KEY, 'Content-Type': 'application/json' }, timeout: 30000 });

            if (pesapalResp.data && pesapalResp.data.success) {
              reference = pesapalResp.data.reference || reference;
              redirectUrl = pesapalResp.data.redirect_url || null;
              orderTrackingId = pesapalResp.data.order_tracking_id || null;
              usedGateway = pesapalResp.data.gateway || 'pesapal';
              stkPushSent = false;
            }
          } catch (pspErr) {
            console.error('Pesapal fallback error:', pspErr.message);
          }
        } else {
          redirectUrl = stkResp.data.redirect_url || null;
          checkoutUrl = stkResp.data.checkout_url || checkoutUrl;
          orderTrackingId = stkResp.data.order_tracking_id || null;
        }
      } else {
        // Try pesapal fallback
        try {
          const pesapalResp = await axios.post(PAYMENT_BASE + '/payments/initiate', {
            amount: amount, currency: 'KES', phone: formattedPhone,
            description: 'QuickCash ' + TIERS[tier].name + ' Activation Fee',
            callback_url: callbackUrl
          }, { headers: { 'X-API-Key': PAYMENT_API_KEY, 'Content-Type': 'application/json' }, timeout: 30000 });
          if (pesapalResp.data && pesapalResp.data.success) {
            reference = pesapalResp.data.reference || reference;
            redirectUrl = pesapalResp.data.redirect_url || null;
            orderTrackingId = pesapalResp.data.order_tracking_id || null;
            usedGateway = pesapalResp.data.gateway || 'pesapal';
          }
        } catch (pspErr) {
          console.error('Pesapal error:', pspErr.message);
        }
      }
    } catch (payErr) {
      const errData = payErr.response ? payErr.response.data : payErr.message;
      console.error('Payment API error:', JSON.stringify(errData));
      // Try pesapal as last resort
      try {
        const pesapalResp = await axios.post(PAYMENT_BASE + '/payments/initiate', {
          amount: amount, currency: 'KES', phone: formattedPhone,
          description: 'QuickCash ' + TIERS[tier].name + ' Activation Fee',
          callback_url: callbackUrl
        }, { headers: { 'X-API-Key': PAYMENT_API_KEY, 'Content-Type': 'application/json' }, timeout: 30000 });
        if (pesapalResp.data && pesapalResp.data.success) {
          reference = pesapalResp.data.reference || reference;
          redirectUrl = pesapalResp.data.redirect_url || null;
          orderTrackingId = pesapalResp.data.order_tracking_id || null;
          usedGateway = pesapalResp.data.gateway || 'pesapal';
        }
      } catch (pspErr2) {
        console.error('Final pesapal fallback error:', pspErr2.message);
      }
    }

    // Save payment record
    try {
      await pool.query(
        'INSERT INTO payments (user_id, amount, phone, provider, reference, order_tracking_id, gateway, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [req.user.id, amount, phone, detectedNetwork, reference, orderTrackingId, usedGateway, 'pending']
      );
    } catch (dbErr) {
      console.error('Payment record insert error:', dbErr.message);
    }

    let userMessage = '';
    if (stkPushSent) {
      userMessage = 'STK push sent! Check your phone and enter your PIN to confirm payment.';
    } else if (redirectUrl) {
      userMessage = 'Payment checkout ready. Complete payment in the checkout page.';
    } else if (pawaStatus === 'REJECTED' || pawaStatus === 'FAILED') {
      userMessage = 'Direct push not available for your network. Please use the checkout page to complete payment.';
    } else {
      userMessage = 'Payment initiated. Please follow the instructions to complete.';
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
