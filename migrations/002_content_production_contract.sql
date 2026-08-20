BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------
-- Stable identity: one content idea across its entire lifetime.
-- A content unit may have many explicit creative revisions.
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
  UNIQUE(workspace_id, content_key),
  CHECK(status IN ('draft', 'planned', 'in_progress', 'mastered', 'qa_failed', 'repairing', 'qa_passed', 'awaiting_human_approval', 'approved', 'delivery', 'published', 'failed')),
  CHECK(approval_state IN ('pending', 'approved', 'revision_requested', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_content_units_workspace_status
  ON content_units(workspace_id, status);

-- ------------------------------------------------------------------
-- Explicit creative/production revision. This prevents a human
-- revision from silently mixing nodes and artifacts from old work.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  revision_no integer NOT NULL,
  revision_type text NOT NULL DEFAULT 'initial',
  parent_revision_id uuid REFERENCES content_revisions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft',
  requested_by text,
  revision_request jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(content_unit_id, revision_no),
  CHECK(revision_no > 0),
  CHECK(revision_type IN ('initial', 'human_revision', 'objective_repair')),
  CHECK(status IN ('draft', 'planned', 'in_progress', 'mastered', 'qa_failed', 'repairing', 'qa_passed', 'awaiting_human_approval', 'approved', 'superseded', 'failed')),
  CHECK(parent_revision_id IS NULL OR parent_revision_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_content_revisions_content
  ON content_revisions(content_unit_id, revision_no DESC);

ALTER TABLE content_units
  ADD COLUMN IF NOT EXISTS current_revision_id uuid REFERENCES content_revisions(id) ON DELETE SET NULL;

-- ------------------------------------------------------------------
-- Logical production graph. Nodes belong to one revision; artifacts
-- are immutable materializations of those nodes.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_revision_id uuid NOT NULL REFERENCES content_revisions(id) ON DELETE CASCADE,
  node_key text NOT NULL,
  node_type text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  required boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_revision_id, node_key),
  CHECK(status IN ('planned', 'in_progress', 'complete', 'invalid', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_production_nodes_revision
  ON production_nodes(content_revision_id);

-- ------------------------------------------------------------------
-- Explicit graph edges make dependency closure and targeted repair
-- deterministic.
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
-- Artifact lineage. Physical artifacts remain in the existing V2
-- artifact registry; this table makes derivation explicit.
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
-- Objective rules are the only authority for automatic repair.
-- Subjective scores/preferences do not belong here as repair triggers.
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
  UNIQUE(content_unit_id, rule_key),
  CHECK(severity IN ('info', 'warning', 'error', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_production_rules_content
  ON production_rules(content_unit_id, enabled);

-- ------------------------------------------------------------------
-- Human review is separate from objective QA and belongs to a concrete
-- revision/artifact candidate.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS human_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  content_revision_id uuid NOT NULL REFERENCES content_revisions(id) ON DELETE RESTRICT,
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
CREATE INDEX IF NOT EXISTS idx_human_reviews_revision
  ON human_reviews(content_revision_id, created_at DESC);

-- ------------------------------------------------------------------
-- Canonical master is explicit and versioned through the artifact it
-- references. Only one approved master may exist for a content unit.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_masters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  content_revision_id uuid NOT NULL REFERENCES content_revisions(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT,
  human_review_id uuid REFERENCES human_reviews(id) ON DELETE RESTRICT,
  qa_passed_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'candidate',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_unit_id, artifact_id),
  UNIQUE(content_revision_id, artifact_id),
  CHECK(status IN ('candidate', 'approved', 'superseded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_masters_current_approved
  ON content_masters(content_unit_id)
  WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS idx_content_masters_revision
  ON content_masters(content_revision_id);

-- ------------------------------------------------------------------
-- Objective QA results. A failed objective rule may authorize repair;
-- a subjective opinion cannot.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qa_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  content_revision_id uuid REFERENCES content_revisions(id) ON DELETE SET NULL,
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
CREATE INDEX IF NOT EXISTS idx_qa_findings_revision
  ON qa_findings(content_revision_id, status);
CREATE INDEX IF NOT EXISTS idx_qa_findings_artifact
  ON qa_findings(artifact_id);

-- ------------------------------------------------------------------
-- Generic destination adapter. No finite platform list is part of the
-- production core.
-- ------------------------------------------------------------------
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

-- A versioned policy describes destination requirements and transforms.
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

-- ------------------------------------------------------------------
-- A package is a deterministic derivative of a canonical master.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_unit_id uuid NOT NULL REFERENCES content_units(id) ON DELETE CASCADE,
  content_master_id uuid NOT NULL REFERENCES content_masters(id) ON DELETE RESTRICT,
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
  UNIQUE(content_master_id, policy_id),
  CHECK(status IN ('planned', 'building', 'ready', 'failed')),
  CHECK(validation_state IN ('pending', 'passed', 'failed')),
  CHECK(publication_state IN ('not_published', 'publishing', 'published', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_packages_content
  ON delivery_packages(content_unit_id);
CREATE INDEX IF NOT EXISTS idx_delivery_packages_master
  ON delivery_packages(content_master_id);
CREATE INDEX IF NOT EXISTS idx_delivery_packages_publication
  ON delivery_packages(publication_state);

-- ------------------------------------------------------------------
-- Publication attempts are independently auditable and retryable.
-- ------------------------------------------------------------------
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
  CHECK(attempt_no > 0),
  CHECK(status IN ('running', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_publication_attempts_package
  ON publication_attempts(delivery_package_id);

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
