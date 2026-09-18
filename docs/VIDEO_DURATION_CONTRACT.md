# Editorial and provider video durations

Editorial `shot.durationSeconds` and `target_clip_duration_ms` remain the approved timeline authority. Provider generation duration is resolved during zero-call preflight, separately for every shot, and persisted in authoritative per-shot settings and canonical execution fingerprints.

- Fixed duration lists choose the smallest supported duration at least as long as the editorial shot.
- Range contracts clamp to the minimum and round upward to `durationStepSeconds` when specified. Replicate Wan 3 and Seedance 2.5 require one-second steps.
- Resolution above the maximum fails with HTTP 409 `UNSUPPORTED_DURATION`.
- `editorialDurationSeconds` and `providerDurationSeconds` are explicit in canonical settings. Paid adapters consume the resolved generation duration without rounding.
- Legacy final-preflight objects derive missing per-shot duration settings from the installed model contract while rebuilding canonical input. Fingerprints include the resulting settings; stale execution preflights cannot be reused.
- The FFmpeg master renderer trims every clip to its editorial timeline duration and caps the master to its target duration. Source-media validation permits longer clips and retains its existing short-source and other checks.

No schema or historical artifact migration is required: settings are additive JSON fields in newly computed preflight and execution records. Existing approvals, artifacts, and historical execution records are preserved.

Regression: `node tests/video-duration-resolution-test.js` (synthetic adapters only; real provider calls zero).
