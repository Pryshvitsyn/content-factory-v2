# Content Factory V2 — Architecture

## 1. Purpose

Content Factory V2 is a controlled production system for AI-assisted content generation. The architecture separates execution, providers, production artifacts, validation, and storage so that each concern can evolve independently.

## 2. Core Production Model

```text
Production
   ↓
Pipeline Run
   ↓
Stage
   ↓
Attempt
   ↓
Provider
   ↓
Artifact
   ↓
Artifact Version
   ↓
Validation
   ↓
Storage
```

### Production
The business-level production job. It defines what must be produced.

### Pipeline Run
A persistent execution instance of a production job.

### Stage
A deterministic step in the production pipeline. Stages have explicit ordering and lifecycle state.

### Attempt
A concrete execution attempt for a stage. Attempts provide ownership, retry history, recovery and failure tracking.

### Artifact
A production output such as a script, production bible, shot plan, image, audio file or video.

### Artifact Version
An immutable revision of an artifact. Regeneration creates a new version rather than overwriting an existing production result.

### Validation
A separate record describing whether an artifact satisfies technical, structural or business requirements.

### Storage
The persistence boundary for artifact content. Business logic uses a storage adapter rather than depending on a physical storage implementation.

## 3. Provider Boundary

```text
Execution
   ↓
Provider Gateway
   ↓
Provider Adapter
   ↓
NVIDIA
   ↓
Normalized Provider Result
```

The execution layer must not depend on vendor-specific response formats. Provider adapters translate vendor requests/responses into the internal provider contract.

NVIDIA is the first provider. Additional providers are future implementations of the same contract.

## 4. Artifact Boundary

The artifact service owns production-output semantics:

```text
Provider Result
      ↓
Artifact Service
      ↓
Artifact identity
      ↓
Immutable version
      ↓
Provenance
      ↓
Validation
      ↓
Storage Adapter
```

Provider code does not own storage. Storage code does not know which AI provider produced the content.

## 5. Provenance

Every generated artifact should be traceable to its production context. The provenance model is intended to preserve:

- production/pipeline run
- stage
- attempt
- provider
- model
- request context where safe to retain
- parent artifact/version where applicable
- validation outcome
- creation timestamp

Secrets must never be stored in provenance.

## 6. Failure and Retry

A failed attempt is not the same thing as a failed logical stage. A stage can have multiple attempts:

```text
Stage
 ├── Attempt 1 → failed
 ├── Attempt 2 → failed
 └── Attempt 3 → success
```

Retries must remain idempotent and must not corrupt or overwrite previous artifacts.

## 7. Database

PostgreSQL is the persistent system of record for execution and production metadata. Database changes are versioned through migrations.

Important structures include pipeline runs, stages, attempts, artifacts, artifact versions, validation results, provider capabilities, continuity snapshots, shots and asset requirements.

## 8. Certification Principle

A feature is not considered complete merely because its schema or architecture exists.

```text
Designed
   ↓
Implemented
   ↓
Tested
   ↓
Certified
```

Only the final state is treated as production-ready.

## 9. Protected Foundation

The certified execution foundation must remain stable while integration layers are developed. New provider, artifact and storage integrations should use the existing execution contracts instead of rewriting them.
