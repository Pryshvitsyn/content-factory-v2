'use strict';

const crypto = require('node:crypto');
const { AvatarStudioError, fingerprint } = require('./domain');
const { assertGateUsable } = require('./gate-zero');
const { analyzePassportCandidate } = require('./passport-qa');
const { PASSPORT_PROMPT_VERSION, PASSPORT_SPEC_VERSION } = require('./passport-plan-compiler');
const { PASSPORT_CALLS_PER_CANDIDATE, PASSPORT_PROVIDER_STRATEGY,
  compilePassportProviderRequest } = require('./passport-provider-compiler');

const FAILURE_CLASSIFICATIONS = Object.freeze(['PROVIDER_CONFIGURATION','PROVIDER_AUTH','PROVIDER_CAPABILITY',
  'PROVIDER_TIMEOUT','PROVIDER_RATE_LIMIT','PROVIDER_REJECTED_INPUT','PROVIDER_OUTPUT_INVALID','ARTIFACT_INGEST_FAILED',
  'SECURITY_REJECTED_OUTPUT','COST_CHANGED','BUDGET_EXCEEDED','CONSENT_INVALIDATED','GATE0_INVALIDATED','UNKNOWN']);

function safeFailure(error) {
  const code = String(error?.code || '').toUpperCase(); const status = Number(error?.status || error?.cause?.status || 0);
  let classification = 'UNKNOWN';
  if (code.includes('CREDENTIAL') || code.includes('CONFIGURATION') || code.includes('NOT_CONFIGURED')) classification = 'PROVIDER_CONFIGURATION';
  else if (status === 401 || status === 403 || code.includes('AUTH')) classification = 'PROVIDER_AUTH';
  else if (code.includes('CAPABILITY') || code.includes('MODEL_NOT_REGISTERED')) classification = 'PROVIDER_CAPABILITY';
  else if (status === 429 || code.includes('RATE_LIMIT')) classification = 'PROVIDER_RATE_LIMIT';
  else if (code.includes('TIMEOUT') || error?.name === 'AbortError') classification = 'PROVIDER_TIMEOUT';
  else if (code === 'PROVIDER_OUTPUT_INVALID') classification = 'PROVIDER_OUTPUT_INVALID';
  else if (code === 'SECURITY_REJECTED_OUTPUT') classification = 'SECURITY_REJECTED_OUTPUT';
  else if (code.includes('ARTIFACT')) classification = 'ARTIFACT_INGEST_FAILED';
  else if (status === 400 || status === 422 || code.includes('REJECTED_INPUT')) classification = 'PROVIDER_REJECTED_INPUT';
  return Object.freeze({ classification, safeMessage: classification === 'UNKNOWN'
    ? 'Provider execution failed; inspect the durable attempt without exposing credentials.'
    : `Passport generation failed: ${classification}.`, mayHaveSpent: !['PROVIDER_CONFIGURATION','PROVIDER_AUTH',
      'PROVIDER_CAPABILITY','PROVIDER_REJECTED_INPUT'].includes(classification) });
}

function numberOrNull(value) { return value == null || value === '' ? null : Number(value); }

class PassportExecutionService {
  constructor({ repository, providerCatalog, providerGateway, assetIntakeService, storage, env = process.env,
    actor = 'local-operator' } = {}) {
    if (!repository || !providerCatalog || !providerGateway || !assetIntakeService || !storage) {
      throw new Error('PassportExecutionService requires repository, providerCatalog, providerGateway, assetIntakeService and storage');
    }
    this.repository = repository; this.providerCatalog = providerCatalog; this.providerGateway = providerGateway;
    this.assetIntakeService = assetIntakeService; this.storage = storage; this.env = env; this.actor = actor;
  }

  async context(scope = {}) {
    for (const field of ['workspaceId','brandId','vertical','avatarId','identityVersionId']) {
      if (!scope[field]) throw new AvatarStudioError(400, 'PASSPORT_EXECUTION_SCOPE_REQUIRED',
        `Explicit ${field} is required for passport execution`);
    }
    const avatar = await this.repository.getCharacter({ id: scope.avatarId, brandId: scope.brandId });
    if (!avatar || avatar.workspaceId !== scope.workspaceId || avatar.verticalCode !== scope.vertical
      || avatar.identityVersionId !== scope.identityVersionId) throw new AvatarStudioError(409,
      'PASSPORT_EXECUTION_SCOPE_MISMATCH', 'Workspace, brand, vertical, avatar or Identity Version scope is stale');
    return avatar;
  }

