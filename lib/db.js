// QuickCash Agency - Shared library for API routes
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Constants - use env vars with safe defaults
const JWT_SECRET = process.env.JWT_SECRET || 'quickcash_agency_secret_key_2024';
const PAYMENT_API_KEY = process.env.PAYMENT_API_KEY || 'pg_Q4LRdgtUxO3HWEYFuOUxvLf2cNDZYHtz';
const PAYMENT_BASE = process.env.PAYMENT_BASE || 'https://pay.xdigitex.space/api';
const CALLBACK_URL = process.env.CALLBACK_URL || 'https://quickcash.kenya.qzz.io/api/payment-callback';

const TIERS = {
  silver: { name: 'Silver', tasks: 30, minEarn: 30, maxEarn: 80, activationFee: 199 },
  gold:   { name: 'Gold',   tasks: 30, minEarn: 100, maxEarn: 250, activationFee: 299 },
  vip:    { name: 'VIP',    tasks: 30, minEarn: 300, maxEarn: 800, activationFee: 399 }
};

const MIN_WITHDRAWAL = 500;

// DB pool - reuses connection across serverless invocations
let pool;
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL ||
      'postgresql://neondb_owner:npg_GHmSXzO54Qkt@ep-proud-resonance-ah9qcip4.c-3.us-east-1.aws.neon.tech/neondb';
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (err) => {
      console.error('Unexpected pool error:', err.message);
    });
  }
  return pool;
}

// Initialize DB schema - called lazily on first request
let dbInitialized = false;
let initPromise = null;

async function ensureDB() {
  if (dbInitialized) return;
  if (initPromise) return initPromise;
  initPromise = initDBInternal().then(() => { dbInitialized = true; }).catch(e => {
    initPromise = null;
    throw e;
  });
  return initPromise;
}

async function initDBInternal() {
  const pool = getPool();
  console.log('Initializing database schema...');
  const colCheck = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'username'");
  if (colCheck.rows.length === 0) {
    console.log('Rebuilding database schema...');
    await pool.query('DROP TABLE IF EXISTS payments CASCADE');
    await pool.query('DROP TABLE IF EXISTS withdrawals CASCADE');
    await pool.query('DROP TABLE IF EXISTS tasks CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
  }
  await pool.query("CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, phone VARCHAR(20) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, tier VARCHAR(20) DEFAULT 'silver', is_activated BOOLEAN DEFAULT false, earnings DECIMAL(10,2) DEFAULT 0, completed_tasks INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  await pool.query("CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), task_type VARCHAR(50) NOT NULL, task_data JSONB, reward DECIMAL(10,2), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  await pool.query("CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), amount DECIMAL(10,2), phone VARCHAR(20), provider VARCHAR(30), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  await pool.query("CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), amount DECIMAL(10,2), phone VARCHAR(20), provider VARCHAR(30), reference VARCHAR(100), order_tracking_id VARCHAR(100), gateway VARCHAR(30), status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");

  // Ensure new columns exist
  try {
    const refCol = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'reference'");
    if (refCol.rows.length === 0) await pool.query('ALTER TABLE payments ADD COLUMN reference VARCHAR(100)');
    const otiCol = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'order_tracking_id'");
    if (otiCol.rows.length === 0) await pool.query('ALTER TABLE payments ADD COLUMN order_tracking_id VARCHAR(100)');
    const gwCol = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'gateway'");
    if (gwCol.rows.length === 0) await pool.query('ALTER TABLE payments ADD COLUMN gateway VARCHAR(30)');
  } catch (alterErr) {
    console.error('DB alter error:', alterErr.message);
  }
  console.log('Database initialized successfully');
}

// Auth middleware - returns user or null
function verifyAuth(req) {
  const auth = req.headers.authorization || '';
  const token = auth.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function formatPhone(phone) {
  if (!phone) return phone;
  phone = phone.replace(/\s+/g, '');
  if (phone.startsWith('+')) return phone;
  if (phone.startsWith('254')) return '+' + phone;
  if (phone.startsWith('0')) return '+254' + phone.substring(1);
  if (phone.startsWith('7') || phone.startsWith('1')) return '+254' + phone;
  return '+' + phone;
}

function detectNetwork(phone) {
  const p = phone.replace(/\s+/g, '').replace('+', '');
  let prefix = '';
  if (p.startsWith('254') && p.length >= 6) prefix = p.substring(3, 6);
  else if (p.startsWith('0') && p.length >= 4) prefix = p.substring(1, 4);
  else if (p.length >= 3) prefix = p.substring(0, 3);
  const num = parseInt(prefix);
  if ((num >= 710 && num <= 719) || (num >= 720 && num <= 729) || (num >= 790 && num <= 799) || (num >= 110 && num <= 113)) return 'safaricom';
  if ((num >= 730 && num <= 739) || (num >= 750 && num <= 759) || (num >= 770 && num <= 779) || (num >= 100 && num <= 109)) return 'airtel';
  if (num >= 770 && num <= 773) return 'telkom';
  return 'safaricom';
}

// Task templates
const TASK_TEMPLATES = require('./tasks');

module.exports = {
  JWT_SECRET,
  PAYMENT_API_KEY,
  PAYMENT_BASE,
  CALLBACK_URL,
  TIERS,
  MIN_WITHDRAWAL,
  TASK_TEMPLATES,
  getPool,
  ensureDB,
  verifyAuth,
  formatPhone,
  detectNetwork,
};
