# Content Factory V2

A controlled production system for AI-assisted content generation.

## Current Status

- **Architecture:** V2
- **Development line:** V2.1
- **Stable branch:** `main`
- **Primary text provider:** NVIDIA-first
- **Database:** PostgreSQL
- **Runtime:** Node.js 22

V2 is built as a durable execution system rather than a single AI script. Production state, stage state, attempts, ownership, artifacts, validation, provider routing, storage, and publication state are explicit and persistent.

## What Is Implemented

The current `main` branch contains a certified execution foundation plus the first real content-production layers.

### Execution foundation

- PostgreSQL-backed production/job/stage state
- deterministic canonical stage ordering
- attempts and retry handling
- concurrent job/stage ownership
- lease fencing and stale-owner protection
- crash/recovery paths
- heartbeat support for long-running stages
- stage input propagation and input fingerprints

### Provider boundary

```text
Production Stage
      ↓
Provider Gateway / Routing
      ↓
Provider Adapter
      ↓
Normalized Provider Result
```

Provider-specific logic stays behind the gateway/adapter boundary. The registry supports capability-aware selection, provider availability, explicit providers, priorities, and fallbacks. Additional providers can be added without changing the execution contract.

### Artifact and storage layer

- immutable artifact versions
- deterministic artifact idempotency
- artifact provenance
- storage adapter boundary
- durable input hydration between stages
- PostgreSQL system truth plus external artifact storage

### Validation and publication

- explicit validation records and publication gates
- database-backed publication idempotency
- duplicate-publication protection under concurrency
- durable `UNKNOWN` publication state
- reconciliation of ambiguous external publication outcomes

### Master video production

The repository now includes one executable vertical-short production path from approved structured plans to a real MP4 master:

- provider-routed image, video and speech generation;
- deterministic media timeline;
- FFmpeg render with synchronized video and audio;
- editorial and technical quality checks;
- immutable master artifact;
- mandatory human review before publication.

The default composition uses NVIDIA for text/video and can use OpenAI for image/speech when configured. Missing capabilities fail closed; the factory does not substitute placeholder media. See [`docs/V2.1-MASTER-PRODUCTION.md`](docs/V2.1-MASTER-PRODUCTION.md).

Replicate Wan 2.2 T2V Fast is also available as a real video provider. Set `VIDEO_PROVIDER=replicate` with `REPLICATE_API_TOKEN` to prefer it while keeping NVIDIA Cosmos registered as an alternative. See [`docs/V2.1-REPLICATE-WAN-VIDEO.md`](docs/V2.1-REPLICATE-WAN-VIDEO.md).

## Real Production Pipeline

The canonical V2.1 production graph is:

```text
SIGNAL
  ↓
IDEA
  ↓
BRIEF
  ↓
BIBLE
  ↓
CONCEPT
  ↓
SCRIPT
  ↓
SHOT_PLAN
  ↓
ASSET_PLAN
  ↓
ASSETS
  ↓
EDIT
  ↓
PLATFORM_ADAPTATION
  ↓
VALIDATION
  ↓
PUBLISH
  ↓
ANALYZE
  ↓
LEARN
```

The first real vertical production slice is implemented through `SCRIPT`. Structured production planning then extends the pipeline through `SHOT_PLAN` and `ASSET_PLAN`.

Continuity is currently represented as a required structured object in the shot plan rather than as a separate database stage. This keeps the canonical stage graph stable while making continuity constraints explicit and machine-checkable.

## Structured Production Planning

Planning outputs are no longer treated as arbitrary free-form text for the structured stages.

```text
SCRIPT
  ↓
SHOT_PLAN
  ├── shots
  └── continuity
        ↓
ASSET_PLAN
  └── assets
```

The structured contracts validate required fields and cross-stage references before a stage can complete. This is the content-plane foundation for downstream asset generation and rendering.

## Asset Orchestrator

The current asset layer is reuse-first:

```text
ASSET_PLAN
    ↓
Find reusable asset
    ├── found → reuse
    └── missing
          ↓
      Provider routing
          ↓
       Generate
          ↓
 Immutable artifact version
          ↓
 Durable asset registry
```

