'use strict';

const crypto = require('node:crypto');
const { ArtifactService } = require('../artifacts/artifact-service');
const { createOpenAIMediaProvider } = require('../providers/openai-media-provider');
const { createElevenLabsTtsProvider } = require('../providers/elevenlabs-tts-provider');
const { buildProductionInput, stableFingerprint } = require('../v2.5/production-input');
const { assertPaidCredentials, resolveV25Configuration } = require('../v2.5/configuration');
const { PostgresMediaExecutionRepository } = require('../v2.5/durable-media-executor');
const { FfprobeMediaInspector } = require('../v2.5/media-validator');
const { createProductionRuntime } = require('../v2.7/production-runtime');
const { qualityProfileFromSelection } = require('../v2.7/quality-video-profile');
const { CAPABILITIES } = require('../v2.8/capabilities');
const { getVideoModelContract, fingerprint: modelFingerprint, INPUT_MODES } = require('../v2.8/video-model-contracts');
const { canonicalFingerprint } = require('../../worker/v2.1-master-production');
const { canonicalCreativeBrief, buildShotPrompt } = require('./creative-contract');

const CANONICAL_OBJECTIVES = Object.freeze(new Set([
  'ORGANIC_REACH','ENGAGEMENT','TRAFFIC','LEAD_GENERATION','APP_INSTALL','PURCHASE','BOOKING',
  'SEO_AUTHORITY','RETENTION','EXPERIMENT',
]));

class V210RuntimeError extends Error {
  constructor(code, message, { boundaryState = 'NOT_CROSSED', details = null, productionId = null } = {}) {
    super(message);
    this.name = 'V210RuntimeError';
    this.code = code;
    this.status = 409;
    this.boundaryState = boundaryState;
    this.details = details;
    this.productionId = productionId;
  }
}

function canonicalObjective(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return CANONICAL_OBJECTIVES.has(normalized) ? normalized : 'EXPERIMENT';
}

function normalizeVoiceProvider(provider) {
  const value = String(provider || '').toLowerCase();
  if (value === 'openai-media') return 'openai';
  return value;
}

function requestedVideoSelection(input = {}) {
  const contract = getVideoModelContract(input.provider, input.model);
  const supplied = input.modelRequest || Object.fromEntries(['resolvedInputMode','durationSeconds','resolution','aspectRatio',
    'generateAudio','watermark','outputFormat','seed'].filter((key) => Object.hasOwn(input, key)).map((key) => [key,input[key]]));
  let modelRequest = {};
  const continuityBindings=Object.freeze((input.continuityBindings||[]).map((binding)=>Object.freeze({
    shotId:String(binding.shotId||''),entityId:String(binding.entityId||''),packId:String(binding.packId||''),
    packFingerprint:String(binding.packFingerprint||''),role:binding.role?String(binding.role):null,
  })));
  if(continuityBindings.some((binding)=>!binding.shotId||!binding.entityId||!binding.packId||!binding.packFingerprint)){
    throw new V210RuntimeError('CONTINUITY_BINDING_INVALID','Continuity bindings require shotId, entityId, packId and packFingerprint');
  }
  if (contract) {
    const allowed = new Set(['resolvedInputMode','durationSeconds','resolution','aspectRatio','generateAudio','watermark','outputFormat','seed']);
    const unknown = Object.keys(supplied).filter((key) => !allowed.has(key));
    if (unknown.length) throw new V210RuntimeError('UNSUPPORTED_MODEL_PARAMETER', `Unsupported model request parameter(s): ${unknown.join(', ')}`);
    modelRequest = Object.freeze({
      resolvedInputMode: supplied.resolvedInputMode || INPUT_MODES.TEXT_TO_VIDEO,
      durationSeconds: supplied.durationSeconds ?? contract.parameters.duration.contentFactoryDefault,
      resolution: supplied.resolution || contract.parameters.resolution.contentFactoryDefault,
      aspectRatio: supplied.aspectRatio || contract.parameters.aspectRatio.contentFactoryDefault,
      generateAudio: supplied.generateAudio ?? contract.parameters.generateAudio.contentFactoryDefault,
      watermark: supplied.watermark ?? contract.parameters.watermark.contentFactoryDefault,
      outputFormat: supplied.outputFormat || contract.parameters.outputFormat.contentFactoryDefault,
      ...(supplied.seed == null ? {} : { seed: supplied.seed }),
    });
  }
  return Object.freeze({
    provider: String(input.provider || '').toLowerCase(),
    model: String(input.model || ''),
    profile: String(input.profile || '').toUpperCase(),
    resolution: input.resolution || null,
    allowExperimental: input.allowExperimental === true,
    modelRequest,
    continuityBindings,
  });
}

