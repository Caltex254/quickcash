const { ensureDB, getPool, verifyAuth, TIERS, TASK_TEMPLATES } = require('../../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    await ensureDB();
    const pool = getPool();
    const user = await pool.query('SELECT tier, completed_tasks FROM users WHERE id = $1', [auth.id]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const tierConf = TIERS[user.rows[0].tier];
    const existing = await pool.query('SELECT COUNT(*) as cnt FROM tasks WHERE user_id = $1 AND status = $2', [auth.id, 'pending']);
    if (parseInt(existing.rows[0].cnt) === 0) {
      const templates = TASK_TEMPLATES[user.rows[0].tier] || TASK_TEMPLATES.silver;
      for (let i = 0; i < tierConf.tasks; i++) {
        const tmpl = templates[i % templates.length];
        const reward = (Math.random() * (tierConf.maxEarn - tierConf.minEarn) + tierConf.minEarn).toFixed(2);
        await pool.query(
          'INSERT INTO tasks (user_id, task_type, task_data, reward, status) VALUES ($1, $2, $3, $4, $5)',
          [auth.id, tmpl.type, JSON.stringify({ question: tmpl.question, options: tmpl.options, icon: tmpl.icon }), reward, 'pending']
        );
      }
    }
    const tasks = await pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY id', [auth.id]);
    res.json({ tasks: tasks.rows, tier: user.rows[0].tier, tierInfo: tierConf });
  } catch (err) {
    console.error('Tasks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
