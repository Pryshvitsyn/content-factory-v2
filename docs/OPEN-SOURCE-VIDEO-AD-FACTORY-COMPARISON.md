# Open-Source Video Ad Factory Comparison

Reviewed 2026-10-22. This is a targeted comparison of public projects that produce social video ads or video content. It is not an exhaustive census of GitHub. A feature listed for another project reflects its public README, not an independently verified live run.

## Projects reviewed

| Project | What it is good at | Relevant documented features | What it does not establish |
| --- | --- | --- | --- |
| [AdForge](https://github.com/HamzaSbay/AdForge) | Fast local ad assembly from supplied footage or stock | Gemini clip analysis, script and timeline, multi-engine TTS, music/SFX, ducked audio, animated captions/lower thirds/CTA, Remotion compositing, 9:16/16:9/1:1 | The README alone does not establish production durability, immutable provenance, tenant isolation, or a live provider account. |
| [advideo-creator](https://github.com/UrNas/advideo-creator) | Script-first social-ad authoring and platform exports | Marketing-scored script templates, voice and stock asset stages, asset quality gates, captions/audio mix, brand profiles, A/B variants, TikTok/Instagram/YouTube export targets | Export targets are not the same as authenticated upload, scheduling, or post-publication analytics. |
| [albertnahas/content-factory](https://github.com/albertnahas/content-factory) | Claude Code workflows and reusable creative recipes | Slash commands, skills/agents, YAML brand setup, media services, UGC/product ad templates, Replicate/OpenAI/ElevenLabs integrations, cost tracking | It is a small plugin repository; its README does not establish a durable production service or verified provider execution. |
| [Eluvio Content Fabric](https://docs.eluv.io/) | Media storage, packaging, streaming and distribution | Video management, transcoding/packaging, access and rights controls, distribution and analytics | This is a media distribution platform, not the similarly named open-source AI advertising-generation repository. |

## Our repository: evidence in code

The current repository has a durable operator workflow: workspace/brand-scoped drafts, authoritative provider-catalog resolution, zero-call preflight, a canonical V2.6 production input, V2.7 production orchestration, immutable media artifacts, provenance, recovery/reconciliation paths, FFmpeg master rendering, post-render validation, and explicit human-review/publish boundaries. The V2.10 operator brief includes the creative plan and validates specific storyboard requirements. Video providers remain capability- and credential-dependent; passing mocked tests does not prove a paid provider run.

The V2.10 Creative Production flow now carries `9:16` or `16:9` from the operator brief through provider capability resolution, shot-generation requirements, canonical production input, the master profile (`1080x1920` or `1920x1080`), and post-render validation. Existing drafts with no aspect ratio default to `9:16`. The portrait-only locked-opening-keyframe pilot is disabled in landscape mode. The older QUALITY workflow already has its own 9:16 and 16:9 master profiles.

The pipeline explicitly asks generators to avoid generated text, watermarks, logos, and split-screen in source imagery. Brand-specific marks or product packaging can still be added deliberately during review/editing; no model can guarantee perfect visual output from a prompt alone.

## Gap map

| Capability | Current state in this repository | Next practical step |
| --- | --- | --- |
| Vertical and landscape MP4 master | Implemented and covered by contract/render tests | Inspect one real provider output in each ratio during a cost-approved pilot. |
| Provider choice | Catalog-backed, per-workspace selection and explicit capability checks | Verify chosen provider/model credentials and supported ratios at runtime before a live job. |
| Clean source frames | Prompt guidance and technical/visual validation exist | Add/record operator review for unwanted marks, malformed text, faces, and product accuracy on every deliverable. |
| Narration and audio | Voice route, approved-copy boundary, audio assembly and validation exist | Human-listen for intelligibility, clipping, loudness, timing, and naturalness. |
| Captions, music, SFX and CTA overlays | Some post-production capabilities exist; this is not yet a polished template library comparable to AdForge's documented Remotion UI | Build reusable, brand-safe ad templates and platform-safe caption/CTA presets after the first pilot. |
| Creative scoring and A/B variants | Not established as an end-to-end operator feature | Add script scoring and a batch variant workflow with explicit review and cost caps. |
| Platform adaptation | MP4 export and manual upload are supported; direct TikTok/YouTube channel connection is not implemented | Add authenticated channel integrations only after rights, account scopes, retry behavior, and approval UX are designed. |
| Publishing | Human approval boundary is explicit; automatic/direct publishing is disabled | Treat upload/scheduling as a separately approved integration, not as part of video generation readiness. |

## Acceptance evidence for the first real ad

Do not label the factory fully operational until a real run records all of the following: chosen provider and model; supported ratio and resolution; cost estimate and call ceiling; source asset rights; playable render; correct duration, codec, dimensions, and audio; no unwanted marks/logos or generated text; human review of creative and spoken claims; final MP4 checksum and provenance; and a documented manual upload check on the intended platform. Live-provider execution is intentionally not part of the automated/mock test suite.

