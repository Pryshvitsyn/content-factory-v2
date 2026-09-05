'use strict';

const crypto = require('node:crypto');
const { canonicalCreativeBrief, canonicalVoice } = require('./creative-contract');
const { validateCreativeCompleteness } = require('./creative-completeness');
const { buildProductionPreflight, assertStartAllowed } = require('./production-preflight');
const { VoicePreviewService, approveVoice, normalizePreviewArtifact, voiceConfigurationFingerprint,
  validateUploadedAudio } = require('./voice-studio');
const { normalizeVoiceProvider, requestedVideoSelection, resolveAuthoritativeVideo,
  resolveAuthoritativeVoice } = require('./runtime-integration');
const { CAPABILITIES } = require('../v2.8/capabilities');

class CreativeProductionError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

function same(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }

class CreativeProductionService {
  constructor({ repository, brandRepository, providerCatalog = null, actor = 'local-operator', env = process.env,
    previewProvider = null, storage = null, starter = null, audioInspector = null, continuityAuthority = null }) {
    this.repository = repository; this.brandRepository = brandRepository; this.providerCatalog = providerCatalog;
    this.actor = actor; this.env = env; this.storage = storage; this.starter = starter; this.audioInspector = audioInspector;
    this.continuityAuthority=continuityAuthority;
    this.voicePreviews = previewProvider ? new VoicePreviewService({ repository, providerGateway: previewProvider, mediaInspector: audioInspector }) : null;
  }
  async scope(brandId) {
    const brand = await this.brandRepository.getBrand(brandId);
    if (!brand) throw new CreativeProductionError(404, 'BRAND_NOT_FOUND', 'Brand not found');
    return { brandId, workspaceId: brand.workspaceId, brand };
  }
  prepareBrief(input) { const brief = canonicalCreativeBrief(input); return { brief, validation: validateCreativeCompleteness(brief) }; }
  async createDraft({ brandId, brief: input, providerSelection, voiceSelection }) {
    const scope = await this.scope(brandId); const { brief, validation } = this.prepareBrief(input);
    return this.repository.createDraft({ ...scope, brief, validation,
      providerSelection: requestedVideoSelection(providerSelection || {}), voiceSelection, actor: this.actor });
  }
  async updateDraft({ id, brandId, brief: input, providerSelection, voiceSelection, voiceApproval }) {
    const scope = await this.scope(brandId); const { brief, validation } = this.prepareBrief(input);
    const selected = providerSelection === undefined ? undefined : requestedVideoSelection(providerSelection);
    const updated = await this.repository.updateDraft({ id, ...scope, brief, validation,
      providerSelection: selected, voiceSelection, voiceApproval });
    if (!updated) throw new CreativeProductionError(409, 'DRAFT_UPDATE_REJECTED',
      'Creative draft is missing, already started, or locked by an active/reconciliation start');
    return updated;
  }
  authoritativeQuality() {
    return Object.freeze({ semanticCritic: this.env.SEMANTIC_VISUAL_MODEL || 'NONE',
      semanticCriticResolved: { provider: this.env.SEMANTIC_VISUAL_PROVIDER || null,
        model: this.env.SEMANTIC_VISUAL_MODEL || null } });
  }
  authoritativeMaster(brief) {
    return Object.freeze({ profile: 'SOCIAL_VERTICAL', resolution: '1080x1920', fps: 30,
      availableVoiceDurationSeconds: brief.targetDurationSeconds,
      audioStrategy: brief.voice.sourceType || 'NO_VOICE' });
  }
  async resolveVoiceRuntime(scope, brief) {
    return resolveAuthoritativeVoice({ catalog: this.providerCatalog, workspaceId: scope.workspaceId,
      brief: { ...brief, brandId: scope.brandId }, repository: this.repository });
  }
  async computePreflight({ draft, scope, request }) {
    if (!this.providerCatalog) throw new CreativeProductionError(409, 'V210_PROVIDER_CATALOG_REQUIRED',
      'V2.10 requires the authoritative Provider Catalog');
    if (!this.starter) throw new CreativeProductionError(409, 'PRODUCTION_STARTER_NOT_CONFIGURED',
      'V2.10 canonical production starter is not configured');
    const brief = canonicalCreativeBrief(draft.creative_brief);
    const authoritativeVideo = await resolveAuthoritativeVideo({ catalog: this.providerCatalog,
      workspaceId: scope.workspaceId, brandId: scope.brandId, request: request.video || request, brief,
      continuityAuthority:this.continuityAuthority });
    const voiceRuntime = await this.resolveVoiceRuntime(scope, brief);
    const quality = this.authoritativeQuality();
    const master = this.authoritativeMaster(brief);
    const preliminary = buildProductionPreflight({ brief, authoritativeVideo, voiceRuntime, quality, master,
      timingToleranceSeconds: Number(request.timingToleranceSeconds || 0) });
    if (preliminary.status === 'BLOCKED' && preliminary.blockers.some((code) => code !== 'PRICE_NOT_VERIFIABLE')) return { preflight: preliminary, canonical: null };
    const canonical = await this.starter.preflight({ draft, preflight: preliminary });
    const final = buildProductionPreflight({ brief, authoritativeVideo, voiceRuntime, quality, master,
      canonicalPlan: canonical.plan, canonicalInputFingerprint: canonical.canonicalInputFingerprint,
      workflowAuthority: canonical.workflowAuthority,
      timingToleranceSeconds: Number(request.timingToleranceSeconds || 0) });
    return { preflight: final, canonical };
  }
  async preflight({ id, brandId, video = {}, timingToleranceSeconds = 0 }) {
    const scope = await this.scope(brandId); let draft = await this.repository.getDraft({ id, ...scope });
    if (!draft) throw new CreativeProductionError(404, 'DRAFT_NOT_FOUND', 'Creative draft not found');
    if (draft.status === 'STARTED' || ['RUNNING','NEEDS_RECONCILIATION'].includes(draft.start_state)) {
      throw new CreativeProductionError(409, 'PREFLIGHT_UNAVAILABLE', 'Started or unresolved creative drafts cannot be re-preflighted');
    }
    const requested = requestedVideoSelection(video);
    if (!same(draft.provider_selection, requested)) {
      const validation = validateCreativeCompleteness(draft.creative_brief);
      draft = await this.repository.updateDraft({ id, ...scope, brief: canonicalCreativeBrief(draft.creative_brief),
        validation, providerSelection: requested });
      if (!draft) throw new CreativeProductionError(409, 'DRAFT_UPDATE_REJECTED', 'Provider selection could not be persisted');
    }
    const request = { video: requested, timingToleranceSeconds: Number(timingToleranceSeconds || 0) };
    const computed = await this.computePreflight({ draft, scope, request });
    if (computed.preflight.status === 'BLOCKED') return computed.preflight;
    await this.repository.savePreflight({ id, ...scope, preflight: computed.preflight, preflightRequest: request, actor: this.actor });
    return computed.preflight;
  }
  async generateVoicePreview({ id, brandId, voice, previewText, confirmation }) {
    if (!this.voicePreviews || !this.providerCatalog) throw new CreativeProductionError(409,
      'VOICE_PREVIEW_PROVIDER_NOT_CONFIGURED', 'Voice Studio provider/catalog is not configured');
    const scope = await this.scope(brandId); const draft = await this.repository.getDraft({ id, ...scope });
    if (!draft) throw new CreativeProductionError(404, 'DRAFT_NOT_FOUND', 'Creative draft not found');
    const requested = canonicalVoice(voice);
    if (!requested.provider || !requested.model || !requested.voiceId) {
      throw new CreativeProductionError(409, 'VOICE_SELECTION_INCOMPLETE', 'Voice provider, model and voice ID are required');
    }
    const scoped = await this.providerCatalog.forWorkspace(scope.workspaceId);
    const provider = normalizeVoiceProvider(requested.provider);
    const resolved = scoped.resolveSelection({ provider, model: requested.model, profile: 'STANDARD', capability: CAPABILITIES.SPEECH });
    const authoritative = canonicalVoice({ ...requested, provider: resolved.provider, model: resolved.model });
    return this.voicePreviews.generate({ ...scope, voice: authoritative, previewText, confirmed: confirmation === true });
  }
  async approveVoice({ id, brandId, voice, previewArtifact }) {
    const scope = await this.scope(brandId); const draft = await this.repository.getDraft({ id, ...scope });
    if (!draft) throw new CreativeProductionError(404, 'DRAFT_NOT_FOUND', 'Creative draft not found');
    const requested = canonicalVoice(voice);
    let certifiedPreview = previewArtifact;
    if (requested.sourceType === 'UPLOADED_AUDIO') {
      const uploaded = await this.repository.getUploadedVoice({ id: requested.uploadedArtifactId,
        workspaceId: scope.workspaceId, brandId: scope.brandId });
      if (!uploaded) throw new CreativeProductionError(409, 'VOICE_UPLOAD_REQUIRED', 'Uploaded narration evidence is unavailable');
      certifiedPreview = { artifactId: uploaded.id, storageKey: uploaded.storage_key,
        contentHash: uploaded.content_hash, durationSeconds: Number(uploaded.duration_seconds) };
    } else {
      if (!previewArtifact?.artifactId || typeof this.repository.getVoicePreview !== 'function') {
        throw new CreativeProductionError(409, 'VOICE_PREVIEW_REQUIRED', 'Durable voice preview evidence is required');
      }
      const stored = await this.repository.getVoicePreview({ id: previewArtifact.artifactId,
        workspaceId: scope.workspaceId, brandId: scope.brandId });
      if (!stored || voiceConfigurationFingerprint(stored.configuration) !== voiceConfigurationFingerprint(requested)) {
        throw new CreativeProductionError(409, 'VOICE_PREVIEW_MISMATCH', 'Voice preview does not match the exact selected voice configuration');
      }
      certifiedPreview = normalizePreviewArtifact(stored);
    }
    const approved = approveVoice({ ...requested, previewArtifact: certifiedPreview });
    const brief = canonicalCreativeBrief({ ...draft.creative_brief, voice: approved });
    const validation = validateCreativeCompleteness(brief);
    return this.repository.updateDraft({ id, ...scope, brief, validation, providerSelection: undefined,
      voiceSelection: approved, voiceApproval: { approved: true,
        configurationFingerprint: approved.approvedConfigurationFingerprint,
        previewArtifactId: approved.previewArtifact?.artifactId || approved.uploadedArtifactId,
        actor: this.actor } });
  }
  async uploadVoice({ id, brandId, contentBase64, contentType, operatorAttestation }) {
    if (!this.storage || !this.audioInspector) throw new CreativeProductionError(409, 'VOICE_STORAGE_NOT_CONFIGURED',
      'Immutable voice storage and audio inspection are not configured');
    const bytes = Buffer.from(contentBase64 || '', 'base64');
    let probe;
    try { probe = await this.audioInspector.inspect({ bytes, contentType, kind: 'voice' }); }
    catch (error) { throw new CreativeProductionError(422, 'UPLOADED_AUDIO_UNDECODABLE',
      'Uploaded narration has no safely decodable audio stream', { code: error.code }); }
    const inspected = { durationSeconds: probe.durationMs / 1000, decodable: true, hasAudio: probe.hasAudio,
      sampleRate: probe.audioSampleRate, channels: probe.audioChannels, codec: probe.audioCodec };
    const validation = validateUploadedAudio({ contentType, size: bytes.length, metadata: inspected, operatorAttestation });
    if (validation.status === 'FAIL') throw new CreativeProductionError(422, 'UPLOADED_AUDIO_INVALID',
      'Uploaded narration failed deterministic audio validation', validation);
    const scope = await this.scope(brandId); const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
    return this.repository.storeUploadedVoice({ id, ...scope, bytes, contentHash, contentType,
      metadata: inspected, operatorAttestation, actor: this.actor, storage: this.storage });
  }
  async start({ id, brandId, confirmation }) {
    const scope = await this.scope(brandId); let draft = await this.repository.getDraft({ id, ...scope });
    if (!draft) throw new CreativeProductionError(404, 'DRAFT_NOT_FOUND', 'Creative draft not found');
    if (draft.status === 'STARTED' && draft.production_id) return Object.freeze({ productionId: draft.production_id,
      draftId: id, accepted: false, reused: true, humanApprovalRequired: true, autoPublish: false });
    if (draft.start_state === 'RUNNING') throw new CreativeProductionError(409, 'START_ALREADY_RUNNING', 'Production start is already running');
    if (draft.start_state === 'NEEDS_RECONCILIATION') throw new CreativeProductionError(409, 'START_NEEDS_RECONCILIATION',
      'Previous start may have crossed an external boundary; reconcile before retrying');
    if (typeof this.repository.getLockedWorkflow === 'function') {
      const locked = await this.repository.getLockedWorkflow({ draftId: id, ...scope });
      if (locked && locked.state !== 'FIRST_VIDEO_ACCEPTED') throw new CreativeProductionError(409,
        'LOCKED_KEYFRAME_STAGE_INCOMPLETE',
        'The exact approved keyframe and bounded first-video validation must complete before remaining production can start');
    }
    if (!draft.preflight_request || !draft.final_preflight) throw new CreativeProductionError(409, 'PREFLIGHT_BLOCKED', 'A persisted READY preflight is required');
    const computed = await this.computePreflight({ draft, scope, request: draft.preflight_request });
    assertStartAllowed({ preflight: draft.final_preflight, currentPreflight: computed.preflight, confirmed: confirmation === true });
    const claimed = await this.repository.claimStart({ id, ...scope, fingerprint: draft.final_preflight.fingerprint,
      actor: this.actor, canonicalInputFingerprint: computed.preflight.canonicalInputFingerprint });
    if (claimed.reused && claimed.production_id) return Object.freeze({ productionId: claimed.production_id,
      draftId: id, accepted: false, reused: true, humanApprovalRequired: true, autoPublish: false });
    try {
      const started = await this.starter.start({ draft: claimed, preflight: computed.preflight, actor: this.actor });
      if (!started?.productionId) throw new CreativeProductionError(502, 'PRODUCTION_START_FAILED', 'Canonical starter returned no production identity');
      await this.repository.finishStartSuccess({ id, ...scope, attempt: claimed.startAttempt,
        productionId: started.productionId, canonicalInputFingerprint: started.canonicalInputFingerprint });
      if (typeof this.repository.markLockedContinuationStarted === 'function') {
        await this.repository.markLockedContinuationStarted({ draftId: id, ...scope,
          productionId: started.productionId });
      }
      return Object.freeze({ ...started, draftId: id, humanApprovalRequired: true, autoPublish: false });
    } catch (error) {
      const boundaryState = error?.boundaryState === 'NOT_CROSSED' ? 'NOT_CROSSED'
        : error?.boundaryState === 'CANONICAL_CREATED' ? 'CANONICAL_CREATED' : 'MAY_HAVE_STARTED';
      await this.repository.finishStartFailure({ id, ...scope, attempt: claimed.startAttempt, error,
        boundaryState, phase: error?.productionId ? 'CANONICAL_START_FAILED' : 'START_FAILED', productionId: error?.productionId || null });
      throw error;
    }
  }
}

module.exports = { CreativeProductionError, CreativeProductionService };
