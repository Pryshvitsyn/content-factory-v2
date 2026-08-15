# Content Factory V2

This package is a controlled V1 -> V2 migration for the current Content Factory.

## What changed

V2 adds:

- transactional/idempotent database migration
- build journal
- pipeline runs and deterministic stages
- immutable artifact history and versions
- stage attempt history
- retries with exponential backoff
- dead-letter handling
- per-stage validation records
- character/location continuity snapshots
- shot planning
- provider capability registry
- NVIDIA-first provider registration
- preservation of the existing NVIDIA script-generation implementation
- a real end-to-end smoke test

The V2 worker is based on the supplied working worker, not a clean-room rewrite. The existing script-generation prompt/path remains in place.

## Install

Copy this V2 directory into the current factory project or keep it beside it.

Run from the current factory root:

```bash
FACTORY_ROOT="$PWD" /path/to/content-factory-v2/build-v2.sh
```

The script creates a timestamped backup under:

```text
backups/content-factory-v2-<UTC timestamp>/
```

It stores both a custom PostgreSQL dump and a schema-only dump.

## Safety

The build:

1. backs up the database and current worker
2. installs dependencies
3. applies the V2 migration in a PostgreSQL transaction
4. verifies V2 tables
5. registers the build
6. replaces the worker only after the migration succeeds
7. verifies NVIDIA
8. runs the smoke test
9. marks the build completed only after smoke passes

Running the SQL migration again is safe.

The worker also uses deterministic keys so retrying a script job does not create another script version for the same generation job.

## Rollback

If the new worker must be reverted:

```bash
cp backups/content-factory-v2-<timestamp>/files/worker.pre-v2.js ./worker.js
```

For a full database rollback, restore the custom dump into a new/recovered database first, verify it, and only then point the worker at it:

```bash
pg_restore --clean --if-exists -d "$DATABASE_URL" backups/content-factory-v2-<timestamp>/database.dump
```

Do not run a destructive restore against the live database until the backup has been verified.

## Smoke test

The smoke test creates one temporary script-generation job, runs:

```text
NVIDIA
  -> SCRIPT
  -> PRODUCTION_BIBLE
  -> SHOT PLAN
  -> CONTINUITY
  -> ARTIFACT
  -> VALIDATION
```

It then checks idempotency and cleans its test data.

Use:

```bash
SMOKE_KEEP=1 node tests/smoke-test.js
```

to retain the smoke data for inspection.

## Provider architecture

The current text path continues to use:

```text
NVIDIA
https://integrate.api.nvidia.com/v1
```

V2 also registers capability slots for:

- text_generation
- image_generation
- video_generation
- audio_generation
- text_to_speech

The actual image/video/audio adapters are deliberately not hard-coded into the text worker. Future providers can implement those capabilities without changing the job/stage/artifact model.
