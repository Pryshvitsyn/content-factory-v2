# PRODUCT SNAPSHOT
Updated: 2026-11-02

## CURRENT STATE
Content Factory V2 has a local Mac Dashboard, PostgreSQL, immutable media and a Script → Storyboard → LOOK → Pilot workflow. User restarted `n8n-postgres-1` and opened Dashboard. Mac checkout reports `4be55b5` with local preview, voice and approval-lifecycle fixes. Screenshot shows a PASS/APPROVED opening frame but missing current LOOK, blocking the first Tune Into Her video.

## LATEST DELTA
Implemented context-bound LOOK approval on `fix/quality-look-lifecycle`, including the existing approval-cycle fix. Server verifies exact frame/creative approval identities; UI offers explicit review of an existing frame. Unchanged repeated approvals preserve Pilot/preflight. Preflight distinguishes pilot readiness from full-production authorization. No generation or approval is performed by installation.

## WORKING
Local contract/service regressions, runtime/keyframe checks, 21 Dashboard tests and build pass. SQL migrations, LOOK reload, stale-context rejection and duplicate preservation pass under PGlite, including the updated full script-first integration fixture through a Pool adapter. Real external generation calls: 0. Validation uses Node 24; Node 22/native PostgreSQL CI remains separate.

## BROKEN / MISSING
The first Mac installer stopped before writes on preview/voice UI differences. Corrected package preserves image-load checks; full prior-package fixture passes installation/build and 27 UI tests. Mac installation is still pending. No completed or reviewed current pilot MP4 is evidenced. Local changes beyond the recovered approval package are preserved by guarded text patches rather than whole-file replacement.

## BLOCKERS
Installation and live verification require the Mac operator. Guarded installer stops if expected local code differs.

## NEXT BEST MOVE
Install with Dashboard stopped, restart, review the intended draft and existing frame, explicitly approve current LOOK, then run final and first-video preflights before one controlled pilot start.

## PARALLEL
GitHub review and CI; no cloud deployment is requested.

## REFERENCES
Repository: https://github.com/Pryshvitsyn/content-factory-v2
Details: docs/QUALITY-LOOK-LIFECYCLE.md; GOAL.md; TASKS.md.
