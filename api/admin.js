// QuickCash Agency - Consolidated Admin API
// All admin operations routed through ?action=... to stay within Vercel's
// 12-serverless-function Hobby plan limit.
//
// Actions (all require Bearer admin token except "login"):
//   POST action=login                  -> { token }
//   GET  action=stats                  -> dashboard KPIs + chart data
//   GET  action=users&q=&limit=&offset= -> paginated users
//   GET  action=user&id=               -> single user detail (with tasks/withdrawals/payments)
//   POST action=update-user            -> { id, tier?, is_activated?, earnings?, completed_tasks?, banned? }
//   POST action=delete-user            -> { id }
//   POST action=credit-user            -> { id, amount } manual earnings adjustment
//   GET  action=withdrawals&status=    -> list withdrawals (filter by status)
//   POST action=approve-withdrawal     -> { id }  mark approved
//   POST action=reject-withdrawal      -> { id }  mark rejected
//   POST action=mark-withdrawal-paid   -> { id }  mark completed (paid out)
//   GET  action=payments&status=       -> list payments (filter by status)
//   GET  action=tiers                  -> tier configuration
//   POST action=update-tier            -> { tier, activationFee, minEarn, maxEarn, tasks }
//   GET  action=analytics              -> 7/30-day signups + revenue charts

const { getPool, initDB } = require('./_lib/db');
const { setCORS, sendJson, parseBody } = require('./_lib/utils');
const { adminLogin, adminMiddleware } = require('./_lib/admin-auth');
const { TIERS, MIN_WITHDRAWAL } = require('./_lib/config');

// Tier overrides stored in memory (Vercel functions are stateless across
// invocations, so this is best-effort; in production, persist to DB).
// To make tier changes durable, we persist to a settings table.

