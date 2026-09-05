'use strict';

const { stableFingerprint } = require('../v2.5/production-input');
const { createProductionRuntime } = require('../v2.7/production-runtime');
const { V210CanonicalProductionStarter, V210RuntimeError, buildCanonicalV210Input } = require('./runtime-integration');
const { V210PostProductionRenderer, V210ReferenceAwareMediaExecutor } = require('./reference-aware-media');
const { buildFirstVideoStagePlan, LockedKeyframeError } = require('./locked-keyframe-contract');
const { ProductionExecutionAuthority, persistV210WorkflowRevision } = require('../workflow/v210-production-authority');

// Bump only when durable canonical execution-identity semantics change. The
// version is salted into the deterministic identity hash while preserving the
// public production-key shape. This prevents an older canonical row produced
// under different fingerprint semantics from permanently blocking a safe
// NOT_CROSSED retry for the same draft.
const V210_EXECUTION_IDENTITY_VERSION = 'r2';

function integratedEnvironment(env, input, live) {
  const audioProvider = input.mediaStack?.audio?.voice?.provider === 'operator-upload' ? 'operator-upload'
    : input.mediaStack?.audio?.voice?.provider === 'elevenlabs' ? 'elevenlabs'
      : input.voiceover?.enabled ? 'openai-media' : 'none';
  return { ...env, LIVE_PAID_GENERATION: live ? 'true' : 'false', REAL_PRODUCTION_INPUT: 'dashboard://v2.10',
    RENDER_MODE: 'QUALITY', VIDEO_PROVIDER: input.qualityVideoProfile.provider, AUDIO_PROVIDER: audioProvider,
    QUALITY_VIDEO_PROVIDER: input.qualityVideoProfile.provider, QUALITY_VIDEO_MODEL: input.qualityVideoProfile.model,
    QUALITY_VIDEO_PROFILE: input.qualityVideoProfile.name,
    LIVE_PRODUCTION_WORKER_ID: env.LIVE_PRODUCTION_WORKER_ID || `v2.10:${process.pid}` };
}

function executionIdentitySource(canonicalInput, version = V210_EXECUTION_IDENTITY_VERSION) {
  const identitySource = { ...canonicalInput };
  delete identitySource.fingerprint;
  delete identitySource.productionKey;
  delete identitySource.liveTestKey;
  return Object.freeze({ executionIdentityVersion: version, canonicalInput: identitySource });
}

function revisionSafeProductionKey(draftId, canonicalInput) {
  if (!draftId || !canonicalInput) throw new V210RuntimeError('V210_EXECUTION_IDENTITY_REQUIRED',
    'Draft identity and canonical input are required for revision-safe production identity');
  const executionIdentityFingerprint = stableFingerprint(executionIdentitySource(canonicalInput));
  return Object.freeze({
    productionKey: `v210-${draftId}-${executionIdentityFingerprint.slice(0, 16)}`,
    executionIdentityFingerprint,
    executionIdentityVersion: V210_EXECUTION_IDENTITY_VERSION,
  });
}

function persistedDraftScope(draft) {
  const workspaceId = draft?.workspace_id || draft?.workspaceId || null;
  const brandId = draft?.brand_id || draft?.brandId || null;
  if (!workspaceId || !brandId) {
    throw new V210RuntimeError('V210_DRAFT_SCOPE_REQUIRED',
      'Persisted V2.10 workspace and brand scope are required for canonical preflight and START');
  }
  return Object.freeze({ workspaceId, brandId });
}

