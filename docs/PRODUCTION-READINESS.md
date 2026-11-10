# Provider execution readiness
Updated: 2026-11-10

## What changed

A reviewed request is compiled by `src/v2.8/provider-request-compiler.js` (`provider-request/6`). Canonical video adapters send that compiler's payload, rather than rebuilding it independently. Replicate's large image path additionally binds the original bytes to a verified file receipt and certifies the resulting wire body as described below. OpenAI image/speech and ElevenLabs speech use the same auxiliary compiler at preflight and execution. The fingerprint covers provider, model/version, capability, endpoint, compiler, body and transport plan. It is checked again before HTTP. Existing raw V2.1 Wan calls retain their legacy input path; new V2.10 assets carry the compiler version.

All generated video, image and speech assets are checked in one pass. A report contains every failing asset (the first compiler failure within each asset). Unknown auxiliary providers/models are blocked. Exact approved shot text is preserved; see [prompt rules](PROMPT-BUDGET-RULES.md). Runway uses UTF-16 units; the local 4000-character budget uses Unicode code points. The budget is not asserted to be a Seedance vendor limit. Wan frame-based footage must cover the timeline clip; longer footage may be trimmed by the existing renderer, and its nominal generated duration is reported separately.

## Portrait reference boundary

The reported failure explicitly names `InputImageSensitiveContentDetected.PrivacyInformation`. It establishes a privacy moderation refusal, not that the depicted people are real or that earlier E005 errors had the same cause. An upstream request ID must not be substituted for the Replicate prediction ID.

BytePlus documents dedicated trusted-output, digital-character and authorized-person workflows. This repository's Replicate Seedance 2.5 adapter implements none of those authorization transports. Consequently its IMAGE_TO_VIDEO and REFERENCE_TO_VIDEO paths are conservatively blocked with `REFERENCE_ELIGIBILITY_UNVERIFIED`, including deferred frames. This local restriction also blocks non-portrait references: it is deliberately not a face detector or a claim that all images violate provider policy. TEXT_TO_VIDEO remains supported. There is no `aiGenerated=true` escape hatch, model switch, automatic paid retry or claim that another model guarantees acceptance.

Reopen this restriction only with a verified transport, account eligibility, immutable asset/provenance requirements and regression tests. A general model capability label is insufficient evidence.

Primary sources reviewed:
- https://console.byteplus.com/ark/region%3Aap-southeast-1/docs/create-video-generation-task-api
- https://docs.byteplus.com/en/docs/modelark/guide-preview
- https://replicate.com/alibaba/wan-3/api/schema
- https://docs.dev.runwayml.com/api/
- https://ai.google.dev/gemini-api/docs/video.md (shutdown notice checked directly; older indexed deprecation pages are stale)

## References, approvals and recovery

### Replicate large reference files

Wan 3 I2V keeps the exact materialized image in the canonical request and the existing geometry/SHA-256 guard. `replicate-files/1` plans a multipart upload for an inline image over the local 256 KiB threshold. Preflight performs no upload or generation. It reports uploads separately; future previous-shot references reserve up to one upload per pending I2V asset. Cached pilot assets reserve none. The call budget counts uploads, generation and evaluation, not polling GETs or artifact downloads.

On explicit Start, after the durable claim and stale-certificate check, the adapter posts the original bytes to `/v1/files` using the official SDK's `content` multipart field. It verifies the response SHA-256, size, MIME, file identity, HTTPS download URL and declared expiry. A signed URL must survive the generation timeout. A documented nullable expiry is accepted; missing/invalid expiry is rejected. Only Replicate API file URLs or Replicate delivery hosts are accepted. No re-encoding, secret URL persistence, cross-brand file cache or inline fallback is introduced.

The existing media journal's extensible `provenance` JSON stores versioned `providerRequestTransport`: upload progress, sanitized file receipts, canonical fingerprint and SHA-256 of the exact serialized prediction body after URL substitution. The wire certificate is persisted before prediction POST. File IDs remain separate from prediction IDs. Upload errors prove only that no prediction POST occurred; an incomplete upload may leave a temporary file. A crash with no prediction ID remains fenced conservatively. A later prediction timeout stays ambiguous; known IDs use GET-only recovery. Recovery and artifact adoption retain transport evidence. No schema migration or historical-row rewrite is required; the new field is additive producer provenance.

