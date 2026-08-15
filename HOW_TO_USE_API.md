# How to Use the Content Factory API

## Quick Start

```bash
# 1. Checkout branch
git checkout feature/perplexity-multi-tenant

# 2. Apply migrations
psql "$DATABASE_URL" -f migrations/001_v2.sql
psql "$DATABASE_URL" -f migrations/002_v2.1_multi_tenant.sql

# 3. Install and configure API
cd apps/api
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL and NVIDIA_API_KEY

# 4. Start API
npm start

# 5. Start worker (separate terminal)
export DATABASE_URL='postgresql://...'
export NVIDIA_API_KEY='your-key'
node worker/factory-worker-v2.js

# 6. Create video
curl -X POST http://localhost:3001/api/productions \
  -H "Content-Type: application/json" \
  -d '{"business_id":"UUID","brand_id":"UUID","topic":"Why Roman pizza is thin","platforms":["tiktok"]}'
```

## Full Documentation

The complete guide with all endpoints, SQL examples, and troubleshooting is in the repository.

## Next Step

Build the dashboard (Next.js app) that calls these endpoints.
