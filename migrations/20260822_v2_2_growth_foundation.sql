-- V2.2 growth ownership foundation
-- Extends V2.1 production without changing certified execution semantics.
BEGIN;

CREATE SCHEMA IF NOT EXISTS v2_2;

CREATE TABLE IF NOT EXISTS v2_2.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  mission text,
  positioning text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, slug),
  CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  CHECK (length(trim(name)) > 0),
  CHECK (length(trim(slug)) > 0)
);

CREATE TABLE IF NOT EXISTS v2_2.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  product_type text NOT NULL DEFAULT 'OTHER',
  status text NOT NULL DEFAULT 'ACTIVE',
  value_proposition text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id, slug),
  CHECK (product_type IN ('APP','WEBSITE','SERVICE','PHYSICAL_PRODUCT','DIGITAL_PRODUCT','MARKETPLACE','MEDIA','OTHER')),
  CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  CHECK (length(trim(name)) > 0),
  CHECK (length(trim(slug)) > 0)
);

CREATE TABLE IF NOT EXISTS v2_2.markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES v2_2.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  country_code text,
  language_code text,
  currency_code text,
  timezone text,
  status text NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS v2_2.audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES v2_2.products(id) ON DELETE CASCADE,
  market_id uuid REFERENCES v2_2.markets(id) ON DELETE SET NULL,
  name text NOT NULL,
  awareness_stage text,
  problem_statement text,
  desired_outcome text,
  pains jsonb NOT NULL DEFAULT '[]'::jsonb,
  desires jsonb NOT NULL DEFAULT '[]'::jsonb,
  objections jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (awareness_stage IS NULL OR awareness_stage IN ('UNAWARE','PROBLEM_AWARE','SOLUTION_AWARE','PRODUCT_AWARE','MOST_AWARE')),
  CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS v2_2.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES v2_2.products(id) ON DELETE CASCADE,
  audience_id uuid REFERENCES v2_2.audiences(id) ON DELETE SET NULL,
  name text NOT NULL,
  promise text,
  cta text,
  destination text,
  status text NOT NULL DEFAULT 'DRAFT',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
  CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS v2_2.funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES v2_2.products(id) ON DELETE CASCADE,
  audience_id uuid REFERENCES v2_2.audiences(id) ON DELETE SET NULL,
  offer_id uuid REFERENCES v2_2.offers(id) ON DELETE SET NULL,
  name text NOT NULL,
  objective text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (objective IN ('ORGANIC_REACH','ENGAGEMENT','TRAFFIC','LEAD_GENERATION','APP_INSTALL','PURCHASE','BOOKING','SEO_AUTHORITY','RETENTION','EXPERIMENT')),
  CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
  CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS v2_2.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id) ON DELETE CASCADE,
  product_id uuid REFERENCES v2_2.products(id) ON DELETE SET NULL,
  market_id uuid REFERENCES v2_2.markets(id) ON DELETE SET NULL,
  audience_id uuid REFERENCES v2_2.audiences(id) ON DELETE SET NULL,
  offer_id uuid REFERENCES v2_2.offers(id) ON DELETE SET NULL,
  funnel_id uuid REFERENCES v2_2.funnels(id) ON DELETE SET NULL,
  name text NOT NULL,
  objective text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  starts_at timestamptz,
  ends_at timestamptz,
  budget_minor bigint,
  currency_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (objective IN ('ORGANIC_REACH','ENGAGEMENT','TRAFFIC','LEAD_GENERATION','APP_INSTALL','PURCHASE','BOOKING','SEO_AUTHORITY','RETENTION','EXPERIMENT')),
  CHECK (status IN ('DRAFT','ACTIVE','PAUSED','COMPLETED','ARCHIVED')),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CHECK (budget_minor IS NULL OR budget_minor >= 0),
  CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS v2_2.content_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id) ON DELETE CASCADE,
  product_id uuid REFERENCES v2_2.products(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES v2_2.campaigns(id) ON DELETE SET NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  format_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  continuity_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('ACTIVE','PAUSED','COMPLETED','ARCHIVED')),
  CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS v2_2.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id) ON DELETE CASCADE,
  product_id uuid REFERENCES v2_2.products(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES v2_2.campaigns(id) ON DELETE SET NULL,
  series_id uuid REFERENCES v2_2.content_series(id) ON DELETE SET NULL,
  audience_id uuid REFERENCES v2_2.audiences(id) ON DELETE SET NULL,
  offer_id uuid REFERENCES v2_2.offers(id) ON DELETE SET NULL,
  content_role text NOT NULL DEFAULT 'DISCOVERY',
  title text,
  hypothesis text,
  status text NOT NULL DEFAULT 'PLANNED',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (content_role IN ('DISCOVERY','VALUE','AUTHORITY','ENGAGEMENT','CONVERSION','RETARGETING','EXPERIMENTAL')),
  CHECK (status IN ('PLANNED','APPROVED','IN_PRODUCTION','READY','PUBLISHED','ARCHIVED','CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_v22_brands_workspace ON v2_2.brands(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_v22_products_brand ON v2_2.products(brand_id, status);
CREATE INDEX IF NOT EXISTS idx_v22_markets_product ON v2_2.markets(product_id, status);
CREATE INDEX IF NOT EXISTS idx_v22_audiences_product ON v2_2.audiences(product_id, market_id, status);
CREATE INDEX IF NOT EXISTS idx_v22_offers_product ON v2_2.offers(product_id, audience_id, status);
CREATE INDEX IF NOT EXISTS idx_v22_campaigns_brand ON v2_2.campaigns(brand_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_v22_campaigns_product ON v2_2.campaigns(product_id, status);
CREATE INDEX IF NOT EXISTS idx_v22_content_series_brand ON v2_2.content_series(brand_id, campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_v22_content_items_campaign ON v2_2.content_items(campaign_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_v22_content_items_series ON v2_2.content_items(series_id, status, created_at);

-- Migration-compatible growth context on existing productions.
-- Nullable columns preserve all certified V2.1 production rows.
ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES v2_2.brands(id) ON DELETE SET NULL;
ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES v2_2.products(id) ON DELETE SET NULL;
ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES v2_2.campaigns(id) ON DELETE SET NULL;
ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS content_item_id uuid REFERENCES v2_2.content_items(id) ON DELETE SET NULL;
ALTER TABLE v2_1.productions ADD COLUMN IF NOT EXISTS objective text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'productions_v22_objective_check'
      AND conrelid = 'v2_1.productions'::regclass
  ) THEN
    ALTER TABLE v2_1.productions
      ADD CONSTRAINT productions_v22_objective_check
      CHECK (objective IS NULL OR objective IN ('ORGANIC_REACH','ENGAGEMENT','TRAFFIC','LEAD_GENERATION','APP_INSTALL','PURCHASE','BOOKING','SEO_AUTHORITY','RETENTION','EXPERIMENT'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_v21_productions_brand ON v2_1.productions(brand_id, created_at);
CREATE INDEX IF NOT EXISTS idx_v21_productions_campaign ON v2_1.productions(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_v21_productions_content_item ON v2_1.productions(content_item_id);

COMMIT;
