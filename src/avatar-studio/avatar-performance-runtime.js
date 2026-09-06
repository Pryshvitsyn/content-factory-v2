'use strict';

// Provider-neutral, durable execution boundary for talking-avatar vendors.  This
// module deliberately does not use ProviderGateway: its legacy auto/fallback
// behaviour is not safe for an approved paid avatar route.
const crypto = require('node:crypto');
const { AvatarStudioError, fingerprint, requiredText } = require('./domain');

const AVATAR_PROVIDERS = Object.freeze(['HEYGEN', 'TAVUS', 'DID']);
const AUDIO_STRATEGIES = Object.freeze(['EXTERNAL_AUDIO', 'PROVIDER_NATIVE']);
const PRICE_STATUSES = Object.freeze(['KNOWN_CURRENT_PRICE', 'UNKNOWN_CURRENT_PRICE', 'ENTITLEMENT_REQUIRED']);
const BINDING_STATUSES = Object.freeze(['ACTIVE', 'SUPERSEDED', 'REVOKED', 'PROVISIONING_FAILED']);

const AVATAR_PROVIDER_CAPABILITIES = Object.freeze({
  HEYGEN: Object.freeze({
    apiVersion: 'V3', provisioning: Object.freeze(['HEYGEN_PHOTO_AVATAR_API', 'HEYGEN_DIGITAL_TWIN_PREBOUND', 'HEYGEN_DIGITAL_TWIN_API']),
    render: Object.freeze(['AVATAR_IV', 'AVATAR_V']), audioStrategies: Object.freeze(['EXTERNAL_AUDIO', 'PROVIDER_NATIVE']),
    entitlementGates: Object.freeze(['HEYGEN_DIGITAL_TWIN_API']), supportsIdempotencyKey: true,
  }),
  TAVUS: Object.freeze({
    apiVersion: 'V1', provisioning: Object.freeze(['TAVUS_REPLICA_API']), render: Object.freeze(['TAVUS_REPLICA']),
    audioStrategies: Object.freeze(['EXTERNAL_AUDIO', 'PROVIDER_NATIVE']), entitlementGates: Object.freeze([]), supportsIdempotencyKey: true,
  }),
  DID: Object.freeze({
    apiVersion: 'V3', provisioning: Object.freeze(['DID_INSTANT_AVATAR_API']), render: Object.freeze(['DID_SCENE']),
    audioStrategies: Object.freeze(['EXTERNAL_AUDIO', 'PROVIDER_NATIVE']), entitlementGates: Object.freeze([]), supportsIdempotencyKey: true,
  }),
});

const IMPULSEOFF_CALM_SELF_V1 = Object.freeze({
  id: 'IMPULSEOFF_CALM_SELF_V1', aspectRatio: '9:16', framing: 'CHEST_UP', durationMinSeconds: 2, durationMaxSeconds: 10,
  expressionTarget: 'CALM_ATTENTIVE', eyeContact: 'NATURAL_DIRECT', cameraPolicy: 'LOCKED_OR_NEARLY_LOCKED',
  headMotion: 'MINIMAL', bodyMotion: 'MINIMAL', handGesture: 'MINIMAL', dramaticPerformance: 'PROHIBITED',
  identityPolicy: 'STABLE_FACE_AND_BODY_GEOMETRY', delivery: 'PRE_RENDERED_CERTIFIED_CLIP_PACK_ONLY',
});

