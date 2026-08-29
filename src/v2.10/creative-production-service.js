'use strict';

const crypto = require('node:crypto');
const { canonicalCreativeBrief } = require('./creative-contract');
const { validateCreativeCompleteness } = require('./creative-completeness');
const { buildProductionPreflight, assertStartAllowed } = require('./production-preflight');
const { VoicePreviewService } = require('./voice-studio');

class CreativeProductionError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

class CreativeProductionService {
  constructor({ repository, brandRepository, actor = 'local-operator', previewProvider = null, storage = null, starter = null, audioInspector = null }) {
    this.repository = repository; this.brandRepository = brandRepository; this.actor = actor; this.storage = storage; this.starter = starter; this.audioInspector = audioInspector;
    this.voicePreviews = previewProvider ? new VoicePreviewService({ repository, providerGateway: previewProvider }) : null;
  }
  async scope(brandId) {
    const brand = await this.brandRepository.getBrand(brandId);
    if (!brand) throw new CreativeProductionError(404, 'BRAND_NOT_FOUND', 'Brand not found');
    return { brandId, workspaceId: brand.workspaceId };
  }
  prepareBrief(input) { const brief = canonicalCreativeBrief(input); return { brief, validation: validateCreativeCompleteness(brief) }; }
  async createDraft({ brandId, brief: input, providerSelection, voiceSelection }) {
    const scope = await this.scope(brandId); const { brief, validation } = this.prepareBrief(input);
    return this.repository.createDraft({ ...scope, brief, validation, providerSelection, voiceSelection, actor: this.actor });
  }
  async updateDraft({ id, brandId, brief: input, providerSelection, voiceSelection, voiceApproval }) {
    const scope = await this.scope(brandId); const { brief, validation } = this.prepareBrief(input);
    const updated = await this.repository.updateDraft({ id, ...scope, brief, validation, providerSelection, voiceSelection, voiceApproval });
    if (!updated) throw new CreativeProductionError(404, 'DRAFT_NOT_FOUND', 'Creative draft not found'); return updated;
  }
  async preflight({ id, brandId, video, quality, master, timingToleranceSeconds }) {
    const scope = await this.scope(brandId); const draft = await this.repository.getDraft({ id, ...scope });
    if (!draft) throw new CreativeProductionError(404, 'DRAFT_NOT_FOUND', 'Creative draft not found');
    const preflight = buildProductionPreflight({ brief: draft.creative_brief, video, quality, master, timingToleranceSeconds });
    if (preflight.status === 'BLOCKED') return preflight;
    await this.repository.savePreflight({ id, ...scope, preflight, actor: this.actor }); return preflight;
  }
  async generateVoicePreview({ id, brandId, voice, previewText, confirmation }) {
    if (!this.voicePreviews) throw new CreativeProductionError(409, 'VOICE_PREVIEW_PROVIDER_NOT_CONFIGURED', 'No Voice Studio preview provider is configured');
    const scope = await this.scope(brandId); const draft = await this.repository.getDraft({ id, ...scope });
    if (!draft) throw new CreativeProductionError(404, 'DRAFT_NOT_FOUND', 'Creative draft not found');
    return this.voicePreviews.generate({ ...scope, voice, previewText, confirmed: confirmation === true });
  }
  async approveVoice({ id, brandId, voice, previewArtifact }) {
    const { approveVoice } = require('./voice-studio'); const scope = await this.scope(brandId);
    const draft = await this.repository.getDraft({ id, ...scope });
    if (!draft) throw new CreativeProductionError(404, 'DRAFT_NOT_FOUND', 'Creative draft not found');
    const approved = approveVoice({ ...voice, previewArtifact });
    const brief = canonicalCreativeBrief({ ...draft.creative_brief, voice: approved });
    const validation = validateCreativeCompleteness(brief);
    return this.repository.updateDraft({ id, ...scope, brief, validation, providerSelection: draft.provider_selection,
      voiceSelection: approved, voiceApproval: { approved: true, configurationFingerprint: approved.approvedConfigurationFingerprint,
        previewArtifactId: approved.previewArtifact?.artifactId || approved.uploadedArtifactId, actor: this.actor } });
  }
  async uploadVoice({ id, brandId, contentBase64, contentType, metadata, operatorAttestation }) {
    if (!this.storage || !this.audioInspector) throw new CreativeProductionError(409, 'VOICE_STORAGE_NOT_CONFIGURED', 'Immutable voice storage and audio inspection are not configured');
    const { validateUploadedAudio } = require('./voice-studio');
    const bytes = Buffer.from(contentBase64 || '', 'base64');
    let probe;
    try { probe = await this.audioInspector.inspect({ bytes, contentType, kind: 'voice' }); }
    catch (error) { throw new CreativeProductionError(422, 'UPLOADED_AUDIO_UNDECODABLE', 'Uploaded narration has no safely decodable audio stream', { code: error.code }); }
    const inspected = { durationSeconds: probe.durationMs / 1000, decodable: true, hasAudio: probe.hasAudio,
      sampleRate: probe.audioSampleRate, channels: probe.audioChannels, codec: probe.audioCodec };
    const validation = validateUploadedAudio({ contentType, size: bytes.length, metadata: inspected, operatorAttestation });
    if (validation.status === 'FAIL') throw new CreativeProductionError(422, 'UPLOADED_AUDIO_INVALID', 'Uploaded narration failed deterministic audio validation', validation);
    const scope = await this.scope(brandId); const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
    return this.repository.storeUploadedVoice({ id, ...scope, bytes, contentHash, contentType, metadata: inspected, operatorAttestation, actor: this.actor, storage: this.storage });
  }
  async start({ id, brandId, currentInput, confirmation }) {
    const scope = await this.scope(brandId); const draft = await this.repository.getDraft({ id, ...scope });
    if (!draft) throw new CreativeProductionError(404, 'DRAFT_NOT_FOUND', 'Creative draft not found');
    assertStartAllowed({ preflight: draft.final_preflight, currentInput, confirmed: confirmation === true });
    if (!this.starter) throw new CreativeProductionError(409, 'PRODUCTION_STARTER_NOT_CONFIGURED', 'V2.10 production starter is not configured');
    const claimed = await this.repository.claimStart({ id, ...scope, fingerprint: draft.final_preflight.fingerprint });
    const started = await this.starter.start({ draft: claimed, preflight: claimed.final_preflight, actor: this.actor });
    if (!started?.productionId) throw new CreativeProductionError(502, 'PRODUCTION_START_FAILED', 'V2.10 starter returned no production identity');
    await this.repository.markStarted({ id, ...scope, productionId: started.productionId });
    return Object.freeze({ ...started, draftId: id, humanApprovalRequired: true, autoPublish: false });
  }
}

module.exports = { CreativeProductionError, CreativeProductionService };
