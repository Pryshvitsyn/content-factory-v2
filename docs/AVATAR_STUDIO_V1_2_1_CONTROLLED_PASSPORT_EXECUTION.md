# Avatar Studio V1.2.1 — Controlled Passport Execution

V1.2.1 closes the execution gap between an immutable Passport Generation Spec and V1.2 candidate review. It does not alter Avatar Levels, Passport QA, human review, or certification.

## Boundaries

The production sequence is:

`PLAN → FRESH PREFLIGHT → IMMUTABLE APPROVAL → EXPLICIT GENERATE → PROVIDER ATTEMPT → GATE 0 + MEDIA VALIDATION → IMMUTABLE ARTIFACT → PASSPORT CANDIDATE → EXISTING QA → HUMAN REVIEW → HUMAN CERTIFICATION`

Plan, preflight, and approval perform zero provider calls. Approval applies to one execution fingerprint containing workspace, brand, vertical, avatar, Identity Version, Identity Lock Version, Generation Spec, source artifact versions and hashes, provider/model, prompt/spec versions, repair delta, candidate count, call count, cost plan, and maximum budget.

Changing any fingerprinted input requires a new preflight and approval. An approval never starts generation. Only the explicit `GENERATE PASSPORT CANDIDATES` action may cross the provider boundary.

## First adapter path

- Catalog provider: `openai`
- Adapter family / gateway route: `openai-media`
- Model: `gpt-image-1`
- Capability: `MULTI_VIEW_IDENTITY_REFERENCE`
- Strategy: `ONE_EDIT_CALL_PER_THREE_VIEW_COMPOSITE`
- Calls per candidate: `1`
- Automated paid retries: `0`

The generic Passport compiler emits a minimized, provider-neutral reference-image request. The existing OpenAI media adapter maps it to `images.edit`. Source bytes are supplied only from approved, immutable V1.1 intake artifacts. Other brands, avatars, documents, secrets, logs, and environment data are excluded.

The model is asked for one horizontal three-panel composite containing frontal, 45-degree, and 90-degree views. Provider compliance is not assumed: each output is validated and then evaluated by the existing Passport QA. A malformed, non-image, undecodable, dimensionless, REVIEW, or BLOCK output cannot become a candidate.

## Call and cost model

An execution can approve a smoke subset between one candidate and the immutable plan's requested candidate count.

- Smoke execution: 1 candidate × 1 call = 1 maximum external call.
- Full four-candidate execution: 4 candidates × 1 call = 4 maximum external calls.

The current catalog has no verified `gpt-image-1` price record. Price per call, price per candidate, and total are therefore `UNKNOWN`, never zero. The operator must explicitly acknowledge unknown cost and set `MAXIMUM_ALLOWED_COST`. If a fresh known total becomes available and exceeds the approved maximum, execution fails before the provider boundary and needs a new approval.

## Durable evidence

The V1.2.1 migration adds append-only execution proposals, approval evidence, execution events, provider attempts, attempt events, and result lineage. Failed attempts remain durable. Partial success keeps every validated artifact and candidate. Retrying is a new explicitly approved execution; no hidden fallback or retry loop is allowed.

Provider output artifacts use the existing `ArtifactService` and `FilesystemStorageAdapter`. Provenance links the artifact and candidate to provider/model/request, execution and attempt, source assets, Identity Version, Identity Lock Version, Generation Spec, prompt/spec versions, candidate ordinal, strategy, and repair lineage. API responses and logs never include provider credentials.

## Strict level proof

- Generated candidate: L0
- Automatic QA PASS/WARN: L0
- Human KEEP: L0
- Exactly one explicit human certification for the current Identity Version + Identity Lock: L1 PASSPORT

## First live smoke test (not executed by implementation or tests)

Use a synthetic avatar with one approved PNG/JPEG identity source and a current Identity Lock. Create a plan with `openai / gpt-image-1`, run a one-candidate cost preflight, review the exact `UNKNOWN` cost disclosure and maximum budget, approve it, then press Generate once. Expected output is one immutable composite artifact, one auto-registered candidate, and one automatic QA snapshot. Do not proceed to a full batch until artifact ingest and QA are confirmed. Generation and QA do not certify the candidate.

The existing global paid-execution kill switch also remains authoritative: `LIVE_PAID_GENERATION=true` must be set explicitly in the Dashboard runtime. A configured credential, successful preflight, and approval cannot bypass this switch.
