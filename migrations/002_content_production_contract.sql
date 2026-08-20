BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------
-- Stable identity for one piece of content across all revisions,
-- production runs, masters and platform deliveries.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content_key text NOT NULL,
  title text,
  idea text NOT NULL,
  audience text,
  goal text,
  status text NOT NULL DEFAULT 'draft',
  approval_state text NOT NULL DEFAULT 'pending',
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, content_key)
);

CREATE INDEX IF NOT EXISTS idx_content_units_workspace_status
  ON content_units(workspace_id, status);

-- ------------------------------------------------------------------
-- Explicit production nodes. A node is a logical production object;
-- artifacts are immutable materializations produced by nodes.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  node_key text NOT NULL,
  node_type text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  required boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_unit_id, node_key)
);

CREATE INDEX IF NOT EXISTS idx_production_nodes_content
  ON production_nodes(content_unit_id);

-- ------------------------------------------------------------------
-- Explicit graph edges make dependency and invalidation deterministic.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upstream_node_id uuid NOT NULL REFERENCES production_nodes(id) ON DELETE CASCADE,
  downstream_node_id uuid NOT NULL REFERENCES production_nodes(id) ON DELETE CASCADE,
  edge_type text NOT NULL DEFAULT 'depends_on',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(upstream_node_id, downstream_node_id, edge_type),
  CHECK(upstream_node_id <> downstream_node_id)
);

CREATE INDEX IF NOT EXISTS idx_production_edges_downstream
  ON production_edges(downstream_node_id);

CREATE INDEX IF NOT EXISTS idx_production_edges_upstream
  ON production_edges(upstream_node_id);

-- ------------------------------------------------------------------
-- Immutable artifact lineage. Existing artifacts remain the physical
-- registry; this table makes dependency relationships explicit.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifact_lineage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  parent_artifact_id uuid REFERENCES artifacts(id) ON DELETE RESTRICT,
  relationship text NOT NULL DEFAULT 'derived_from',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(artifact_id, parent_artifact_id, relationship),
  CHECK(artifact_id <> parent_artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_artifact_lineage_artifact
  ON artifact_lineage(artifact_id);

CREATE INDEX IF NOT EXISTS idx_artifact_lineage_parent
  ON artifact_lineage(parent_artifact_id);

-- ------------------------------------------------------------------
-- Objective production rules. These are the authority for automatic
-- QA/repair. Subjective creative preferences do not belong here.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid REFERENCES content_units(id) ON DELETE CASCADE,
  rule_key text NOT NULL,
  rule_type text NOT NULL,
  severity text NOT NULL DEFAULT 'error',
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_unit_id, rule_key)
);

CREATE INDEX IF NOT EXISTS idx_production_rules_content
  ON production_rules(content_unit_id, enabled);

-- ------------------------------------------------------------------
-- Human review is deliberately separate from objective QA.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS human_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  decision text NOT NULL,
  revision_request jsonb NOT NULL DEFAULT '{}'::jsonb,
  comment text,
  reviewer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_human_reviews_content
  ON human_reviews(content_unit_id, created_at DESC);

-- ------------------------------------------------------------------
-- Objective QA results. A failure may authorize targeted repair;
-- subjective scoring never does so by itself.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qa_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  rule_id uuid REFERENCES production_rules(id) ON DELETE SET NULL,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  code text NOT NULL,
  message text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  repair_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_qa_findings_content_status
  ON qa_findings(content_unit_id, status);

CREATE INDEX IF NOT EXISTS idx_qa_findings_artifact
  ON qa_findings(artifact_id);

-- ------------------------------------------------------------------
-- Platform delivery policies. Deliveries are deterministic derivatives
-- of an approved canonical master.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  policy_key text NOT NULL UNIQUE,
  version text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  transform jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  master_artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL REFERENCES delivery_policies(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'planned',
  artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  validation_state text NOT NULL DEFAULT 'pending',
  publication_state text NOT NULL DEFAULT 'not_published',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_unit_id, master_artifact_id, policy_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_packages_content
  ON delivery_packages(content_unit_id);

CREATE INDEX IF NOT EXISTS idx_delivery_packages_publication
  ON delivery_packages(publication_state);

-- ------------------------------------------------------------------
-- Provider/model provenance without secrets.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifact_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
  model_id uuid REFERENCES ai_models(id) ON DELETE SET NULL,
  renderer_version text,
  prompt_template_key text,
  prompt_hash text,
  configuration_hash text,
  input_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(artifact_id)
);

COMMIT;
