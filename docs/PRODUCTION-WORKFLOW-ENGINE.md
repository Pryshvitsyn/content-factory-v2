# Durable media production workflow engine

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

Artifact lineage is SOURCE → provider derivative → resolved request → raw output → normalized output → QA frames/contact sheet → QA evidence → composed master → export. Every derivative is a new immutable version with parent hashes and producing stage/operation provenance.

Creative Director proposes revisions; deterministic validation and human approval authorize them. Model contracts sit below GENERATE operations, while transport remains provider-owned. Technical QA is shared; Avatar, sphere/loop, recurring-character, and creative QA remain composable domain packs.

Dashboard state must come from durable revisions/runs/stages/attempts, not React memory. The operator sees production-oriented progress, exact request fingerprints and blockers rather than a raw graph editor.

Legacy workflows migrate progressively through compatibility adapters. Wan, Avatar Studio, ImpulseOff, MoneyPrinterTurbo, FFmpeg, and historical artifacts are not rewritten by this layer.