function requiredCapability(shot, capabilities = []) {
  if (shot.referencePolicy === 'NONE') return CAPABILITIES.TEXT_TO_VIDEO;
  if (capabilities.includes(CAPABILITIES.IMAGE_TO_VIDEO)) return CAPABILITIES.IMAGE_TO_VIDEO;
  if (capabilities.includes(CAPABILITIES.REFERENCE_TO_VIDEO)) return CAPABILITIES.REFERENCE_TO_VIDEO;
  return CAPABILITIES.IMAGE_TO_VIDEO;
}

async function resolveAuthoritativeVideo({ catalog, workspaceId, brandId, request, brief: input, continuityAuthority = null } = {}) {
  if (!catalog) throw new V210RuntimeError('V210_PROVIDER_CATALOG_REQUIRED', 'Authoritative Provider Catalog is required');
  const brief = canonicalCreativeBrief(input);
  const requested = requestedVideoSelection(request);
  const bindingShotIds=new Set(requested.continuityBindings.map((binding)=>binding.shotId));
  if (!requested.provider || !requested.model || !requested.profile) {
    throw new V210RuntimeError('VIDEO_SELECTION_INCOMPLETE', 'Explicit provider, model, and profile are required');
  }
  const scoped = await catalog.forWorkspace(workspaceId);
  let base = null;
  const shotCapabilities = [];
  for (const shot of brief.storyboard) {
    if (shot.referencePolicy === 'UPLOADED_REFERENCE'
      && (!shot.referenceMedia?.artifactId || !shot.referenceMedia?.storageKey || !shot.referenceMedia?.contentHash)) {
      throw new V210RuntimeError('REFERENCE_EVIDENCE_MISSING',
        `Shot ${shot.shotId} requires immutable uploaded reference artifactId, storageKey and contentHash`);
    }
    const advertised = scoped.listModels(requested.provider).find((item) => item.modelId === requested.model)?.capabilities || [];
    const capability = requiredCapability(bindingShotIds.has(shot.shotId)?{...shot,referencePolicy:'DURABLE_CONTINUITY_PACK'}:shot, advertised);
    const resolved = scoped.resolveSelection({ provider: requested.provider, model: requested.model,
      profile: requested.profile, capability, durationSeconds: shot.durationSeconds,
      resolution: requested.resolution, aspectRatio: '9:16', allowExperimental: requested.allowExperimental });
    if (!base) base = resolved;
    if (base.provider !== resolved.provider || base.model !== resolved.model || base.profile !== resolved.profile) {
      throw new V210RuntimeError('V210_PROVIDER_RESOLUTION_CONFLICT',
        'All storyboard shots must resolve to one authoritative provider/model/profile selection');
    }
    shotCapabilities.push(Object.freeze({ shotId: shot.shotId, capability: resolved.capability }));
  }
  const contract = getVideoModelContract(requested.provider, requested.model);
  const shotModelRequests = brief.storyboard.map((shot) => {
    if (!contract) return Object.freeze({ shotId: shot.shotId, modelContractVersion: null, modelSchemaVersion: null,
      resolvedInputMode: null, modelRequest: Object.freeze({}) });
    let resolvedInputMode = requested.modelRequest.resolvedInputMode;
    if (shot.referencePolicy === 'NONE' && !bindingShotIds.has(shot.shotId)) resolvedInputMode = INPUT_MODES.TEXT_TO_VIDEO;
    else if (resolvedInputMode === INPUT_MODES.TEXT_TO_VIDEO) resolvedInputMode = INPUT_MODES.FIRST_FRAME_IMAGE_TO_VIDEO;
    if (shot.referencePolicy !== 'NONE' && resolvedInputMode === INPUT_MODES.FIRST_LAST_FRAME) {
      throw new V210RuntimeError('MODEL_INPUT_MODE_REFERENCE_MISMATCH','V2.10 single-reference shots cannot satisfy FIRST_LAST_FRAME');
    }
    const referenceType=String(shot.referenceMedia?.contentType||shot.referenceMedia?.content_type||'image/');
    if (shot.referencePolicy !== 'NONE' && [INPUT_MODES.FIRST_FRAME_IMAGE_TO_VIDEO].includes(resolvedInputMode) && !referenceType.startsWith('image/')) {
      throw new V210RuntimeError('MODEL_INPUT_MODE_REFERENCE_MISMATCH','First-frame mode requires an image reference');
    }
    if (shot.referencePolicy !== 'NONE' && [INPUT_MODES.VIDEO_EDITING,INPUT_MODES.VIDEO_EXTENSION].includes(resolvedInputMode) && !referenceType.startsWith('video/')) {
      throw new V210RuntimeError('MODEL_INPUT_MODE_REFERENCE_MISMATCH',`${resolvedInputMode} requires a video reference`);
    }
    const adaptive = [INPUT_MODES.FIRST_LAST_FRAME,INPUT_MODES.VIDEO_EDITING,INPUT_MODES.VIDEO_EXTENSION].includes(resolvedInputMode);
    const modelRequest = Object.freeze({ ...requested.modelRequest, resolvedInputMode,
      durationSeconds: resolvedInputMode === INPUT_MODES.VIDEO_EDITING || resolvedInputMode === INPUT_MODES.VIDEO_EXTENSION
        ? -1 : shot.durationSeconds, aspectRatio: adaptive ? 'adaptive' : requested.modelRequest.aspectRatio });
    return Object.freeze({ shotId: shot.shotId, modelContractVersion: contract.contractVersion,
      modelSchemaVersion: contract.provenance.providerSchemaVersion, resolvedInputMode, modelRequest,
      requestPolicyFingerprint: modelFingerprint({ provider: requested.provider, model: requested.model, shotId: shot.shotId,
        prompt: buildShotPrompt(brief, shot), referenceMedia: shot.referenceMedia || null, modelRequest }) });
  });
  const resolvedContinuityBindings=[];const continuityBlockers=[];
  for(const binding of requested.continuityBindings){
    try{
      if(!continuityAuthority?.resolve)throw new V210RuntimeError('CONTINUITY_AUTHORITY_REQUIRED','Durable continuity authority is not configured');
      const resolved=await continuityAuthority.resolve({workspaceId,consumerBrandId:brandId,packId:binding.packId,fingerprint:binding.packFingerprint});
      if(resolved.pack.entityId!==binding.entityId)throw new V210RuntimeError('CONTINUITY_ENTITY_MISMATCH','Continuity pack entity does not match binding');
      const contractLimits=contract?.limits||{};const counts={REFERENCE_IMAGE:0,REFERENCE_VIDEO:0,REFERENCE_AUDIO:0};
      for(const reference of resolved.references)if(Object.hasOwn(counts,reference.role))counts[reference.role]++;
      if(counts.REFERENCE_IMAGE>Number(contractLimits.referenceImages??Infinity)||counts.REFERENCE_VIDEO>Number(contractLimits.referenceVideos??Infinity)||counts.REFERENCE_AUDIO>Number(contractLimits.referenceAudios??Infinity))throw new V210RuntimeError('CONTINUITY_REFERENCE_LIMIT_EXCEEDED','Continuity pack exceeds selected model limits');
      resolvedContinuityBindings.push(Object.freeze({...binding,ownerBrandId:resolved.row.owner_brand_id,
        packRevision:resolved.pack.revision,entityType:resolved.pack.entityType,authorityBinding:resolved.pack.authorityBinding,
        references:resolved.references.map((reference)=>Object.freeze({...reference}))}));
    }catch(error){continuityBlockers.push(Object.freeze({code:error.code||'CONTINUITY_AUTHORITY_INVALID',shotId:binding.shotId,message:error.message}));}
  }
  return Object.freeze({ ...base, shotCapabilities: Object.freeze(shotCapabilities), requested,
    modelContractVersion: contract?.contractVersion || null, modelSchemaVersion: contract?.provenance.providerSchemaVersion || null,
    modelPricing: contract?.pricing || null,
    shotModelRequests: Object.freeze(shotModelRequests),resolvedContinuityBindings:Object.freeze(resolvedContinuityBindings),
    continuityAuthorityStatus:continuityBlockers.length?'BLOCKED':'READY',continuityAuthorityBlockers:Object.freeze(continuityBlockers) });
}

