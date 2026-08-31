# Avatar Studio V1.1 — Asset Intake, Consent and Gate 0 Review

V1.1 replaces operator-entered avatar source artifact IDs with a browser intake flow. It extends the existing Content Factory artifact storage and Avatar Studio V1 domain; it is not a separate application or generation engine.

## Immutable flow

1. The browser explicitly selects `UPLOAD`, `CAMERA`, `MICROPHONE`, `EXISTING_ASSET`, or `SAFE_URL_IMPORT`.
2. New bytes are written once through `ArtifactService` and the configured `StorageAdapter`. Existing V2.1 assets retain their existing immutable version.
3. `avatar_studio.asset_intakes` records workspace, brand, vertical, character, hash, media metadata, provenance, source type and the initial Gate 0 result.
4. Gate 0 review decisions are append-only `gate0_review_events`; the intake row is never rewritten.
5. Consent grants and revocations are append-only `consent_events`. Revocation does not mutate historical artifacts, but future source use and plan compilation fail closed.
6. `USE AS AVATAR SOURCE` creates the existing `source_assets` record and explicit `source_asset_roles`. Filename inference is forbidden.

## Security boundary

- Unsupported MIME types, extension/signature mismatches, unreadable media, prompt injection, concealed instructions and embedded execution are blocked.
- Tracking parameters, external URLs, uncertain provenance, PII and real-person face/voice rights are routed to review.
- A Gate 0 `BLOCK` cannot be manually promoted. A `REVIEW` becomes usable only through an immutable `APPROVE_FOR_USE` event.
- Safe URL import requires public HTTPS, rejects credentials, redirects and private/reserved DNS results, caps response size, and pins the validated public IP for the TLS request.
- Every read and write resolves the avatar's explicit workspace, brand and vertical scope.

## Consent foundation

The dashboard supports explicit disclosure text, local audio/video consent evidence, durable remote consent request tokens, brand/vertical/channel/use scopes, expiry and append-only revocation. It does not send messages or call an external consent service. Tokens are returned once; only their SHA-256 hashes are stored.

## Cost boundary

Asset intake uses local inspection and immutable storage only. `SAFE_URL_IMPORT` may perform one operator-requested download, but no AI provider or external generation call is available from these routes. Test Content remains plan-only with execution authorization set to false.

## Next production slice

`PASSPORT LAB`: compose frontal, 45-degree and 90-degree candidates from approved `IDENTITY`/`PASSPORT_SOURCE` assets, compare multiple immutable candidate sets, run geometry and identity-continuity QA, and preserve the existing explicit certification boundary. Paid generation remains a separate, later approval boundary.
