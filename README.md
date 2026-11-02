# Content Factory V2

## What it is
A multi-brand, provider-neutral system for producing advertising videos with durable execution, immutable media artifacts, quality gates and explicit human review.

## Current status
Development / live-pilot validation. Implementation exists; a completed, accepted MP4 for the current pilot is not verified. See [PRODUCT_SNAPSHOT.md](PRODUCT_SNAPSHOT.md) for current evidence and next action.

## Stack
Node.js 22, PostgreSQL, React 19 / Vite, FFmpeg / ffprobe; capability-routed media providers and configurable artifact storage.

## Run
```bash
npm ci
# Configure a local .env using .env.example; never commit credentials.
LIVE_PAID_GENERATION=false npm run dashboard:local
```
Requires the configured local PostgreSQL database and artifact storage. The local runner prepares the schema and checks readiness; inspect its migration behavior before using an existing database. See [operator setup](docs/V2.7-OPERATOR-CONSOLE.md) and [local runtime](docs/V2.3-CONTROL-DASHBOARD.md).

QUALITY workflow: Brand / Idea → approved Script → approved Storyboard → Visual Lock → approved Pilot → remaining shots → Master Review. See [script-first workflow](docs/QUALITY-SCRIPT-FIRST-WORKFLOW.md). Preflight and Start are separate actions; approval does not publish.

## Test
Safe local entry points after dependency installation:
```bash
LIVE_PAID_GENERATION=false node tests/quality-script-first-test.js
LIVE_PAID_GENERATION=false node tests/v2.10-runtime-integration-test.js
npm run test:v2.1
npm run dashboard:build
```
Run affected suites from [package.json](package.json) and relevant CI workflows. PostgreSQL suites require a prepared test database. `npm test` is an operator-invoked live smoke test that may incur provider cost; it is not the default unit-test command. Mock tests do not certify a live production.

## Deploy / URLs
No production or staging service URL is verified in this handoff. Run locally using the command above; a frontend build alone does not deploy the full system. Prepare and verify deployment configuration before an explicitly authorized release under [AGENTS.md](AGENTS.md).

- Dashboard: http://127.0.0.1:3000 (when running).
- API: http://127.0.0.1:3001 (default loopback binding).
- Repository: https://github.com/Pryshvitsyn/content-factory-v2
- Final MP4 export is available for manual upload; direct channel publishing, scheduling and analytics are not implemented.

## Structure
| Path | Owns |
| --- | --- |
| `apps/dashboard/` | Operator UI and local API |
| `src/` | Production, providers, artifacts, storage and validation |
| `worker/` | Canonical execution contracts and workers |
| `migrations/` | Versioned persistent schema changes |
| `config/`, `schemas/` | Production inputs and schemas |
| `scripts/`, `tests/` | Runtime tools and verification |
| `docs/` | Existing architecture, contracts and workflow details |

## Project brain
- [GOAL.md](GOAL.md): destination and milestone proof.
- [PRODUCT_SNAPSHOT.md](PRODUCT_SNAPSHOT.md): current state only.
- [TASKS.md](TASKS.md): executable work.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): existing architecture entry point; later implementation details live in the versioned documents below.
- [Provider contract](docs/PROVIDER-CONTRACT-V2.1.md), [storage](docs/STORAGE-ARCHITECTURE.md), [universal media](docs/V2.9.2-UNIVERSAL-MEDIA-STACK.md), [continuity](docs/V2.10.3-CROSS-SHOT-CONTINUITY-GATE.md).

## Agent rules
See [AGENTS.md](AGENTS.md). Existing workflow decisions remain in their authoritative documents; no parallel decision log, architecture copy, role files or skills are created without a concrete need.

## Security / license
Never commit secrets, private data or populated environment files. No open-source license has been selected; public visibility alone does not grant reuse or redistribution rights. The package metadata license field is not a substitute for an approved repository license.
