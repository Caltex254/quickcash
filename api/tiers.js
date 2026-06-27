// GET /api/tiers
const { TIERS, MIN_WITHDRAWAL } = require('./_lib/config');
const { setCORS, sendJson } = require('./_lib/utils');

module.exports = (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  return sendJson(res, 200, { tiers: TIERS, minWithdrawal: MIN_WITHDRAWAL });
};
