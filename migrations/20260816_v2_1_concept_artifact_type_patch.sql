-- V2.1 CONCEPT vertical slice: register the database artifact type used by CONCEPT.
-- The artifact vocabulary remains explicit and database-enforced.

ALTER TABLE v2_1.artifacts
  DROP CONSTRAINT IF EXISTS artifacts_artifact_type_check;

ALTER TABLE v2_1.artifacts
  ADD CONSTRAINT artifacts_artifact_type_check CHECK (
    artifact_type IN (
      'IDEA_SET','CONTENT_BRIEF','CONCEPT','SCRIPT','PRODUCTION_BIBLE','REFERENCE_IMAGE','IMAGE','VIDEO',
      'VOICE','AUDIO','MUSIC','CAPTIONS','EDIT','FINAL_VIDEO','THUMBNAIL'
    )
  );

COMMENT ON CONSTRAINT artifacts_artifact_type_check ON v2_1.artifacts IS
  'Canonical V2.1 artifact vocabulary. Creative-stage artifacts are explicitly registered here so workers cannot invent undeclared artifact types.';
