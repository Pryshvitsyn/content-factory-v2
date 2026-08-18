# V2.1 Storage Architecture

## Goal

Keep the Mac development environment lightweight while allowing large generated media to live on a separate 1 TB Windows storage machine.

## Canonical separation

PostgreSQL stores **system truth and metadata**. It does not store large media blobs.

Storage stores **large immutable content objects** such as video, images, audio, archives, and exports.

```text
Content Factory
     |
     +--> PostgreSQL
     |      - productions
     |      - stages / attempts
     |      - artifacts / versions
     |      - validation
     |      - provider/model provenance
     |      - storage metadata
     |
     +--> Storage
            - video
            - images
            - audio
            - project files
            - exports
```

## Local development topology

The Mac is the development/control machine. The Windows 1 TB machine is the large-file storage target.

```text
MacBook
  |
  +-- Git / source code
  +-- worker / n8n / PostgreSQL development services
  +-- small test artifacts
  |
  +-- network storage --> Windows 1 TB
                            +-- videos
                            +-- images
                            +-- audio
                            +-- generated exports
                            +-- large artifact payloads
```

The Windows machine must be treated as a storage backend, not as the source of truth for pipeline state.

## Artifact storage contract

Each immutable `artifact_version` contains metadata such as:

- artifact ID
- version number
- artifact type
- content hash
- byte size
- MIME type
- storage backend
- storage key/path
- creation timestamp
- provider/model provenance
- validation status

The actual file is addressed by the storage key/path.

Example:

```text
PostgreSQL
artifact_version = 123
content_hash = sha256:...
storage_backend = windows-share
storage_key = artifacts/production-1042/script/v2/final.json

Windows
<storage-root>/artifacts/production-1042/script/v2/final.json
```

## Storage abstraction

Core application code must not hard-code Windows paths.

Use a provider-neutral storage interface:

```text
put(object)
get(key)
head(key)
delete(key)        # only where lifecycle policy permits
exists(key)
presign(key)        # when a remote HTTP URL is appropriate
```

The initial implementation may use a mounted/network filesystem. The interface must allow a future migration to S3-compatible object storage, MinIO, or another backend without changing artifact semantics.

## Capacity policy

The Mac should retain only development data and a bounded local cache. Large generated content should be written to the Windows storage backend once the storage integration is enabled.

Do not fill the Mac SSD with generated media.

Recommended operational guardrail:

- keep at least 20 GB free on the Mac
- monitor storage before generation batches
- keep Windows storage capacity visible to the dashboard later
- define retention/cleanup policies before automated bulk generation

## Backup principle

The Windows storage machine is **not automatically a backup**. A second copy/back-up strategy is required before production data is considered durable.

PostgreSQL backups and media backups must be handled separately because their failure/recovery characteristics differ.

## Current implementation status

This document defines the architecture only. It does not change the certified worker execution functions or PostgreSQL certification tests.

The next implementation step is a storage adapter plus configuration for a Windows network share, followed by an integration test using a small fixture. Large media migration should happen only after the adapter is proven.