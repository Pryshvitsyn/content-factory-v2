# QUALITY LOOK lifecycle

LOOK is an approval of the exact immutable opening frame **in its current creative context**. Its `quality-look/2` fingerprint binds frame ID/version/hash/storage/validation identity and the current SCRIPT and STORYBOARD approval event IDs and fingerprints. Historical unbound LOOK events remain immutable but cannot authorize generation.

The server returns one state to both operator screens: `BLOCKED_UPSTREAM`, `KEYFRAME_REQUIRED`, `REVIEW_REQUIRED` or `APPROVED`, with a reason and expected fingerprint. First approval is possible for a PASS frame; reapproval of an already bound frame records a new LOOK decision without generating or rebinding media. An active exact duplicate preserves pilot approval and prepared preflight. Context is checked again while holding the scoped draft lock before appending a LOOK event; stale/foreign frame requests fail closed. Only a newly changed LOOK invalidates PILOT/preflight. Unsaved editor changes disable approval until saved.

Preflight requires current SCRIPT, STORYBOARD and LOOK. READY before human pilot approval is labelled **READY FOR PILOT ONLY** and full Start stays disabled. First-video preflight/start still enforce their own server gates; remaining production requires PILOT. Repeated saves/approvals of unchanged current script/storyboard do not unnecessarily invalidate downstream work.

## Local recovery

Stop Dashboard, run the guarded installer, restart with `LIVE_PAID_GENERATION=false` for review. Select the intended brand/draft and inspect Script, Storyboard and existing frame. Click **REVIEW & APPROVE CURRENT LOOK** explicitly. After final preflight, run first-video preflight. Paid start remains a separate action. No approval is inferred or granted by installation.

The prior additive `20261101_quality_approval_lifecycle.sql` migration is included as a prerequisite. No new schema migration is introduced for LOOK context. Append-only history and existing media are preserved. A rollback after version-2 approvals requires stopping the application and restoring a compatible writer; never delete history or restore the old lifetime-unique approval index.

## Evidence

- Node contract/service tests: exact identity/context, first approval, reapproval, stale and foreign rejection, explicit confirmation, duplicate preservation, preflight stage distinction.
- PostgreSQL semantics exercised using PGlite: clean/upgrade migration reruns, scoped row locks, latest-event idempotency, stale context rejection, reload and frame reuse. PGlite serializes requests; it is not proof of all native PostgreSQL concurrent schedules.
- Existing PostgreSQL script-first integration fixture updated to use an actual validated/bound frame; locally exercised through a PGlite Pool adapter. Native PostgreSQL CI remains necessary.
- Dashboard tests include persisted APPROVED frame + stale LOOK; review is available, first-video/full Start remain blocked. Build and related runtime/keyframe regressions pass with zero real provider calls.

Local validation used Node 24; CI targets Node 22. The user's Mac runtime has not been inspected directly or changed by these checks.

## Mac package compatibility correction

The first installer stopped before writing on the previously delivered preview/voice combination. Its UI anchors assumed the older approval guard without the mandatory image-load check. The revised installer matches stable subexpressions, preserves the image-load guard and voice/preview additions, and updates optional preview tests to exercise current LOOK semantics. Installation/build and all 27 UI tests passed on a fixture assembled from the exact earlier preview, voice and approval packages. This is package compatibility evidence, not direct verification of the Mac checkout.