The asset orchestrator is capability-aware for text, image, video, voice, and audio. It uses deterministic idempotency keys and the existing immutable Artifact Service. Existing reusable assets are selected before generation; missing assets are generated through the Provider Gateway.

The architecture does **not** claim that every media provider is already connected. The orchestrator provides the production boundary so concrete image/video/voice/audio adapters can be added independently.

## What Is Not Complete Yet

The system is not yet the finished end-to-end media factory. The remaining production layers are deliberately explicit:

1. concrete image/video/voice/audio provider adapters;
2. asset generation at real media scale;
3. stronger continuity enforcement across generated assets;
4. broader edit templates beyond the certified vertical-short path;
5. production-scale rendering/export operations;
6. additional platform-specific adaptation profiles;
7. richer perceptual QA and review tooling;
8. production analytics and learning feedback.

A capability is not considered complete merely because its schema or interface exists. It becomes part of the certified system only after implementation and automated verification.

## Provider Architecture

```text
Execution / Orchestrator
        ↓
Provider Gateway
        ↓
Capability-aware routing
        ↓
Provider Registry
        ↓
NVIDIA / OpenAI / Claude / other enabled adapters
        ↓
Normalized Provider Result
```

The Factory is intentionally provider-agnostic at the execution boundary. One stage may use one model while another stage uses a different provider or model according to capability, availability, routing policy, cost, or quality requirements.

See [`docs/PROVIDER-CONTRACT-V2.1.md`](docs/PROVIDER-CONTRACT-V2.1.md).

## Artifact Architecture

Artifacts are independent from execution state and are immutable.

```text
Artifact
   ├── Version 1
   ├── Version 2
   └── Version 3
```

Regeneration creates a new version instead of destructively overwriting a previous result. Deterministic idempotency keys protect the system from duplicate artifact creation during retries or concurrent execution.

## Storage

Storage is accessed through an adapter boundary rather than directly from business logic.

- PostgreSQL stores durable system truth and metadata.
- Large artifact bytes are stored through the configured storage backend.
- The adapter boundary supports filesystem development and future S3-compatible, MinIO, NAS, or cloud storage backends without changing artifact semantics.

See:

- [`docs/STORAGE-ARCHITECTURE.md`](docs/STORAGE-ARCHITECTURE.md)
- [`docs/STORAGE-ADAPTER-V2.1.md`](docs/STORAGE-ADAPTER-V2.1.md)

## Database

V2.1 uses PostgreSQL as the source of truth for execution and production state.

Important durable concepts include:

```text
productions
jobs
stage_definitions
stage_runs
attempts / retry state
artifacts / artifact versions
validation state
publication state
asset registry
provider configuration
```

All schema changes must be represented by migrations. Production behavior must not depend on undocumented schema changes.

The canonical stage contract is defined in [`worker/v2.1-production-contract.js`](worker/v2.1-production-contract.js).

## Testing and Certification

Install dependencies:

```bash
npm ci
```

Run the basic smoke test:

```bash
npm test
```

Run the V2.1 contract suite:

```bash
npm run test:v2.1
```

CI also verifies runtime syntax, provider routing, artifact/storage integration, multi-stage execution, PostgreSQL lifecycle, retries and recovery, concurrency ownership, lease fencing, artifact idempotency, crash recovery, reconciliation, validation, publication, structured production planning, and asset orchestration.

## V2.3 Control Dashboard

The local Control Dashboard exposes persisted brand, production, stage, artifact, review and provider state through a thin Node API and five-screen React interface. Exact immutable master versions can be approved or rejected without publishing them.

After applying the V2.3 review migration to a development database, use the placeholder-safe local runner:

```bash
npm install
npm run dashboard:local
```

Open `http://127.0.0.1:3000`. The API binds to `127.0.0.1:3001` by default. The runner discovers `content_os`, uses the production artifact root, validates schema readiness, and rejects placeholder database URLs or occupied ports safely. See [`docs/V2.3-CONTROL-DASHBOARD.md`](docs/V2.3-CONTROL-DASHBOARD.md).

## V2.4 Controlled Live Production