async function ensureSettingsTable() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_settings (
    key VARCHAR(50) PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function loadTierOverrides() {
  const pool = getPool();
  await ensureSettingsTable();
  const r = await pool.query("SELECT value FROM admin_settings WHERE key='tiers'");
  if (r.rows.length > 0) {
    return { ...TIERS, ...r.rows[0].value };
  }
  return { ...TIERS };
}

async function saveTierOverrides(overrides) {
  const pool = getPool();
  await ensureSettingsTable();
  await pool.query(
    `INSERT INTO admin_settings (key, value) VALUES ('tiers', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(overrides)]
  );
}

// ----------------- Action handlers -----------------

async function handleLogin(req, res) {
  const body = await parseBody(req);
  const { phone, password } = body;
  const token = adminLogin(phone, password);
  if (!token) {
    return sendJson(res, 401, { error: 'Invalid admin credentials' });
  }
  return sendJson(res, 200, { token, phone, role: 'admin' });
}

async function handleStats(req, res) {
  const pool = getPool();
  const [
    totalUsers, activatedUsers, pendingWithdrawals,
    pendingPayments, completedPayments, withdrawalsAll,
    tierCounts, todaySignups, revenueAgg
  ] = await Promise.all([
    pool.query('SELECT COUNT(*) AS c FROM users'),
    pool.query("SELECT COUNT(*) AS c FROM users WHERE is_activated = true"),
    pool.query("SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS total FROM withdrawals WHERE status = 'pending'"),
    pool.query("SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS total FROM payments WHERE status = 'pending'"),
    pool.query("SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS total FROM payments WHERE status = 'completed'"),
    pool.query("SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS total FROM withdrawals WHERE status = 'completed'"),
    pool.query("SELECT tier, COUNT(*) AS c FROM users GROUP BY tier"),
    pool.query("SELECT COUNT(*) AS c FROM users WHERE created_at >= CURRENT_DATE"),
    pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status = 'completed'")
  ]);

  const tiers = {};
  tierCounts.rows.forEach(r => { tiers[r.tier] = parseInt(r.c, 10); });

  // Signups over last 14 days
  const signups = await pool.query(`
    SELECT d::date AS day, COUNT(u.id) AS count
    FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, '1 day') d
    LEFT JOIN users u ON u.created_at::date = d::date
    GROUP BY d::date ORDER BY d::date
  `);

  // Revenue over last 14 days
  const revenue = await pool.query(`
    SELECT d::date AS day, COALESCE(SUM(p.amount),0) AS total
    FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, '1 day') d
    LEFT JOIN payments p ON p.created_at::date = d::date AND p.status = 'completed'
    GROUP BY d::date ORDER BY d::date
  `);

  return sendJson(res, 200, {
    totalUsers: parseInt(totalUsers.rows[0].c, 10),
    activatedUsers: parseInt(activatedUsers.rows[0].c, 10),
    pendingWithdrawals: parseInt(pendingWithdrawals.rows[0].c, 10),
    pendingWithdrawalsAmount: parseFloat(pendingWithdrawals.rows[0].total),
    pendingPayments: parseInt(pendingPayments.rows[0].c, 10),
    pendingPaymentsAmount: parseFloat(pendingPayments.rows[0].total),
    completedPayments: parseInt(completedPayments.rows[0].c, 10),
    totalRevenue: parseFloat(completedPayments.rows[0].total),
    completedWithdrawals: parseInt(withdrawalsAll.rows[0].c, 10),
    completedWithdrawalsAmount: parseFloat(withdrawalsAll.rows[0].total),
    tierCounts: tiers,
    todaySignups: parseInt(todaySignups.rows[0].c, 10),
    signupsChart: signups.rows.map(r => ({ day: r.day, count: parseInt(r.count, 10) })),
    revenueChart: revenue.rows.map(r => ({ day: r.day, total: parseFloat(r.total) }))
  });
}

async function handleListUsers(req, res) {
  const pool = getPool();
  const url = new URL(req.url, 'http://localhost');
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  let sql = `SELECT id, username, phone, tier, is_activated, earnings, completed_tasks, created_at
             FROM users`;
  const params = [];
  if (q) {
    sql += ` WHERE username ILIKE $1 OR phone ILIKE $1`;
    params.push(`%${q}%`);
  }
  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const countSql = q
    ? `SELECT COUNT(*) AS c FROM users WHERE username ILIKE $1 OR phone ILIKE $1`
    : `SELECT COUNT(*) AS c FROM users`;
  const countParams = q ? [`%${q}%`] : [];

  const [rows, count] = await Promise.all([
    pool.query(sql, params),
    pool.query(countSql, countParams)
  ]);

  return sendJson(res, 200, {
    users: rows.rows,
    total: parseInt(count.rows[0].c, 10),
    limit,
    offset
  });
}

async function handleGetUser(req, res) {
  const pool = getPool();
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('id');
  if (!id) return sendJson(res, 400, { error: 'Missing id' });

  const user = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  if (user.rows.length === 0) return sendJson(res, 404, { error: 'User not found' });

  const [tasks, withdrawals, payments] = await Promise.all([
    pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [id]),
    pool.query('SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [id]),
    pool.query('SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [id])
  ]);

  return sendJson(res, 200, {
    user: user.rows[0],
    tasks: tasks.rows,
    withdrawals: withdrawals.rows,
    payments: payments.rows
  });
}

async function handleUpdateUser(req, res) {
  const pool = getPool();
  const body = await parseBody(req);
  const { id, tier, is_activated, earnings, completed_tasks } = body;
  if (!id) return sendJson(res, 400, { error: 'Missing id' });

  const sets = [];
  const params = [];
  if (tier && ['silver', 'gold', 'vip'].includes(tier)) {
    params.push(tier);
    sets.push(`tier = $${params.length}`);
  }
  if (typeof is_activated === 'boolean') {
    params.push(is_activated);
    sets.push(`is_activated = $${params.length}`);
  }
  if (typeof earnings === 'number' && earnings >= 0) {
    params.push(earnings);
    sets.push(`earnings = $${params.length}`);
  }
  if (typeof completed_tasks === 'number' && completed_tasks >= 0) {
    params.push(completed_tasks);
    sets.push(`completed_tasks = $${params.length}`);
  }
  if (sets.length === 0) return sendJson(res, 400, { error: 'Nothing to update' });

  params.push(id);
  const sql = `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`;
  const r = await pool.query(sql, params);
  if (r.rows.length === 0) return sendJson(res, 404, { error: 'User not found' });
  return sendJson(res, 200, { user: r.rows[0] });
}

async function handleDeleteUser(req, res) {
  const pool = getPool();
  const body = await parseBody(req);
  const { id } = body;
  if (!id) return sendJson(res, 400, { error: 'Missing id' });
  await pool.query('DELETE FROM tasks WHERE user_id = $1', [id]);
  await pool.query('DELETE FROM withdrawals WHERE user_id = $1', [id]);
  await pool.query('DELETE FROM payments WHERE user_id = $1', [id]);
  const r = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
  if (r.rows.length === 0) return sendJson(res, 404, { error: 'User not found' });
  return sendJson(res, 200, { deleted: true });
}

async function handleCreditUser(req, res) {
  const pool = getPool();
  const body = await parseBody(req);
  const { id, amount } = body;
  if (!id || typeof amount !== 'number') return sendJson(res, 400, { error: 'Missing id or amount' });
  const r = await pool.query(
    'UPDATE users SET earnings = GREATEST(0, earnings + $1) WHERE id = $2 RETURNING id, earnings',
    [amount, id]
  );
  if (r.rows.length === 0) return sendJson(res, 404, { error: 'User not found' });
  return sendJson(res, 200, { user: r.rows[0] });
}

async function handleListWithdrawals(req, res) {
  const pool = getPool();
  const url = new URL(req.url, 'http://localhost');
  const status = url.searchParams.get('status'); // pending|approved|rejected|completed
  let sql = `SELECT w.*, u.username, u.phone AS user_phone, u.tier
             FROM withdrawals w JOIN users u ON u.id = w.user_id`;
  const params = [];
  if (status && ['pending', 'approved', 'rejected', 'completed'].includes(status)) {
    params.push(status);
    sql += ` WHERE w.status = $1`;
  }
  sql += ` ORDER BY w.created_at DESC LIMIT 200`;
  const r = await pool.query(sql, params);
  return sendJson(res, 200, { withdrawals: r.rows });
}

async function handleWithdrawalAction(req, res, newStatus) {
  const pool = getPool();
  const body = await parseBody(req);
  const { id } = body;
  if (!id) return sendJson(res, 400, { error: 'Missing id' });
  const r = await pool.query(
    'UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *',
    [newStatus, id]
  );
  if (r.rows.length === 0) return sendJson(res, 404, { error: 'Withdrawal not found' });
  return sendJson(res, 200, { withdrawal: r.rows[0] });
}

async function handleListPayments(req, res) {
  const pool = getPool();
  const url = new URL(req.url, 'http://localhost');
  const status = url.searchParams.get('status');
  let sql = `SELECT p.*, u.username, u.phone AS user_phone, u.tier
             FROM payments p JOIN users u ON u.id = p.user_id`;
  const params = [];
  if (status && ['pending', 'completed', 'failed', 'rejected'].includes(status)) {
    params.push(status);
    sql += ` WHERE p.status = $1`;
  }
  sql += ` ORDER BY p.created_at DESC LIMIT 200`;
  const r = await pool.query(sql, params);
  return sendJson(res, 200, { payments: r.rows });
}

async function handleGetTiers(req, res) {
  const tiers = await loadTierOverrides();
  return sendJson(res, 200, { tiers, minWithdrawal: MIN_WITHDRAWAL });
}

async function handleUpdateTier(req, res) {
  const pool = getPool();
  const body = await parseBody(req);
  const { tier, activationFee, minEarn, maxEarn, tasks } = body;
  if (!tier || !['silver', 'gold', 'vip'].includes(tier)) {
    return sendJson(res, 400, { error: 'Invalid tier' });
  }
  const current = await loadTierOverrides();
  const updated = {
    ...current,
    [tier]: {
      name: current[tier].name,
      tasks: typeof tasks === 'number' ? tasks : current[tier].tasks,
      minEarn: typeof minEarn === 'number' ? minEarn : current[tier].minEarn,
      maxEarn: typeof maxEarn === 'number' ? maxEarn : current[tier].maxEarn,
      activationFee: typeof activationFee === 'number' ? activationFee : current[tier].activationFee
    }
  };
  await saveTierOverrides(updated);
  return sendJson(res, 200, { tiers: updated });
}

async function handleAnalytics(req, res) {
  const pool = getPool();
  const [signups30, revenue30, withdrawals30, tierBreakdown, topEarners] = await Promise.all([
    pool.query(`
      SELECT d::date AS day, COUNT(u.id) AS count
      FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') d
      LEFT JOIN users u ON u.created_at::date = d::date
      GROUP BY d::date ORDER BY d::date`),
    pool.query(`
      SELECT d::date AS day, COALESCE(SUM(p.amount),0) AS total
      FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') d
      LEFT JOIN payments p ON p.created_at::date = d::date AND p.status = 'completed'
      GROUP BY d::date ORDER BY d::date`),
    pool.query(`
      SELECT d::date AS day, COALESCE(SUM(w.amount),0) AS total
      FROM generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day') d
      LEFT JOIN withdrawals w ON w.created_at::date = d::date AND w.status = 'completed'
      GROUP BY d::date ORDER BY d::date`),
    pool.query(`SELECT tier, COUNT(*) AS c, COALESCE(SUM(earnings),0) AS earnings FROM users GROUP BY tier`),
    pool.query(`SELECT id, username, phone, tier, earnings, completed_tasks FROM users ORDER BY earnings DESC LIMIT 10`)
  ]);
  return sendJson(res, 200, {
    signups30: signups30.rows,
    revenue30: revenue30.rows,
    withdrawals30: withdrawals30.rows,
    tierBreakdown: tierBreakdown.rows,
    topEarners: topEarners.rows
  });
}

// ----------------- Router -----------------

module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  try {
    await initDB();
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || (req.method === 'POST' ? '' : 'stats');

    // Login is public; everything else requires admin token
    if (action === 'login' && req.method === 'POST') {
      return await handleLogin(req, res);
    }

    // Wrap everything else in admin middleware
    return adminMiddleware(async (r, s) => {
      const u = new URL(r.url, 'http://localhost');
      const a = u.searchParams.get('action') || 'stats';

      if (r.method === 'GET' && a === 'stats') return handleStats(r, s);
      if (r.method === 'GET' && a === 'users') return handleListUsers(r, s);
      if (r.method === 'GET' && a === 'user') return handleGetUser(r, s);
      if (r.method === 'POST' && a === 'update-user') return handleUpdateUser(r, s);
      if (r.method === 'POST' && a === 'delete-user') return handleDeleteUser(r, s);
      if (r.method === 'POST' && a === 'credit-user') return handleCreditUser(r, s);
      if (r.method === 'GET' && a === 'withdrawals') return handleListWithdrawals(r, s);
      if (r.method === 'POST' && a === 'approve-withdrawal') return handleWithdrawalAction(r, s, 'approved');
      if (r.method === 'POST' && a === 'reject-withdrawal') return handleWithdrawalAction(r, s, 'rejected');
      if (r.method === 'POST' && a === 'mark-withdrawal-paid') return handleWithdrawalAction(r, s, 'completed');
      if (r.method === 'GET' && a === 'payments') return handleListPayments(r, s);
      if (r.method === 'GET' && a === 'tiers') return handleGetTiers(r, s);
      if (r.method === 'POST' && a === 'update-tier') return handleUpdateTier(r, s);
      if (r.method === 'GET' && a === 'analytics') return handleAnalytics(r, s);

      return sendJson(s, 404, { error: 'Unknown admin action: ' + a });
    })(req, res);
  } catch (err) {
    console.error('Admin API error:', err);
    return sendJson(res, 500, { error: 'Server error: ' + err.message });
  }
};
