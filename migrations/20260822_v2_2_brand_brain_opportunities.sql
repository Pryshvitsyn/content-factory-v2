-- V2.2 Brand Brain and evidence-backed opportunities
BEGIN;

CREATE TABLE IF NOT EXISTS v2_2.brand_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id) ON DELETE CASCADE,
  knowledge_type text NOT NULL,
  logical_key text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id, knowledge_type, logical_key),
  CHECK (knowledge_type IN (
    'IDENTITY','POSITIONING','MISSION','VALUE_PROPOSITION','VOICE','VISUAL_LANGUAGE',
    'AUDIENCE_INSIGHT','PAIN','DESIRE','OBJECTION','CLAIM_POLICY','PROHIBITED_CLAIM',
    'COMPETITOR','CREATIVE_PATTERN','LEARNING','REFERENCE','OTHER'
  )),
  CHECK (status IN ('ACTIVE','SUPERSEDED','ARCHIVED')),
  CHECK (length(trim(logical_key)) > 0)
);

CREATE TABLE IF NOT EXISTS v2_2.brand_knowledge_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id uuid NOT NULL REFERENCES v2_2.brand_knowledge(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  content jsonb NOT NULL,
  source_type text NOT NULL DEFAULT 'MANUAL',
  source_ref text,
  confidence numeric(5,4),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(knowledge_id, version_no),
  CHECK (version_no > 0),
  CHECK (source_type IN ('MANUAL','IMPORT','AI_DERIVED','ANALYTICS','EXTERNAL_SOURCE','SYSTEM')),
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE TABLE IF NOT EXISTS v2_2.signal_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES v2_2.brands(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  name text NOT NULL,
  canonical_ref text,
  status text NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_type IN ('SEARCH','SOCIAL','COMPETITOR','FORUM','REVIEW','COMMENT','NEWS','ANALYTICS','CUSTOMER','SEASONALITY','MANUAL','OTHER')),
  CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS v2_2.signal_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES v2_2.signal_sources(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES v2_2.brands(id) ON DELETE CASCADE,
  product_id uuid REFERENCES v2_2.products(id) ON DELETE SET NULL,
  market_id uuid REFERENCES v2_2.markets(id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL,
  title text,
  summary text,
  canonical_ref text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_v22_signal_observation_hash
  ON v2_2.signal_observations(source_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS v2_2.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id) ON DELETE CASCADE,
  product_id uuid REFERENCES v2_2.products(id) ON DELETE SET NULL,
  market_id uuid REFERENCES v2_2.markets(id) ON DELETE SET NULL,
  audience_id uuid REFERENCES v2_2.audiences(id) ON DELETE SET NULL,
  title text NOT NULL,
  hypothesis text NOT NULL,
  objective text NOT NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 0.5,
  status text NOT NULL DEFAULT 'PROPOSED',
  decision_reason text,
  decided_by text,
  decided_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (objective IN ('ORGANIC_REACH','ENGAGEMENT','TRAFFIC','LEAD_GENERATION','APP_INSTALL','PURCHASE','BOOKING','SEO_AUTHORITY','RETENTION','EXPERIMENT')),
  CHECK (confidence >= 0 AND confidence <= 1),
  CHECK (status IN ('PROPOSED','APPROVED','REJECTED','EXPIRED','CONVERTED','ARCHIVED')),
  CHECK (length(trim(title)) > 0),
  CHECK (length(trim(hypothesis)) > 0)
);

CREATE TABLE IF NOT EXISTS v2_2.opportunity_evidence (
  opportunity_id uuid NOT NULL REFERENCES v2_2.opportunities(id) ON DELETE CASCADE,
  observation_id uuid NOT NULL REFERENCES v2_2.signal_observations(id) ON DELETE CASCADE,
  relevance numeric(5,4),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(opportunity_id, observation_id),
  CHECK (relevance IS NULL OR (relevance >= 0 AND relevance <= 1))
);

ALTER TABLE v2_2.campaigns ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES v2_2.opportunities(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS v2_2.approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES v2_2.brands(id) ON DELETE CASCADE,
  operation text NOT NULL,
  mode text NOT NULL,
  cost_threshold_minor bigint,
  currency_code text,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(brand_id, operation),
  CHECK (mode IN ('AUTO','REVIEW','MANDATORY_APPROVAL')),
  CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
  CHECK (cost_threshold_minor IS NULL OR cost_threshold_minor >= 0),
  CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  CHECK (length(trim(operation)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_v22_brand_knowledge_brand ON v2_2.brand_knowledge(brand_id, knowledge_type, status);
CREATE INDEX IF NOT EXISTS idx_v22_brand_knowledge_versions ON v2_2.brand_knowledge_versions(knowledge_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_v22_signal_sources_brand ON v2_2.signal_sources(brand_id, source_type, status);
CREATE INDEX IF NOT EXISTS idx_v22_signal_observations_brand ON v2_2.signal_observations(brand_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_v22_opportunities_brand ON v2_2.opportunities(brand_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v22_opportunities_product ON v2_2.opportunities(product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v22_campaign_opportunity ON v2_2.campaigns(opportunity_id) WHERE opportunity_id IS NOT NULL;

COMMIT;
