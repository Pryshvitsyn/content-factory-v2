# TASKS

## NOW
- [ ] Verify native PostgreSQL 16/17 and Chromium CI for the pilot lifecycle repair.
- [ ] Reconcile the reviewed repair into the actual Mac checkout without losing local changes.
- [ ] Review the existing pilot and its bag-placement warning in the factory; record an explicit exact-pilot decision.

## NEXT
- [ ] After pilot approval, reuse its saved artifact, generate only remaining shots, and verify final MP4, audio and continuity.

## PARALLEL
- [ ] Review stacked PRs #123 and #124 together with this lifecycle repair.

## BLOCKED
- [ ] Install and verify this repair on the live Mac draft and storage.
  Blocked by: no connected Mac filesystem/runtime and incomplete export of Mac-only source.

## DONE
- [x] Replace manual test-state preparation with actual service and HTTP execution against SQL constraints; reproduce the missing FIRST_VIDEO_RUNNING transition before fixing it.
- [x] Commit provider-boundary/workflow advancement together; recover review from completed immutable evidence after a local failure with zero new generation.
- [x] Add saved MP4 playback, download and QA to both review screens; verify original content hash and exact-attempt atomic approval.
- [x] Check corruption, foreign brand, stale attempt, duplicate decision, failed quality, ambiguous execution and historical completed-result recovery.
- [x] Confirm UI state FIRST_VIDEO_REVIEW/r19 after the operator's single-pilot report; no human pilot approval performed in this session.
- [x] Verify both transport workflows on implementation commit de7f2a4: Node 22, PostgreSQL 17 file-receipt/fencing/adoption checks and PostgreSQL 16 approval/recovery checks.
- [x] Implement Replicate large-image uploads preserving original SHA-256, durable file receipts and the exact prediction-body digest.
- [x] Count uploads for all pending shots; keep preflight network-free and cached pilots reusable.
- [x] Verify 21 synthetic transport groups, sibling routes, recovery, UI/build and local FFmpeg regression checks; zero real uploads or generation.
- [x] Verify both GitHub workflows on implementation commit 59aa8ca: Node 22, PostgreSQL 17 media journals and PostgreSQL 16 approval/recovery checks.
- [x] Preserve PR #122 approval/recovery behavior and immutable history.
- [x] Integrate lossless prompt-budget repair with all-asset diagnostics.
- [x] Bind compiled payload to canonical video and auxiliary execution.
- [x] Add early Seedance reference-eligibility and continuity-plan gates.
- [x] Persist accepted IDs before polling in stage/media journals; preserve IDs on recovery errors.
- [x] Disable automatic paid creation retries; retain explicit Start and approval boundaries.
- [x] Verify local contracts, recovery, FFmpeg master, UI tests and build with zero real generation.
- [x] Add repeatable provider-readiness command, CI workflow and permanent agent rules.
