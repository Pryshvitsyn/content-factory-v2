# V2.1 Storage Adapter

## Purpose

The Content Factory stores large media outside PostgreSQL while keeping storage implementation details out of pipeline code.

PostgreSQL stores artifact metadata and the storage key. The adapter stores the actual bytes.

## Contract

```text
put(key, bytes, metadata) -> StoredObject
get(key) -> bytes/stream
head(key) -> ObjectMetadata
exists(key) -> boolean
delete(key) -> void
```

The implementation must never expose absolute Windows paths to the core pipeline.

## Initial backend

The first backend is a filesystem/network-share adapter. A Windows 1 TB machine can expose a dedicated Content Factory share. The Mac mounts that share; the application receives only a configured storage root.

Example configuration:

```text
CONTENT_STORAGE_BACKEND=filesystem
CONTENT_STORAGE_ROOT=/mnt/content-factory
```

The root is environment-specific and is never committed to Git.

## Object layout

Keys are portable POSIX-style relative paths:

```text
artifacts/{production_id}/{artifact_type}/{artifact_id}/v{version}/{filename}
```

Example:

```text
artifacts/production-1042/video/video-88/v3/final.mp4
```

The adapter joins the configured root with the validated relative key. `..`, absolute paths, and path traversal are rejected.

## Immutability

Artifact versions are immutable. `put` must not silently overwrite an existing object for an immutable artifact version. A collision is an error unless an explicit future administrative operation allows replacement.

## Metadata

The adapter records/returns:

- key
- byte size
- MIME type when supplied
- modification time
- content hash when calculated

The canonical artifact metadata remains in PostgreSQL.

## Safety and capacity

- Do not store secrets in object metadata.
- Do not use the storage share as the database.
- Do not treat the Windows machine as a backup.
- Keep a free-space guardrail on the Mac; large production media should not be copied into the repository or Docker volumes.
- Backup/retention policy is a separate concern and must be defined before bulk automated generation.

## Future backends

The same contract can later support S3-compatible storage, MinIO, NAS, or cloud object storage without changing artifact semantics.

## Implementation boundary

This adapter is deliberately independent from the certified execution functions. It does not change worker claim/lease/recovery behavior.
