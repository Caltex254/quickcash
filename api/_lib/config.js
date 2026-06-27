// QuickCash Agency - Shared config & constants
// Vercel-compatible: reads from environment variables when available,
// falls back to hardcoded production values.

const JWT_SECRET = process.env.JWT_SECRET || 'quickcash_agency_secret_key_2024';

const PAYMENT_API_KEY = process.env.PAYMENT_API_KEY || 'pg_Q4LRdgtUxO3HWEYFuOUxvLf2cNDZYHtz';
const PAYMENT_BASE = process.env.PAYMENT_BASE || 'https://pay.xdigitex.space/api';

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://quickcash.kenya.qzz.io';

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_GHmSXzO54Qkt@ep-proud-resonance-ah9qcip4.c-3.us-east-1.aws.neon.tech/neondb';

const TIERS = {
  silver: { name: 'Silver', tasks: 30, minEarn: 30, maxEarn: 80, activationFee: 199 },
  gold:   { name: 'Gold',   tasks: 30, minEarn: 100, maxEarn: 250, activationFee: 299 },
  vip:    { name: 'VIP',    tasks: 30, minEarn: 300, maxEarn: 800, activationFee: 399 }
};

const MIN_WITHDRAWAL = 500;

module.exports = {
  JWT_SECRET,
  PAYMENT_API_KEY,
  PAYMENT_BASE,
  PUBLIC_BASE_URL,
  DATABASE_URL,
  TIERS,
  MIN_WITHDRAWAL
};
