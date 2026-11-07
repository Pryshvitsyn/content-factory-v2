# PRODUCT SNAPSHOT
Updated: 2026-11-07

## CURRENT STATE
The first Tune Into Her ad is not yet a verified finished MP4. The latest supplied live failure is a Seedance input-image privacy refusal. Work is now implemented in branch `fix/production-readiness-20261107`, based on GitHub PR #122 and the available November 7 source exports. It is not installed on the Mac.

## LATEST DELTA
One compiler binds preflight to actual video/image/speech payloads. All-asset diagnostics, prompt budgets, immutable frame checks, accepted-ID persistence in both journals and no automatic creation retries are enforced. The unverified Seedance reference transport is blocked before payment. Global/per-shot reference conflicts are rejected; SOURCE QA uses the current clip. Existing approvals/history are preserved.

## WORKING
Local Node 24 tests cover eight HTTP payload mappings, stale inputs, four-shot failures, privacy/timeout/recovery outcomes, pilot identity, real synthetic FFmpeg video+audio, 22 UI tests and Dashboard build. GitHub PostgreSQL 17 journal, migration and concurrency checks passed. Real generation calls: 0.

## BROKEN / MISSING
Mac integration, live account eligibility, real pilot quality and final ad remain unverified. The supplied storyboard's third shot has a different opening pose from shot two's end; its reference transition requires review.

## BLOCKERS
No connected Mac browser/runtime is available. Only part of its newer source was exported, so this branch cannot safely overwrite that working tree blindly.

## NEXT BEST MOVE
Reconcile the Mac checkout with this reviewed branch; run a fresh dry preflight for the complete draft and exact opening frame, then review a compatible route before one explicit pilot Start.

## PARALLEL
Node 22 / PostgreSQL 17 CI and code review. Cloud deployment remains deferred.

## REFERENCES
`docs/PRODUCTION-READINESS.md`, `docs/PROMPT-BUDGET-RULES.md`, `TASKS.md`; [Implementation PR #123](https://github.com/Pryshvitsyn/content-factory-v2/pull/123); baseline PR #122.
