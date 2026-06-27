const { TIERS, MIN_WITHDRAWAL } = require('../../lib/db');

module.exports = (req, res) => {
  res.json({ tiers: TIERS, minWithdrawal: MIN_WITHDRAWAL });
};