async function resolveAuthoritativeVoice({ catalog, workspaceId, brief: input, repository = null } = {}) {
  const brief = canonicalCreativeBrief(input);
  const voice = brief.voice;
  if (!voice.sourceType) return Object.freeze({ status: 'READY', sourceType: null, externalCalls: 0 });
  if (!voice.approved) return Object.freeze({ status: 'BLOCKED', code: 'VOICE_NOT_APPROVED', sourceType: voice.sourceType });
  if (voice.sourceType === 'UPLOADED_AUDIO') {
    if (!repository || !voice.uploadedArtifactId) return Object.freeze({ status: 'BLOCKED', code: 'VOICE_UPLOAD_REQUIRED', sourceType: voice.sourceType });
    const artifact = await repository.getUploadedVoice({ id: voice.uploadedArtifactId, workspaceId, brandId: input.brandId || null }).catch(() => null);
    return Object.freeze({ status: artifact ? 'READY' : 'BLOCKED', code: artifact ? null : 'VOICE_UPLOAD_REQUIRED',
      sourceType: voice.sourceType, provider: 'operator-upload', model: 'uploaded-audio', voiceId: 'uploaded-human', externalCalls: 0 });
  }
  if (!catalog || !voice.provider || !voice.model || !voice.voiceId) {
    return Object.freeze({ status: 'BLOCKED', code: 'VOICE_SELECTION_INCOMPLETE', sourceType: voice.sourceType });
  }
  const scoped = await catalog.forWorkspace(workspaceId);
  const provider = normalizeVoiceProvider(voice.provider);
  const resolved = scoped.resolveSelection({ provider, model: voice.model, profile: 'STANDARD', capability: CAPABILITIES.SPEECH });
  return Object.freeze({ status: 'READY', sourceType: voice.sourceType, provider: resolved.provider,
    providerDisplayName: resolved.providerDisplayName, model: resolved.model, providerModelId: resolved.providerModelId,
    configurationStatus: resolved.configurationStatus, availability: resolved.availability,
    voiceId: voice.voiceId, language: voice.language, externalCalls: 1 });
}