  async buildPreflight({ generationSpecId, maximumAllowedCost, executionCandidateCount, ...scope } = {}) {
    const avatar = await this.context(scope);
    const spec = await this.repository.generationSpec({ id: generationSpecId, avatarId: avatar.id, brandId: scope.brandId });
    if (!spec) throw new AvatarStudioError(404, 'PASSPORT_GENERATION_SPEC_NOT_FOUND', 'Generation Spec was not found in this scope');
    if (spec.promptVersion !== PASSPORT_PROMPT_VERSION || spec.specVersion !== PASSPORT_SPEC_VERSION) {
      throw new AvatarStudioError(409, 'PASSPORT_PROMPT_SPEC_VERSION_STALE',
        'Prompt or Passport Spec version changed; create a new immutable Generation Spec and approval');
    }
    const lock = (avatar.identityLocks || []).find((item) => item.identityVersionId === avatar.identityVersionId);
    if (!lock || lock.id !== spec.identityLockVersionId) throw new AvatarStudioError(409, 'PASSPORT_IDENTITY_LOCK_STALE',
      'Generation Spec does not reference the current Identity Lock');
    const candidateCount = Number(executionCandidateCount || spec.requestedCandidateCount);
    if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > Number(spec.requestedCandidateCount)) {
      throw new AvatarStudioError(400, 'PASSPORT_EXECUTION_CANDIDATE_COUNT_INVALID',
        'Execution candidate count must be between 1 and the immutable planned candidate count');
    }
    const budget = Number(maximumAllowedCost);
    if (!Number.isFinite(budget) || budget < 0) throw new AvatarStudioError(400, 'MAXIMUM_ALLOWED_COST_REQUIRED',
      'Set an explicit non-negative maximum allowed cost');
    let selection;
    try {
      selection = this.providerCatalog.resolveSelection({ provider: spec.preferredProvider, model: spec.preferredModel,
        profile: 'PREMIUM', capability: 'MULTI_VIEW_IDENTITY_REFERENCE' });
    } catch (error) {
      throw new AvatarStudioError(error.status || 409, error.code || 'PROVIDER_CONFIGURATION', error.message, error.details);
    }
    const sourceAssets = []; const inputAssetVersions = [];
    for (const sourceId of spec.sourceAssetIds || []) {
      const source = await this.repository.source({ id: sourceId, avatarId: avatar.id });
      if (!source || source.brandId !== scope.brandId) throw new AvatarStudioError(409, 'GATE0_INVALIDATED',
        'Passport source is missing or outside the approved brand scope');
      try { assertGateUsable(source, { allowReview: false }); }
      catch (error) { throw new AvatarStudioError(409, 'GATE0_INVALIDATED', error.message); }
      if (!source.intakeAssetId) throw new AvatarStudioError(409, 'PASSPORT_SOURCE_INTAKE_REQUIRED',
        'Real generation requires an immutable V1.1 source intake');
      const intake = await this.repository.intake({ id: source.intakeAssetId, brandId: scope.brandId, avatarId: avatar.id });
      const eligibility = this.assetIntakeService.eligibility(intake, avatar, source.roles || []);
      if (!eligibility.eligible) {
        const consentFailure = eligibility.failures.some((item) => item.includes('CONSENT'));
        throw new AvatarStudioError(409, consentFailure ? 'CONSENT_INVALIDATED' : 'GATE0_INVALIDATED',
          'Source consent, rights or Gate 0 eligibility changed', eligibility);
      }
      sourceAssets.push(source); inputAssetVersions.push(Object.freeze({ sourceAssetId: source.id,
        intakeAssetId: intake.id, artifactId: intake.artifactId, artifactVersion: intake.artifactVersion,
        contentHash: intake.contentHash, gate0Status: intake.effectiveGate0Status }));
    }
    const perCandidate = numberOrNull(spec.costPlan?.knownPricePerCandidate);
    const knownTotalCost = perCandidate == null ? null : Number((perCandidate * candidateCount).toFixed(6));
    if (knownTotalCost != null && knownTotalCost > budget) throw new AvatarStudioError(409, 'BUDGET_EXCEEDED',
      'Known Passport generation cost exceeds MAXIMUM_ALLOWED_COST', { knownTotalCost, maximumAllowedCost: budget });
    const totalPlannedCalls = candidateCount * PASSPORT_CALLS_PER_CANDIDATE;
    const costPlan = Object.freeze({ status: knownTotalCost == null ? 'UNKNOWN' : 'KNOWN', currency: 'USD',
      knownPricePerCall: perCandidate, knownPricePerCandidate: perCandidate, knownTotalCost,
      maximumKnownSubtotal: knownTotalCost == null ? 0 : knownTotalCost,
      unknownElements: knownTotalCost == null ? Object.freeze(['PROVIDER_PRICE_PER_CALL','PROVIDER_PRICE_PER_CANDIDATE','TOTAL_COST']) : Object.freeze([]),
      maximumAllowedCost: budget, unknownIsZero: false });
    const snapshot = { schemaVersion: 'avatar-passport-execution-preflight-v1', workspaceId: scope.workspaceId,
      brandId: scope.brandId, vertical: scope.vertical, avatarId: scope.avatarId, identityVersionId: scope.identityVersionId,
      identityLockVersionId: lock.id, generationSpecId: spec.id, generationPlanFingerprint: spec.planFingerprint,
      provider: spec.preferredProvider, model: spec.preferredModel, adapterFamily: selection.adapterFamily,
      capability: 'MULTI_VIEW_IDENTITY_REFERENCE', profile: selection.profile, strategy: PASSPORT_PROVIDER_STRATEGY,
      candidateCount, callsPerCandidate: PASSPORT_CALLS_PER_CANDIDATE, totalPlannedCalls, costPlan,
      maximumAllowedCost: budget, inputAssetVersions, promptVersion: spec.promptVersion, specVersion: spec.specVersion,
      repairDelta: spec.repairDelta || null, originalGenerationSpecId: spec.originalGenerationSpecId || null };
    return Object.freeze({ avatar, spec, sourceAssets, selection, snapshot: Object.freeze(snapshot),
      preflightFingerprint: fingerprint(snapshot), status: 'PREFLIGHT_READY', providerCalls: 0, externalGenerationCalls: 0 });
  }

  async preflight(input) {
    const built = await this.buildPreflight(input);
    const execution = await this.repository.createPassportExecution({ preflight: built, actor: this.actor });
    await this.repository.addPassportExecutionEvent({ execution, status: 'PLANNED',
      details: { generationSpecId: built.spec.id, providerCalls: 0 }, actor: this.actor });
    await this.repository.addPassportExecutionEvent({ execution, status: 'PREFLIGHT_READY', details: { providerCalls: 0 }, actor: this.actor });
    await this.repository.addPassportExecutionEvent({ execution, status: 'AWAITING_APPROVAL', details: { approvalRequired: true }, actor: this.actor });
    return Object.freeze({ executionId: execution.id, ...built.snapshot, preflightFingerprint: built.preflightFingerprint,
      status: 'AWAITING_APPROVAL', humanApprovalRequired: true, providerCalls: 0, externalGenerationCalls: 0 });
  }

  async approve({ executionId, explicitConfirmation = false, unknownCostAcknowledged = false, ...scope } = {}) {
    if (!explicitConfirmation) throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED',
      'Explicit approval of the exact immutable execution proposal is required');
    const execution = await this.repository.passportExecution({ id: executionId, ...scope });
    if (!execution) throw new AvatarStudioError(404, 'PASSPORT_EXECUTION_NOT_FOUND', 'Execution proposal was not found in this scope');
    const fresh = await this.buildPreflight({ ...scope, generationSpecId: execution.generationSpecId,
      maximumAllowedCost: execution.maximumAllowedCost, executionCandidateCount: execution.candidateCount });
    if (fresh.preflightFingerprint !== execution.preflightFingerprint) throw new AvatarStudioError(409, 'STALE_PREFLIGHT',
      'Execution proposal changed; run a new preflight and approve again');
    if (fresh.snapshot.costPlan.status === 'UNKNOWN' && !unknownCostAcknowledged) throw new AvatarStudioError(409,
      'UNKNOWN_COST_ACKNOWLEDGEMENT_REQUIRED', 'UNKNOWN provider cost must be explicitly acknowledged');
    const approval = await this.repository.createPassportExecutionApproval({ execution, preflight: fresh,
      unknownCostAcknowledged, actor: this.actor });
    await this.repository.addPassportExecutionEvent({ execution, status: 'APPROVED', details: { approvalId: approval.id }, actor: this.actor });
    return Object.freeze({ approval, status: 'APPROVED', providerCalls: 0, externalGenerationCalls: 0 });
  }

  async generate({ executionId, ...scope } = {}) {
    if (this.env.LIVE_PAID_GENERATION !== 'true') throw new AvatarStudioError(409, 'PASSPORT_LIVE_EXECUTION_DISABLED',
      'Passport provider execution is disabled; explicitly enable the existing LIVE_PAID_GENERATION gate after cost review');
    const execution = await this.repository.passportExecution({ id: executionId, ...scope });
    if (!execution) throw new AvatarStudioError(404, 'PASSPORT_EXECUTION_NOT_FOUND', 'Execution was not found in this scope');
    if (!execution.approval) throw new AvatarStudioError(409, 'EXECUTION_APPROVAL_REQUIRED', 'No immutable approval exists for this execution');
    if ((execution.attempts || []).length) throw new AvatarStudioError(409, 'EXECUTION_ALREADY_ATTEMPTED',
      'This approved execution already has provider attempts; create a new preflight for retry spending');
    const fresh = await this.buildPreflight({ ...scope, generationSpecId: execution.generationSpecId,
      maximumAllowedCost: execution.maximumAllowedCost, executionCandidateCount: execution.candidateCount });
    if (fresh.preflightFingerprint !== execution.preflightFingerprint
      || execution.approval.preflightFingerprint !== execution.preflightFingerprint) throw new AvatarStudioError(409,
      'STALE_APPROVAL', 'Approval no longer matches the exact current execution proposal');
    if (fresh.snapshot.costPlan.knownTotalCost != null
      && fresh.snapshot.costPlan.knownTotalCost > Number(execution.approval.maximumAllowedCost)) throw new AvatarStudioError(409,
      'COST_CHANGED', 'Fresh known cost exceeds the approved maximum; new approval is required');
    await this.repository.addPassportExecutionEvent({ execution, status: 'QUEUED', details: {}, actor: this.actor });
    await this.repository.addPassportExecutionEvent({ execution, status: 'GENERATING', details: {}, actor: this.actor });
    const referenceImages = [];
    for (const source of fresh.sourceAssets) {
      const intake = await this.repository.intake({ id: source.intakeAssetId, brandId: scope.brandId, avatarId: scope.avatarId });
      referenceImages.push({ bytes: await this.storage.get({ key: intake.artifactStorageKey }),
        filename: intake.originalFilename, contentType: intake.mimeType });
    }
    const successful = []; const failures = [];
    for (let ordinal = 1; ordinal <= execution.candidateCount; ordinal += 1) {
      const compiled = compilePassportProviderRequest({ generationSpec: fresh.spec, sourceImages: referenceImages, candidateOrdinal: ordinal });
      const attempt = await this.repository.createPassportProviderAttempt({ execution, ordinal, request: compiled, actor: this.actor });
      await this.repository.addPassportProviderAttemptEvent({ attempt, status: 'STARTED', actor: this.actor });
      try {
        const result = await this.providerGateway.generate({ provider: execution.adapterFamily,
          model: execution.model, capability: compiled.capability, prompt: compiled.prompt,
          referenceImages: compiled.referenceImages, idempotencyKey: attempt.idempotencyKey });
        if (!Buffer.isBuffer(result.output)) throw Object.assign(new Error('Provider did not return inline image bytes'),
          { code: 'PROVIDER_OUTPUT_INVALID' });
        const ingested = await this.assetIntakeService.ingestProviderOutput({ avatar: fresh.avatar, brandId: scope.brandId,
          bytes: result.output, filename: `passport-candidate-${ordinal}.png`, mimeType: result.contentType,
          provider: execution.provider, model: execution.model, attemptId: attempt.id, providerRequestId: result.requestId,
          consentVerified: true, provenance: { executionId: execution.id, generationSpecId: fresh.spec.id,
            sourceAssetIds: fresh.spec.sourceAssetIds, identityVersionId: fresh.spec.identityVersionId,
            identityLockVersionId: fresh.spec.identityLockVersionId, promptVersion: fresh.spec.promptVersion,
            specVersion: fresh.spec.specVersion, repairDelta: fresh.spec.repairDelta || null,
            strategy: PASSPORT_PROVIDER_STRATEGY, candidateOrdinal: ordinal } });
        const source = await this.repository.useIntake({ avatar: fresh.avatar, intake: ingested.asset,
          roles: ['PASSPORT_CANDIDATE'], actor: this.actor });
        const candidate = await this.repository.createGeneratedPassportCandidate({ avatar: fresh.avatar,
          generationSpec: fresh.spec, intake: ingested.asset, source, execution, attempt, providerResult: result, actor: this.actor });
        const qa = analyzePassportCandidate({ width: ingested.asset.width, height: ingested.asset.height,
          evidence: { source: 'AUTOMATIC_POST_PROVIDER_INGEST', executionId: execution.id, attemptId: attempt.id } });
        const qaSnapshot = await this.repository.createPassportQaSnapshot({ candidate, qa, sourceEvidence: {
          artifactId: candidate.artifactId, artifactVersion: candidate.artifactVersion,
          identityVersionId: candidate.identityVersionId, identityLockVersionId: candidate.identityLockVersionId,
          referenceGeometryContract: 'V2.10.2_REFERENCE_GEOMETRY', continuityContract: 'V2.10_CONTINUITY_CONTRACT',
          executionId: execution.id, attemptId: attempt.id }, actor: this.actor });
        await this.repository.addPassportProviderAttemptEvent({ attempt, status: 'SUCCEEDED',
          providerRequestId: result.requestId, responseMetadata: { contentType: result.contentType,
            usage: result.usage || null, artifactId: candidate.artifactId, artifactVersion: candidate.artifactVersion },
          actualKnownCost: result.actualKnownCost, actor: this.actor });
        await this.repository.createPassportExecutionResult({ execution, attempt, candidate, intake: ingested.asset,
          artifact: ingested.artifact, providerResult: result, actor: this.actor });
        successful.push(Object.freeze({ candidate, qaSnapshot }));
      } catch (error) {
        const failure = safeFailure(error);
        await this.repository.addPassportProviderAttemptEvent({ attempt, status: 'FAILED',
          failureClassification: failure.classification, safeErrorMessage: failure.safeMessage,
          mayHaveSpent: failure.mayHaveSpent, actor: this.actor });
        failures.push(Object.freeze({ attemptId: attempt.id, ordinal, ...failure }));
      }
    }
    const status = successful.length === execution.candidateCount ? 'GENERATED'
      : successful.length ? 'PARTIAL_SUCCESS' : 'FAILED';
    await this.repository.addPassportExecutionEvent({ execution, status, details: { successCount: successful.length,
      failureCount: failures.length, callsExecuted: execution.candidateCount, automaticRetries: 0 }, actor: this.actor });
    return Object.freeze({ executionId: execution.id, status, successCount: successful.length,
      failureCount: failures.length, callsPlanned: execution.totalPlannedCalls, callsExecuted: execution.candidateCount,
      successful: Object.freeze(successful), failures: Object.freeze(failures), automaticRetries: 0 });
  }

  async inspect(input) { return this.repository.passportExecution(input); }

  async cancel({ executionId, ...scope } = {}) {
    const execution = await this.repository.passportExecution({ id: executionId, ...scope });
    if (!execution) throw new AvatarStudioError(404, 'PASSPORT_EXECUTION_NOT_FOUND', 'Execution was not found in this scope');
    if ((execution.attempts || []).length) throw new AvatarStudioError(409, 'EXECUTION_CANCELLATION_UNAVAILABLE',
      'Execution cannot be cancelled after a provider attempt exists');
    await this.repository.addPassportExecutionEvent({ execution, status: 'CANCELLED', details: { beforeProviderExecution: true }, actor: this.actor });
    return Object.freeze({ executionId, status: 'CANCELLED', providerCalls: 0 });
  }
}

module.exports = { FAILURE_CLASSIFICATIONS, PassportExecutionService, safeFailure };
