# How to Use the Content Factory API (Complete Guide)

This guide explains how to run and use the API on the isolated `feature/perplexity-multi-tenant` branch.

> The API creates content-production records and queues a script-generation job. The worker then processes the job using PostgreSQL and your NVIDIA API configuration.

## Before You Start

You need:

- Node.js 18 or later
- PostgreSQL running and reachable
- The V2.1 migrations applied to the target database
- A NVIDIA API key configured locally
- The repository checked out on `feature/perplexity-multi-tenant`

Never commit real credentials. Keep them only in local `.env` files.

## Check Out the Branch

```bash
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant
```

If you already cloned the repository:

```bash
git fetch origin
git checkout feature/perplexity-multi-tenant
git pull origin feature/perplexity-multi-tenant
```

## Apply Database Migrations

First, create a database if you do not already have one:

```bash
createdb content_factory
```

Then run the base migration followed by the multi-tenant migration:

```bash
psql "$DATABASE_URL" -f migrations/001_v2.sql
psql "$DATABASE_URL" -f migrations/002_v2.1_multi_tenant.sql
```

If your migration filenames differ in your local branch, list the directory first:

```bash
ls migrations
```

## Configure the API

Move into the API directory and install dependencies:

```bash
cd apps/api
npm install
cp .env.example .env
```

Open `apps/api/.env` and add your real values:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
NVIDIA_API_KEY=your_nvidia_api_key
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
PORT=3001
NODE_ENV=development
```

The API itself needs `DATABASE_URL`. The NVIDIA values are also used by the worker configuration.

## Start the API

From `apps/api`:

```bash
npm start
```

For development mode with file watching:

```bash
npm run dev
```

You should see output similar to:

```text
Database connected
API server running on http://localhost:3001
```

Check that it is alive:

```bash
curl http://localhost:3001/health
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2026-08-16T00:00:00.000Z"
}
```

## Create Business Data

Before you can create a video production, the database needs a tenant, business, brand, and optionally a content universe (series). Obtain their UUIDs with SQL or create them through your database tool.

Example starter records:

```sql
INSERT INTO tenants (name, slug)
VALUES ('My Factory', 'my-factory')
RETURNING id;

INSERT INTO businesses (tenant_id, name, slug, industry)
VALUES ('TENANT_UUID', 'Roma Pizza', 'roma-pizza', 'food_beverage')
RETURNING id;

INSERT INTO brands (business_id, name, slug)
VALUES ('BUSINESS_UUID', 'Roma Pizza', 'roma-pizza')
RETURNING id;

INSERT INTO brand_identities (brand_id, tone, visual_language)
VALUES (
  'BRAND_UUID',
  'funny and local',
  '{"style":"warm_cinematic","lighting_type":"natural"}'::jsonb
);

INSERT INTO content_universes (brand_id, name, type, format_rules)
VALUES (
  'BRAND_UUID',
  'Marco Explains Pizza',
  'series',
  '{"duration_ms":20000,"aspect_ratio":"9:16","hook_style":"unexpected","cta":"visit"}'::jsonb
)
RETURNING id;
```

Replace `TENANT_UUID`, `BUSINESS_UUID`, and `BRAND_UUID` with IDs returned by the preceding statements.

## Create a Video Production

Send a `POST` request to the API:

```bash
curl -X POST http://localhost:3001/api/productions \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "BUSINESS_UUID",
    "brand_id": "BRAND_UUID",
    "series_id": "SERIES_UUID",
    "topic": "Why Roman pizza is thin",
    "platforms": ["tiktok", "instagram", "youtube"]
  }'
