// POST /api/tasks/:id/complete
const { getPool } = require('../../_lib/db');
const { authMiddleware } = require('../../_lib/auth');
const { setCORS, sendJson } = require('../../_lib/utils');

module.exports = authMiddleware(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    // Vercel dynamic route param: req.query.id
    const taskId = req.query.id;
    const pool = getPool();
    const task = await pool.query('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [taskId, req.user.id]);
    if (task.rows.length === 0) return sendJson(res, 404, { error: 'Task not found' });
    if (task.rows[0].status === 'completed') return sendJson(res, 400, { error: 'Task already completed' });
    await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', ['completed', taskId]);
    await pool.query('UPDATE users SET earnings = earnings + $1, completed_tasks = completed_tasks + 1 WHERE id = $2', [task.rows[0].reward, req.user.id]);
    const user = await pool.query('SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1', [req.user.id]);
    return sendJson(res, 200, { message: 'Task completed', reward: task.rows[0].reward, user: user.rows[0] });
  } catch (err) {
    return sendJson(res, 500, { error: 'Server error' });
  }
});
