'use strict';

const { CAPABILITIES } = require('../v2.8/capabilities');

const SMOKE_KINDS = Object.freeze({
  PASSPORT: Object.freeze({ capability: CAPABILITIES.MULTI_VIEW_IDENTITY_REFERENCE, certifiedPassportRequired: false }),
  BODY: Object.freeze({ capability: CAPABILITIES.CHARACTER_BODY_REFERENCE, certifiedPassportRequired: true }),
});

function yesNo(value) { return value ? 'YES' : 'NO'; }
function enabledDisabled(value) { return value ? 'ENABLED' : 'DISABLED'; }

function consentReadiness(avatar, now = new Date()) {
  if (avatar?.subjectType === 'SYNTHETIC') return 'NOT_REQUIRED';
  const events = avatar?.consentEvents || [];
  const latest = events.find((item) => item.modality === 'FACE');
  if (latest) {
    const active = latest.status === 'APPROVED' && latest.eventType !== 'REVOKE'
      && (!latest.expiresAt || new Date(latest.expiresAt) > now);
    return active ? 'VALID' : 'INVALID';
  }
  return avatar?.consent?.status === 'APPROVED' || (avatar?.consentRecords || []).some((item) => item.status === 'APPROVED')
    ? 'VALID' : 'INVALID';
}

function identityLockReadiness(avatar) {
  return (avatar?.identityLocks || []).some((item) => item.identityVersionId === avatar.identityVersionId) ? 'CURRENT' : 'STALE';
}

function normalizedGate0(source, intake) {
  const status = String(intake?.effectiveGate0Status || source?.effectiveGate0Status || source?.gate0Status || 'BLOCK').toUpperCase();
  return ['PASS','REVIEW','BLOCK'].includes(status) ? status : 'BLOCK';
}

function costReadiness(costPlan) {
  if (costPlan?.knownTotalCost != null || ['KNOWN','VERIFIED'].includes(costPlan?.status)) return 'KNOWN';
  if (costPlan?.status === 'PARTIAL') return 'PARTIAL';
  return 'UNKNOWN';
}

function approvalReadiness({ execution, generationSpec }) {
  if (!execution?.approval) return 'MISSING';
  const approvalFingerprint = execution.approval.preflightFingerprint || execution.approval.preflight_fingerprint;
  const executionFingerprint = execution.preflightFingerprint || execution.preflight_fingerprint;
  const snapshot = execution.preflightSnapshot || execution.preflight_snapshot || execution.inputSnapshot || execution.input_snapshot || {};
  const planFingerprint = snapshot.generationPlanFingerprint || snapshot.generation_plan_fingerprint;
  if (!approvalFingerprint || approvalFingerprint !== executionFingerprint) return 'STALE';
  if (generationSpec && (execution.model !== generationSpec.preferredModel || execution.provider !== generationSpec.preferredProvider
    || (planFingerprint && planFingerprint !== generationSpec.planFingerprint))) return 'STALE';
  return 'VALID';
}

function buildSmokeReadiness({ kind = 'PASSPORT', env = {}, providerCatalog, avatar, source = null, intake = null,
  generationSpec = null, execution = null } = {}) {
  const normalizedKind = String(kind).toUpperCase(); const definition = SMOKE_KINDS[normalizedKind];
  if (!definition) { const error = new Error(`Unsupported Avatar smoke kind '${kind}'`); error.code = 'SMOKE_KIND_INVALID'; throw error; }
  const providers = providerCatalog?.listProviders?.() || [];
  const openai = providers.find((item) => item.id === 'openai');
  const openaiModels = providerCatalog?.listModels?.('openai') || [];
  const image2 = openaiModels.find((item) => item.modelId === 'gpt-image-2') || null;
  const selectedModelId = generationSpec?.preferredModel || execution?.model || image2?.modelId || null;
  const selectedModel = openaiModels.find((item) => item.modelId === selectedModelId) || null;
  const gate0 = normalizedGate0(source,intake); const consent = consentReadiness(avatar);
  const lock = identityLockReadiness(avatar); const certifiedPassport = (avatar?.passportCertificationEvents || [])
    .some((item) => item.identityVersionId === avatar.identityVersionId && item.explicitConfirmation !== false);
  const sourceEligible = Boolean((source || intake) && gate0 === 'PASS' && ['VALID','NOT_REQUIRED'].includes(consent));
  const costPlan = execution?.costPlan || execution?.cost_plan || generationSpec?.costPlan || generationSpec?.cost_plan || null;
  const budget = execution?.maximumAllowedCost ?? execution?.maximum_allowed_cost;
  const approval = approvalReadiness({ execution,generationSpec });
  const checks = Object.freeze({
    OPENAI_API_KEY: yesNo(Boolean(env.OPENAI_API_KEY)),
    LIVE_PAID_GENERATION: enabledDisabled(env.LIVE_PAID_GENERATION === 'true'),
    providerConfigured: yesNo(Boolean(openai?.configured)),
    gptImage2CatalogEntry: yesNo(Boolean(image2)),
    requiredCapability: yesNo(Boolean(image2?.capabilities?.includes(definition.capability))),
    sourceAssetEligible: yesNo(sourceEligible),
    gate0,
    consent,
    identityLock: lock,
    certifiedPassport: yesNo(certifiedPassport),
    costStatus: costReadiness(costPlan),
    budgetCeiling: Number.isFinite(Number(budget)) ? 'SET' : 'NOT_SET',
    humanApproval: approval,
  });
  const blockers = [];
  if (checks.OPENAI_API_KEY === 'NO') blockers.push('OPENAI_API_KEY_MISSING');
  if (checks.LIVE_PAID_GENERATION === 'DISABLED') blockers.push('LIVE_PAID_GENERATION_DISABLED');
  if (checks.providerConfigured === 'NO') blockers.push('PROVIDER_NOT_CONFIGURED');
  if (checks.gptImage2CatalogEntry === 'NO') blockers.push('GPT_IMAGE_2_NOT_REGISTERED');
  if (checks.requiredCapability === 'NO') blockers.push('REQUIRED_CAPABILITY_MISSING');
  if (checks.sourceAssetEligible === 'NO') blockers.push('SOURCE_ASSET_INELIGIBLE');
  if (checks.gate0 !== 'PASS') blockers.push(`GATE_0_${checks.gate0}`);
  if (!['VALID','NOT_REQUIRED'].includes(checks.consent)) blockers.push('CONSENT_INVALID');
  if (checks.identityLock !== 'CURRENT') blockers.push('IDENTITY_LOCK_STALE');
  if (definition.certifiedPassportRequired && checks.certifiedPassport !== 'YES') blockers.push('CERTIFIED_PASSPORT_REQUIRED');
  if (checks.budgetCeiling !== 'SET') blockers.push('BUDGET_CEILING_NOT_SET');
  if (checks.humanApproval !== 'VALID') blockers.push(`HUMAN_APPROVAL_${checks.humanApproval}`);
  return Object.freeze({ schemaVersion: 'avatar-smoke-readiness-v1', kind: normalizedKind, provider: 'openai',
    model: selectedModelId, modelStatus: selectedModel?.lifecycleStatus || null,
    capability: definition.capability, checks, ready: blockers.length === 0, blockers: Object.freeze(blockers),
    paidProviderCalls: 0, externalGenerationCalls: 0, secretsRedacted: true });
}

module.exports = { SMOKE_KINDS, approvalReadiness, buildSmokeReadiness, consentReadiness, costReadiness, identityLockReadiness };