function provider(value) {
  const name = String(value || '').trim().toUpperCase();
  if (!AVATAR_PROVIDERS.includes(name)) throw new AvatarStudioError(400, 'AVATAR_PROVIDER_INVALID', 'Choose HEYGEN, TAVUS, or DID');
  return name;
}
function audioStrategy(value) {
  const result = String(value || '').trim().toUpperCase();
  if (!AUDIO_STRATEGIES.includes(result)) throw new AvatarStudioError(400, 'AVATAR_AUDIO_STRATEGY_INVALID', 'Choose EXTERNAL_AUDIO or PROVIDER_NATIVE');
  return result;
}
function noAuto(name, value) {
  const result = requiredText(name, value);
  if (result.toUpperCase() === 'AUTO') throw new AvatarStudioError(400, 'AVATAR_EXPLICIT_ROUTE_REQUIRED', `${name} must be explicit; AUTO is not permitted for Avatar Performance`);
  return result;
}
function canonicalPerformanceCapture(input = {}) {
  const technical = input.technicalEvidence || {};
  const duration = Number(technical.durationMs ?? input.durationMs);
  const width = Number(technical.width ?? input.width); const height = Number(technical.height ?? input.height);
  if (!input.artifactId || !Number.isInteger(Number(input.artifactVersion)) || Number(input.artifactVersion) < 1) {
    throw new AvatarStudioError(400, 'PERFORMANCE_CAPTURE_ARTIFACT_REQUIRED', 'Performance Capture requires an immutable artifact and version');
  }
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || !requiredText('codec', technical.codec || input.codec)) {
    throw new AvatarStudioError(400, 'PERFORMANCE_CAPTURE_TECHNICAL_EVIDENCE_REQUIRED', 'Performance Capture requires duration, dimensions, codec and fps evidence');
  }
  const fps = Number(technical.fps ?? input.fps); if (!Number.isFinite(fps) || fps <= 0) throw new AvatarStudioError(400, 'PERFORMANCE_CAPTURE_TECHNICAL_EVIDENCE_REQUIRED', 'Performance Capture requires fps evidence');
  if (input.humanApproved !== true) throw new AvatarStudioError(409, 'PERFORMANCE_CAPTURE_APPROVAL_REQUIRED', 'A human approval is required for Performance Capture');
  const canonical = { workspaceId: requiredText('workspaceId', input.workspaceId), avatarId: requiredText('avatarId', input.avatarId),
    identityVersionId: requiredText('identityVersionId', input.identityVersionId), artifactId: requiredText('artifactId', input.artifactId),
    artifactVersion: Number(input.artifactVersion), contentHash: requiredText('contentHash', input.contentHash),
    technicalEvidence: { durationMs: duration, width, height, codec: requiredText('codec', technical.codec || input.codec), fps },
    provenance: Object.freeze({ ...(input.provenance || {}) }), humanApproved: true, approvalEvidence: Object.freeze({ ...(input.approvalEvidence || {}) }) };
  return Object.freeze({ ...canonical, fingerprint: fingerprint(canonical) });
}

function canonicalProviderConsent(input = {}) {
  if (!input.artifactId || !Number.isInteger(Number(input.artifactVersion)) || Number(input.artifactVersion) < 1) {
    throw new AvatarStudioError(400, 'PROVIDER_CONSENT_EVIDENCE_REQUIRED', 'Provider-specific consent must reference an immutable artifact version');
  }
  const canonical = { provider: provider(input.provider), artifactId: String(input.artifactId), artifactVersion: Number(input.artifactVersion),
    contentHash: requiredText('providerConsentEvidence.contentHash', input.contentHash), consentType: requiredText('providerConsentEvidence.consentType', input.consentType),
    capturedAt: input.capturedAt || null, expiresAt: input.expiresAt || null };
  return Object.freeze({ ...canonical, fingerprint: fingerprint(canonical) });
}

function canonicalProviderBinding(input = {}) {
  const selectedProvider = provider(input.provider); const matrix = AVATAR_PROVIDER_CAPABILITIES[selectedProvider];
  const type = requiredText('providerBindingType', input.providerBindingType).toUpperCase();
  if (!matrix.provisioning.includes(type)) throw new AvatarStudioError(400, 'PROVIDER_BINDING_TYPE_UNSUPPORTED', `${type} is not supported by ${selectedProvider}`);
  if (matrix.entitlementGates.includes(type) && input.entitlementVerified !== true) {
    throw new AvatarStudioError(409, 'PROVIDER_ENTITLEMENT_REQUIRED', `${selectedProvider} ${type} requires a verified provider entitlement`);
  }
  const capture = input.performanceCapture || null;
  if (['HEYGEN_DIGITAL_TWIN_API', 'TAVUS_REPLICA_API', 'DID_INSTANT_AVATAR_API'].includes(type) && !capture?.id && !capture?.performanceCaptureId) {
    throw new AvatarStudioError(409, 'PERFORMANCE_CAPTURE_REQUIRED', `${type} requires approved Performance Capture`);
  }
  const consent = input.providerConsentEvidence ? canonicalProviderConsent({ ...input.providerConsentEvidence, provider: selectedProvider }) : null;
  const canonical = { workspaceId: requiredText('workspaceId', input.workspaceId), avatarId: requiredText('avatarId', input.avatarId),
    identityVersionId: requiredText('identityVersionId', input.identityVersionId), passportCertificationId: requiredText('passportCertificationId', input.passportCertificationId),
    provider: selectedProvider, providerBindingType: type, providerExternalId: requiredText('providerExternalId', input.providerExternalId),
    providerEngineCapabilities: Object.freeze([...(input.providerEngineCapabilities || [])].map(String).sort()),
    performanceCaptureId: capture?.id || capture?.performanceCaptureId || input.performanceCaptureId || null, providerConsentEvidence: consent,
    bindingRevision: Number.isInteger(Number(input.bindingRevision)) && Number(input.bindingRevision) > 0 ? Number(input.bindingRevision) : 1,
    status: 'ACTIVE', provisioningEvidence: Object.freeze({ ...(input.provisioningEvidence || {}) }), providerRequestId: input.providerRequestId || null };
  return Object.freeze({ ...canonical, fingerprint: fingerprint(canonical) });
}

