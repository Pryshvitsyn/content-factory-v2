-- Content Factory V2.1 multi-business architecture
-- Adds the business/brand/strategy/series hierarchy without changing the frozen V2.0 schema.
-- Existing V2.1 rows remain valid; new ownership columns are nullable for safe migration.

CREATE TABLE IF NOT EXISTS v2_1.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS v2_1.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES v2_1.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  industry text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS v2_1.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES v2_1.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  voice jsonb NOT NULL DEFAULT '{}'::jsonb,
  visual_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  compliance_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS v2_1.audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES v2_1.businesses(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES v2_1.brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS v2_1.offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES v2_1.businesses(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES v2_1.brands(id) ON DELETE CASCADE,
  offering_type text NOT NULL CHECK (offering_type IN ('PRODUCT','SERVICE','OTHER')),
  name text NOT NULL,
  description text,
  claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS v2_1.content_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES v2_1.brands(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  objective jsonb NOT NULL DEFAULT '{}'::jsonb,
  pillars jsonb NOT NULL DEFAULT '[]'::jsonb,
  platform_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  trend_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  learning_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, version)
);

CREATE TABLE IF NOT EXISTS v2_1.content_universes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES v2_1.brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  premise text,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, name)
);

CREATE TABLE IF NOT EXISTS v2_1.series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  universe_id uuid NOT NULL REFERENCES v2_1.content_universes(id) ON DELETE CASCADE,
  name text NOT NULL,
  format_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  narrative_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (universe_id, name)
);

ALTER TABLE v2_1.projects ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES v2_1.tenants(id) ON DELETE CASCADE;
ALTER TABLE v2_1.projects ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES v2_1.businesses(id) ON DELETE CASCADE;
ALTER TABLE v2_1.projects ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES v2_1.brands(id) ON DELETE SET NULL;
ALTER TABLE v2_1.projects ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES v2_1.series(id) ON DELETE SET NULL;

ALTER TABLE v2_1.assets ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES v2_1.businesses(id) ON DELETE CASCADE;
ALTER TABLE v2_1.assets ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES v2_1.brands(id) ON DELETE SET NULL;
ALTER TABLE v2_1.assets ADD COLUMN IF NOT EXISTS continuity_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE v2_1.production_bibles ADD COLUMN IF NOT EXISTS contract_version integer NOT NULL DEFAULT 1;
ALTER TABLE v2_1.production_bibles ADD COLUMN IF NOT EXISTS context_fingerprint text;
ALTER TABLE v2_1.production_bibles ADD COLUMN IF NOT EXISTS resolved_context jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_v21_businesses_tenant ON v2_1.businesses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_v21_brands_business ON v2_1.brands(business_id);
CREATE INDEX IF NOT EXISTS idx_v21_audiences_business ON v2_1.audiences(business_id);
CREATE INDEX IF NOT EXISTS idx_v21_offerings_business ON v2_1.offerings(business_id);
CREATE INDEX IF NOT EXISTS idx_v21_strategies_brand ON v2_1.content_strategies(brand_id, version);
CREATE INDEX IF NOT EXISTS idx_v21_universes_brand ON v2_1.content_universes(brand_id);
CREATE INDEX IF NOT EXISTS idx_v21_series_universe ON v2_1.series(universe_id);
CREATE INDEX IF NOT EXISTS idx_v21_projects_business ON v2_1.projects(business_id);
CREATE INDEX IF NOT EXISTS idx_v21_assets_business ON v2_1.assets(business_id, brand_id);

COMMENT ON SCHEMA v2_1 IS 'V2.1 content OS; shared production machinery with tenant/business/brand-specific creative context.';
COMMENT ON TABLE v2_1.tenants IS 'Isolation boundary for one customer/account using the factory.';
COMMENT ON TABLE v2_1.businesses IS 'A real business served by a tenant; multiple brands may belong to one business.';
COMMENT ON TABLE v2_1.content_universes IS 'Reusable creative worlds that can contain multiple recurring series.';
COMMENT ON TABLE v2_1.series IS 'Repeatable content format/narrative system inside a creative universe.';
