# Avatar Studio V1.2 — Passport Lab

Passport Lab completes the strict Avatar Studio `L0 IDENTITY -> L1 PASSPORT` boundary inside the existing Content Factory Dashboard. It does not add a generation application or execution path.

## Certification invariant

An avatar remains L0 after source intake, Gate 0, consent, Identity, Identity Lock, plan creation, candidate upload, automated QA and `KEEP`. Only an immutable `passport_certification_event`, explicitly confirmed by a human for the current Identity Version and its current Identity Lock, completes L1.

The invariant is enforced in the Level Engine, service, PostgreSQL certification trigger, the `level_states` database guard, API routes and Dashboard. PostgreSQL has one certification per Identity Version. A new Identity Version requires a new Identity Lock and passport certification. Existing V1 certified evidence remains immutable and readable; V1.2 certification uses the new version-scoped boundary.

## Identity Lock

`identity_lock_versions` stores three explicit classifications:

- `PERMANENT`: approved physical identity features;
- `TEMPORARY`: wardrobe, accessories, props, environment, lighting and other non-identity elements;
- `UNCERTAIN`: features requiring an operator decision.

The records are immutable and versioned against `character_versions`. Service and database validation prevent known temporary elements such as hats, jackets, wardrobe, backgrounds and locations from silently entering permanent identity.

## Generation plans and prompts

`passport_generation_specs` is provider-independent and plan-only. It stores the three canonical views, studio/camera spec, Identity Lock, negative constraints, source versions, prompt/spec versions, requested candidate count, capability requirements, cost plan and repair lineage.

Canonical prompt assets live under `src/avatar-studio/prompts`:

- `AVATAR_PASSPORT_BASE`;
- `AVATAR_PASSPORT_IDENTITY_LOCK`;
- `AVATAR_PASSPORT_NEGATIVE`;
- `AVATAR_PASSPORT_REPAIR`.

The existing Provider Catalog now knows `MULTI_VIEW_IDENTITY_REFERENCE`. Planning may select a registered capable model without probing or invoking it. Unknown prices remain `UNKNOWN`.

`planned_external_call_count` describes a future approved batch. Every plan returned by this slice also records `executionAuthorized=false`, `paidProviderCalls=0` and `externalGenerationCalls=0`. No execution route exists.

## Manual candidates and QA

Manual composites pass through the V1.1 immutable Asset Intake and global Gate 0, receive the explicit `PASSPORT_CANDIDATE` source role and then become immutable `passport_candidates`. The operator never enters an artifact ID.

Local analysis divides the original horizontal composite into non-destructive frontal, 45-degree and profile preview regions. These regions are evidence coordinates; candidate bytes are never modified. QA snapshots extend:

- V2.10.2 reference geometry for decoded dimensions and horizontal panel geometry;
- V2.10 continuity for dimensioned identity checks and special profile scrutiny.

Automated outcomes are `PASS_FOR_REVIEW`, `WARN` or `REJECT`. Local deterministic analysis deliberately reports unmeasured biometric dimensions and never human-certifies a candidate.

## Human review and repair

Candidate decisions are append-only events: `KEEP`, `REJECT`, `COMPARE` or `SUPERSEDE`. Rejections require a structured reason. Certification requires explicit confirmation of frontal, 45-degree, profile and all-three comparison. Human uncertainty must result in rejection.

Generate-more is another immutable plan. `original_generation_spec_id`, `repair_delta` and optional `repair_parent_candidate_id` preserve lineage without rewriting the original plan or candidate.

## Future execution boundary

A later execution slice must require a fresh preflight, current Gate 0 eligibility, valid non-revoked consent, current Identity Lock, provider capability, cost calculation and a separate explicit execution approval. The V1.2 API cannot make a provider call merely because a plan exists.
