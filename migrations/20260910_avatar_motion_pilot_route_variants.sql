-- Route variants add a geometry-specific human review outcome.  This changes
-- only the validation constraint; historic review rows and immutable triggers
-- remain untouched.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.conname = 'motion_pilot_identity_review_reason'
      AND n.nspname = 'avatar_studio'
      AND r.relname = 'motion_pilot_identity_reviews'
  ) THEN
    ALTER TABLE avatar_studio.motion_pilot_identity_reviews
      DROP CONSTRAINT motion_pilot_identity_review_reason;
  END IF;
  ALTER TABLE avatar_studio.motion_pilot_identity_reviews
    ADD CONSTRAINT motion_pilot_identity_review_reason CHECK (
      (decision = 'PASS' AND reason_code = 'IDENTITY_MATCH') OR
      (decision = 'FAIL' AND reason_code IN (
        'PROVIDER_IDENTITY_SUBSTITUTION_AT_FRAME_0', 'IDENTITY_DRIFT',
        'FACE_MORPH', 'AGE_DRIFT', 'WARDROBE_DRIFT', 'BODY_DRIFT',
        'GEOMETRY_DRIFT', 'OTHER'
      ))
    );
END $$;
