# QuickCash Agency - Vercel Deployment

Live site: https://quickcash.kenya.qzz.io

## Tech Stack
- Next.js 14 (API routes)
- PostgreSQL (Neon)
- bcryptjs + JWT auth
- pawapay + pesapal payment integration

## Local Development
```bash
npm install
npm run dev
```

## Environment Variables
Set these in Vercel dashboard:
- `DATABASE_URL` - PostgreSQL connection string
- `PAYMENT_API_KEY` - pawapay API key
- `JWT_SECRET` - JWT signing secret
