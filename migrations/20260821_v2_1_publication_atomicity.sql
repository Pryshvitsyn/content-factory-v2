BEGIN;

-- Extend durable publication lifecycle with an explicit UNKNOWN state and an
-- atomic claim primitive. The unique publication_key is the cross-worker fence.
ALTER TABLE v2_1.publications
  DROP CONSTRAINT IF EXISTS publications_status_check;
ALTER TABLE v2_1.publications
  ADD CONSTRAINT publications_status_check
  CHECK (status IN ('PENDING','PUBLISHING','PUBLISHED','FAILED','UNKNOWN'));

CREATE OR REPLACE FUNCTION v2_1.claim_publication(
  p_artifact_version_id uuid,
  p_destination text,
  p_publication_key text
)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r v2_1.publications;
BEGIN
  INSERT INTO v2_1.publications(
    artifact_version_id, destination, publication_key, status, started_at, updated_at
  ) VALUES (
    p_artifact_version_id, p_destination, p_publication_key, 'PUBLISHING', now(), now()
  )
  ON CONFLICT (publication_key) DO NOTHING
  RETURNING * INTO r;

  IF FOUND THEN
    RETURN jsonb_build_object('claimed', true, 'publication', to_jsonb(r));
  END IF;

  SELECT * INTO r
    FROM v2_1.publications
   WHERE publication_key = p_publication_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'publication claim disappeared for key %', p_publication_key;
  END IF;

  IF r.status = 'FAILED' THEN
    UPDATE v2_1.publications
       SET status='PUBLISHING',
           attempt=attempt+1,
           started_at=now(),
           updated_at=now(),
           error='{}'::jsonb
     WHERE publication_key=p_publication_key
    RETURNING * INTO r;
    RETURN jsonb_build_object('claimed', true, 'publication', to_jsonb(r));
  END IF;

  RETURN jsonb_build_object('claimed', false, 'publication', to_jsonb(r));
END $$;

COMMIT;
