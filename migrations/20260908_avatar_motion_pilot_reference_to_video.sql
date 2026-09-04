ALTER TABLE avatar_studio.motion_pilot_executions
  DROP CONSTRAINT IF EXISTS motion_pilot_executions_capability_check;
ALTER TABLE avatar_studio.motion_pilot_executions
  ADD CONSTRAINT motion_pilot_executions_capability_check CHECK(capability IN ('IMAGE_TO_VIDEO','REFERENCE_TO_VIDEO'));
