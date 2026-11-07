# Prompt budget rules
Updated: 2026-11-07

1. Compile the approved current shot once (`shot/4`). Do not rewrap it in the whole story. Keep approved START/ACTION/END, subjects, style, lighting, camera, continuity and negative requirements. No silent truncation, summarization or budget increase.
2. Deduplicate only identical static composition components. Repeated camera conversions must be idempotent. Temporal states and distinct or contradictory requirements are not interchangeable duplicates.
3. Add default production constraints once (`provider-prompt/3`). Custom negative intent and historical inputs retain their explicit translation. Still-image compilation retains the approved opening-state description.
4. Measure the final translated provider request, not just the form input. Preserve the documented unit per model: Runway UTF-16 units; local video budget Unicode code points. Provider and local limits must remain labeled separately.
5. Check every generated video/image/speech asset. Report all failed assets in one response, with identity, actual length, limit and source. Do not stop after the first failing shot.
6. A deferred reference is not a final-payload certificate. Materialize verified immutable bytes before execution; compiler/input/reference changes require a new preflight. `provider-request/5` rejects older certificates.
7. Run `npm run test:provider-readiness` for changes to shot projection, catalog, prompt translation, provider payloads or lifecycle. Test sibling assets/routes, Unicode boundaries, stale certificates, zero-HTTP rejection and accepted-ID retention. Do not claim live success from mock tests.

The supplied November 7 draft export reproduced 4650/4786/5020 characters for videos 1/2/3. Lossless static deduplication and compact framing yielded 3725/3756/3990. These are historical reproduction values, not a permanent allowance: video 3 had only 10 characters of headroom. Current Seedance reference eligibility and per-shot continuity checks are additional independent gates; see [execution readiness](PRODUCTION-READINESS.md).
