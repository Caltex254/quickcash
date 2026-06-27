// GET /api/tasks
const { getPool } = require('./_lib/db');
const { TIERS } = require('./_lib/config');
const { TASK_TEMPLATES } = require('./_lib/tasks');
const { authMiddleware } = require('./_lib/auth');
const { setCORS, sendJson } = require('./_lib/utils');

module.exports = authMiddleware(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const pool = getPool();
    const user = await pool.query('SELECT tier, completed_tasks FROM users WHERE id = $1', [req.user.id]);
    const tierConf = TIERS[user.rows[0].tier];
    const existing = await pool.query('SELECT COUNT(*) as cnt FROM tasks WHERE user_id = $1 AND status = $2', [req.user.id, 'pending']);
    if (parseInt(existing.rows[0].cnt, 10) === 0) {
      const templates = TASK_TEMPLATES[user.rows[0].tier] || TASK_TEMPLATES.silver;
      for (let i = 0; i < tierConf.tasks; i++) {
        const tmpl = templates[i % templates.length];
        const reward = (Math.random() * (tierConf.maxEarn - tierConf.minEarn) + tierConf.minEarn).toFixed(2);
        await pool.query(
          'INSERT INTO tasks (user_id, task_type, task_data, reward, status) VALUES ($1, $2, $3, $4, $5)',
          [req.user.id, tmpl.type, JSON.stringify({ question: tmpl.question, options: tmpl.options, icon: tmpl.icon }), reward, 'pending']
        );
      }
    }
    const tasks = await pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY id', [req.user.id]);
    return sendJson(res, 200, { tasks: tasks.rows, tier: user.rows[0].tier, tierInfo: tierConf });
  } catch (err) {
    console.error('Tasks error:', err.message);
    return sendJson(res, 500, { error: 'Server error' });
  }
});
