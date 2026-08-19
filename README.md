# Content Factory V2

A controlled production architecture for AI-assisted content generation.

## Status

- **Architecture:** V2
- **Baseline:** V2.0
- **Development line:** V2.1
- **Primary text provider:** NVIDIA
- **Database:** PostgreSQL
- **Runtime:** Node.js 22
- **Stable branch:** `main`

V2 replaces the legacy V1 execution model with explicit production state, deterministic stages, attempts, artifacts, validation, provider configuration, and persistent database contracts.

## What V2 Is

Content Factory V2 is a production system, not a single AI script. A production job is tracked from execution through validated artifacts.

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

The system separates:

- execution state
- stage state
- retry/attempt history
- AI provider configuration
- production artifacts
- artifact versions
- validation results
- persistent storage
- continuity and shot-planning data

## Current Certified Foundation

The V2 foundation currently includes:

- PostgreSQL-backed pipeline state
- deterministic stage sequencing
- stage ownership and concurrency protection
- attempt and retry tracking
- recovery/idempotency contracts
- artifact and artifact-version data model
- validation records
- provider capability registry
- NVIDIA-first provider configuration
- storage adapter foundation
- CI validation on Node.js 22

The execution foundation and PostgreSQL concurrency certification are protected by automated tests.

## Production Pipeline

The current production planning flow is:

```text
NVIDIA
  ↓
SCRIPT
  ↓
PRODUCTION_BIBLE
  ↓
SHOTS
  ↓
CONTINUITY
  ↓
ASSET_REQUIREMENTS
  ↓
ARTIFACTS
  ↓
VALIDATION
```

V2 currently provides the text, planning, production-package, tracking, and validation foundation. Full image/video/voice/audio generation, final assembly, rendering, and publishing are downstream capabilities and are developed as V2.1 integrations.

## Provider Architecture

Providers are configuration-driven and NVIDIA-first.

The intended V2.1 provider boundary is:

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

The execution system must not depend directly on a vendor-specific response format. Provider results are normalized before becoming production artifacts.

Additional providers can be added without changing the execution contract.

## Artifact Architecture

Artifacts are production outputs, independent from execution state.

```text
Artifact
   ├── Version 1
   ├── Version 2
   └── Version 3
```

Versions are immutable. Regeneration creates a new version rather than destructively replacing the previous result.

Artifact provenance records the production context needed to understand where an output came from, including stage, attempt, provider/model context, and validation state.

## Storage

Storage is accessed through an adapter boundary rather than directly from business logic.

The adapter is responsible for persistence operations and content integrity. Production code should not assume a particular physical storage backend.

The current foundation supports filesystem-backed development storage; object storage can be introduced later without changing the artifact contract.

## Database

V2 uses PostgreSQL for persistent production state.

Core structures include:

```text
factory_v2_builds
pipeline_runs
job_stages
stage_attempts
artifacts
artifact_versions
dead_letter_jobs
provider_capabilities
continuity_snapshots
shots
asset_requirements
validation_results
```

All database changes must be represented by migrations. Undocumented production schema changes are not allowed.

## Testing

Install dependencies:

```bash
npm ci
```

Run the V2 smoke test:

```bash
npm test
```

Run the V2.1 stage-sequencing tests:

```bash
npm run test:v2.1
```

CI additionally validates worker syntax, PostgreSQL execution/concurrency certification, migrations, required files, and Git whitespace.

## Environment

Create a local `.env` from `.env.example`.

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/content_os
NVIDIA_API_KEY=your_nvidia_api_key_here
```

Never commit `.env`, API keys, database passwords, credentials, or generated secrets.

## Repository Structure

```text
content-factory-v2/
├── .github/workflows/       # CI
├── migrations/              # versioned PostgreSQL changes
├── tests/                   # smoke, contract and certification tests
├── worker/                  # V2 execution worker
├── build-v2.sh              # controlled V2 build
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
└── README.md
```

## Development Rules

1. `main` is the stable V2 line.
2. Development happens on dedicated branches.
3. Database changes require migrations.
4. Certified execution functions are not changed casually.
5. Provider-specific logic stays behind provider boundaries.
6. Artifacts are immutable; revisions create new versions.
7. Validation is recorded separately from production output.
8. Secrets never enter Git.
9. Every meaningful change must pass CI before being considered certified.

## V2.1 Roadmap

V2.1 is built incrementally on the certified V2 foundation:

1. Provider Gateway and normalized provider contract
2. NVIDIA provider adapter
3. Artifact Service integration
4. Storage Adapter integration
5. End-to-end Stage → Provider → Artifact → Validation → Storage certification
6. Image/video/voice/audio provider integrations
7. Asset generation orchestration
8. Stronger continuity enforcement and asset reuse
9. Final media assembly
10. Publishing workflows
11. Production dashboard and analytics

The rule is simple: a capability is called **certified** only after implementation and automated verification. Architecture or schema alone is not considered complete functionality.

## Security

Never commit:

- `.env`
- API keys
- database passwords
- production credentials
- generated secrets
- local backups
- private data

Use `.env.example` as the safe configuration template.

## License

Private project.
