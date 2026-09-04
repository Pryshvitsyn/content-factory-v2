ALTER TABLE avatar_studio.motion_pilot_identity_reviews
  ADD CONSTRAINT motion_pilot_identity_review_reason CHECK (
    (decision='PASS' AND reason_code='IDENTITY_MATCH') OR
    (decision='FAIL' AND reason_code IN ('PROVIDER_IDENTITY_SUBSTITUTION_AT_FRAME_0','IDENTITY_DRIFT','FACE_MORPH','AGE_DRIFT','WARDROBE_DRIFT','BODY_DRIFT','OTHER'))
  );
DROP TRIGGER IF EXISTS motion_pilot_identity_reviews_immutable_change ON avatar_studio.motion_pilot_identity_reviews;
CREATE TRIGGER motion_pilot_identity_reviews_immutable_change
  BEFORE UPDATE OR DELETE ON avatar_studio.motion_pilot_identity_reviews
  FOR EACH ROW EXECUTE FUNCTION avatar_studio.reject_immutable_change();