```

Required fields:

| Field | Description |
|---|---|
| `business_id` | UUID of the business that owns the production |
| `brand_id` | UUID of the relevant brand |
| `topic` | Video idea; minimum 10 characters |
| `platforms` | One or more of `tiktok`, `instagram`, `youtube` |

Optional fields:

| Field | Description |
|---|---|
| `series_id` | UUID of the content universe / recurring series |
| `audience_id` | UUID of a target audience |
| `product_id` | UUID of a product or service |

Successful response:

```json
{
  "id": "PRODUCTION_UUID",
  "status": "queued",
  "message": "Production created. Script generation started."
}
```

The API creates:

1. A `contents` record for the idea
2. A `content_variants` record for the brand/platform variation
3. A `productions` record
4. A `SCRIPT_GENERATION` job in the `jobs` table
5. One draft `edition` per requested platform

## Start the Worker

Open a second terminal from the repository root:

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DATABASE'
export NVIDIA_API_KEY='your_nvidia_api_key'
export NVIDIA_BASE_URL='https://integrate.api.nvidia.com/v1'
node worker/factory-worker-v2.js
```

The worker polls PostgreSQL for queued jobs. For a script job it loads the business, brand, series, and compliance context; resolves the production Bible; calls NVIDIA Nemotron; and saves the generated script as an artifact.

## List Productions

Use the business UUID:

```bash
curl "http://localhost:3001/api/productions?business_id=BUSINESS_UUID"
```

Optional pagination:

```bash
curl "http://localhost:3001/api/productions?business_id=BUSINESS_UUID&limit=20&offset=0"
```

## Check One Production

```bash
curl http://localhost:3001/api/productions/PRODUCTION_UUID
```

The response includes the production record, calculated progress, jobs, artifacts, and platform editions.

## Approve a Production

Once the production is ready for review:

```bash
curl -X POST http://localhost:3001/api/productions/PRODUCTION_UUID/approve
```

## Schedule Publishing

This creates publication records for existing editions. It does not yet authenticate and upload directly to TikTok, Instagram, or YouTube; those provider integrations are a later implementation stage.

```bash
curl -X POST http://localhost:3001/api/productions/PRODUCTION_UUID/publish \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["tiktok", "instagram"],
    "scheduled_at": "2026-08-16T18:00:00Z"
  }'
```

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Confirm that the API server is running |
| `POST` | `/api/productions` | Create a production and queue script generation |
| `GET` | `/api/productions?business_id=...` | List a business's productions |
| `GET` | `/api/productions/:id` | Get production status, jobs, artifacts, and editions |
| `POST` | `/api/productions/:id/approve` | Mark a production as approved |
| `POST` | `/api/productions/:id/publish` | Create scheduled publication records |

## Current Limits

This is the first usable API layer, not the completed production factory. The copied worker currently implements script generation through NVIDIA Nemotron; shot generation, media generation, continuity checks, rendering, and direct social publishing remain explicit follow-up implementations.

Do not treat a `completed` job as a completed TikTok video unless the corresponding final-video artifact and validation stages are present. Always inspect the production's jobs and artifacts before approval.

## Troubleshooting

### API cannot connect to PostgreSQL

Check the database URL:

```bash
echo "$DATABASE_URL"
psql "$DATABASE_URL" -c "SELECT NOW();"
```

### API reports `Business not found` or `Brand not found`

Confirm your UUIDs:

```sql
SELECT id, name FROM businesses;
SELECT id, name, business_id FROM brands;
```

The brand should belong to the business selected for the production.

### Worker does not claim jobs

Inspect queued jobs:

```sql
SELECT id, production_id, job_type, status, attempts, created_at
FROM jobs
ORDER BY created_at DESC;
```

Confirm that `DATABASE_URL` is set in the terminal that starts the worker.

### NVIDIA API fails

Verify that `NVIDIA_API_KEY` is present locally, that the selected model is available to your NVIDIA account, and that the model name in the worker matches the NVIDIA endpoint's currently supported identifier.

## Next Step

Once API creation and worker script generation work locally, build the dashboard. The dashboard will call these same endpoints so you can create a TikTok production through a form instead of with `curl`.