function canonicalPerformanceContract(input = {}) {
  const selectedProvider = provider(input.provider); const binding = input.providerBinding || {};
  if (provider(binding.provider) !== selectedProvider || !binding.id || binding.status !== 'ACTIVE') throw new AvatarStudioError(409, 'AVATAR_PROVIDER_BINDING_REQUIRED', 'An active explicit provider binding is required');
  const strategy = audioStrategy(input.audioStrategy); const engine = noAuto('providerEngine', input.providerEngine);
  if (!AVATAR_PROVIDER_CAPABILITIES[selectedProvider].render.includes(engine)) throw new AvatarStudioError(400, 'AVATAR_PROVIDER_ENGINE_UNSUPPORTED', `${engine} is not an explicit supported engine for ${selectedProvider}`);
  if (!AVATAR_PROVIDER_CAPABILITIES[selectedProvider].audioStrategies.includes(strategy)) throw new AvatarStudioError(400, 'AVATAR_AUDIO_STRATEGY_UNSUPPORTED', `${selectedProvider} does not support ${strategy}`);
  const audio = input.audioArtifact || null;
  if (strategy === 'EXTERNAL_AUDIO' && (!audio?.artifactId || !Number.isInteger(Number(audio.artifactVersion)) || !audio.contentHash)) {
    throw new AvatarStudioError(400, 'EXTERNAL_AUDIO_ARTIFACT_REQUIRED', 'EXTERNAL_AUDIO requires an immutable audio artifact reference');
  }
  const canonical = { workspaceId: requiredText('workspaceId', input.workspaceId), brandId: requiredText('brandId', input.brandId), avatarId: requiredText('avatarId', input.avatarId),
    identityVersionId: requiredText('identityVersionId', input.identityVersionId), provider: selectedProvider, providerBindingId: binding.id,
    providerBindingRevision: Number(binding.bindingRevision), providerEngine: engine, performanceProfile: requiredText('performanceProfile', input.performanceProfile),
    script: requiredText('script', input.script), audioStrategy: strategy, audioArtifact: audio ? Object.freeze({ artifactId: audio.artifactId, artifactVersion: Number(audio.artifactVersion), contentHash: audio.contentHash }) : null,
    language: requiredText('language', input.language), framing: requiredText('framing', input.framing), aspectRatio: requiredText('aspectRatio', input.aspectRatio),
    durationPolicy: Object.freeze({ ...(input.durationPolicy || {}) }), expressionTarget: requiredText('expressionTarget', input.expressionTarget),
    gestureIntensity: requiredText('gestureIntensity', input.gestureIntensity), cameraPolicy: requiredText('cameraPolicy', input.cameraPolicy),
    backgroundPolicy: requiredText('backgroundPolicy', input.backgroundPolicy), outputFormat: requiredText('outputFormat', input.outputFormat), qaProfile: requiredText('qaProfile', input.qaProfile) };
  if (!Number.isInteger(canonical.providerBindingRevision) || canonical.providerBindingRevision < 1) throw new AvatarStudioError(409, 'AVATAR_PROVIDER_BINDING_REVISION_REQUIRED', 'Binding revision is invalid');
  return Object.freeze({ ...canonical, requestFingerprint: fingerprint(canonical) });
}

