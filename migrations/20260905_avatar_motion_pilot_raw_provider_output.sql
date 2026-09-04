-- Paid provider output is a durable checkpoint, independent of Gate 0 acceptance.
ALTER TABLE avatar_studio.motion_pilot_attempts ADD COLUMN IF NOT EXISTS provider_metrics jsonb;
ALTER TABLE avatar_studio.motion_pilot_attempts ADD COLUMN IF NOT EXISTS output_byte_size bigint;
ALTER TABLE avatar_studio.motion_pilot_attempts ADD COLUMN IF NOT EXISTS raw_artifact_id text;
ALTER TABLE avatar_studio.motion_pilot_attempts ADD COLUMN IF NOT EXISTS raw_artifact_version integer;
ALTER TABLE avatar_studio.motion_pilot_attempts ADD COLUMN IF NOT EXISTS raw_artifact_storage_key text;
ALTER TABLE avatar_studio.motion_pilot_attempts ADD COLUMN IF NOT EXISTS raw_content_hash text;
ALTER TABLE avatar_studio.motion_pilot_attempts ADD COLUMN IF NOT EXISTS raw_output_provenance jsonb;
ALTER TABLE avatar_studio.motion_pilot_attempts ADD COLUMN IF NOT EXISTS provider_completed_at timestamptz;
