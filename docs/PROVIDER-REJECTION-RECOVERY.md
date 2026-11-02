# Provider rejection and recovery

Replicate Seedance 2.5 uses 480p/720p and deterministic integer durations of 4–30 seconds. Its catalog and adapter enforce the same bounds before provider execution. A 1080×1920 master is a separate render target, not permission to request unsupported provider resolution.

## Execution outcomes

- Local input validation and an explicit HTTP 400/422 from the prediction creation POST without an accepted prediction ID are recorded as FAILED / NOT_CROSSED. Media journal entries become terminal failures too.
- Once a prediction ID exists, errors retain that ID. A provider terminal failure is a completed failed attempt, not proof that creation never happened.
- Network errors, server failures and unproven outcomes remain fenced as NEEDS_RECONCILIATION. GET/poll errors never become creation rejections. No automatic paid retries were added.

## Existing immutable attempts

The migration preserves every historical row, including multiple unresolved attempts for one workflow/stage. A unique index covers RUNNING attempts; a database insert trigger serializes claims with the repository's advisory-lock key and refuses a new active attempt beside any unresolved evidence. Only the exact legacy Seedance resolution HTTP 422 with no prediction or result is excluded from the fence. The previous narrowly scoped local keyframe-tier exception remains supported. Startup uses this migration instead of replaying the superseded September index definition.

A corrected canonical request resolves a production through the existing revision-safe production key. Its media execution does not reuse a failed journal row from an older input. The approved immutable frame retains its original production. Continuation uses the actual accepted pilot production, with workspace/brand scope checks and persisted acceptance evidence.

First-video preflight checks unresolved attempts before reporting readiness. The operator must inspect a fresh preflight and explicitly start. No migration or installer grants approval or starts media generation.

## Proof and limits

Mocked HTTP tests cover creation versus polling, accepted prediction IDs, timeouts, no automatic retries, local input guards and both journals. PostgreSQL-compatible PGlite tests execute the migration twice, check immutable history, concurrent-attempt uniqueness, scoped continuation and canonical production reuse. Existing durable media, runtime integration and real FFmpeg master tests pass. Dashboard checks remain part of installation.

The first migration package failed on the Mac with 23505 while rebuilding an index over historical unresolved rows. The revised upgrade fixture contains three such rows for the same workflow/stage, verifies every row remains unchanged, blocks new execution and reruns the migration after a corrected RUNNING attempt exists. Concurrent inserts must allow exactly one claim. Native PostgreSQL runs the same test in a dedicated CI database.

These checks do not certify a live Mac database or a successful provider render. Native PostgreSQL and Node 22 CI run separately. The guarded installer stops before writing if local code differs; backups and rollback protect file changes. Startup applies the migration using the normal local preparation path.