function revisionSafeCanonical({ draft, preflight }) {
  const canonical = buildCanonicalV210Input({ draft, preflight });
  const scope = persistedDraftScope(draft);
  if (canonical.input.brandId !== scope.brandId) {
    throw new V210RuntimeError('V210_DRAFT_SCOPE_MISMATCH',
      'Canonical brand does not match the persisted V2.10 draft scope');
  }
  // LiveProductionService.prepare() has always added workspaceId from the active
  // brand before preflight, but START/createDraft historically received the
  // unscoped canonical input. On legacy databases where productions.workspace_id
  // is nullable that allowed a transient NULL-workspace INSERT followed by a
  // `workspace_id = NULL` lookup that can never match. Scope the canonical input
  // before identity/fingerprinting so FINAL PREFLIGHT and START certify and use
  // the exact same durable workspace-owned object.
  const scopedBase = { ...canonical.input, workspaceId: scope.workspaceId };
  delete scopedBase.fingerprint;
  const identity = revisionSafeProductionKey(draft.id, scopedBase);
  const normalized = { ...scopedBase, productionKey: identity.productionKey, liveTestKey: identity.productionKey };
  const input = Object.freeze({ ...normalized, fingerprint: stableFingerprint(normalized) });
  const raw = Object.freeze({ ...canonical.raw, production_key: identity.productionKey });
  return Object.freeze({ ...canonical, raw, input, scope, ...identity });
}

class V210IntegratedProductionStarter extends V210CanonicalProductionStarter {
  constructor(options={}){super(options);this.continuityAuthority=options.continuityAuthority||null;}
  runtime(input, live) {
    const env = integratedEnvironment(this.env, input, live);
    const config = this.configResolver(env, input);
    const runtime = createProductionRuntime({ db: this.db, storage: this.storage, config, env, logger: this.logger,
      mediaInspector: this.mediaInspector,
      mediaExecutorDecorator: (delegate) => new V210ReferenceAwareMediaExecutor({ delegate, storage: this.storage,
        continuityAuthority:this.continuityAuthority }),
      masterRenderer: new V210PostProductionRenderer({ postProduction: input.postProduction || null }),
    });
    return { ...runtime, config, env };
  }

  async preflight({ draft, preflight }) {
    const canonical = revisionSafeCanonical({ draft, preflight });
    const runtime = this.runtime(canonical.input, false);
    const prepared = await runtime.service.prepare({ input: canonical.input, config: runtime.config });
    const workflowAuthority = await persistV210WorkflowRevision({ storage: this.storage, draft, canonical });
    return Object.freeze({ canonicalInputFingerprint: canonical.input.fingerprint, plan: prepared.plan,
      providerExecutions: 0, canonical, workflowAuthority });
  }

  lockedFirstVideoProjection({ draft, preflight, keyframe }) {
    const canonical = revisionSafeCanonical({ draft, preflight });
    const asset = canonical.input.assetPlan.assets.find((item) => item.asset_id === keyframe.asset_id && item.kind === 'video');
    if (!asset) throw new LockedKeyframeError('FIRST_VIDEO_ASSET_MISSING',
      `Canonical production has no video asset '${keyframe.asset_id}' for the approved keyframe`);
    const plan = buildFirstVideoStagePlan({ draft, canonical, keyframe, executionAsset: asset,
      semantic: { provider: this.env.SEMANTIC_VISUAL_PROVIDER, model: this.env.SEMANTIC_VISUAL_MODEL } });
    return Object.freeze({ canonical, asset, plan });
  }

  async preflightLockedFirstVideo({ draft, preflight, keyframe }) {
    const projection = this.lockedFirstVideoProjection({ draft, preflight, keyframe });
    const runtime = this.runtime(projection.canonical.input, false);
    const selection = runtime.mediaExecutor.selection(projection.asset);
    if (selection.provider !== projection.plan.provider || selection.model !== projection.plan.model) {
      throw new LockedKeyframeError('FIRST_VIDEO_PROVIDER_MISMATCH',
        'Prepared bounded execution differs from the authoritative provider/model selection');
    }
    return Object.freeze({ ...projection, providerExecutions: 0 });
  }

