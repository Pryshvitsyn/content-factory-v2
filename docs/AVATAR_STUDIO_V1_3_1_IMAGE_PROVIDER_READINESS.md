# Avatar Studio V1.3.1 — Current Image Provider and Real Smoke Readiness

## Verified provider state

The previous new-plan path selected `openai / gpt-image-1`. On 2026-09-01 the official OpenAI model catalog identifies `gpt-image-2` as the default, current image-generation model and documents both image generation and image editing endpoints. The image guide documents multiple reference inputs, automatic high-fidelity image processing for `gpt-image-2`, flexible `size`, and `low`/`medium`/`high` quality.

Sources:

- <https://developers.openai.com/api/docs/models/gpt-image-2>
- <https://developers.openai.com/api/docs/guides/image-generation>

`gpt-image-2` is therefore the preferred catalog model for new Avatar plans. `gpt-image-1` remains registered with `lifecycleStatus=DEPRECATED`, `replacementModelId=gpt-image-2`, and `selectable=false`. Existing immutable plans, attempts, artifacts, and provenance retain their exact recorded provider/model. The adapter still resolves an explicitly recorded historical `gpt-image-1` model; no record is rewritten or silently migrated.

## Capability and compilation contract

The existing `openai-media` adapter advertises these capabilities for `gpt-image-2`:

- `MULTI_VIEW_IDENTITY_REFERENCE`
- `CHARACTER_BODY_REFERENCE`
- `CHARACTER_EXPRESSION_REFERENCE`
- `MOUTH_SHAPE_REFERENCE`

All use one `images.edit` request per candidate with approved reference bytes, the canonical prompt/spec including Identity Lock constraints, and the requested size/quality. The adapter does not send `input_fidelity` for `gpt-image-2` because the official API applies high fidelity automatically.

Passport asks for one horizontal composite containing frontal, 45-degree, and 90-degree views. One candidate equals one visible external edit call. The provider does not guarantee correct three-panel geometry or cross-panel identity in every output; deterministic geometry checks, identity-continuity QA, and explicit human certification remain mandatory. Additional repair candidates always require a new plan, preflight, budget, and approval.

Body, expression, and mouth references compile through the same adapter. The first body smoke is exactly `CHEST_UP_NEUTRAL`; it does not trigger full-body, seated, expression, or mouth generation.

## Cost model

Version `openai-image-api-2026-09-01` records the official `gpt-image-2` rates:

- text input: USD 5 / 1M tokens;
- reference-image input: USD 8 / 1M tokens;
- image output: USD 30 / 1M tokens.

For the documented common sizes, the official calculator table supplies an output-only estimate. A high-quality `1536x1024` or `1024x1536` output is estimated at USD 0.165. Prompt and high-fidelity reference input tokens are not known before execution, so the plan status is `PARTIAL`, `knownTotalCost=null`, and `UNKNOWN` never becomes zero. A hard `MAXIMUM_ALLOWED_COST` is still required. When the provider response contains all token-usage components, the adapter records the exact known cost for that completed call.

## Zero-call readiness

With the local Dashboard API running, this command performs no provider call:

```bash
PAID_PROVIDER_CALLS=0 EXTERNAL_GENERATION_CALLS=0 node scripts/avatar-studio-smoke-readiness.js \
  --kind PASSPORT \
  --avatar-id ACTUAL_AVATAR_ID \
  --brand-id ACTUAL_BRAND_ID \
  --source-asset-id ACTUAL_SOURCE_ASSET_ID \
  --generation-spec-id ACTUAL_GENERATION_SPEC_ID \
  --execution-id ACTUAL_EXECUTION_ID
```

It prints only presence/status fields. It never prints `OPENAI_API_KEY`, authorization headers, `.env`, or asset bytes.

## SMOKE A — Passport (prepared, never run by V1.3.1)

Prerequisites: synthetic L0 avatar, one eligible JPG source with Gate 0 PASS, current Identity Lock, Dashboard API started deliberately with a real key and `LIVE_PAID_GENERATION=true`, and a human-chosen budget ceiling.

Exact command:

```bash
node scripts/avatar-studio-real-smoke.js \
  --kind PASSPORT \
  --avatar-id ACTUAL_L0_AVATAR_ID \
  --brand-id ACTUAL_BRAND_ID \
  --source-asset-id ACTUAL_SOURCE_ASSET_ID \
  --maximum-allowed-cost 1.00 \
  --confirm-one-paid-call YES \
  --acknowledge-partial-cost YES
```

The script creates a three-candidate immutable plan only because the Passport plan contract requires at least three planned candidates, but preflights and approves exactly one execution candidate. It prints the exact immutable proposal and requires the operator to type its fingerprint before approval. It then runs the zero-call readiness check and stops if any check fails. Only after that boundary can it invoke one generation call. It never certifies L1 automatically.

Maximum paid/external generation calls: **1**.

Cost information: official output-only estimate **USD 0.165** for high-quality `1536x1024`; text/reference input tokens and total cost remain unknown until response usage is returned; hard ceiling in the command is **USD 1.00**. This ceiling is an operator guard, not a provider quote.

After generation, manually inspect immutable artifact provenance, Gate 0, panel geometry, identity continuity, and automatic QA. Human KEEP and explicit Passport certification are separate actions. Only that certification creates L1.

## SMOKE B — Chest-up body (prepared, never run by V1.3.1)

Run only after SMOKE A succeeded, its candidate was human-certified, the avatar is currently L1, and a Body Build version exists for that exact Passport.

Exact command:

```bash
node scripts/avatar-studio-real-smoke.js \
  --kind BODY \
  --avatar-id ACTUAL_L1_AVATAR_ID \
  --brand-id ACTUAL_BRAND_ID \
  --maximum-allowed-cost 1.00 \
  --confirm-one-paid-call YES \
  --acknowledge-partial-cost YES
```

Maximum paid/external generation calls: **1**. The official output-only estimate is **USD 0.165** for high-quality `1024x1536`; input tokens and total remain unknown until execution. The result remains an L1 candidate until QA, guided human review, and explicit reference certification. It does not create or generate the rest of L2.

## Wardrobe boundary

V1.4 Wardrobe must not begin merely because both transport smokes succeeded. The exact prerequisite is a current immutable `L2_CERTIFICATION_EVENT` for the avatar's current Identity Version, Identity Lock, certified Passport, Body Build, three required body references, and three required expression references. Any changed dependency makes the prior L2 certification stale.
