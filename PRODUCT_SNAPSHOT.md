# PRODUCT SNAPSHOT
Updated: 2026-11-08

## CURRENT STATE
The first Tune Into Her ad remains unfinished. PR #123 contains provider-readiness repairs; branch `fix/replicate-file-transport-20261108` adds the missing large-image transport on top. Neither is verified as installed on the Mac.

## LATEST DELTA
Replicate Wan 3 keeps approved image bytes and SHA-256 through preflight, then uploads large references only on explicit Start. Receipt identity/expiry, durable evidence and the exact wire-body digest must pass before prediction submission. All pending shots include upload estimates; cached pilots require none. File IDs, prediction IDs and signed URLs have separate handling. Seedance's unverified portrait route remains blocked; no automatic retry or model switch was added.

## WORKING
Local Node 24: 20 transport groups, existing eight-route contracts, prompt budgets, recovery, V2.5 synthetic FFmpeg video/audio, V2.9.2, V2.10, 22 UI tests and Dashboard build pass. Real uploads and generation calls: 0. Prior PR #123 CI passed on Node 22/PostgreSQL 16–17. New transport PostgreSQL checks are submitted to CI separately.

## BROKEN / MISSING
The user's report identifies the approved 2.98 MiB PNG and its OpenAI provenance; this session has not independently accessed that file. Current API-key permissions, exact-image moderation, live pilot quality and final MP4 remain unverified.

## BLOCKERS
No connected Mac runtime; incomplete export of its newer source prevents a safe blind overwrite.

## NEXT BEST MOVE
Finish transport CI/review, reconcile the Mac checkout preserving local changes, then run fresh all-asset and exact-frame preflights before one explicit pilot Start.

## PARALLEL
Review the shot-two/shot-three opening-pose transition and PR #123.

## REFERENCES
`TASKS.md`, `docs/PRODUCTION-READINESS.md`, `docs/PROMPT-BUDGET-RULES.md`; [base PR #123](https://github.com/Pryshvitsyn/content-factory-v2/pull/123).
