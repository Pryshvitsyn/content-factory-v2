# Model contracts

`ReferenceInputPlan` supplies the same ordered provider-neutral reference structure to authoritative preflight and provider execution. The selected Model Contract remains the sole source of model-specific input-mode compatibility, cardinality, duration, and schema mapping; provider adapters remain transport-only.

Model contracts are plugins beneath typed GENERATE operations. They declare reviewed provider/model identity, contract and provider-schema versions, capabilities, explicit input modes, fields/defaults/ranges, compatibility and media limits, request mapping, output expectations, pricing status, adapter family, and compatible QA profiles.

Provider adapters own authentication, transport, provider job lifecycle, recovery, output retrieval, and provider errors. Workflows own purpose, continuity, approval, budgets, and domain QA. A contract owns neither.

`src/v2.8/video-model-contracts.js` is the local reviewed registry. `resolveVideoModelRequest()` explicitly resolves Factory defaults, rejects unknown fields, preserves provider reference order, emits one exact provider payload, and fingerprints the immutable snapshot. Approval binds to that fingerprint. `compareVideoModelSchema()` reports `SCHEMA_DRIFT`; it never changes runtime behavior.

Future Replicate video models register a contract and use the existing generic Replicate adapter discovery path. No new authentication or prediction transport is required.
