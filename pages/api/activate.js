const { ensureDB, getPool, verifyAuth, TIERS, PAYMENT_API_KEY, PAYMENT_BASE, CALLBACK_URL, formatPhone, detectNetwork } = require('../../lib/db');
const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }

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
    await ensureDB();
    const body = req.body || {};
    phone = body.phone || '';
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    const pool = getPool();
    const user = await pool.query('SELECT is_activated, tier FROM users WHERE id = $1', [auth.id]);
    if (!user.rows || user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.rows[0].is_activated) {
      return res.status(400).json({ error: 'Account already activated' });
    }

    tier = user.rows[0].tier;
    amount = TIERS[tier].activationFee;
    const formattedPhone = formatPhone(phone);
    detectedNetwork = detectNetwork(phone);

    console.log('Activation request:', { phone: formattedPhone, detectedNetwork, amount, tier });

    // STRATEGY: Try pawapay STK push first, then pesapal iframe fallback
    try {
      const stkPayload = {
        amount: amount,
        currency: 'KES',
        gateway: 'mobile',
        phone: formattedPhone,
        description: 'QuickCash ' + TIERS[tier].name + ' Activation Fee',
        callback_url: CALLBACK_URL
      };

      console.log('Trying STK push:', JSON.stringify(stkPayload));

      const stkResp = await axios.post(PAYMENT_BASE + '/payments/initiate', stkPayload, {
        headers: { 'X-API-Key': PAYMENT_API_KEY, 'Content-Type': 'application/json' },
        timeout: 30000
      });

      console.log('STK push response:', JSON.stringify(stkResp.data));

      if (stkResp.data && stkResp.data.success) {
        reference = stkResp.data.reference || reference;
        checkoutUrl = stkResp.data.checkout_url || null;
        pawaStatus = stkResp.data.pawa_status || '';
        usedGateway = stkResp.data.gateway || 'pawapay';

        if (pawaStatus === 'ACCEPTED') {
          stkPushSent = true;
          console.log('STK push ACCEPTED for', detectedNetwork);
        } else if (pawaStatus === 'REJECTED' || pawaStatus === 'FAILED') {
          console.log('STK push REJECTED, trying pesapal iframe checkout...');
          try {
            const pesapalPayload = {
              amount: amount,
              currency: 'KES',
              phone: formattedPhone,
              description: 'QuickCash ' + TIERS[tier].name + ' Activation Fee',
              callback_url: CALLBACK_URL
            };
            const pesapalResp = await axios.post(PAYMENT_BASE + '/payments/initiate', pesapalPayload, {
              headers: { 'X-API-Key': PAYMENT_API_KEY, 'Content-Type': 'application/json' },
              timeout: 30000
            });
            console.log('Pesapal response:', JSON.stringify(pesapalResp.data));
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
        console.log('STK push returned non-success:', JSON.stringify(stkResp.data));
        try {
          const pesapalPayload = {
            amount: amount,
            currency: 'KES',
            phone: formattedPhone,
            description: 'QuickCash ' + TIERS[tier].name + ' Activation Fee',
            callback_url: CALLBACK_URL
          };
          const pesapalResp = await axios.post(PAYMENT_BASE + '/payments/initiate', pesapalPayload, {
            headers: { 'X-API-Key': PAYMENT_API_KEY, 'Content-Type': 'application/json' },
            timeout: 30000
          });
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
      try {
        const pesapalPayload = {
          amount: amount,
          currency: 'KES',
          phone: formattedPhone,
          description: 'QuickCash ' + TIERS[tier].name + ' Activation Fee',
          callback_url: CALLBACK_URL
        };
        const pesapalResp = await axios.post(PAYMENT_BASE + '/payments/initiate', pesapalPayload, {
          headers: { 'X-API-Key': PAYMENT_API_KEY, 'Content-Type': 'application/json' },
          timeout: 30000
        });
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
        [auth.id, amount, phone, detectedNetwork, reference, orderTrackingId, usedGateway, 'pending']
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

    res.json({
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
        [auth.id, amount || 0, phone || '', detectedNetwork || '', reference, usedGateway || '', 'failed']
      );
    } catch (e) {}
    res.status(500).json({ error: 'Payment could not be processed. Please try again.' });
  }
};
