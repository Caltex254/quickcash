# QuickCash Agency

Serverless deployment of the QuickCash Agency platform — live at
**https://quickcash.kenya.qzz.io**.

## Stack
- **Frontend** — Single-page HTML app served from `/public/index.html`
- **Backend** — Vercel serverless functions in `/api/*` (Node.js)
- **Database** — Neon PostgreSQL (`pg` driver, pooled)
- **Auth** — JWT (7-day expiry) + bcryptjs password hashing
- **Payments** — xdigitex/pawapay gateway with pesapal iframe fallback
- **Hosting** — Vercel + Cloudflare DNS (CNAME to `cname.vercel-dns.com`)

## Project layout
```
quickcash/
├── api/
│   ├── _lib/                 # Shared helpers (db, auth, config, utils, tasks)
│   ├── signup.js             # POST /api/signup
│   ├── login.js              # POST /api/login
│   ├── me.js                 # GET  /api/me
│   ├── tiers.js              # GET  /api/tiers
│   ├── change-tier.js        # POST /api/change-tier
│   ├── tasks.js              # GET  /api/tasks
│   ├── tasks/[id]/complete.js# POST /api/tasks/:id/complete
│   ├── activate.js           # POST /api/activate
│   ├── payment-callback.js   # POST /api/payment-callback  (webhook)
│   ├── verify-payment.js     # POST /api/verify-payment
│   ├── payment-status/[reference].js  # GET /api/payment-status/:reference
│   ├── withdraw.js           # POST /api/withdraw
│   └── init.js               # GET  /api/init  (manual DB setup)
├── public/
│   └── index.html            # Frontend SPA
├── package.json
├── vercel.json
└── README.md
```

## Environment variables (set in Vercel project settings)
| Key | Description |
|-----|-------------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign JWT tokens |
| `PAYMENT_API_KEY` | xdigitex payment gateway API key |
| `PAYMENT_BASE` | xdigitex payment API base URL |
| `PUBLIC_BASE_URL` | Public site URL (used for payment callback) |

## Local development
```bash
npm install
npm install -g vercel
vercel dev
```

## First-time DB setup
After the first deploy, hit `GET /api/init` once to ensure all tables exist.
Tables already exist in the shared Neon database from prior deployment.

## Custom domain
`quickcash.kenya.qzz.io` is configured on Cloudflare as a CNAME pointing to
`cname.vercel-dns.com`. The domain is added to the Vercel project and SSL
is auto-provisioned by Vercel.
