# Replicate Seedance 2.5

Creative Production persists and restores the complete nested Seedance `modelRequest`. Multiple ordered continuity entities flow through `ReferenceInputPlan`; unsupported role combinations block during authoritative preflight. Editing and extension retain provider duration `-1` independently from positive editorial duration.

## Production transport and gating

References at or below 1 MB use data URIs. Larger immutable image, video, and audio inputs use Replicate's official `POST /v1/files` multipart API (files must be less than 100 MB); the returned file-resource URL is inserted only into the ephemeral prediction payload. Durable evidence records the Factory artifact/version/SHA/MIME/size, Replicate file ID, locator hash, expiry, and materialization-contract version—never bytes, base64, or a raw signed locator. Identical SHA inputs share one upload within an exact adapter lifecycle. Upload failure is pre-prediction and cannot create a paid job.

Current Seedance pricing remains `UNKNOWN_CURRENT_PRICE`. V2.10 exposes exact per-shot contract requests but blocks START with `PRICE_NOT_VERIFIABLE`; no guessed price or silent route fallback is permitted.

- Provider: `replicate`
- Model: `bytedance/seedance-2.5`
- Local contract: `replicate-seedance-2.5@1`
- Observed: 2026-09-05
- Official reviewed schema: `fa8b2706824084e968dfe1d1cdff8e0193b40ef908827e3d2940a927704a5f43`
- Source: https://replicate.com/bytedance/seedance-2.5/versions/fa8b2706824084e968dfe1d1cdff8e0193b40ef908827e3d2940a927704a5f43/api

The reviewed fields are `prompt`, `image`, `last_frame_image`, `reference_images`, `reference_videos`, `reference_audios`, `duration`, `resolution`, `aspect_ratio`, `generate_audio`, `watermark`, `output_format`, and `seed`. Unknown fields fail with `UNSUPPORTED_MODEL_PARAMETER`; Wan-only fields are never sent.

Explicit modes are `TEXT_TO_VIDEO`, `FIRST_FRAME_IMAGE_TO_VIDEO`, `FIRST_LAST_FRAME`, `MULTIMODAL_REFERENCE`, `VIDEO_EDITING`, and `VIDEO_EXTENSION`. First/last frames cannot mix with multimodal references. A last frame requires a first frame. Audio references require an image or video reference. Editing/extension require a reference video, intelligent duration `-1`, and adaptive aspect ratio. First/last also requires adaptive aspect ratio.

Limits: 30 images, 10 videos/30 seconds combined, 10 audios/30 seconds combined, and 2000 prompt characters. Duration is `-1` or 4–30 seconds. Reviewed resolutions are 480p/720p/1080p; aspect ratios are adaptive, 16:9, 9:16, 1:1, 4:3, and 3:4. Output is MP4. Content Factory explicitly resolves duration 5, resolution 720p, aspect 16:9, audio false, watermark false, and MP4 rather than inheriting provider defaults. Seed is optional.

References retain provider order and aliases `[Image1]`, `[Video1]`, and `[Audio1]`; reordering changes the request fingerprint. Immutable artifact ID/version/SHA and any derived lineage must be resolved before constructing the provider input. Replicate SDK local `Buffer`/file inputs are preferred; data URIs are not the large-media default.

Pricing is `UNKNOWN_CURRENT_PRICE` until a reviewed official per-property rate is recorded. Zero-call review remains available, but paid start fails closed with `PRICE_NOT_VERIFIABLE`; acknowledgment plus a numeric maximum is not treated as an enforceable ceiling. An estimate must never be labeled verified.

Zero-call example: resolve a `TEXT_TO_VIDEO` request through `resolveVideoModelRequest()`, inspect its exact provider input and fingerprint, run backend preflight, and bind human approval. This performs no prediction. Generation remains unavailable while `LIVE_PAID_GENERATION=false`.

Errors include `SEEDANCE_INPUT_MODE_REQUIRED`, `SEEDANCE_INPUT_MODE_CONFLICT`, `FIRST_FRAME_REQUIRED`, `LAST_FRAME_REQUIRES_FIRST_FRAME`, `REFERENCE_AUDIO_REQUIRES_VISUAL_REFERENCE`, reference count/duration limit codes, `INVALID_DURATION`, unsupported resolution/aspect/output codes, and `UNSUPPORTED_MODEL_PARAMETER`.
