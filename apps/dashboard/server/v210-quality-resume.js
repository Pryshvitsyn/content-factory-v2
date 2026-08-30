'use strict';

const { revisionSafeCanonical } = require('../../../src/v2.10/integrated-starter');

function resumeError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

async function loadV210Draft({ creativeService, production }) {
  const db = creativeService?.repository?.db;
  if (!db?.query) throw resumeError(503, 'V210_RESUME_UNAVAILABLE', 'V2.10 draft repository is unavailable');
  const result = await db.query(`/* v2.10.1:quality-recovery-load-draft */
    SELECT * FROM v2_10.creative_drafts
    WHERE production_id=$1 AND workspace_id=$2 AND brand_id=$3
    ORDER BY updated_at DESC LIMIT 1`, [production.id, production.workspaceId, production.brandId]);
  const draft = result.rows[0];
  if (!draft) throw resumeError(409, 'V210_RESUME_DRAFT_NOT_FOUND',
    'The recovered production is not linked to a persisted V2.10 creative draft');
  return draft;
}

function assertRecoveryReady(production) {
  const recovery = production?.qualityRecovery;
  if (production?.jobStatus !== 'RETRYING' || recovery?.recovered !== true || recovery?.status !== 'READY_TO_CONTINUE') {
    throw resumeError(409, 'QUALITY_RECOVERY_NOT_READY_TO_CONTINUE',
      'Same-execution continuation requires a successfully recovered immutable source and RETRYING durable job state');
  }
  if (Number(production.ambiguousExecutions || 0) > 0) {
    throw resumeError(409, 'QUALITY_RECOVERY_EXECUTION_AMBIGUOUS',
      'External execution state is ambiguous; reconcile it before continuing the production');
  }
}

async function exactV210Context({ service, creativeService, productionId, brandId, live = false }) {
  if (!creativeService?.starter) throw resumeError(503, 'V210_RESUME_UNAVAILABLE', 'V2.10 production starter is unavailable');
  const production = await service.production(productionId, brandId);
  assertRecoveryReady(production);
  const draft = await loadV210Draft({ creativeService, production });
  if (String(draft.production_id) !== String(production.id) || draft.status !== 'STARTED') {
    throw resumeError(409, 'V210_RESUME_DRAFT_MISMATCH', 'Persisted V2.10 draft does not own this production');
  }
  if (!draft.final_preflight?.authoritativeVideo || !draft.final_preflight?.canonicalInputFingerprint) {
    throw resumeError(409, 'V210_RESUME_PREFLIGHT_MISSING', 'Persisted exact V2.10 preflight evidence is unavailable');
  }

  const canonical = revisionSafeCanonical({ draft, preflight: draft.final_preflight });
  const expectedFingerprint = draft.final_preflight.canonicalInputFingerprint;
  const storedFingerprint = production.metadata?.live_input_fingerprint || null;
  const storedKey = production.metadata?.production_key || production.metadata?.live_test_key || null;
  if (canonical.input.fingerprint !== expectedFingerprint || storedFingerprint !== expectedFingerprint) {
    throw resumeError(409, 'V210_RESUME_IDENTITY_MISMATCH',
      'Recovered execution identity does not match the immutable V2.10 preflight and production fingerprint', {
        canonicalInputFingerprint: canonical.input.fingerprint,
        preflightFingerprint: expectedFingerprint,
        storedFingerprint,
      });
  }
  if (storedKey && storedKey !== canonical.productionKey) {
    throw resumeError(409, 'V210_RESUME_KEY_MISMATCH', 'Recovered execution production key does not match the V2.10 canonical key');
  }

  const starter = creativeService.starter;
  const runtime = starter.runtime(canonical.input, live);
  const prepared = await runtime.service.prepare({ input: canonical.input, config: runtime.config });
  if (String(prepared.existing?.productionId || '') !== String(production.id)) {
    throw resumeError(409, 'V210_RESUME_PRODUCTION_MISMATCH', 'Exact canonical input resolved to a different production');
  }
  if (prepared.existing?.jobStatus !== 'RETRYING') {
    throw resumeError(409, 'V210_RESUME_JOB_NOT_RETRYING',
      `Recovered execution is ${prepared.existing?.jobStatus || 'UNKNOWN'}; refusing duplicate or stale continuation`);
  }
  return { production, draft, canonical, starter, runtime, prepared };
}