function createVoicePreviewGateway({ env = process.env } = {}) {
  return Object.freeze({
    async generatePreview({ voice, text, idempotencyKey }) {
      const provider = normalizeVoiceProvider(voice.provider);
      let adapter;
      if (provider === 'openai') {
        if (!env.OPENAI_API_KEY) throw new V210RuntimeError('VOICE_PREVIEW_PROVIDER_NOT_CONFIGURED', 'OpenAI voice preview is not configured');
        adapter = createOpenAIMediaProvider({ apiKey: env.OPENAI_API_KEY, speechModel: voice.model });
      } else if (provider === 'elevenlabs') {
        if (!env.ELEVENLABS_API_KEY) throw new V210RuntimeError('VOICE_PREVIEW_PROVIDER_NOT_CONFIGURED', 'ElevenLabs voice preview is not configured');
        adapter = createElevenLabsTtsProvider({ apiKey: env.ELEVENLABS_API_KEY, model: voice.model });
      } else {
        throw new V210RuntimeError('VOICE_PREVIEW_PROVIDER_UNSUPPORTED', `Voice preview provider '${voice.provider}' is unsupported`);
      }
      const response = await adapter.generate({ capability: 'speech-generation', model: voice.model,
        idempotencyKey, prompt: JSON.stringify({ description: text, generation_requirements: {
          text, voice: voice.voiceId, voice_id: voice.voiceId, language: voice.language,
          instructions: voice.instructions,
        } }) });
      return Object.freeze({ bytes: response.output, contentType: response.contentType || 'audio/mpeg',
        requestId: response.requestId || null, provenance: response.provenance || {}, usage: response.usage || null });
    },
  });
}

function sceneCopy(brief) {
  const explicit = brief.storyboard.map((shot) => shot.voiceoverSegment || shot.dialogue || '');
  if (explicit.some(Boolean)) return explicit;
  return brief.storyboard.map((shot, index) => {
    if (brief.storyboard.length === 1) return [brief.hook, brief.coreMessage, brief.cta].filter(Boolean).join(' ');
    if (index === 0) return [brief.hook, brief.coreMessage].filter(Boolean).join(' ');
    if (index === brief.storyboard.length - 1) return brief.cta;
    return '';
  });
}

function canonicalRequestForDraft(draft, brief, video) {
  return Object.freeze({ requestId: draft.id, brandId: draft.brand_id || draft.brandId, title: brief.title,
    objective: canonicalObjective(brief.objective), creativeObjective: brief.objective,
    platform: brief.targetPlatform, targetDurationSeconds: brief.targetDurationSeconds,
    aspectRatio: '9:16', renderMode: 'QUALITY', provider: video.provider, model: video.model,
    modelFamily: video.modelFamily || null, profile: video.profile, hook: brief.hook,
    coreMessage: brief.coreMessage, creativeBrief: brief.creativeConcept, cta: brief.cta,
    voiceover: sceneCopy(brief).filter(Boolean).join(' '), visualDirection: brief.visualStyle,
    audience: brief.audienceIntent, publicationPolicy: { requiresHumanApproval: true, autoPublish: false } });
}

