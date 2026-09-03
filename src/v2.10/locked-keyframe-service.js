'use strict';

const { createOpenAIMediaProvider } = require('../providers/openai-media-provider');
const { createSemanticVisualEvaluatorAdapter } = require('../v2.9/semantic-visual-evaluator-factory');
const { compatible, geometry } = require('../v2.10.2/reference-geometry');
const { validateCreativeCompleteness } = require('./creative-completeness');
const { fingerprint } = require('./creative-contract');
const { CreativeProductionError } = require('./creative-production-service-core');
const { CAPABILITIES } = require('../v2.8/capabilities');
const { approvedKeyframeIdentity, bindApprovedKeyframe, buildKeyframeStagePlan, contentHash,
  LockedKeyframeError, normalizeKeyframeSelection, resolveShot, sanitizeEvaluatorResult,
  shotPlanFingerprint, STAGES } = require('./locked-keyframe-contract');

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

class KeyframeImageGateway {
  constructor({ providers = {} } = {}) { this.providers = providers; }
  async generate({ selection, prompt, idempotencyKey, onProviderRequest }) {
    const provider = this.providers[selection.provider];
    if (!provider) throw new LockedKeyframeError('KEYFRAME_PROVIDER_NOT_CONFIGURED',
      `No image adapter is configured for '${selection.provider}'`);
    const response = await provider.generate({ capability: 'image-generation', model: selection.model,
      idempotencyKey, onProviderRequest, prompt: JSON.stringify({ description: prompt,
        generation_requirements: { prompt, size: selection.resolvedSettings?.size || '1024x1536',
          quality: selection.resolvedSettings?.quality || 'high' } }) });
    const bytes = Buffer.isBuffer(response.output) ? response.output : Buffer.isBuffer(response.bytes) ? response.bytes : null;
    if (!bytes?.length) throw new LockedKeyframeError('KEYFRAME_PROVIDER_OUTPUT_INVALID',
      'Image provider returned no durable image bytes');
    return Object.freeze({ bytes, contentType: response.contentType || 'image/png', requestId: response.requestId || null,
      provider: response.provider || selection.provider, model: response.model || selection.model,
      usage: response.usage || null, provenance: response.provenance || {} });
  }
}