V2.4 adds one CLI-only, operator-invoked path for a minimal Replicate video → immutable media → FFmpeg master → validation → V2.3 Review Queue run. It is never called by dashboard startup, tests, CI, migrations or workers. Live execution requires the explicit `LIVE_PAID_GENERATION=true` gate; `false` performs a non-paid dry-run. See [`docs/V2.4-CONTROLLED-LIVE-PRODUCTION.md`](docs/V2.4-CONTROLLED-LIVE-PRODUCTION.md).

For a legacy local Content OS database, `npm run live:production:local` first applies the deterministic row-preserving compatibility bridge and then runs the full pre-paid schema/write/storage gate. Schema ownership and recovery details are documented in [`docs/V2.4-LEGACY-SCHEMA-COMPATIBILITY.md`](docs/V2.4-LEGACY-SCHEMA-COMPATIBILITY.md).

## V2.5 Reusable Real Content Production

V2.5 accepts an external creative brief with variable-count shots and voiceover, tracks every paid media asset behind its own durable idempotency/reconciliation fence, assembles a real FFmpeg video+audio master, validates media streams, and sends the exact immutable master to human review.

Safe local pre-paid plan (provider calls remain zero):

```bash
LIVE_PAID_GENERATION=false \
REAL_PRODUCTION_INPUT=config/productions/attune-dont-guess-tune-in.json \
VIDEO_PROVIDER=replicate AUDIO_PROVIDER=openai-media \
npm run real:production:local
```

See [`docs/V2.5-REAL-CONTENT-PRODUCTION.md`](docs/V2.5-REAL-CONTENT-PRODUCTION.md) for the operator contract, recovery states, paid boundary, and certification commands.

## V2.6 FAST Rendering

V2.6 adds an explicit renderer router. Existing inputs remain on the unchanged `QUALITY` lane; new `FAST` inputs can use a pinned external MoneyPrinterTurbo service. FAST output is copied into the same immutable artifact store, validated with ffprobe, and registered in the same human Review Queue. No FAST job is started by dry-run or CI.

```bash
LIVE_PAID_GENERATION=false \
REAL_PRODUCTION_INPUT=config/productions/attune-fast-example.json \
RENDER_MODE=FAST FAST_RENDERER=moneyprinterturbo \
MPT_ENABLED=true MPT_BASE_URL=http://127.0.0.1:8080 \
MPT_AUTO_PUBLISH_DISABLED=true \
npm run real:production:local
```

See [`docs/V2.6-FAST-RENDERING.md`](docs/V2.6-FAST-RENDERING.md) for the pinned upstream API/image, localhost companion, recovery rules, safe dry-run, and operator-controlled real command.

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
├── apps/dashboard/          # V2.3 browser UI and local Control API
├── docs/                    # architecture and contract documents
├── migrations/              # versioned PostgreSQL changes
├── src/                     # provider, artifact, storage and validation services
├── worker/                  # V2.1 execution and orchestration workers
├── tests/                   # smoke, contract, integration and certification tests
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
4. Certified execution boundaries are changed deliberately and re-certified.
5. Provider-specific logic stays behind provider boundaries.
6. Artifacts are immutable; revisions create new versions.
7. Validation is recorded separately from production output.
8. Secrets never enter Git.
9. Every meaningful change must pass CI before it is considered certified.
10. Architecture and contracts in `docs/` and canonical runtime contracts must stay synchronized with implementation.

## Roadmap to a Full Media Factory

The remaining path is intentionally ordered from production semantics to media output:

1. concrete media provider adapters;
2. production-scale asset generation;
3. continuity enforcement and asset reuse improvements;
4. deterministic edit manifest;
5. media assembly and rendering;
6. platform adaptation;
7. objective QA and human approval;
8. publication operations;
9. analytics and learning feedback.

The goal is not merely to execute jobs reliably. The goal is a Factory that can accept a production request, create coherent structured plans, resolve or generate the required assets, assemble them into a finished result, validate that result, and publish it with durable provenance and recovery semantics.

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

No open-source license has been selected yet. Public visibility does not grant permission to reuse or redistribute the code beyond rights granted by applicable law.
