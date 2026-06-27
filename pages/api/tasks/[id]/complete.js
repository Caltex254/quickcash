const { ensureDB, getPool, verifyAuth } = require('../../../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    await ensureDB();
    const pool = getPool();
    const taskId = req.query.id;
    const task = await pool.query('SELECT * FROM tasks WHERE id = $1 AND user_id = $2', [taskId, auth.id]);
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.rows[0].status === 'completed') {
      return res.status(400).json({ error: 'Task already completed' });
    }
    await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', ['completed', taskId]);
    await pool.query('UPDATE users SET earnings = earnings + $1, completed_tasks = completed_tasks + 1 WHERE id = $2', [task.rows[0].reward, auth.id]);
    const user = await pool.query(
      'SELECT id, username, phone, tier, is_activated, earnings, completed_tasks FROM users WHERE id = $1',
      [auth.id]
    );
    res.json({ message: 'Task completed', reward: task.rows[0].reward, user: user.rows[0] });
  } catch (err) {
    console.error('Task complete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