Source checks, 2026-11-08:
- [HTTP input file guidance](https://replicate.com/docs/reference/http#models.predictions.create) recommends URLs above 256 KB; this is transport guidance, not a model image limit.
- [Input files](https://replicate.com/docs/topics/predictions/input-files) describes SDK-managed uploads.
- Official JavaScript SDK [multipart implementation](https://github.com/replicate/replicate-javascript/blob/main/lib/files.js), [URL substitution](https://github.com/replicate/replicate-javascript/blob/main/lib/util.js) and [response contract tests](https://github.com/replicate/replicate-javascript/blob/main/index.test.ts).

The user's local report identifies a 2.98 MiB approved PNG matching an OpenAI text-to-image artifact, and past Wan 3 success with a different image. Those are supplied findings, not new independent Mac observations. File transport does not establish this API key's live permissions or guarantee moderation/creative acceptance of that PNG.

### Immutable references and prediction recovery

- A global previous-frame requirement cannot silently become per-shot NONE. Every affected shot is reported. This structural check does not judge whether two free-text poses mean the same thing.
- The supplied third shot starts after a time jump: he is at the stove and she is seated. Reusing shot two's ending frame without reviewing that mismatch is not a valid automatic repair. Approve a compatible start frame or revise the transition before continuation.
- Exact first-video preflight reads and verifies the immutable frame and certifies its materialized payload. A missing future previous-shot frame remains deferred; no fabricated final certificate is issued.
- Authorization metadata is excluded from media identity so the accepted pilot can be reused. Actual prompt/model/settings/reference changes remain material. SOURCE QA receives only the current shot; full-plan continuity QA remains separate.
- The accepted provider ID is saved in both enclosing stage and media journals before polling. Terminal failure, local rejection and ambiguous outcomes remain distinct. Read-only recovery keeps the known ID even if polling fails. Historical unresolved attempts are not relabeled or deleted.
- OpenAI SDK generation retries and ElevenLabs POST retries are disabled. Inline media is hashed/redacted in Replicate provenance. Image stage certificates are checked too.

## Proof and limits

Transport validation: 21 synthetic upload/receipt/timeout/journal/redaction groups pass locally, including expiry after delayed persistence. Both Node 22 workflows passed on transport implementation commit `de7f2a4051d08e84d36f661158bb3dd691c52dd8`: [Provider readiness](https://github.com/Pryshvitsyn/content-factory-v2/actions/runs/42427623906), with PostgreSQL 17 receipt persistence, worker fencing and artifact adoption; [QUALITY](https://github.com/Pryshvitsyn/content-factory-v2/actions/runs/42427623907), with PostgreSQL 16 approval/recovery checks. Final revision checks are attached to [PR #124](https://github.com/Pryshvitsyn/content-factory-v2/pull/124). No real reference upload or generation was performed.

Local Node 24.22.1: provider-readiness suite (10 contract groups, 30 prompt checks, 12 execution groups and rejection recovery), V2.1 stage/provider/media adapters, V2.5 and V2.6 including real FFmpeg three-shot+audio rendering, V2.9.2/semantic recovery, V2.10 and V2.10.1–4 recovery, 22 UI tests and Dashboard build pass. All external generation is mocked; real provider calls: 0. Tests use synthetic material, not the working database. GitHub workflow `Provider readiness` adds Node 22 and disposable PostgreSQL 17 checks; both this workflow and the existing QUALITY workflow passed on implementation commit `59aa8caac2ffbb2f587c06239ff75492626b3d89`. The former uses PostgreSQL 17 for media journals; the latter uses PostgreSQL 16 for approval, keyframe and recovery migrations. Evidence: [provider readiness](https://github.com/Pryshvitsyn/content-factory-v2/actions/runs/42423925363) and [QUALITY](https://github.com/Pryshvitsyn/content-factory-v2/actions/runs/42423925379).

Integration baseline: GitHub PR #122 head `9f2222655e8b9db506a11e1e80b9eaf9dcbe0e98`, plus the supplied November 7 compiler/runtime exports and reviewed prompt-budget changes. Only a subset of the Mac's newer source was exported. This branch is not proof that all Mac-only changes have been reconciled. No production migration, deployment, approval, paid generation or publication was performed.

## Local continuation after main integration

PR #125 was merged at `8b9d611183c48b5e1546e85be893708a81ede490`, with all eight main-target workflows passing at `901d3cf1375b9e1775b22d2b5b1f3008eed5a136`. Source tree: `c4aa637a26202d0df3fe158290f70b6c6142355f`. This proves GitHub integration, not installation on the Mac. The user accepted the saved Tune Into Her pilot after confirming that the bag is on the floor. Do not generate that pilot again.

The next agent needs local access to `/Users/eliogenesis/Documents/content-factory-first-ad` and must complete these steps as one task:

1. Read the project core, inspect Git status/HEAD and running processes. Back up tracked and untracked local work without committing secrets or media. Reconcile merged main with those changes in an isolated branch/worktree; do not use destructive reset/clean or replace the whole checkout. In particular preserve local KeyframePreview/VoicePlayback features and existing repair evidence. Record the resulting source identity and diff from the merged source.
2. Inspect the actual database and storage configuration without printing credentials. Before startup/migrations, make and verify a working-database backup with a server-compatible `pg_dump` (the reported server is PostgreSQL 17; the earlier Homebrew 15 client failed). Verify the custom archive with compatible `pg_restore`; keep media immutable. Inspect which migrations are already applied. Use the normal ordered migration/startup process, never ad-hoc updates to approvals or history.
3. Run `npm run test:provider-readiness`, V2.4–V2.7 affected checks, actual PostgreSQL approval/recovery tests against a disposable database, and dashboard tests/build. Restart the existing local dashboard deliberately, initially with generation disabled. Confirm the served API/UI expose the saved-pilot player and exact-attempt decision path. A Git commit alone does not establish the running version.
4. Reload Tune Into Her draft `d760bf82-addd-41fb-9ab9-41ef01ed36ad`, brand `a03def76-bd3d-4c8e-b00a-ec77616c5191` (observed r19; verify current revision). Match saved prediction `fd2pr4zft5rmy0d1qcctgjzang`, immutable MP4 hash and FIRST_VIDEO attempt. The supplied result was 5.04 seconds, 720×1280. Record the founder's existing acceptance through the supported exact-attempt approval operation. Do not infer acceptance of a different or newer artifact. Reload to prove the decision persisted; playback and approval make zero generation calls.
5. Inspect every shot, voice and final payload. In the observed r19, shots two/three have `referencePolicy: NONE`; textual identity instructions do not provide visual references. Shot two starts from the pilot's end. Shot three jumps to him at the stove and her seated. Prepare a compatible reference/transition proposal using the existing reference machinery; review any material storyboard/reference revision and its approval consequences before changing it. Do not silently force the previous frame into the incompatible third-shot pose or invalidate/recreate the accepted pilot.
6. Run a fresh continuation preflight on the final reviewed revision. Prove video-1 reuses the accepted artifact and no new pilot prediction is planned. Report remaining video, speech, semantic and upload calls, their maximum, known costs and unknown costs. Use the existing approved Wan 3 route unless the founder approves a change. Start only within the authorized reviewed plan/budget; no automatic creation retry or provider switch.
7. Verify remaining source clips, identity/scene continuity, voice timing, master duration/resolution/audio and final human playback. Save the immutable final MP4 and provenance, update TASKS and PRODUCT_SNAPSHOT, and report separate GitHub/installation/database/media states. Publication remains a separate decision.

No new generation, working-database migration or approval was performed by the cloud integration session. Local readiness cannot guarantee upstream moderation or creative quality.
