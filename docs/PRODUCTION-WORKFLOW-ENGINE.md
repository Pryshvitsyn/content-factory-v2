# Durable media production workflow engine

## Durable production authority

V2.10 remains the production entry point and V2.1/V2.5 remains the sole durable paid-media state machine. A workflow definition describes intent; it does not authorize execution. Final preflight stores the immutable workflow artifact ID/version/fingerprint and every exact `GENERATE_VIDEO` operation request fingerprint. Explicit human START is recorded in `v2_10.start_attempts`, binding the persisted preflight and canonical-input fingerprints. Immediately before canonical production creation, `ProductionExecutionAuthority` reloads that durable attempt and reconstructs the operation identities. Browser objects and caller-supplied `approved: true` values are never execution authority.

Continuity authority is separately resolved from immutable pack artifacts plus append-only grant events. Provider materialization is transport only: canonical Factory artifacts remain truth, while V2.5 owns provider-boundary state, request-ID persistence, reconciliation, artifact adoption, and QA.

Content Factory remains one engine. The certified V2.1 runtime is the execution compatibility boundary:

| Definition/runtime concept | Existing authority |
|---|---|
| Production | `v2_1.productions` |
| Durable execution instance | V2.1 job/pipeline run |
| Logical operation | V2.1 stage run, carrying a workflow node identity |
| Attempt history | V2.1 stage attempts and V2.5 media execution state |
| External media intent/reconciliation | `v2_5.media_executions` / `DurableMediaExecutor` |
| Immutable output | Artifact / Artifact Version / storage adapter |
| Validation evidence | validation records and V2.9 quality contracts |

The added definition layer answers *what should happen*. An immutable workflow revision contains typed nodes, dependency edges, policy versions, subject bindings, approval gates, output expectations, and a deterministic fingerprint. `compileV21ExecutionPlan()` maps it onto V2.1; it does not execute or create a parallel state machine. Revisions are stored through ArtifactService as immutable, idempotent artifact versions.

Operation contracts declare type/version, input/output roles, executor identity, side-effect and cost classes, retry/idempotency policy, and provenance requirements. Core operations map to existing implementations: V2.5 durable media, V2.1 FFmpeg master composition, V2.9 frame sampling, universal technical QA, domain QA packs, Factory approvals, export, and publication. Domains can register contracts without modifying an executor.

External paid operations persist intent before submission, record the provider ID immediately, and reconcile uncertain state. They do not automatically create a replacement call. Local exact-input operations may safely retry according to their contract. Higher-level approved batches remain above immutable one-call children.

Paid execution never trusts a caller-supplied readiness flag. Immediately before V2.5, the workflow layer re-resolves exact artifact bytes, validates their hashes and scoped grants, recompiles role-aware model input, and reconstructs the preflight. Workflow, operation, provider/model/contract, prompt revision/hash, ordered references, parameters, request fingerprint, and approval must still match. It then emits the V2.5-compatible asset; V2.5 remains the only paid-media state machine.

Reference roles are explicit: `FIRST_FRAME`, `LAST_FRAME`, `REFERENCE_IMAGE`, `REFERENCE_VIDEO`, and `REFERENCE_AUDIO`. First/last roles are never inferred from order. A provider-media resolver converts immutable bytes into a provider-compatible local Buffer/file/upload value. Small data URIs are compatibility-only; large media never requires permanent public hosting. Resolution evidence retains artifact ID/version/SHA/MIME/size, lineage, and provider/model purpose.

Artifact lineage is SOURCE → provider derivative → resolved request → raw output → normalized output → QA frames/contact sheet → QA evidence → composed master → export. Every derivative is a new immutable version with parent hashes and producing stage/operation provenance.

Creative Director proposes revisions; deterministic validation and human approval authorize them. Model contracts sit below GENERATE operations, while transport remains provider-owned. Technical QA is shared; Avatar, sphere/loop, recurring-character, and creative QA remain composable domain packs.

Dashboard state must come from durable revisions/runs/stages/attempts, not React memory. The operator sees production-oriented progress, exact request fingerprints and blockers rather than a raw graph editor.

Unknown pricing is reviewable but not paid-startable. `PRICE_NOT_VERIFIABLE` remains until a separately reviewed estimator exists. Workflow/master geometry takes precedence over provider defaults when supported; model-required adaptive modes take precedence over workflow geometry.

Legacy workflows migrate progressively through compatibility adapters. Wan, Avatar Studio, ImpulseOff, MoneyPrinterTurbo, FFmpeg, and historical artifacts are not rewritten by this layer.
