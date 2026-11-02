# TASKS

## NOW
- [ ] Install guarded provider recovery v2 on Mac with Dashboard stopped; verify startup after the 23505 migration failure.
- [ ] Inspect fresh first-video preflight for the intended Tune Into Her draft, approved frame/LOOK, STANDARD/720p and valid duration.
- [ ] Reconcile any other genuinely unknown provider attempts surfaced by preflight before retrying.

## NEXT
- [ ] Explicitly start one pilot; inspect actual video and approve/reject motion.
- [ ] Continue remaining shots only after pilot approval; verify final MP4/audio/QA and update snapshot.

## PARALLEL
- [ ] Review GitHub changes and run Node 22/native PostgreSQL CI.

## BLOCKED
- [ ] Live pilot verification.
  Blocked by: installation and operator actions on the Mac runtime.

## DONE
- [x] Reuse existing project core and preserve local-only fixes through guarded patches.
- [x] Bind LOOK to exact frame and current creative approvals; reject stale/foreign requests.
- [x] Preserve downstream state on duplicate approvals; distinguish pilot/full readiness.
- [x] Enforce Seedance resolution/duration parity before HTTP.
- [x] Distinguish proven creation refusal from unknown outcomes in stage and media journals.
- [x] Preserve immutable history and concurrency fences; use revision-safe canonical production identity for corrected input.
- [x] Verify provider recovery, SQL migration, scope, durable media, runtime, FFmpeg and Dashboard behavior without real generation.

- [x] Reproduce multi-attempt legacy upgrade; preserve history, enforce database insert fencing and stop replaying the superseded index.