function buildCanonicalV210Input({ draft, preflight } = {}) {
  const brief = canonicalCreativeBrief(draft.creative_brief || draft.creativeBrief);
  const video = preflight.authoritativeVideo;
  if (!video?.provider || !video.model || !video.profile) {
    throw new V210RuntimeError('V210_AUTHORITATIVE_PREFLIGHT_REQUIRED', 'Authoritative V2.10 provider resolution is required');
  }
  const qualityProfile = qualityProfileFromSelection(video);
  const capabilities = new Map((video.shotCapabilities || []).map((item) => [item.shotId, item.capability]));
  const shotModelRequests = new Map((video.shotModelRequests || []).map((item) => [item.shotId, item]));
  const continuityBindings = new Map((video.resolvedContinuityBindings || []).map((item) => [item.shotId,item]));
  const copy = sceneCopy(brief);
  const approvedSpokenCopy = copy.filter(Boolean).join(' ').trim();
  const voiceEnabled = Boolean(brief.voice.sourceType && approvedSpokenCopy);
  const uploaded = brief.voice.sourceType === 'UPLOADED_AUDIO';
  const voiceCatalogProvider = uploaded ? 'operator-upload' : normalizeVoiceProvider(brief.voice.provider);
  const voiceExecutionProvider = uploaded ? 'operator-upload' : voiceCatalogProvider === 'openai' ? 'openai-media' : voiceCatalogProvider;
  const voiceModel = uploaded ? 'uploaded-audio' : brief.voice.model;
  const voiceId = uploaded ? 'uploaded-human' : brief.voice.voiceId;
  const scenes = brief.storyboard.map((shot, index) => {
    const fps = qualityProfile.framesPerSecond || 24;
    const numFrames = Math.max(2, Math.round(shot.durationSeconds * fps) + 1);
    const capability = capabilities.get(shot.shotId) || CAPABILITIES.TEXT_TO_VIDEO;
    const contractRequest = shotModelRequests.get(shot.shotId) || null;
    const continuityBinding=continuityBindings.get(shot.shotId)||null;
    return {
      scene_id: `v210-scene-${index + 1}`, duration_seconds: shot.durationSeconds,
      location: shot.environment, visual: `${shot.purpose}. ${shot.action}`, emotional_intent: shot.emotionalIntent,
      dialogue_or_voiceover: copy[index] || '', shots: [{ shot_id: shot.shotId, asset_id: shot.assetId,
        duration_seconds: shot.durationSeconds, framing: shot.framing, camera: shot.camera,
        subject: shot.subject, action: shot.action, continuity: shot.continuity,
        video: { provider: video.provider, vendor: video.vendor || null, model: video.model,
          model_family: video.modelFamily || null, provider_model_id: video.providerModelId || video.model,
          model_version: video.modelVersion || null, profile: video.profile, capability,
          resolved_settings: { ...(video.resolvedSettings || {}), ...(contractRequest?.modelRequest || {}), duration: shot.durationSeconds },
          prompt: buildShotPrompt(brief, shot), resolution: contractRequest?.modelRequest.resolution || video.resolvedSettings?.resolution || qualityProfile.resolution,
          aspect_ratio: contractRequest?.modelRequest.aspectRatio || '9:16', num_frames: numFrames, frames_per_second: fps,
          go_fast: qualityProfile.goFast === true, optimize_prompt: qualityProfile.optimizePrompt,
          interpolate_output: qualityProfile.interpolateOutput, sample_shift: qualityProfile.sampleShift,
          ...(contractRequest ? { resolved_input_mode: contractRequest.resolvedInputMode,
            duration: contractRequest.modelRequest.durationSeconds, generate_audio: contractRequest.modelRequest.generateAudio,
            watermark: contractRequest.modelRequest.watermark, output_format: contractRequest.modelRequest.outputFormat,
            seed: contractRequest.modelRequest.seed ?? null, model_parameters: {},
            model_contract_version: contractRequest.modelContractVersion, model_schema_version: contractRequest.modelSchemaVersion,
            request_policy_fingerprint: contractRequest.requestPolicyFingerprint } : {}) },
      }],
    };
  });
  const creativePlan = { schemaVersion: 2, planner: 'v2.10-operator-storyboard', operatorBriefAuthoritative: true,
    creativeObjective: brief.objective,
    shots: brief.storyboard.map((shot) => ({ shotId: shot.shotId, assetId: shot.assetId, roles: shot.roles,
      durationSeconds: shot.durationSeconds, purpose: shot.purpose, subject: shot.subject, action: shot.action,
      environment: shot.environment, emotionalIntent: shot.emotionalIntent, framing: shot.framing,
      camera: shot.camera, lensComposition: shot.lensComposition, lighting: shot.lighting,
      continuity: shot.continuity, generationPrompt: buildShotPrompt(brief, shot), negativeGuidance: shot.negativeGuidance,
      referencePolicy: shot.referencePolicy, referenceMedia: shot.referenceMedia || null })),
    continuity: brief.continuity };
  const mediaStack = { schemaVersion: '2.9.2', preset: 'CUSTOM', resolutionOrder: ['operator','brand','preset'],
    video, audio: { strategy: voiceEnabled ? 'EXTERNAL_VOICE' : 'NO_VOICE', generateNativeAudio: false,
      generateExternalVoice: voiceEnabled, dialogueOwner: voiceEnabled ? 'EXTERNAL_VOICE' : 'NONE',
      preventDuplicateNarration: true, voice: voiceEnabled ? { provider: voiceCatalogProvider,
        model: voiceModel, voiceId, language: brief.voice.language || 'en' } : null },
    semanticCritic: preflight.quality?.semanticCriticResolved || null,
    master: { profile: 'SOCIAL_VERTICAL', container: 'mp4', codec: 'h264', width: 1080, height: 1920,
      framesPerSecond: 30, aspectRatio: '9:16', audioCodec: 'aac' } };
  const raw = { schema_version: '2.6', render_mode: 'QUALITY', brand_id: draft.brand_id || draft.brandId,
    production_key: `v210-${draft.id}`, title: brief.title, objective: canonicalObjective(brief.objective),
    target_platform: brief.targetPlatform, target_duration_seconds: brief.targetDurationSeconds, aspect_ratio: '9:16',
    hook: brief.hook, core_message: brief.coreMessage,
    approved_spoken_copy: approvedSpokenCopy || [brief.hook, brief.coreMessage, brief.cta].filter(Boolean).join(' '),
    spoken_copy_policy: { contract_version: 'v2.8.1', source: 'v2.10-approved-storyboard', strict_approved_copy: true },
    creative_concept: brief.creativeConcept, cta: brief.cta, creative_plan: creativePlan,
    quality_video_profile: { ...qualityProfile, capabilities: video.capabilities, capabilityMetadata: video.capabilityMetadata,
      resolvedSettings: video.resolvedSettings }, media_stack: mediaStack,
    provider_selection: { provider: video.provider, vendor: video.vendor || null, model: video.model,
      model_version: video.modelVersion || null, profile: video.profile, capability: video.capability,
      resolved_settings: video.resolvedSettings || {}, model_request: video.requested?.modelRequest || {},
      model_contract_version: video.modelContractVersion || null, model_schema_version: video.modelSchemaVersion || null }, scenes,
    voiceover: { enabled: voiceEnabled, asset_id: 'voiceover-main', provider: voiceExecutionProvider,
      model: voiceModel || 'none', voice: voiceId || 'none', voice_id: voiceId || 'none',
      language: brief.voice.language || 'en', instructions: brief.voice.instructions || null,
      text: approvedSpokenCopy || [brief.hook, brief.coreMessage, brief.cta].filter(Boolean).join(' ') },
    continuity: { characters: [brief.continuity.identity, brief.continuity.appearance].filter(Boolean),
      locations: [brief.continuity.environment].filter(Boolean), products: [], wardrobe: [brief.continuity.wardrobe].filter(Boolean),
      props: [brief.continuity.props].filter(Boolean), visual_style: brief.visualStyle,
      character_rules: `Preserve identity and appearance: ${brief.continuity.identity}; ${brief.continuity.appearance}. Wardrobe: ${brief.continuity.wardrobe}.`,
      location_rules: `Preserve environment, props, lighting and camera language: ${brief.continuity.environment}; ${brief.continuity.props}; ${brief.continuity.lightingColorLanguage}; ${brief.continuity.cameraLanguage}.` },
    visual_style: { avoid: ['generated text','watermarks','logos','split-screen'], direction: brief.visualStyle },
    audio: { strategy: voiceEnabled ? 'EXTERNAL_VOICE' : 'NO_VOICE', dialogue_owner: voiceEnabled ? 'EXTERNAL_VOICE' : 'NONE',
      prevent_duplicate_narration: true, ambience_intent: 'Subtle natural ambience below speech.', music_intent: 'No generated music.', speech_priority: true },
    captions: { enabled: false, intent: 'Approved typography is added only in post-production.', end_title: null },
    publication_policy: { requires_human_approval: true, auto_publish: false, destination: 'disabled' } };
  const base = buildProductionInput(raw);
  const refs = new Map(brief.storyboard.map((shot, index) => [shot.assetId, { shot, index }]));
  const assetPlan = Object.freeze({ ...base.assetPlan, assets: Object.freeze(base.assetPlan.assets.map((asset) => {
    if (asset.kind !== 'video') return asset;
    const ref = refs.get(asset.asset_id);
    if (!ref || ref.shot.referencePolicy === 'NONE') return asset;
    const v210Reference = ref.shot.referencePolicy === 'PREVIOUS_SHOT_FRAME'
      ? { policy: 'PREVIOUS_SHOT_FRAME', previousAssetId: brief.storyboard[ref.index - 1]?.assetId || null }
      : { policy: 'UPLOADED_REFERENCE', artifact: ref.shot.referenceMedia,
        resolvedInputMode: asset.generation_requirements.resolved_input_mode || null };
    return Object.freeze({ ...asset, generation_requirements: Object.freeze({ ...asset.generation_requirements,
      v210_reference: Object.freeze(v210Reference) }) });
  })) });
  const continuityAssetPlan=Object.freeze({...assetPlan,assets:Object.freeze(assetPlan.assets.map((asset)=>{
    if(asset.kind!=='video')return asset;const shotId=asset.required_for_shots?.[0];const binding=continuityBindings.get(shotId);
    const sourceShot=brief.storyboard.find((shot)=>shot.shotId===shotId);const contractDriven=Boolean(asset.generation_requirements.model_contract_version);
    const requirements={...asset.generation_requirements,...(contractDriven&&sourceShot?{prompt:buildShotPrompt(brief,sourceShot)}:{}),
      ...(binding?{v210_continuity_binding:Object.freeze(binding)}:{})};
    return Object.freeze({...asset,generation_requirements:Object.freeze(requirements)});
  }))});
  const normalized = { ...base, assetPlan:continuityAssetPlan, productionNamespace: 'v2.7-operator', postProduction: brief.postProduction };
  delete normalized.fingerprint;
  const input = Object.freeze({ ...normalized, fingerprint: stableFingerprint(normalized) });
  return Object.freeze({ raw: Object.freeze(raw), input, canonicalRequest: canonicalRequestForDraft(draft, brief, video) });
}

