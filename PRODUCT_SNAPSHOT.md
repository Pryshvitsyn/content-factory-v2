# PRODUCT SNAPSHOT
Updated: 2026-11-02

## CURRENT STATE
Content Factory has a local Mac Dashboard, PostgreSQL and an immutable Script → Storyboard → LOOK → Pilot workflow. Mac screenshots show an approved opening frame, Seedance STANDARD/720p and pilot-only readiness. The first Tune Into Her video is not yet confirmed complete.

## LATEST DELTA
Mac startup failed with 23505 rebuilding a unique index over old unresolved attempts. Revised recovery migration preserves multiple historical unresolved rows, keeps RUNNING uniqueness and adds an advisory-lock database insert fence that blocks new active attempts beside unresolved evidence. Startup no longer replays the superseded September index. Provider outcome classification, Seedance input bounds and revision-safe canonical production identity remain in place. The upgrade fixture now includes three old ambiguous attempts in one workflow; migration reruns and concurrent insert checks pass.

## WORKING
Mocked provider/stage/media tests, PGlite migration/history/concurrency/scope checks, durable-media and runtime regressions, real FFmpeg master checks, Dashboard tests and build pass. Guarded installation succeeds on the prior preview/voice/LOOK fixture. No real provider generation was used in these checks.

## BROKEN / MISSING
Recovery v2 still needs installation and verification on the Mac. Earlier unknown-duration/network attempts may still require reconciliation; they are not automatically released. No reviewed current pilot MP4 is evidenced.

## BLOCKERS
Direct access to the Mac runtime is unavailable. Unknown local code makes the installer stop before writes.

## NEXT BEST MOVE
Install provider recovery with Dashboard stopped, restart through dashboard:local, inspect a fresh first-video preflight, then explicitly start one pilot if ready.

## PARALLEL
GitHub review and Node 22/native PostgreSQL CI. Cloud deployment remains deferred.

## REFERENCES
https://github.com/Pryshvitsyn/content-factory-v2/pull/122
Details: docs/PROVIDER-REJECTION-RECOVERY.md; docs/QUALITY-LOOK-LIFECYCLE.md; TASKS.md.
