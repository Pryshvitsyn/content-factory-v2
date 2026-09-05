'use strict';
const crypto = require('node:crypto');

const { createCoreOperationRegistry } = require('./operation-registry');
const { workflowRevision, ArtifactWorkflowRevisionStore } = require('./workflow-definition');
const { ArtifactService } = require('../artifacts/artifact-service');
const { fingerprint } = require('../v2.8/video-model-contracts');

class ProductionExecutionAuthority {
  constructor({ repository, storage } = {}) { if (!repository?.startAttempts || !storage?.get) throw new Error('V2.10 repository and artifact storage are required'); this.repository = repository; this.storage=storage; }
  async assertAuthorized({ draft, preflight, canonical }) {
    const workspaceId = draft.workspace_id || draft.workspaceId;
    const brandId = draft.brand_id || draft.brandId;
    const attempts = await this.repository.startAttempts({ id: draft.id, workspaceId, brandId });
    const active = attempts.find((row) => Number(row.attempt) === Number(draft.startAttempt || draft.start_attempt));
    if (!active || active.status !== 'RUNNING' || active.actor == null) throw Object.assign(new Error('No active durable human START authority'), { code: 'PRODUCTION_EXECUTION_NOT_AUTHORIZED' });
    if (active.preflight_fingerprint !== preflight.fingerprint || active.canonical_input_fingerprint !== canonical.input.fingerprint) {
      throw Object.assign(new Error('Durable START authority does not match exact preflight/canonical input'), { code: 'PRODUCTION_EXECUTION_AUTHORITY_STALE' });
    }
    const approved = preflight.operationPlans || [];
    if (!approved.length || approved.some((plan) => plan.workflowFingerprint !== preflight.workflowAuthority?.workflowFingerprint)) {
      throw Object.assign(new Error('Final preflight has no exact workflow operation authority'), { code: 'PRODUCTION_OPERATION_AUTHORITY_MISSING' });
    }
    const workflowBytes=await this.storage.get({key:preflight.workflowAuthority.workflowArtifactStorageKey});
    if (!Buffer.isBuffer(workflowBytes) || crypto.createHash('sha256').update(workflowBytes).digest('hex') !== preflight.workflowAuthority.workflowArtifactContentHash) {
      throw Object.assign(new Error('Immutable workflow artifact bytes/hash are unavailable'), { code: 'PRODUCTION_WORKFLOW_AUTHORITY_INVALID' });
    }
    const durableWorkflow=JSON.parse(workflowBytes.toString('utf8'));
    if (durableWorkflow.workflowFingerprint !== preflight.workflowAuthority.workflowFingerprint
      || Number(durableWorkflow.revision)!==Number(preflight.workflowAuthority.workflowRevision)) {
      throw Object.assign(new Error('Immutable workflow revision does not match final preflight'), { code: 'PRODUCTION_WORKFLOW_AUTHORITY_STALE' });
    }
    const rebuilt = operationPlans(canonical, { workflowFingerprint: preflight.workflowAuthority.workflowFingerprint });
    if (fingerprint(rebuilt) !== fingerprint(approved)) throw Object.assign(new Error('Operation request changed after human START'), { code: 'PRODUCTION_OPERATION_AUTHORITY_STALE' });
    return Object.freeze({ actor: active.actor, attempt: active.attempt, preflightFingerprint: active.preflight_fingerprint,
      canonicalInputFingerprint: active.canonical_input_fingerprint, operationRequestFingerprints: approved.map((item) => item.requestFingerprint) });
  }
}

function operationPlans(canonical, revision) {
  return Object.freeze(canonical.input.assetPlan.assets.filter((asset) => asset.kind === 'video').map((asset) => {
    const requirements = asset.generation_requirements || {};
    const reference = requirements.v210_reference?.artifact || null;
    const continuityReferences=requirements.v210_continuity_binding?.references||[];
    const identity = { schemaVersion: 'production-operation-plan@1', operationNodeId: `generate:${asset.asset_id}`,
      shotId: asset.asset_id, assetId: asset.asset_id, provider: requirements.provider, model: requirements.model,
      modelContractVersion: requirements.model_contract_version || null,
      modelSchemaVersion: requirements.model_schema_version || null,
      resolvedInputMode: requirements.resolved_input_mode || requirements.capability,
      promptRevision: 'v2.10-approved-storyboard', promptHash: fingerprint(requirements.prompt || asset.description || ''),
      orderedReferences: continuityReferences.length?continuityReferences.map(({role,artifactId,artifactVersion,sha256})=>({role,artifactId,artifactVersion,sha256}))
        : reference ? [{ artifactId: reference.artifactId || reference.id,
          artifactVersion: reference.version || 1, sha256: reference.contentHash || reference.content_hash }] : [],
      continuityPack:requirements.v210_continuity_binding?{packId:requirements.v210_continuity_binding.packId,
        packRevision:requirements.v210_continuity_binding.packRevision,
        packFingerprint:requirements.v210_continuity_binding.packFingerprint}:null,
      resolvedModelParameters: requirements.model_parameters || requirements.resolved_settings || {},
      requestPolicyFingerprint: requirements.request_policy_fingerprint || null,
      expectedProviderCalls: 1, workflowFingerprint: revision.workflowFingerprint };
    return Object.freeze({ ...identity, requestFingerprint: fingerprint(identity) });
  }));
}

async function persistV210WorkflowRevision({ storage, draft, canonical }) {
  const registry = createCoreOperationRegistry();
  const videoAssets = canonical.input.assetPlan.assets.filter((asset) => asset.kind === 'video');
  const revision = workflowRevision({ workspaceId: canonical.input.workspaceId,
    brandId: canonical.input.brandId, workflowType: 'V2_10_CREATIVE_PRODUCTION', revision: Number(draft.revision || 1),
    nodes: videoAssets.map((asset) => ({ id: `generate:${asset.asset_id}`, operationType: 'GENERATE_VIDEO',
      contractVersion: '1', assetId: asset.asset_id })), edges: [],
    configuration: { canonicalInputFingerprint: canonical.input.fingerprint },
    policyVersions: { production: 'v2.10', modelContracts: 'v2.8' },
    outputExpectations: [{ aspectRatio: canonical.input.aspectRatio }] }, registry);
  const artifact = await new ArtifactWorkflowRevisionStore({ artifactService: new ArtifactService({ storage }) }).save(revision);
  return Object.freeze({ workflowArtifactId: artifact.artifactId, workflowArtifactVersion: artifact.version,
    workflowArtifactContentHash: artifact.contentHash, workflowArtifactStorageKey: artifact.storageKey,
    workflowFingerprint: revision.workflowFingerprint,
    workflowRevision: revision.revision, operationPlans: operationPlans(canonical, revision) });
}

module.exports = { ProductionExecutionAuthority, operationPlans, persistV210WorkflowRevision };
