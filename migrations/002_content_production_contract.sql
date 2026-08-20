BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Stable identity for one piece of content across all revisions.
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

-- Logical production graph nodes. Artifacts are immutable materializations.
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

-- Explicit graph edges make dependency and invalidation deterministic.
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

-- Immutable artifact lineage.
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

-- Objective production rules are the only authority for automatic repair.
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

-- Human review is separate from objective QA and controls creative approval.
CREATE TABLE IF NOT EXISTS human_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  decision text NOT NULL,
  revision_request jsonb NOT NULL DEFAULT '{}'::jsonb,
  comment text,
  reviewer text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(decision IN ('approve', 'request_revision', 'reject'))
);

CREATE INDEX IF NOT EXISTS idx_human_reviews_content
  ON human_reviews(content_unit_id, created_at DESC);

-- The canonical master is an explicit release candidate, not an implicit file.
CREATE TABLE IF NOT EXISTS content_masters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
  human_review_id uuid REFERENCES human_reviews(id) ON DELETE RESTRICT,
  qa_passed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'candidate',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_unit_id, artifact_id),
  CHECK(status IN ('candidate', 'approved', 'superseded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_masters_current_approved
  ON content_masters(content_unit_id)
  WHERE status = 'approved';

-- Objective QA results. Only objective rule violations can authorize repair.
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
  resolved_at timestamptz,
  CHECK(severity IN ('info', 'warning', 'error', 'critical')),
  CHECK(status IN ('open', 'resolved', 'waived'))
);

CREATE INDEX IF NOT EXISTS idx_qa_findings_content_status
  ON qa_findings(content_unit_id, status);
CREATE INDEX IF NOT EXISTS idx_qa_findings_artifact
  ON qa_findings(artifact_id);

-- Generic delivery adapters: no platform is part of the production core.
CREATE TABLE IF NOT EXISTS delivery_adapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter_key text NOT NULL UNIQUE,
  adapter_version text NOT NULL,
  target_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A policy describes requirements/transformation for any destination.
CREATE TABLE IF NOT EXISTS delivery_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter_id uuid NOT NULL REFERENCES delivery_adapters(id) ON DELETE RESTRICT,
  policy_key text NOT NULL UNIQUE,
  version text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  transform jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_policies_adapter
  ON delivery_policies(adapter_id, enabled);

CREATE TABLE IF NOT EXISTS delivery_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  master_artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL REFERENCES delivery_policies(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'planned',
  artifact_id uuid REFERENCES artifacts(id) ON DELETE SET NULL,
  validation_state text NOT NULL DEFAULT 'pending',
  publication_state text NOT NULL DEFAULT 'not_published',
  external_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_unit_id, master_artifact_id, policy_id),
  CHECK(status IN ('planned', 'building', 'ready', 'failed')),
  CHECK(validation_state IN ('pending', 'passed', 'failed')),
  CHECK(publication_state IN ('not_published', 'publishing', 'published', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_packages_content
  ON delivery_packages(content_unit_id);
CREATE INDEX IF NOT EXISTS idx_delivery_packages_publication
  ON delivery_packages(publication_state);

-- Publication attempts are auditable and independently retryable.
CREATE TABLE IF NOT EXISTS publication_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_package_id uuid NOT NULL REFERENCES delivery_packages(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL,
  status text NOT NULL DEFAULT 'running',
  idempotency_key text NOT NULL,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_metadata jsonb,
  error_data jsonb,
  external_reference text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(delivery_package_id, attempt_no),
  UNIQUE(idempotency_key),
  CHECK(status IN ('running', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_publication_attempts_package
  ON publication_attempts(delivery_package_id);

-- Provider/model provenance without secrets.
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
