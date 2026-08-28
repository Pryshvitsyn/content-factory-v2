BEGIN;

ALTER TABLE v2_9.semantic_evaluation_attempts
  ADD COLUMN IF NOT EXISTS possible_post_pass_speech_calls integer NOT NULL DEFAULT 0
    CHECK (possible_post_pass_speech_calls >= 0),
  ADD COLUMN IF NOT EXISTS reused_video_assets integer NOT NULL DEFAULT 0
    CHECK (reused_video_assets >= 0),
  ADD COLUMN IF NOT EXISTS reused_speech_assets integer NOT NULL DEFAULT 0
    CHECK (reused_speech_assets >= 0),
  ADD COLUMN IF NOT EXISTS new_speech_generations integer NOT NULL DEFAULT 0
    CHECK (new_speech_generations >= 0),
  ADD COLUMN IF NOT EXISTS new_video_generations integer NOT NULL DEFAULT 0
    CHECK (new_video_generations = 0);

COMMIT;

-- Forward-only recovery: these columns append call accounting to immutable semantic
-- attempt evidence. Disable the V2.9.2.1 recovery route to roll back behavior.
