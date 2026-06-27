// Phone/network helpers - Vercel serverless compatible

function formatPhone(phone) {
  if (!phone) return phone;
  phone = String(phone).replace(/\s+/g, '');
  if (phone.startsWith('+')) return phone;
  if (phone.startsWith('254')) return '+' + phone;
  if (phone.startsWith('0')) return '+254' + phone.substring(1);
  if (phone.startsWith('7') || phone.startsWith('1')) return '+254' + phone;
  return '+' + phone;
}

// All providers use pawapay (mobile) for STK push
function mapProviderToGateway(/* provider */) {
  return 'mobile';
}

// Map provider to pawapay correspondent for proper network routing
function mapProviderToCorrespondent(provider) {
  switch (provider) {
    case 'safaricom': return 'MPESA_KEN';
    case 'airtel':    return 'AIRTEL_KEN';
    case 'telkom':    return 'TELKOM_KEN';
    default:          return 'MPESA_KEN';
  }
}

// Auto-detect network from phone number prefix
function detectNetwork(phone) {
  const p = String(phone || '').replace(/\s+/g, '').replace('+', '');
  let prefix = '';
  if (p.startsWith('254') && p.length >= 6) prefix = p.substring(3, 6);
  else if (p.startsWith('0') && p.length >= 4) prefix = p.substring(1, 4);
  else if (p.length >= 3) prefix = p.substring(0, 3);

  const num = parseInt(prefix, 10);
  if (Number.isNaN(num)) return 'safaricom';
  // Safaricom prefixes: 710-719, 720-729, 790-799, 110-113
  if ((num >= 710 && num <= 719) || (num >= 720 && num <= 729) || (num >= 790 && num <= 799) || (num >= 110 && num <= 113)) return 'safaricom';
  // Airtel prefixes: 730-739, 750-759, 770-779, 100-109
  if ((num >= 730 && num <= 739) || (num >= 750 && num <= 759) || (num >= 770 && num <= 779) || (num >= 100 && num <= 109)) return 'airtel';
  // Telkom prefixes: 770-773
  if (num >= 770 && num <= 773) return 'telkom';
  return 'safaricom';
}

// CORS + JSON helpers
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// Parse JSON body from Vercel request
function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') {
      resolve(req.body);
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = {
  formatPhone,
  mapProviderToGateway,
  mapProviderToCorrespondent,
  detectNetwork,
  setCORS,
  sendJson,
  parseBody
};
