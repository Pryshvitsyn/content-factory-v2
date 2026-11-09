# PRODUCT SNAPSHOT
Updated: 2026-11-09

## CURRENT STATE
The operator reports one Tune Into Her Wan 3 pilot (5.04 s, 720×1280), no retry/publication. The connected Dashboard showed draft r19 in FIRST_VIDEO_REVIEW. Human acceptance and the completed three-shot master remain outstanding. The live MP4 has not been visually inspected in this cloud session.

## LATEST DELTA
Branch `fix/pilot-review-lifecycle-20261109`, based on PR #124, fixes the missing workflow transition before provider submission. The old PostgreSQL test manually inserted that transition; it now exercises the actual service and HTTP review flow. Saved media survives a subsequent local failure. A zero-generation recovery action restores review from exact completed evidence, never from an ambiguous attempt. Pilot playback, download and QA appear in both review screens. Approval binds the exact attempt and commits with workflow state; content is hash-verified.

## WORKING
Local SQL/PGlite tests reproduce the original failure, then pass service execution, injected failure, reload, recovery, playback/ranges, corrupt-file and cross-brand denial, atomic approval, duplicates and PASS/FAIL/unknown outcomes. All provider-readiness checks, 26 UI tests, build, recovery/continuity and synthetic FFmpeg three-shot/audio master pass. Real provider calls this repair: 0. Native PostgreSQL 16/17 also passed on implementation commit `14b2a35`. Chromium playback and final-commit checks are recorded in [PR #125](https://github.com/Pryshvitsyn/content-factory-v2/pull/125).

## BROKEN / MISSING
Cloud Chromium is not installed. This repair is not installed on the Mac; its separate uncommitted source must be preserved. Live visual acceptance, remaining generation and final master verification are unfinished.

## BLOCKERS
No connected Mac filesystem/runtime for installation; browser access alone cannot replace that.

## NEXT BEST MOVE
Reconcile the CI-verified repair into the Mac checkout, then review the existing pilot inside the factory before any continuation.

## PARALLEL
Review the shot-one ending against shot-two and shot-three continuity.

## REFERENCES
`TASKS.md`, `AGENTS.md`, `tests/quality-script-first-postgres-test.js`; PR #124 is the transport base. Reported prediction: `fd2pr4zft5rmy0d1qcctgjzang`.