  async ensureLockedProduction({ draft, preflight, actor, productionId }) {
    const canonical = revisionSafeCanonical({ draft, preflight });
    const runtime = this.runtime(canonical.input, true);
    this.credentialCheck({ config: runtime.config, input: canonical.input, env: runtime.env });
    const rows = await runtime.service.createDraft({ input: canonical.input, config: runtime.config,
      command: { source: 'v2.10-locked-keyframe', requestId: draft.id, actor,
        productionId, canonicalRawInput: canonical.raw, canonicalRequest: canonical.canonicalRequest } });
    if (rows.production.id !== productionId) throw new LockedKeyframeError('LOCKED_PRODUCTION_ID_MISMATCH',
      'Canonical production does not match the preallocated locked-keyframe production identity');
    return Object.freeze({ canonical, runtime, production: rows.production, job: rows.job });
  }

  async startLockedFirstVideo({ draft, preflight, keyframe, actor, productionId, expectedFingerprint,
    beforeProviderBoundary = null }) {
    if (this.env.LIVE_PAID_GENERATION !== 'true') throw new LockedKeyframeError('V210_EXECUTION_DISABLED',
      'LIVE_PAID_GENERATION=true is required after reviewing the first-video preflight');
    const projection = this.lockedFirstVideoProjection({ draft, preflight, keyframe });
    if (!expectedFingerprint || projection.plan.fingerprint !== expectedFingerprint) {
      throw new LockedKeyframeError('STALE_LOCKED_STAGE_PREFLIGHT', 'First-video input changed after authoritative preflight');
    }
    const prepared = await this.ensureLockedProduction({ draft, preflight, actor, productionId });
    if (beforeProviderBoundary) await beforeProviderBoundary();
    const media = await prepared.runtime.mediaExecutor.execute({ workspaceId: projection.canonical.input.workspaceId,
      productionId, brandId: projection.canonical.input.brandId,
      workerId: prepared.runtime.config.workerId, asset: projection.asset });
    const quality = await prepared.runtime.visualQualityEvaluator.evaluate({ media,
      creativePlan: projection.canonical.input.creativePlan,
      expectedAspectRatio: projection.canonical.input.aspectRatio || '9:16', intendedContentType: 'cinematic',
      qualityTier: projection.canonical.input.qualityVideoProfile?.name || 'STANDARD',
      provider: media.provider, model: media.model,
      generationSettings: projection.asset.generation_requirements || {}, motionExpected: true,
      evaluationClass: 'SOURCE', semanticEvaluationRequired: true });
    return Object.freeze({ productionId, jobId: prepared.job.id, media, quality,
      accepted: quality.status !== 'FAIL', canonicalInputFingerprint: projection.canonical.input.fingerprint,
      executionFingerprint: projection.plan.executionFingerprint, plan: projection.plan,
      remainingProductionScheduled: false, publicationTriggered: false });
  }

  async start({ draft, preflight, actor }) {
    if (this.env.LIVE_PAID_GENERATION !== 'true') {
      throw new V210RuntimeError('V210_EXECUTION_DISABLED',
        'LIVE_PAID_GENERATION=true is required after reviewing the final V2.10 preflight');
    }
    const canonical = revisionSafeCanonical({ draft, preflight });
    await new ProductionExecutionAuthority({ repository: this.repository, storage: this.storage }).assertAuthorized({ draft, preflight, canonical });
    const runtime = this.runtime(canonical.input, true);
    try { this.credentialCheck({ config: runtime.config, input: canonical.input, env: runtime.env }); }
    catch (error) {
      throw new V210RuntimeError(error.code || 'V210_CREDENTIALS_MISSING', error.message,
        { boundaryState: 'NOT_CROSSED' });
    }
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

module.exports = { V210_EXECUTION_IDENTITY_VERSION, V210IntegratedProductionStarter, executionIdentitySource,
  integratedEnvironment, persistedDraftScope, revisionSafeCanonical, revisionSafeProductionKey };
