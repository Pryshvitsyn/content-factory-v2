# V2.1 Storage Architecture

## Goal

Keep the Mac development environment lightweight while allowing large generated media to live on a separate storage machine.

## Canonical separation

PostgreSQL stores **system truth and metadata**. It does not store large media blobs.

Storage stores **large immutable content objects** such as video, images, audio, archives, and exports.

```text
Content Factory
     |
     +--> PostgreSQL
     |      - productions / pipeline state
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

The Mac is the development and control machine. A Windows 1 TB machine can be used as the large-file storage target.

```text
MacBook
  |
  +-- Git / source code
  +-- worker / n8n / PostgreSQL development services
  +-- small test artifacts
  |
  +-- network storage --> Windows storage
                            +-- videos
                            +-- images
                            +-- audio
                            +-- generated exports
                            +-- large artifact payloads
```

The storage machine is a backend, not the source of truth for pipeline state.

## Artifact storage contract

Each immutable artifact version should carry metadata such as:

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

## Storage abstraction

Core application code must not hard-code physical storage paths.

Use the storage-adapter boundary for operations such as:

```text
put(key, bytes, metadata)
get(key)
head(key)
delete(key)
exists(key)
```

The initial implementation may use a mounted/network filesystem. The interface must permit a future migration to S3-compatible object storage, MinIO, NAS, or another backend without changing artifact semantics.

## Capacity policy

The Mac should retain only development data and a bounded local cache. Large generated content should move to the configured storage backend once storage integration is enabled.

Do not fill the Mac SSD with generated media.

Operational guardrails should include:

- minimum free-space threshold on the Mac
- storage monitoring before generation batches
- storage capacity visibility for future dashboard work
- explicit retention/cleanup policies before bulk generation

## Backup principle

The storage machine is **not automatically a backup**. A second copy/backup strategy is required before production data is considered durable.

PostgreSQL backups and media backups must be handled separately because their failure and recovery characteristics differ.

## Current implementation status

The architecture is separated from the certified execution contract. Storage integration must be validated independently with small fixtures before large media generation is enabled.
