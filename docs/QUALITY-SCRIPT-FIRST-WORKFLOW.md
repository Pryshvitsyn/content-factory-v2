# QUALITY Script-First Director Workflow

Status: **stacked implementation on `codex/quality-script-first`**, based on PR #89 (`feat/locked-keyframe-production`).

This document describes the implemented QUALITY operator path and its safety boundaries. It does not authorize paid production or deployment.

## Goal

Make Content Factory direct the video before a media model generates it.

Canonical operator flow:

1. BRAND
2. IDEA / creative draft
3. SCRIPT
4. SHOT PLAN / STORYBOARD
5. VISUAL LOCK
6. PILOT SHOT
7. PRODUCE REMAINING SHOTS
8. MASTER REVIEW

Internal mental model:

`DIRECT → LOCK → GENERATE`

FAST remains a separate economical path and is not forced through this full workflow.

## Hard gates

QUALITY media execution is fail-closed behind durable approvals.

- Keyframe preflight/execution requires current `SCRIPT` and `STORYBOARD` approvals.
- First-video preflight/execution additionally requires current `LOOK` approval.
- Remaining production start additionally requires current human `PILOT` approval.
- Semantic PASS for the pilot does **not** count as human pilot acceptance.
- Human approval remains mandatory.
- `autoPublish=false` remains mandatory.

## Script

Script is a first-class immutable revision, not only narration text.

It contains:

- objective
- target audience
- platform
- aspect ratio
- duration
- hook
- core message
- CTA
- timed narrative beats
- voiceover/dialogue/on-screen copy
- creative concept
- visual style
- tone

`GENERATE SCRIPT` currently produces an editable zero-provider-call scaffold from the canonical creative draft. Missing creative detail is not invented silently; the operator must complete it before approval.

Saving creates a durable immutable script revision. Approval is an append-only approval event.

## Shot plan / storyboard

Storyboard creation requires the currently approved script.

Every shot contract includes:

- purpose
- START STATE
- ACTION
- INTENDED END STATE
- subject
- environment
- camera framing
- camera angle/movement/lens intent/composition
- lighting
- MUST KEEP
- MAY CHANGE
- spoken content
- on-screen text
- transition from previous
- transition to next
- negative guidance

Saving creates an immutable storyboard revision tied to the approved script revision.

Storyboard approval binds the approved shot contracts back into the canonical creative brief used by the existing V2.10 production engine.

## Transition policies

Supported explicit policies:

### CONTINUOUS

The next shot continues the same physical moment. The previous accepted final frame may be used as a strong opening reference.

It does **not** mean the camera must remain identical.

### SAME_SCENE

Preserve subject/character, wardrobe, scene, required props, time/lighting as specified.

Do not force the previous final frame as the next opening composition. Camera angle and framing may change when the shot contract allows them.

### MATCH_CUT

Preserve only the specifically matched visual/motion element. Do not inherit the whole previous scene by default.

### CHARACTER_ONLY

Preserve the canonical character/subject identity without inheriting the previous environment, pose or composition.

### NEW_SCENE

Do not inherit the previous final frame or scene by default.

## Generation prompt authority

The existing V2.10 prompt compiler now receives structured shot-contract information including:

- START STATE
- ACTION
- INTENDED END STATE
- transition policy
- MUST KEEP
- MAY CHANGE

The video model is treated as executor, not primary director.

## Visual lock

PR #89 remains the foundation for VISUAL LOCK.

The opening keyframe can be:

- `OPERATOR_UPLOAD`
- `AI_GENERATED`

The exact approved immutable keyframe identity includes artifact/version/hash/storage identity and is bound to the opening shot.

This implementation adds the required SCRIPT/STORYBOARD gate before the keyframe path and records LOOK approval in the durable QUALITY approval chain.

## Pilot shot

PR #89 already bounds first-video execution to one video generation plus one fresh semantic evaluation, with no voice, continuity or renderer work.

This implementation changes the acceptance semantics:

`semantic PASS → FIRST_VIDEO_REVIEW`

not:

`semantic PASS → FIRST_VIDEO_ACCEPTED`

The operator must explicitly choose:

- `APPROVE LOOK & MOTION`
- `REJECT PILOT`

Only explicit human approval moves the workflow to `FIRST_VIDEO_ACCEPTED`.

Remaining production stays unscheduled until then and requires a fresh continuation preflight.

## Durable data

Forward migration:

`migrations/20260903_quality_script_first.sql`

It adds:

- `v2_10.quality_script_revisions`
- `v2_10.quality_storyboard_revisions`
- `v2_10.quality_stage_approval_events`

It also extends locked-keyframe workflow state with explicit pilot review/rejection and allows a new immutable locked workflow for a new canonical creative intent instead of mutating historical evidence.

## Invalidation

