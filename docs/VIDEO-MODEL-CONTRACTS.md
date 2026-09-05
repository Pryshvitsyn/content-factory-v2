# Video model contracts

Content Factory resolves video work as workflow policy → generation plan → reviewed model contract → immutable resolved request → provider adapter → immutable output → base QA → optional workflow QA → human review.

## Boundaries

- Provider code owns credentials, transport, upload, prediction lifecycle, download, and provider errors.
- A model contract owns supported modes and fields, defaults, compatibility, limits, request mapping, schema provenance, pricing status, output expectations, and compatible QA profiles.
- Workflows own creative intent, brand/identity policy, additional QA, budgets, and human decisions.

`src/v2.8/video-model-contracts.js` is the reviewed local registry. Runtime never adopts a remote schema automatically. `compareVideoModelSchema()` is a developer/test drift report; `SCHEMA_DRIFT` requires review and a new local contract version. Catalog responses expose serializable contract metadata so operator controls can use the same enums and modes.

`resolveVideoModelRequest()` requires an explicit input mode, resolves every execution-sensitive default, rejects unknown fields, preserves ordered references, maps provider input, records pricing/schema/contract versions, fixes expected calls at one, and hashes a stable immutable snapshot. Approval must bind to `requestFingerprint`; any prompt, media/version/hash/order, mode, setting, contract, schema, or pricing change produces a different fingerprint and requires fresh preflight/approval.

The Replicate adapter factory discovers registered Replicate model contracts. A future model normally adds one registry contract and tests; it does not add a provider transport. Replicate execution must persist intent before POST, persist prediction ID immediately, reconcile uncertain jobs by ID, and never automatically retry or fall back.

Canonical artifacts remain source truth. Provider-compatible conversions are new immutable derivatives with source/derived hashes and transform provenance. Provider URLs are temporary retrieval locations, never canonical artifacts.

`BASE_VIDEO_QA` is provider-independent technical and request/output QA. `AVATAR_MOTION_QA`, `LOOP_CONTENT_QA`, and `AUDIO_VIDEO_QA` compose domain checks above it. Representative frames and contact sheets are derived QA artifacts and never become identity/reference truth automatically. Generated output always requires human review.

Security rules: never log tokens, authorization headers, signed URLs, base64, or private media; use scoped local/SDK file resolution; validate downloads; preserve brand/workspace scope.
