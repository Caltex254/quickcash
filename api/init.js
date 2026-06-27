// GET /api/init - Manually trigger DB schema setup/verification (idempotent)
const { initDB } = require('./_lib/db');
const { setCORS, sendJson } = require('./_lib/utils');

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  try {
    await initDB();
    return sendJson(res, 200, { ok: true, message: 'Database initialized successfully' });
  } catch (err) {
    console.error('Init error:', err.message);
    return sendJson(res, 500, { ok: false, error: err.message });
  }
};