The implemented invalidation chain is:

- canonical script-level input change → invalidate SCRIPT, STORYBOARD, LOOK, PILOT and paid preflight
- new script revision → old script approval no longer matches current revision; invalidate downstream STORYBOARD/LOOK/PILOT
- storyboard-level canonical input change → invalidate STORYBOARD/LOOK/PILOT and paid preflight
- new storyboard revision → old storyboard approval no longer matches current revision; invalidate LOOK/PILOT
- approved storyboard binding → invalidate LOOK/PILOT and paid preflight
- new LOOK approval → invalidate prior PILOT approval/preflight
- pilot semantic acceptance → invalidate previous full-production preflight and wait for human review

Approved historical evidence is never overwritten.

## Operator UI

Main Dashboard now includes a `QUALITY DIRECTOR` entry linking to:

`/quality-director.html`

The Script Director page provides:

- brand selection
- creative-draft selection
- visible BRAND → IDEA → SCRIPT → STORYBOARD → LOOK → PILOT progress
- editable script scaffold
- save/approve Script
- editable shot contracts
- explicit transition selectors
- save/approve Storyboard
- Look/Pilot durable status
- human pilot Approve/Reject actions when the engine is in `FIRST_VIDEO_REVIEW`

The existing Creative Production page still owns provider/model selection, immutable keyframe generation/upload and bounded pilot generation.

## API

Read current director state:

`GET /api/v2.10/creative-drafts/:id/quality-director?brandId=...`

Zero-generation-call director actions:

- `script-generate`
- `script-save`
- `script-approve`
- `storyboard-generate`
- `storyboard-save`
- `storyboard-approve`
- `pilot-approve`
- `pilot-reject`

These are under:

`POST /api/v2.10/creative-drafts/:id/quality-director/:action`

Existing PR #89 locked-keyframe endpoints remain the media boundary.

## Safety

This branch does not intentionally:

- make paid provider calls during tests
- enable `LIVE_PAID_GENERATION`
- auto-publish
- merge PR #89
- deploy
- execute production migration against the live DB
- mutate historical Avatar Studio data/code paths

CI explicitly sets:

- `LIVE_PAID_GENERATION=false`
- `PAID_PROVIDER_CALLS=0`
- `EXTERNAL_GENERATION_CALLS=0`

## Test coverage

New contract test:

`tests/quality-script-first-test.js`

Covers:

- script completeness
- shot START/ACTION/END contract
- transition policies
- CONTINUOUS previous-frame semantics
- SAME_SCENE not forcing same composition
- CHARACTER_ONLY and NEW_SCENE isolation
- approval gates
- prompt compilation from structured shot truth
- mandatory human approval / no auto-publish

New PostgreSQL certification:

`tests/quality-script-first-postgres-test.js`

Covers:

- durable script/storyboard approvals
- immutable revisions/events
- downstream invalidation
- new immutable workflow for changed creative intent
- semantic pilot PASS stopping at human review
- continuation blocked before human pilot approval
- pilot human acceptance

Dedicated workflow:

`.github/workflows/quality-script-first-ci.yml`

It also runs PR #89 locked-keyframe regression, V2.10 recovery/continuity suites, universal media/provider regressions, FFmpeg and the Dashboard production build.

## First real QUALITY production procedure

Do this only after the stacked PR and PR #89 have been reviewed and the required CI is green.

1. Start Dashboard with paid generation disabled.
2. Choose the intended canonical brand.
3. Create/resume a QUALITY creative draft.
4. Open `QUALITY DIRECTOR`.
5. Generate/edit/save the Script.
6. Approve the exact Script revision.
7. Generate/edit every shot contract.
8. Check START → ACTION → END for every shot.
9. Check every transition policy; do not use CONTINUOUS unless the shots truly represent one continuous physical moment.
10. Approve the exact Storyboard revision.
11. Return to Creative Production.
12. Create/upload the opening keyframe.
13. Validate and human-approve the exact keyframe.
14. Run a fresh production preflight.
15. Run the bounded first-video preflight.
16. Only when intentionally testing real media, explicitly enable the live paid gate outside this implementation task.
17. Generate exactly the pilot shot.
18. Review actual motion/look.
19. Approve or reject the pilot manually in QUALITY DIRECTOR.
20. If approved, run a fresh remaining-production preflight. Do not reuse the old full-production preflight.
21. Produce remaining shots under existing continuity/quality gates.
22. Assemble voice/audio/edit/master.
23. Final human review. Publication remains manual/disabled.

## Merge policy

This branch should remain stacked on PR #89 until:

- its own CI is green
- PR #89 behavior is green against its base
- review confirms no weakening of provider/cost/recovery boundaries
- no production migration has been executed as part of review

Do not merge merely because GitHub reports the branch as mergeable.