async function continuationPreflight({ service, creativeService, productionId, brandId }) {
  const context = await exactV210Context({ service, creativeService, productionId, brandId, live: false });
  const executions = typeof service.repository?.semanticRetryMediaExecutions === 'function'
    ? await service.repository.semanticRetryMediaExecutions(productionId, brandId) : [];
  const succeeded = new Set(executions.filter((row) => row.status === 'SUCCEEDED').map((row) => String(row.asset_id)));
  const videoAssets = context.canonical.input.assetPlan.assets.filter((asset) => asset.kind === 'video');
  const voiceAssets = context.canonical.input.assetPlan.assets.filter((asset) => asset.kind === 'voice');
  const remainingVideoAssetIds = videoAssets.map((asset) => String(asset.asset_id)).filter((id) => !succeeded.has(id));
  const remainingVoiceAssetIds = voiceAssets.map((asset) => String(asset.asset_id)).filter((id) => !succeeded.has(id));
  return Object.freeze({
    status: 'READY', productionId, exactCanonicalIdentity: true,
    canonicalInputFingerprint: context.canonical.input.fingerprint,
    productionKey: context.canonical.productionKey,
    existingSourceMedia: videoAssets.length - remainingVideoAssetIds.length,
    remainingVideoGenerations: remainingVideoAssetIds.length,
    remainingVideoAssetIds: Object.freeze(remainingVideoAssetIds),
    remainingSpeechGenerations: remainingVoiceAssetIds.length,
    remainingVoiceAssetIds: Object.freeze(remainingVoiceAssetIds),
    provider: context.canonical.input.qualityVideoProfile?.provider || null,
    model: context.canonical.input.qualityVideoProfile?.model || null,
    profile: context.canonical.input.qualityVideoProfile?.name || null,
    resolution: context.canonical.input.qualityVideoProfile?.resolution || null,
    evaluatorCallsPlanned: Number(context.prepared.plan.expectedQualityEvaluatorCalls || 0),
    costStatus: 'UNKNOWN',
    estimatedCost: null,
    humanApprovalRequired: true,
    autoPublish: false,
    providerCallsDuringPreflight: 0,
  });
}

async function continueRecoveredV210({ service, creativeService, productionId, brandId, confirmation }) {
  if (confirmation !== true) throw resumeError(400, 'V210_RESUME_CONFIRMATION_REQUIRED',
    'Explicit confirmation is required to continue paid production execution');
  const context = await exactV210Context({ service, creativeService, productionId, brandId, live: true });
  try {
    context.starter.credentialCheck({ config: context.runtime.config, input: context.canonical.input, env: context.runtime.env });
  } catch (error) {
    throw resumeError(409, error.code || 'V210_RESUME_CREDENTIALS_MISSING', error.message);
  }
  context.starter.scheduler(() => context.runtime.service.run({ input: context.canonical.input, config: context.runtime.config }));
  return Object.freeze({
    accepted: true,
    productionId,
    jobId: context.production.jobId,
    jobStatus: 'RETRYING',
    exactCanonicalIdentity: true,
    canonicalInputFingerprint: context.canonical.input.fingerprint,
    productionKey: context.canonical.productionKey,
    existingPaidMediaPreserved: true,
    videoRegenerationTriggered: false,
    humanApprovalRequired: true,
    autoPublish: false,
  });
}

module.exports = { continuationPreflight, continueRecoveredV210, exactV210Context, loadV210Draft };