function impulseOffCalmSelfContract(input = {}) {
  const duration = Number(input.durationSeconds ?? input.durationPolicy?.requestedSeconds);
  if (!Number.isFinite(duration) || duration < 2 || duration > 10) throw new AvatarStudioError(400, 'IMPULSEOFF_DURATION_INVALID', 'ImpulseOff Calm Self clips must be 2–10 seconds');
  return canonicalPerformanceContract({ ...input, performanceProfile: 'IMPULSEOFF_CALM_SELF_V1', aspectRatio: '9:16', framing: 'CHEST_UP',
    expressionTarget: 'CALM_ATTENTIVE', gestureIntensity: 'MINIMAL', cameraPolicy: 'LOCKED_OR_NEARLY_LOCKED', backgroundPolicy: input.backgroundPolicy || 'APPROVED_NEUTRAL',
    durationPolicy: { minSeconds: 2, maxSeconds: 10, requestedSeconds: duration } });
}

function safeProviderError(error) { return { code: String(error?.code || 'AVATAR_PROVIDER_RUNTIME_FAILURE').slice(0, 120), status: Number(error?.status) || null }; }

class AvatarPerformanceRuntimeService {
  constructor({ repository, adapters = {}, artifactService = null, assetIntakeService = null, automaticQa = null, env = process.env, actor = 'local-operator' } = {}) {
    if (!repository) throw new Error('repository is required'); this.repository = repository; this.adapters = adapters; this.artifactService = artifactService;
    this.assetIntakeService = assetIntakeService; this.automaticQa = automaticQa; this.env = env; this.actor = actor;
  }
  async createPerformanceCapture(input) { const capture = canonicalPerformanceCapture(input); return this.repository.createPerformanceCapture({ capture, actor: this.actor }); }
  async createProviderBinding(input) { const binding = canonicalProviderBinding(input); return this.repository.createAvatarProviderBinding({ binding, actor: this.actor }); }
  async supersedeProviderBinding(input) { const replacement = canonicalProviderBinding(input); return this.repository.supersedeAvatarProviderBinding({ previousBindingId: input.previousBindingId, replacement, actor: this.actor }); }
  async preflight(input = {}) {
    const binding = await this.repository.avatarProviderBinding({ id: input.providerBindingId, workspaceId: input.workspaceId, avatarId: input.avatarId });
    const contract = input.performanceProfile === 'IMPULSEOFF_CALM_SELF_V1' ? impulseOffCalmSelfContract({ ...input, providerBinding: binding }) : canonicalPerformanceContract({ ...input, providerBinding: binding });
    const price = input.price || { status: 'UNKNOWN_CURRENT_PRICE' }; const priceStatus = String(price.status || '').toUpperCase();
    if (!PRICE_STATUSES.includes(priceStatus)) throw new AvatarStudioError(400, 'AVATAR_PRICE_STATUS_INVALID', 'Provider price status is invalid');
    const blockers = [];
    if (priceStatus !== 'KNOWN_CURRENT_PRICE') blockers.push({ code: priceStatus, message: priceStatus === 'ENTITLEMENT_REQUIRED' ? 'Provider entitlement verification is required' : 'Current provider price is not verified' });
    const snapshot = Object.freeze({ contract, bindingFingerprint: binding.fingerprint, price: { status: priceStatus, amountUsd: price.amountUsd ?? null, checkedAt: price.checkedAt || null },
      providerCalls: 0, externalGenerationCalls: 0, readiness: blockers.length ? 'BLOCKED' : 'READY' });
    return Object.freeze({ ...snapshot, preflightFingerprint: fingerprint(snapshot), blockers });
  }
  async createExecution({ preflight } = {}) {
    if (!preflight?.contract || preflight.readiness !== 'READY') throw new AvatarStudioError(409, 'AVATAR_PERFORMANCE_PREFLIGHT_BLOCKED', 'A READY, exact provider preflight is required');
    return this.repository.createAvatarPerformanceExecution({ preflight, actor: this.actor });
  }
  async approve({ executionId, explicitConfirmation = false } = {}) {
    if (explicitConfirmation !== true) throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED', 'Explicit human approval is required');
    const execution = await this.repository.avatarPerformanceExecution({ id: executionId });
    if (!execution || execution.preflightSnapshot?.readiness !== 'READY') throw new AvatarStudioError(409, 'AVATAR_PERFORMANCE_PREFLIGHT_REQUIRED', 'A READY immutable preflight is required');
    return this.repository.approveAvatarPerformanceExecution({ execution, actor: this.actor });
  }
  async generate({ executionId, avatar } = {}) {
    if (this.env.LIVE_PAID_GENERATION !== 'true') throw new AvatarStudioError(409, 'AVATAR_PERFORMANCE_LIVE_EXECUTION_DISABLED', 'Avatar provider execution is disabled by LIVE_PAID_GENERATION');
    const execution = await this.repository.avatarPerformanceExecution({ id: executionId });
    if (!execution?.approval) throw new AvatarStudioError(409, 'EXECUTION_APPROVAL_REQUIRED', 'An approved immutable execution is required');
    if ((execution.attempts || []).length) throw new AvatarStudioError(409, 'AVATAR_PERFORMANCE_ALREADY_ATTEMPTED', 'No automatic retry is allowed after an Avatar provider boundary');
    const contract = execution.preflightSnapshot.contract; const adapter = this.adapters[contract.provider];
    if (!adapter) throw new AvatarStudioError(503, 'AVATAR_PROVIDER_ADAPTER_UNAVAILABLE', `No adapter is configured for ${contract.provider}`);
    const attempt = await this.repository.createAvatarPerformanceAttempt({ execution, actor: this.actor });
    await this.repository.recordAvatarPerformanceAttemptEvent({ attempt, status: 'PROVIDER_INTENT_PERSISTED', actor: this.actor });
    await this.repository.recordAvatarPerformanceAttemptEvent({ attempt, status: 'MAY_HAVE_STARTED', mayHaveStarted: true, actor: this.actor });
    try {
      const dispatchContract = contract.audioStrategy === 'EXTERNAL_AUDIO' ? { ...contract, audioArtifact: { ...contract.audioArtifact,
        ...(await adapter.materializeAudio({ artifact: contract.audioArtifact, contract })) } } : contract;
      const result = await adapter.generate({ contract: dispatchContract, binding: execution.binding || null, idempotencyKey: attempt.idempotencyKey,
        onProviderRequest: async ({ requestId, status = 'SUBMITTED' }) => this.repository.recordAvatarPerformanceAttemptEvent({ attempt, status, providerRequestId: requestId, mayHaveStarted: true, actor: this.actor }) });
      if (!Buffer.isBuffer(result.output) || !result.output.length) throw new AvatarStudioError(502, 'AVATAR_PROVIDER_OUTPUT_UNAVAILABLE', 'Provider output must be materialized as bytes before it can become canonical');
      const raw = this.artifactService ? await this.artifactService.createVersion({ artifactId: `avatar-performance-raw-${attempt.id}`, type: 'binary', content: result.output,
        stageId: 'AVATAR_PERFORMANCE_RAW_PROVIDER_OUTPUT', attemptId: attempt.id, idempotencyKey: `avatar-performance-raw:${attempt.id}`, provider: contract.provider, model: contract.providerEngine, validationStatus: 'RAW_PROVIDER_SUCCESS' }) : null;
      await this.repository.recordAvatarPerformanceAttemptEvent({ attempt, status: 'PROVIDER_OUTPUT_CHECKPOINTED', providerRequestId: result.requestId || null, mayHaveStarted: true, rawArtifact: raw, actor: this.actor });
      if (!this.assetIntakeService || !avatar) throw new AvatarStudioError(503, 'AVATAR_PERFORMANCE_INGESTION_UNAVAILABLE', 'Canonical Avatar output ingestion is not configured');
      const ingested = await this.assetIntakeService.ingestProviderVideoOutput({ avatar, brandId: contract.brandId, bytes: result.output, filename: 'avatar-performance-canonical.mp4', provider: contract.provider, model: contract.providerEngine, attemptId: attempt.id, providerRequestId: result.requestId, consentVerified: true,
        provenance: { source: 'AVATAR_PERFORMANCE_RUNTIME', contractFingerprint: contract.requestFingerprint, providerBindingId: contract.providerBindingId, providerBindingRevision: contract.providerBindingRevision, rawArtifactId: raw?.artifactId || null } });
      const qa = this.automaticQa ? await this.automaticQa({ contract, intake: ingested.asset }).catch((error) => ({ status: 'UNCERTAIN', reasonCode: error.code || 'AUTO_QA_RUNTIME_FAILURE' })) : { status: 'UNCERTAIN', reasonCode: 'AUTO_QA_NOT_CONFIGURED' };
      await this.repository.recordAvatarPerformanceAttemptEvent({ attempt, status: 'SUCCEEDED', providerRequestId: result.requestId || null, mayHaveStarted: true, rawArtifact: raw, actor: this.actor });
      const recorded = await this.repository.completeAvatarPerformanceAttempt({ attempt, result, raw, ingested, qa, actor: this.actor });
      return Object.freeze({ executionId, attempt: recorded, artifact: ingested.artifact, automaticQa: qa, humanCertification: 'NOT_CERTIFIED', providerCalls: 1, externalGenerationCalls: 1 });
    } catch (error) {
      await this.repository.recordAvatarPerformanceAttemptEvent({ attempt, status: 'NEEDS_RECONCILIATION', mayHaveStarted: true, error: safeProviderError(error), actor: this.actor });
      throw error;
    }
  }
  async recover({ executionId, attemptId } = {}) {
    const execution = await this.repository.avatarPerformanceExecution({ id: executionId }); const attempt = (execution?.attempts || []).find((item) => item.id === attemptId);
    if (!execution || !attempt?.providerRequestId) throw new AvatarStudioError(409, 'AVATAR_PERFORMANCE_RECOVERY_INELIGIBLE', 'A persisted provider request ID is required for recovery');
    const adapter = this.adapters[execution.preflightSnapshot.contract.provider];
    if (!adapter?.recover) throw new AvatarStudioError(409, 'PROVIDER_RECOVERY_UNSUPPORTED', 'This provider adapter cannot recover the persisted request');
    return adapter.recover({ requestId: attempt.providerRequestId, contract: execution.preflightSnapshot.contract });
  }
  async certify({ executionId, resultId, decision, humanNote = null } = {}) {
    const execution = await this.repository.avatarPerformanceExecution({ id: executionId });
    if (!execution?.result || execution.result.id !== resultId) throw new AvatarStudioError(404, 'AVATAR_PERFORMANCE_RESULT_NOT_FOUND', 'The exact immutable result is required for human certification');
    return this.repository.certifyAvatarPerformanceResult({ result: execution.result, decision, humanNote, actor: this.actor });
  }
  async benchmark({ workspaceId, brandId, avatarId, identityVersionId, commonIntent, bindings, priceByProvider = {} } = {}) {
    const requested = Object.fromEntries((bindings || []).map((item) => [provider(item.provider), item]));
    if (!AVATAR_PROVIDERS.every((name) => requested[name])) throw new AvatarStudioError(400, 'BENCHMARK_BINDINGS_REQUIRED', 'Benchmark requires explicit HEYGEN, TAVUS and DID bindings');
    const rows = [];
    for (const name of AVATAR_PROVIDERS) {
      const binding = requested[name]; const preflight = await this.preflight({ ...commonIntent, providerEngine: commonIntent.providerEngines?.[name] || commonIntent.providerEngine,
        workspaceId, brandId, avatarId, identityVersionId, provider: name, providerBindingId: binding.id, price: priceByProvider[name] || { status: 'UNKNOWN_CURRENT_PRICE' } });
      rows.push({ provider: name, bindingId: binding.id, bindingRevision: binding.bindingRevision, preflight, deviation: binding.capabilityDeviation || null });
    }
    const comparable = fingerprint({ identityVersionId, script: commonIntent.script, audioArtifact: commonIntent.audioArtifact, framing: commonIntent.framing, aspectRatio: commonIntent.aspectRatio, performanceProfile: commonIntent.performanceProfile, qaProfile: commonIntent.qaProfile });
    const benchmark = Object.freeze({ workspaceId, brandId, avatarId, identityVersionId, commonIntentFingerprint: comparable, executions: rows, providerCalls: 0, externalGenerationCalls: 0 });
    return this.repository.createAvatarProviderBenchmark({ benchmark, actor: this.actor });
  }
}

module.exports = { AVATAR_PROVIDERS, AUDIO_STRATEGIES, PRICE_STATUSES, BINDING_STATUSES, AVATAR_PROVIDER_CAPABILITIES, IMPULSEOFF_CALM_SELF_V1,
  canonicalPerformanceCapture, canonicalProviderConsent, canonicalProviderBinding, canonicalPerformanceContract, impulseOffCalmSelfContract, AvatarPerformanceRuntimeService };
