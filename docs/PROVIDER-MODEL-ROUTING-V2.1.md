# V2.1 Provider / Model Routing

## Design rule

The Factory separates three concerns:

```text
capability → provider → model
```

A credential belongs to a provider account/deployment. A model is configuration selected for a capability. The core pipeline never stores a credential per model.

## NVIDIA today

NVIDIA is the first enabled provider. Its current catalog includes text, image generation, image editing, and video generation entries. NVIDIA documents OpenAI-compatible image generation at `/v1/images/generations`, image editing at `/v1/images/edits`, and video generation at `/v1/videos/generations`. The exact model identifiers and endpoint capabilities remain adapter-owned.

Current catalog defaults:

- text: `nvidia/nemotron-3-super-120b-a12b`
- image: `black-forest-labs/flux.2-klein-4b`
- image editing: `black-forest-labs/flux.2-klein-4b`
- video: `wan-ai/wan2.2`

The model catalog is deliberately data-driven. Adding another NVIDIA model does not require a new credential or a new pipeline stage.

## Future providers

A future provider is added by registering its capabilities and models behind its adapter. For example:

```text
OpenAI
 ├── image_generation → model A, model B
 └── video_generation → model C

Provider X
 └── video_generation → model D
```

The Asset Orchestrator asks for a capability and requirements; provider/model selection is resolved separately. This allows a stronger future video provider to replace NVIDIA without rewriting planning, assets, timeline assembly, or rendering.

## Credential rule

Do not create `MODEL_API_KEY` values such as `FLUX_API_KEY` or `QWEN_API_KEY` when the provider API uses one provider credential.

Use provider-scoped credentials instead:

```text
NVIDIA_API_KEY
OPENAI_API_KEY
PROVIDER_X_API_KEY
```

Self-hosted NIM may additionally require infrastructure credentials such as `NGC_API_KEY` for obtaining NIM/model artifacts. That is deployment infrastructure, not a per-model application credential.

## No fake success

A provider failure must never be converted into a placeholder and marked as a production asset. If no eligible provider/model can produce a real artifact, the generation stage fails explicitly and records the reason.

## Routing policy

Provider selection may later consider:

- capability support
- model quality
- quality tier
- latency
- cost
- availability
- provider priority
- explicit user/project preference

The selected provider and model must be written into artifact provenance.