function runtimeEnvironment(env, input, live) {
  const audioProvider = input.mediaStack?.audio?.voice?.provider === 'operator-upload' ? 'operator-upload'
    : input.mediaStack?.audio?.voice?.provider === 'elevenlabs' ? 'elevenlabs'
      : input.voiceover?.enabled ? 'openai-media' : 'none';
  return { ...env, LIVE_PAID_GENERATION: live ? 'true' : 'false', REAL_PRODUCTION_INPUT: 'dashboard://v2.10',
    RENDER_MODE: 'QUALITY', VIDEO_PROVIDER: input.qualityVideoProfile.provider, AUDIO_PROVIDER: audioProvider,
    QUALITY_VIDEO_PROVIDER: input.qualityVideoProfile.provider, QUALITY_VIDEO_MODEL: input.qualityVideoProfile.model,
    QUALITY_VIDEO_PROFILE: input.qualityVideoProfile.name, LIVE_PRODUCTION_WORKER_ID: env.LIVE_PRODUCTION_WORKER_ID || `v2.10:${process.pid}` };
}

class V210CanonicalProductionStarter {
  constructor({ db, storage, repository, env = process.env, logger = console, scheduler = null,
    runtimeFactory = createProductionRuntime, configResolver = resolveV25Configuration, credentialCheck = assertPaidCredentials,
    mediaInspector = null } = {}) {
    if (!db || !storage || !repository) throw new Error('db, storage, and V2.10 repository are required');
    this.db = db; this.storage = storage; this.repository = repository; this.env = env; this.logger = logger;
    this.runtimeFactory = runtimeFactory; this.configResolver = configResolver; this.credentialCheck = credentialCheck;
    this.mediaInspector = mediaInspector || new FfprobeMediaInspector();
    this.scheduler = scheduler || ((task) => setImmediate(() => Promise.resolve().then(task).catch((error) =>
      logger.error?.('V2.10 background production failed', { code: error.code || 'V210_EXECUTION_FAILED', message: error.message }))));
  }
  runtime(input, live) {
    const env = runtimeEnvironment(this.env, input, live);
    const config = this.configResolver(env, input);
    const runtime = this.runtimeFactory({ db: this.db, storage: this.storage, config, env, logger: this.logger });
    return { ...runtime, config, env };
  }
  async preflight({ draft, preflight }) {
    const canonical = buildCanonicalV210Input({ draft, preflight });
    const runtime = this.runtime(canonical.input, false);
    const prepared = await runtime.service.prepare({ input: canonical.input, config: runtime.config });
    return Object.freeze({ canonicalInputFingerprint: canonical.input.fingerprint, plan: prepared.plan,
      providerExecutions: 0, canonical });
  }
  async seedUploadedVoice({ draft, productionId, canonical, runtime }) {
    const brief = canonicalCreativeBrief(draft.creative_brief || draft.creativeBrief);
    if (brief.voice.sourceType !== 'UPLOADED_AUDIO') return null;
    const uploaded = await this.repository.getUploadedVoice({ id: brief.voice.uploadedArtifactId,
      workspaceId: draft.workspace_id || draft.workspaceId, brandId: draft.brand_id || draft.brandId });
    if (!uploaded) throw new V210RuntimeError('VOICE_UPLOAD_REQUIRED', 'Approved uploaded narration artifact is unavailable',
      { boundaryState: 'CANONICAL_CREATED', productionId });
    const bytes = await this.storage.get({ key: uploaded.storage_key });
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (hash !== uploaded.content_hash) throw new V210RuntimeError('UPLOADED_AUDIO_HASH_MISMATCH',
      'Uploaded narration no longer matches immutable evidence', { boundaryState: 'CANONICAL_CREATED', productionId });
    const asset = canonical.input.assetPlan.assets.find((item) => item.kind === 'voice');
    if (!asset) throw new V210RuntimeError('VOICE_UPLOAD_CANONICAL_ASSET_MISSING',
      'Canonical production has no voice asset for uploaded narration', { boundaryState: 'CANONICAL_CREATED', productionId });
    const fingerprint = canonicalFingerprint({ brandId: canonical.input.brandId, productionId, asset });
    const artifactId = `brand:${canonical.input.brandId}:asset:${asset.asset_id}`;
    const idempotencyKey = `${canonical.input.brandId}:${productionId}:media:${asset.asset_id}:${fingerprint}`;
    const artifactService = runtime.artifactService || new ArtifactService({ storage: this.storage });
    const artifact = await artifactService.createVersion({ artifactId, type: 'binary', content: bytes,
      idempotencyKey, provider: 'operator-upload', model: 'uploaded-audio', validationStatus: 'validated_media' });
    const executions = runtime.mediaExecutionRepository || new PostgresMediaExecutionRepository({ db: this.db });
    const row = await executions.ensure({ workspaceId: canonical.input.workspaceId, brandId: canonical.input.brandId,
      productionId, asset, fingerprint, idempotencyKey, provider: 'operator-upload', model: 'uploaded-audio' });
    const probe = await this.mediaInspector.inspect({ bytes, contentType: uploaded.content_type, kind: 'voice',
      expectedDurationMs: Math.round(canonical.input.targetDurationSeconds * 1000) });
    await executions.adopt({ id: row.id, artifact, media: { assetId: asset.asset_id, kind: 'voice', bytes,
      contentType: uploaded.content_type, provider: 'operator-upload', model: 'uploaded-audio', requestId: null,
      provenance: { source: 'operator-upload', uploadedArtifactId: uploaded.id, externalCalls: 0 } }, probe, workerId: null });
    return artifact;
  }
  async start({ draft, preflight, actor }) {
    if (this.env.LIVE_PAID_GENERATION !== 'true') {
      throw new V210RuntimeError('V210_EXECUTION_DISABLED',
        'LIVE_PAID_GENERATION=true is required after reviewing the final V2.10 preflight');
    }
    const canonical = buildCanonicalV210Input({ draft, preflight });
    const runtime = this.runtime(canonical.input, true);
    try { this.credentialCheck({ config: runtime.config, input: canonical.input, env: runtime.env }); }
    catch (error) { throw new V210RuntimeError(error.code || 'V210_CREDENTIALS_MISSING', error.message, { boundaryState: 'NOT_CROSSED' }); }
    let productionId = null;
    try {
      const rows = await runtime.service.createDraft({ input: canonical.input, config: runtime.config,
        command: { source: 'v2.7-operator-console', requestId: draft.id, actor,
          canonicalRawInput: canonical.raw, canonicalRequest: canonical.canonicalRequest } });
      productionId = rows.production.id;
      await this.seedUploadedVoice({ draft, productionId, canonical, runtime });
      this.scheduler(() => runtime.service.run({ input: canonical.input, config: runtime.config }));
      return Object.freeze({ productionId, jobId: rows.job.id, accepted: true, boundaryState: 'CANONICAL_CREATED',
        canonicalInputFingerprint: canonical.input.fingerprint, publicationTriggered: false });
    } catch (error) {
      if (error instanceof V210RuntimeError) {
        if (productionId && error.boundaryState === 'NOT_CROSSED') error.boundaryState = 'CANONICAL_CREATED';
        if (!error.productionId && productionId) error.productionId = productionId;
        throw error;
      }
      throw new V210RuntimeError(error.code || 'V210_CANONICAL_START_FAILED', error.message,
        { boundaryState: productionId ? 'CANONICAL_CREATED' : 'NOT_CROSSED', details: error.details || null, productionId });
    }
  }
}

module.exports = { CANONICAL_OBJECTIVES, V210CanonicalProductionStarter, V210RuntimeError, buildCanonicalV210Input,
  canonicalObjective, createVoicePreviewGateway, normalizeVoiceProvider, requestedVideoSelection, resolveAuthoritativeVideo,
  resolveAuthoritativeVoice };
