# Content Factory V2

A controlled V2 architecture for the Content Factory.

Content Factory V2 separates content production into explicit stages with persistent pipeline tracking, artifacts, validation, continuity data, provider configuration, retries, and idempotency.

## Current Status

**Version:** 2.0.0-prep
**Status:** Working V2 baseline
**Primary text provider:** NVIDIA
**Database:** PostgreSQL
**Runtime:** Node.js

The current V2 build has been successfully smoke-tested through:

NVIDIA → SCRIPT → PRODUCTION_BIBLE → SHOTS → CONTINUITY → ARTIFACTS → VALIDATION

The current system stops before actual image, video, voice, audio generation, final editing, and publishing. Asset requirements are prepared for downstream generation providers.

## What Changed in V2

V2 adds:

- transactional and idempotent database migration
- build journal
- persistent pipeline runs
- deterministic pipeline stages
- stage attempt history
- retry support
- dead-letter job handling
- artifact persistence
- artifact versioning
- per-stage validation records
- character and location continuity snapshots
- shot planning
- asset requirements
- provider capability registry
- NVIDIA-first provider registration
- preservation of the existing NVIDIA script-generation path
- end-to-end smoke testing

## Architecture

A production job moves through explicit stages.

```text
Generation Job
      |
      v
Pipeline Run
      |
      +-- Script
      |
      +-- Production Bible
      |
      +-- Shots
      |
      +-- Continuity
      |
      +-- Asset Requirements
      |
      +-- Artifacts
      |
      +-- Validation

     The architecture separates:
job execution
pipeline state
stage execution
production artifacts
validation
provider configuration
Pipeline Stages
Script
Generates and persists the structured script using the existing NVIDIA-first text-generation path.
Production Bible
Converts the script into a structured production plan for downstream production.
Shots
Breaks scenes into individual shots and stores shot-level production information.
Continuity
Tracks continuity information across characters, locations, scenes, and shots.
Asset Requirements
Defines the assets required to produce the planned shots and provides the interface to future generation providers.
Artifacts
Persists production outputs independently from execution state and supports artifact versioning.
Validation
Stores validation results separately from production outputs.
Database Architecture
V2 introduces or extends the following structures:
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
Existing Content Factory data is migrated into the V2 architecture rather than discarded.
Provider Architecture
The current text-generation provider is NVIDIA.
The worker currently requires the configured provider to be:
nvidia
The NVIDIA API is accessed through its OpenAI-compatible API interface.
Provider configuration is stored in PostgreSQL.
API credentials are supplied through environment variables and must never be committed to Git.
The architecture is designed to support additional providers later.
Environment
Create a local .env file based on .env.example.
Example:
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/content_os
NVIDIA_API_KEY=your_nvidia_api_key_here
Never commit .env.
The repository contains .env.example as a safe template.
Installation
Install project dependencies:
npm install
Database Migration
The main V2 migration is:
migrations/001_v2.sql
The migration creates the V2 structures and migrates existing Content Factory data into the V2 architecture.
The migration includes idempotency protections for migrated records.
Build Script
The controlled V2 build script is:
build-v2.sh
The build process:
verifies PostgreSQL connectivity
creates a backup
installs required dependencies
applies the V2 database migration
verifies the database structures
verifies NVIDIA provider configuration
verifies the enabled NVIDIA model
installs the V2 worker
runs the smoke test
reports the final build result
The build creates a backup before modifying the working Content Factory.
Backups are kept outside the Git-tracked source tree.
Worker
The V2 worker is:
worker/factory-worker-v2.js
The worker can be run directly with:
node worker/factory-worker-v2.js
Testing
Run:
npm test
The smoke test verifies the working V2 pipeline:
NVIDIA
|
v
SCRIPT
|
v
PRODUCTION_BIBLE
|
v
SHOTS
|
v
CONTINUITY
|
v
ARTIFACTS
|
v
VALIDATION
A successful test ends with:
SMOKE TEST PASSED.
The smoke test creates temporary test data and cleans it after completion.
Idempotency
V2 introduces idempotency protections for important operations.
They prevent repeated execution from unintentionally creating duplicate:
pipeline runs
stages
generation jobs
asset requirements
migrated legacy records
This is important because production systems must be safe to retry after failures or interruptions.
Retry and Failure Handling
V2 tracks stage attempts separately from the logical stage.
Example:
Stage
|
+-- Attempt 1
+-- Attempt 2
+-- Attempt 3
Failed jobs can eventually be moved into dead-letter handling instead of being retried indefinitely.
Artifact Versioning
Production outputs are stored separately from execution state.
This allows multiple versions of an artifact to exist while retaining the logical identity of the production output.
The goal is to make future regeneration and revision safe rather than destructive.
Continuity
Continuity is treated as structured production data.
The system provides a foundation for maintaining consistency across:
characters
locations
visual properties
scene relationships
production constraints
This becomes particularly important when one character or location is reused across multiple videos or scenes.
Current Limitations
V2 currently provides the text, planning, production-package, tracking, and validation foundation.
It does not yet provide:
image generation
video generation
voice generation
music/audio generation
final editing
rendering
social publishing
These capabilities are intended to consume the structured V2 production package and asset requirements.
Repository Structure
content-factory-v2/
|
+-- build-v2.sh
+-- migrations/
| +-- 001_v2.sql
+-- tests/
| +-- smoke-test.js
+-- worker/
| +-- factory-worker-v2.js
+-- package.json
+-- package-lock.json
+-- .env.example
+-- .gitignore
+-- README.md
Development Workflow
The stable release line is:
main
Development should happen on dedicated branches.
Examples:
release/v2.0.0-prep
feature/v2.1-asset-generation
feature/v2.1-provider-system
fix/stage-retry
Changes should be:
developed on a branch
tested locally
reviewed
committed intentionally
merged into main
tagged when a release is created
Database changes must be represented by migrations.
Do not make undocumented production database changes.
Release Baseline
The current working V2 baseline is being prepared for the v2.0.0 release.
The intended stable release tag is:
v2.0.0
After the release baseline is verified, V2.1 development will continue on a separate branch.
V2.1 Roadmap
Planned V2.1 work includes:
provider abstraction
image generation providers
video generation providers
voice generation
asset generation orchestration
stronger continuity enforcement
asset reuse
generation retries
final media assembly
publishing workflows
These are planned capabilities and are not represented as completed functionality in V2.0.0.
Security Rules
Never commit:
.env
API keys
database passwords
production credentials
generated secrets
local backups
Use .env.example to document required environment variables.
License
Private project.
