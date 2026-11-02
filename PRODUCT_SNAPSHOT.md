# PRODUCT SNAPSHOT
Updated: 2026-11-02

## CURRENT STATE
Content Factory has a local Mac Dashboard, PostgreSQL and an immutable Script → Storyboard → LOOK → Pilot workflow. Mac screenshots show an approved opening frame, Seedance STANDARD/720p and pilot-only readiness. The first Tune Into Her video is not yet confirmed complete.

## LATEST DELTA
Implemented provider-outcome classification in both execution journals: explicit creation rejection becomes FAILED/NOT_CROSSED; uncertain outcomes stay fenced. Seedance catalog/adapter bounds agree (480p/720p, 4–30 seconds). Corrected canonical inputs resolve separate production identities while preserving the approved frame. A migration preserves history and excludes only the exact evidenced legacy resolution rejection from the active-attempt fence. First-video preflight checks unresolved attempts before readiness; continuation uses the accepted pilot's actual production.

## WORKING
Mocked provider/stage/media tests, PGlite migration/history/concurrency/scope checks, durable-media and runtime regressions, real FFmpeg master checks, Dashboard tests and build pass. Guarded installation succeeds on the prior preview/voice/LOOK fixture. No real provider generation was used in these checks.

## BROKEN / MISSING
The new recovery package still needs installation and verification on the Mac. Earlier unknown-duration/network attempts may still require reconciliation; they are not automatically released. No reviewed current pilot MP4 is evidenced.

## BLOCKERS
Direct access to the Mac runtime is unavailable. Unknown local code makes the installer stop before writes.

## NEXT BEST MOVE
Install provider recovery with Dashboard stopped, restart through dashboard:local, inspect a fresh first-video preflight, then explicitly start one pilot if ready.

## PARALLEL
GitHub review and Node 22/native PostgreSQL CI. Cloud deployment remains deferred.

## REFERENCES
https://github.com/Pryshvitsyn/content-factory-v2/pull/122
Details: docs/PROVIDER-REJECTION-RECOVERY.md; docs/QUALITY-LOOK-LIFECYCLE.md; TASKS.md.