function createKeyframeImageGateway({ env = process.env } = {}) {
  const providers = {};
  if (env.OPENAI_API_KEY) providers.openai = createOpenAIMediaProvider({ apiKey: env.OPENAI_API_KEY,
    imageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-1' });
  return new KeyframeImageGateway({ providers });
}

class SemanticStillEvaluator {
  constructor({ adapter }) { this.adapter = adapter; }
  get configured() { return this.adapter?.configured === true; }
  get provider() { return this.adapter?.provider || null; }
  get model() { return this.adapter?.model || null; }
  async evaluate({ bytes, contentType, probe, creativePlan, provider, model }) {
    if (!this.adapter?.configured) throw new LockedKeyframeError('SEMANTIC_STILL_EVALUATOR_NOT_CONFIGURED',
      'Semantic still evaluation must be configured before a keyframe stage can execute');
    return this.adapter.evaluate({ frames: [{ ratio: 0, timestampMs: 0, contentType, bytes,
      analysisHash: contentHash(bytes) }], creativePlan, negativeIntent: null, expectedAspectRatio: '9:16',
      intendedContentType: 'cinematic keyframe', qualityTier: 'QUALITY', provider, model,
      generationSettings: { width: probe.width, height: probe.height }, evaluationClass: 'KEYFRAME' });
  }
}

function createSemanticStillEvaluator({ env = process.env } = {}) {
  return new SemanticStillEvaluator({ adapter: createSemanticVisualEvaluatorAdapter({ env }) });
}

function publicKeyframe(row) {
  if (!row) return null;
  return Object.freeze({ id: row.id, productionId: row.production_id, brandId: row.brand_id,
    shotId: row.shot_id, assetId: row.asset_id, version: Number(row.version), predecessorId: row.predecessor_id,
    sourceType: row.source_type, provider: row.provider, model: row.model, generationSettings: row.generation_settings,
    promptFingerprint: row.prompt_fingerprint, storageKey: row.storage_key, contentHash: row.content_hash,
    contentType: row.content_type, width: Number(row.width), height: Number(row.height),
    providerRequestId: row.provider_request_id, validationStatus: row.validation_status || null,
    approvalDecision: row.approval_decision || null, approvalEventId: row.approval_event_id || null,
    validationEventId: row.validation_event_id || null, createdAt: row.created_at,
    immutable: true, humanApprovalRequired: true, autoPublish: false });
}

class LockedKeyframeService {
  constructor({ repository, brandRepository, providerCatalog, starter, storage, imageInspector,
    imageGateway, stillEvaluator, actor = 'local-operator', env = process.env } = {}) {
    if (!repository || !brandRepository || !providerCatalog || !starter || !storage || !imageInspector) {
      throw new Error('locked-keyframe repository, brand scope, catalog, starter, storage and image inspector are required');
    }
    this.repository = repository; this.brandRepository = brandRepository; this.providerCatalog = providerCatalog;
    this.starter = starter; this.storage = storage; this.imageInspector = imageInspector;
    this.imageGateway = imageGateway; this.stillEvaluator = stillEvaluator; this.actor = actor; this.env = env;
  }

  async scope(brandId) {
    const brand = await this.brandRepository.getBrand(brandId);
    if (!brand) throw new CreativeProductionError(404, 'BRAND_NOT_FOUND', 'Brand not found');
    return { brandId, workspaceId: brand.workspaceId };
  }

  async draft(id, scope) {
    const draft = await this.repository.getDraft({ id, ...scope });
    if (!draft) throw new CreativeProductionError(404, 'DRAFT_NOT_FOUND', 'Creative draft not found');
    if (draft.status === 'STARTED') throw new CreativeProductionError(409, 'LOCKED_WORKFLOW_ALREADY_STARTED',
      'A started production cannot enter keyframe preparation');
    return draft;
  }

  async workflow({ draft, scope, shotId }) {
    const { shot } = resolveShot(draft.creative_brief, shotId);
    return this.repository.ensureLockedWorkflow({ draftId: draft.id, ...scope, shotId, assetId: shot.assetId,
      canonicalIntentFingerprint: fingerprint({ draftId: draft.id, brandId: scope.brandId,
        shotPlan: shotPlanFingerprint(draft.creative_brief, shotId) }), actor: this.actor });
  }

  async resolveKeyframeSelection(scope, raw) {
    const selection = normalizeKeyframeSelection(raw);
    if (selection.sourceType === 'OPERATOR_UPLOAD') return selection;
    const catalog = await this.providerCatalog.forWorkspace(scope.workspaceId);
    const resolved = catalog.resolveSelection({ provider: selection.provider, model: selection.model,
      profile: selection.profile, capability: CAPABILITIES.TEXT_TO_IMAGE, aspectRatio: '9:16' });
    return Object.freeze({ ...selection, ...resolved, sourceType: 'AI_GENERATED' });
  }

  async preflightKeyframe({ id, brandId, shotId, keyframe = {} }) {
    if (!this.stillEvaluator || this.stillEvaluator.configured === false) {
      throw new LockedKeyframeError('SEMANTIC_STILL_EVALUATOR_NOT_CONFIGURED',
        'Keyframe preflight is blocked until the semantic still evaluator is configured; provider calls remain zero');
    }
    const scope = await this.scope(brandId); const draft = await this.draft(id, scope);
    const selection = await this.resolveKeyframeSelection(scope, keyframe);
    const workflow = await this.workflow({ draft, scope, shotId });
    const plan = buildKeyframeStagePlan({ draft, shotId, selection,
      semantic: { provider: this.env.SEMANTIC_VISUAL_PROVIDER, model: this.env.SEMANTIC_VISUAL_MODEL } });
    const stored = await this.repository.saveLockedStagePreflight({ workflowId: workflow.id, ...scope,
      stage: STAGES.KEYFRAME, draftRevision: draft.revision, plan, actor: this.actor });
    return Object.freeze({ ...plan, preflightId: stored.id, productionId: workflow.production_id });
  }

  async inspectImage(bytes, contentType) {
    if (!IMAGE_TYPES.has(contentType)) throw new LockedKeyframeError('KEYFRAME_TYPE_UNSUPPORTED',
      'Keyframe must be PNG, JPEG, or WebP');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new LockedKeyframeError('KEYFRAME_SIZE_INVALID',
      `Keyframe must contain 1-${MAX_IMAGE_BYTES} bytes`);
    const probe = await this.imageInspector.inspect({ bytes, contentType, kind: 'image' });
    if (!probe.width || !probe.height || !compatible(geometry(probe.width, probe.height), '9:16')) {
      throw new LockedKeyframeError('KEYFRAME_GEOMETRY_MISMATCH', 'Keyframe must have verified 9:16 geometry', { probe });
    }
    return probe;
  }

  async executeKeyframe({ id, brandId, shotId, preflightId, fingerprint: expectedFingerprint,
    confirmation, contentBase64 = null, contentType = null }) {
    if (confirmation !== true) throw new LockedKeyframeError('EXPLICIT_CONFIRMATION_REQUIRED',
      'Explicit keyframe-stage confirmation is required');
    const scope = await this.scope(brandId); const draft = await this.draft(id, scope);
    const workflow = await this.repository.getLockedWorkflow({ draftId: id, ...scope, shotId });
    if (!workflow) throw new LockedKeyframeError('LOCKED_WORKFLOW_MISSING', 'Run keyframe preflight first');
    const preflight = await this.repository.getLockedStagePreflight({ id: preflightId, workflowId: workflow.id,
      ...scope, stage: STAGES.KEYFRAME });
    if (!preflight || preflight.fingerprint !== expectedFingerprint || Number(preflight.draft_revision) !== Number(draft.revision)) {
      throw new LockedKeyframeError('STALE_LOCKED_STAGE_PREFLIGHT', 'Keyframe input changed after authoritative preflight');
    }
    const plan = preflight.execution_plan;
    const current = buildKeyframeStagePlan({ draft, shotId, selection: { sourceType: plan.executionAssets[0].sourceType,
      provider: plan.provider, model: plan.model, profile: plan.profile, resolvedSettings: plan.resolvedSettings },
      semantic: { provider: this.env.SEMANTIC_VISUAL_PROVIDER, model: this.env.SEMANTIC_VISUAL_MODEL } });
    if (current.fingerprint !== preflight.fingerprint) throw new LockedKeyframeError('STALE_LOCKED_STAGE_PREFLIGHT',
      'Keyframe execution projection no longer matches the prepared plan');
    const attempt = await this.repository.claimLockedStage({ workflowId: workflow.id, ...scope,
      stage: STAGES.KEYFRAME, preflightId });
    if (attempt.reused) return attempt.result;
    let boundary = false;
    try {
      let generated;
      if (plan.executionAssets[0].sourceType === 'OPERATOR_UPLOAD') {
        const bytes = Buffer.from(contentBase64 || '', 'base64');
        generated = { bytes, contentType: contentType || 'image/jpeg', requestId: null,
          provider: 'operator-upload', model: 'uploaded-image', provenance: { source: 'OPERATOR_UPLOAD', externalCalls: 0 } };
      } else {
        if (!this.imageGateway) throw new LockedKeyframeError('KEYFRAME_PROVIDER_NOT_CONFIGURED', 'Image gateway is not configured');
        await this.repository.markLockedStageBoundary({ attemptId: attempt.id }); boundary = true;
        generated = await this.imageGateway.generate({ selection: plan, prompt: plan.prompt,
          idempotencyKey: `locked-keyframe:${workflow.id}:${preflight.fingerprint}`,
          onProviderRequest: async ({ requestId }) => this.repository.recordLockedStageProviderRequest({
            attemptId: attempt.id, providerRequestId: requestId }) });
      }
      const probe = await this.inspectImage(generated.bytes, generated.contentType);
      const artifact = await this.repository.storeKeyframeArtifact({ workflowId: workflow.id, ...scope,
        productionId: workflow.production_id, shotId, assetId: workflow.opening_asset_id,
        sourceType: plan.executionAssets[0].sourceType, provider: generated.provider, model: generated.model,
        generationSettings: plan.resolvedSettings, promptFingerprint: fingerprint(plan.prompt), bytes: generated.bytes,
        contentHash: contentHash(generated.bytes), contentType: generated.contentType, width: probe.width,
        height: probe.height, providerRequestId: generated.requestId, provenance: { ...generated.provenance,
          usage: generated.usage || null, externalContentIsUntrustedData: true }, actor: this.actor });
      const { brief, shot } = resolveShot(draft.creative_brief, shotId);
      if (!boundary) {
        await this.repository.markLockedStageBoundary({ attemptId: attempt.id });
        boundary = true;
      }
      const rawEvaluation = await this.stillEvaluator.evaluate({ bytes: generated.bytes,
        contentType: generated.contentType, probe, creativePlan: { schemaVersion: 2,
          operatorBriefAuthoritative: true, shots: [{ ...shot, generationPrompt: plan.prompt }], continuity: brief.continuity },
        provider: generated.provider, model: generated.model });
      const evaluation = sanitizeEvaluatorResult(rawEvaluation);
      const validation = await this.repository.recordKeyframeValidation({ keyframeId: artifact.id, ...scope,
        shotPlanFingerprint: shotPlanFingerprint(draft.creative_brief, shotId), result: evaluation,
        semanticExternalCalls: evaluation.metadata.externalCalls,
        evaluatorProvider: evaluation.metadata.provider, evaluatorModel: evaluation.metadata.model });
      const resolved = { keyframe: publicKeyframe({ ...artifact, validation_status: validation.status,
        validation_event_id: validation.id }), validation: evaluation,
        lifecycle: validation.status === 'PASS' ? 'AWAITING_HUMAN_APPROVAL' : 'KEYFRAME_VALIDATION_FAILED',
        externalCalls: { image: plan.externalCalls.imageGeneration, semantic: evaluation.metadata.externalCalls,
          total: plan.externalCalls.imageGeneration + evaluation.metadata.externalCalls },
        remainingProductionScheduled: false, humanApprovalRequired: true, autoPublish: false };
      await this.repository.finishLockedStage({ attemptId: attempt.id,
        status: validation.status === 'PASS' ? 'SUCCEEDED' : 'FAILED', boundaryState: 'COMPLETED',
        providerRequestId: generated.requestId, keyframeId: artifact.id, result: resolved,
        error: validation.status === 'PASS' ? {} : { code: 'KEYFRAME_SEMANTIC_VALIDATION_FAILED' } });
      return Object.freeze(resolved);
    } catch (error) {
      await this.repository.finishLockedStage({ attemptId: attempt.id,
        status: boundary ? 'NEEDS_RECONCILIATION' : 'FAILED', boundaryState: boundary ? 'MAY_HAVE_STARTED' : 'NOT_CROSSED',
        error: { code: error.code || 'KEYFRAME_STAGE_FAILED', message: error.message } }).catch(() => {});
      throw error;
    }
  }

  async approveKeyframe({ id, brandId, keyframeId, confirmation, reason = null }) {
    if (confirmation !== true) throw new LockedKeyframeError('EXPLICIT_CONFIRMATION_REQUIRED',
      'Explicit human keyframe approval is required');
    const scope = await this.scope(brandId); const draft = await this.draft(id, scope);
    const approved = await this.repository.approveKeyframe({ keyframeId, ...scope, actor: this.actor, reason });
    const brief = bindApprovedKeyframe(draft.creative_brief, approved.shot_id, approved);
    const validation = validateCreativeCompleteness(brief);
    const updated = await this.repository.updateDraft({ id, ...scope, brief, validation,
      providerSelection: undefined, voiceSelection: undefined, voiceApproval: undefined });
    if (!updated) throw new LockedKeyframeError('KEYFRAME_BINDING_REJECTED',
      'Approved keyframe could not be bound to the canonical creative revision');
    return Object.freeze({ keyframe: publicKeyframe(approved), draftRevision: updated.revision,
      canonicalReference: approvedKeyframeIdentity(approved), productionPreflightInvalidated: true,
      nextRequiredAction: 'RUN_FINAL_PRODUCTION_PREFLIGHT', humanApprovalRequired: true, autoPublish: false });
  }

  async preflightFirstVideo({ id, brandId, keyframeId }) {
    const scope = await this.scope(brandId); const draft = await this.draft(id, scope);
    if (draft.status !== 'PREFLIGHT_READY' || !draft.final_preflight) throw new LockedKeyframeError('FINAL_PREFLIGHT_REQUIRED',
      'Run a fresh final production preflight after approving the exact keyframe');
    const keyframe = await this.repository.getKeyframe({ id: keyframeId, ...scope });
    approvedKeyframeIdentity(keyframe);
    const workflow = await this.repository.getLockedWorkflow({ draftId: id, ...scope, shotId: keyframe.shot_id });
    if (!workflow || workflow.production_id !== keyframe.production_id) throw new LockedKeyframeError('LOCKED_WORKFLOW_MISSING',
      'Approved keyframe does not belong to this production workflow');
    const projected = await this.starter.preflightLockedFirstVideo({ draft, preflight: draft.final_preflight, keyframe });
    const stored = await this.repository.saveLockedStagePreflight({ workflowId: workflow.id, ...scope,
      stage: STAGES.FIRST_VIDEO, draftRevision: draft.revision, keyframe, plan: projected.plan, actor: this.actor });
    return Object.freeze({ ...projected.plan, preflightId: stored.id });
  }

  async startFirstVideo({ id, brandId, keyframeId, preflightId, fingerprint: expectedFingerprint, confirmation }) {
    if (confirmation !== true) throw new LockedKeyframeError('EXPLICIT_CONFIRMATION_REQUIRED',
      'Explicit first-video paid-stage confirmation is required');
    const scope = await this.scope(brandId); const draft = await this.draft(id, scope);
    const keyframe = await this.repository.getKeyframe({ id: keyframeId, ...scope });
    approvedKeyframeIdentity(keyframe);
    const workflow = await this.repository.getLockedWorkflow({ draftId: id, ...scope, shotId: keyframe.shot_id });
    const stored = await this.repository.getLockedStagePreflight({ id: preflightId, workflowId: workflow.id,
      ...scope, stage: STAGES.FIRST_VIDEO });
    if (!stored || stored.fingerprint !== expectedFingerprint || Number(stored.draft_revision) !== Number(draft.revision)
      || stored.keyframe_id !== keyframe.id || Number(stored.keyframe_version) !== Number(keyframe.version)
      || stored.keyframe_content_hash !== keyframe.content_hash) {
      throw new LockedKeyframeError('STALE_LOCKED_STAGE_PREFLIGHT',
        'First-video preflight does not match the exact approved keyframe and current canonical revision');
    }
    const current = await this.starter.preflightLockedFirstVideo({ draft, preflight: draft.final_preflight, keyframe });
    if (current.plan.fingerprint !== stored.fingerprint) throw new LockedKeyframeError('STALE_LOCKED_STAGE_PREFLIGHT',
      'Prepared first-video execution changed after preflight');
    const attempt = await this.repository.claimLockedStage({ workflowId: workflow.id, ...scope,
      stage: STAGES.FIRST_VIDEO, preflightId });
    if (attempt.reused) return attempt.result;
    let boundary = false;
    try {
      const result = await this.starter.startLockedFirstVideo({ draft, preflight: draft.final_preflight,
        keyframe, actor: this.actor, productionId: workflow.production_id, expectedFingerprint,
        beforeProviderBoundary: async () => { await this.repository.markLockedStageBoundary({ attemptId: attempt.id }); boundary = true; } });
      const safeQuality = sanitizeEvaluatorResult(result.quality);
      const response = { productionId: result.productionId, jobId: result.jobId,
        accepted: result.accepted, media: { assetId: result.media.assetId, provider: result.media.provider,
          model: result.media.model, requestId: result.media.requestId, artifact: result.media.artifact,
          provenance: result.media.provenance }, quality: safeQuality,
        exactKeyframe: approvedKeyframeIdentity(keyframe), externalCalls: {
          video: 1, semantic: safeQuality.metadata.externalCalls, continuity: 0, voice: 0, renderer: 0,
          total: 1 + safeQuality.metadata.externalCalls }, remainingProductionScheduled: false,
        readyForContinuationPreflight: result.accepted,
        nextRequiredAction: result.accepted ? 'RUN_CONTINUATION_PREFLIGHT' : 'STOP_AND_REVIEW_FAILURE',
        humanApprovalRequired: true, autoPublish: false };
      await this.repository.finishLockedStage({ attemptId: attempt.id,
        status: result.accepted ? 'SUCCEEDED' : 'FAILED', boundaryState: 'COMPLETED',
        providerRequestId: result.media.requestId, result: response,
        error: result.accepted ? {} : { code: 'FIRST_VIDEO_VALIDATION_FAILED' } });
      await this.repository.recordFirstVideoResult({ workflowId: workflow.id, ...scope,
        accepted: result.accepted, result: response });
      return Object.freeze(response);
    } catch (error) {
      await this.repository.finishLockedStage({ attemptId: attempt.id,
        status: boundary ? 'NEEDS_RECONCILIATION' : 'FAILED',
        boundaryState: boundary ? 'MAY_HAVE_STARTED' : 'NOT_CROSSED',
        error: { code: error.code || 'FIRST_VIDEO_STAGE_FAILED', message: error.message } }).catch(() => {});
      throw error;
    }
  }
}

module.exports = { IMAGE_TYPES, MAX_IMAGE_BYTES, KeyframeImageGateway, LockedKeyframeService,
  SemanticStillEvaluator, createKeyframeImageGateway, createSemanticStillEvaluator, publicKeyframe };
