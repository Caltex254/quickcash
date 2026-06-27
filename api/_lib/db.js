// Database pool singleton - reused across Vercel serverless invocations
const { Pool } = require('pg');
const { DATABASE_URL } = require('./config');

// Vercel reuses warm instances, so we cache the pool globally.
let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    pool.on('error', (err) => {
      console.error('Unexpected pool error:', err.message);
    });
  }
  return pool;
}

async function initDB() {
  const p = getPool();
  try {
    const colCheck = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'username'");
    if (colCheck.rows.length === 0) {
      console.log('Rebuilding database schema...');
      await p.query('DROP TABLE IF EXISTS payments CASCADE');
      await p.query('DROP TABLE IF EXISTS withdrawals CASCADE');
      await p.query('DROP TABLE IF EXISTS tasks CASCADE');
      await p.query('DROP TABLE IF EXISTS users CASCADE');
    }
    await p.query("CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, phone VARCHAR(20) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, tier VARCHAR(20) DEFAULT 'silver', is_activated BOOLEAN DEFAULT false, earnings DECIMAL(10,2) DEFAULT 0, completed_tasks INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    await p.query("CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), task_type VARCHAR(50) NOT NULL, task_data JSONB, reward DECIMAL(10,2), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    await p.query("CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), amount DECIMAL(10,2), phone VARCHAR(20), provider VARCHAR(30), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    await p.query("CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), amount DECIMAL(10,2), phone VARCHAR(20), provider VARCHAR(30), reference VARCHAR(100), order_tracking_id VARCHAR(100), gateway VARCHAR(30), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");

    // Ensure optional columns exist (idempotent)
    try {
      const refCol = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'reference'");
      if (refCol.rows.length === 0) await p.query('ALTER TABLE payments ADD COLUMN reference VARCHAR(100)');
      const otiCol = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'order_tracking_id'");
      if (otiCol.rows.length === 0) await p.query('ALTER TABLE payments ADD COLUMN order_tracking_id VARCHAR(100)');
      const gwCol = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'gateway'");
      if (gwCol.rows.length === 0) await p.query('ALTER TABLE payments ADD COLUMN gateway VARCHAR(30)');
    } catch (alterErr) {
      console.error('DB alter error:', alterErr.message);
    }
    console.log('Database schema verified');
  } catch (err) {
    console.error('DB init failed:', err.message);
    throw err;
  }
}

module.exports = { getPool, initDB };
