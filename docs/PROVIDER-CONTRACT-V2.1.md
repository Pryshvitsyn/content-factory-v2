# V2.1 Provider Contract

## Purpose

The Content Factory core must not depend on one AI vendor's wire format. NVIDIA remains the first/default provider, while the core uses a provider-neutral contract.

## Selection model

```text
required capability
        ↓
eligible enabled providers
        ↓
provider priority
        ↓
explicit model policy
        ↓
selected provider + model
```

Lower numeric priority wins. NVIDIA is the initial preferred provider for supported text-generation capabilities.

A fallback is permitted only when another enabled provider supports the same capability and contract. Fallback must be deterministic and recorded in provenance.

## Provider capabilities

Capabilities are explicit, for example:

- text_generation
- structured_generation
- image_generation
- video_generation
- embedding

A model must advertise the capabilities it supports. The core must never infer capability from a model name alone.

## Normalized request

Provider adapters receive a vendor-neutral request containing:

- capability
- requested model or model policy
- system/context messages
- structured input
- generation parameters
- correlation ID
- production/stage identifiers

Provider-specific fields stay inside the adapter.

## Normalized response

Adapters return:

- provider
- model
- provider request ID when available
- normalized output
- usage/token metadata when available
- finish status
- safe provider metadata
- retryability/error classification

The response becomes part of the provenance for the resulting immutable artifact version.

## Error classes

Use a normalized taxonomy:

- `invalid_request` — non-retryable
- `authentication` — configuration problem
- `rate_limited` — retryable with backoff
- `timeout` — retryable
- `transient_provider` — retryable
- `unavailable` — fallback eligible when policy permits
- `content_policy` — non-retryable until input/policy changes
- `malformed_response` — limited retry, then provider health issue

## NVIDIA

NVIDIA remains the first provider. Its OpenAI-compatible transport is an implementation detail of the NVIDIA adapter. Core pipeline code must not depend on NVIDIA-specific request parameters.

The existing NVIDIA model configuration remains the source for the first supported implementation; this document does not change the worker execution path.

## Provenance

For every generated artifact version, record at minimum:

- provider
- model
- capability
- provider request ID when available
- generation timestamp
- normalized request fingerprint where safe
- usage when available
- fallback information when a fallback occurred

## Guardrail

This contract is design/documentation only. It intentionally does not modify the certified worker execution functions, PostgreSQL claim/lease/recovery functions, or existing execution tests.
