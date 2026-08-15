'use strict';

const { fingerprint } = require('./v2.1-execution-engine');
const { executeIdeaStage } = require('./v2.1-idea-generation');
const { executeBriefStage } = require('./v2.1-brief-generation');
const { executeConceptStage } = require('./v2.1-concept-generation');
const { executeScriptStage } = require('./v2.1-script-generation');
const {
  recoverExpiredWork,
  claimJob,
  heartbeatJob,
  claimNextStage,
  completeStage,
  failStage,
} = require('./v2.1-execution-engine');

const FIRST_VERTICAL_SLICE = Object.freeze(['SIGNAL', 'IDEA', 'BRIEF', 'CONCEPT', 'SCRIPT']);

function requireClient(client) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
}

function requireWorker(workerId) {
  if (typeof workerId !== 'string' || !workerId.trim()) throw new Error('workerId is required');
}

function normalizeSignal(signal) {
  return signal && typeof signal === 'object' && !Array.isArray(signal) ? signal : {};
}

async function loadProduction(client, productionId) {
  const result = await client.query(
    `SELECT id, status, context_fingerprint, context_snapshot, request_snapshot
       FROM v2_1.productions
      WHERE id = $1`,
    [productionId]
  );
  if (!result.rowCount) throw new Error('Production not found');
  return result.rows[0];
}

async function assertContextUnchanged(client, productionId, expectedFingerprint) {
  const production = await loadProduction(client, productionId);
  if (production.context_fingerprint !== expectedFingerprint) {
    throw new Error('Production context fingerprint changed during execution');
  }
  if (production.status !== 'RUNNING') {
    throw new Error(`Production is no longer RUNNING: ${production.status}`);
  }
  return production;
}

async function completeSignalStage(client, { productionId, stageRunId, workerId, signal }) {
  const production = await loadProduction(client, productionId);
  const effectiveSignal = normalizeSignal(signal || production.request_snapshot?.signal || {});
  const outputFingerprint = fingerprint(effectiveSignal);
  return completeStage(client, {
    stageRunId,
    workerId,
    outputArtifacts: ['SIGNAL_SET'],
    outputFingerprint,
  });
}

const HANDLERS = Object.freeze({
  IDEA: executeIdeaStage,
  BRIEF: executeBriefStage,
  CONCEPT: executeConceptStage,
  SCRIPT: executeScriptStage,
});

async function executeClaimedStage(client, {
  productionId,
  stage,
  stageRunId,
  workerId,
  signal,
  providerCall,
}) {
  if (stage === 'SIGNAL') {
    return completeSignalStage(client, { productionId, stageRunId, workerId, signal });
  }

  const handler = HANDLERS[stage];
  if (!handler) throw new Error(`No production handler is registered for stage ${stage}`);

  return handler({
    client,
    productionId,
    stageRunId,
    workerId,
    signal: normalizeSignal(signal),
    provider: 'nvidia',
    providerCall,
  });
}

async function verifyVerticalSliceProvenance(client, { productionId, jobId, contextFingerprint }) {
  const result = await client.query(
    `SELECT sr.stage,
            sr.status AS stage_status,
            sr.output_artifacts,
            gr.id AS generation_run_id,
            gr.status AS generation_status,
            gr.artifact_id,
            gr.request->'production'->>'contextFingerprint' AS request_context_fingerprint,
            a.artifact_type,
            av.version AS artifact_version,
            av.output_hash,
            av.metadata
       FROM v2_1.stage_runs sr
       LEFT JOIN LATERAL (
         SELECT gr.*
           FROM v2_1.generation_runs gr
          WHERE gr.stage_run_id = sr.id
          ORDER BY gr.created_at DESC
          LIMIT 1
       ) gr ON true
       LEFT JOIN v2_1.artifacts a ON a.id = gr.artifact_id
       LEFT JOIN v2_1.artifact_versions av ON av.artifact_id = gr.artifact_id
      WHERE sr.job_id = $1
        AND sr.stage = ANY($2::text[])
      ORDER BY array_position($2::text[], sr.stage), av.version DESC NULLS LAST`,
    [jobId, FIRST_VERTICAL_SLICE]
  );

  const rowsByStage = new Map();
  for (const row of result.rows) {
    if (!rowsByStage.has(row.stage)) rowsByStage.set(row.stage, row);
  }

  for (const stage of FIRST_VERTICAL_SLICE) {
    const row = rowsByStage.get(stage);
    if (!row || row.stage_status !== 'COMPLETED') throw new Error(`Vertical slice stage ${stage} is not completed`);
    if (stage === 'SIGNAL') continue;
    if (row.generation_status !== 'COMPLETED' || !row.artifact_id || !row.output_hash) {
      throw new Error(`Vertical slice provenance is incomplete for ${stage}`);
    }
    if (row.request_context_fingerprint !== contextFingerprint) {
      throw new Error(`Context fingerprint drift detected in ${stage} generation request`);
    }
  }

  const idea = rowsByStage.get('IDEA');
  const brief = rowsByStage.get('BRIEF');
  const concept = rowsByStage.get('CONCEPT');
  const script = rowsByStage.get('SCRIPT');

  if (idea.artifact_type !== 'IDEA_SET') throw new Error('IDEA artifact type is not canonical');
  if (brief.artifact_type !== 'CONTENT_BRIEF') throw new Error('BRIEF artifact type is not canonical');
  if (concept.artifact_type !== 'CONCEPT') throw new Error('CONCEPT artifact type is not canonical');
  if (script.artifact_type !== 'SCRIPT') throw new Error('SCRIPT artifact type is not canonical');

  const briefSource = brief.metadata?.sourceArtifactId;
  const conceptSource = concept.metadata?.sourceArtifactId;
  const scriptSources = script.metadata?.sourceArtifactIds || [];
  if (briefSource !== idea.artifact_id) throw new Error('BRIEF provenance does not point to canonical IDEA artifact');
  if (conceptSource !== brief.artifact_id) throw new Error('CONCEPT provenance does not point to canonical BRIEF artifact');
  if (!scriptSources.includes(idea.artifact_id) || !scriptSources.includes(concept.artifact_id)) {
    throw new Error('SCRIPT provenance does not point to canonical IDEA and CONCEPT artifacts');
  }

  return {
    productionId,
    contextFingerprint,
    stages: FIRST_VERTICAL_SLICE.map((stage) => ({
      stage,
      artifactId: rowsByStage.get(stage)?.artifact_id || null,
      generationRunId: rowsByStage.get(stage)?.generation_run_id || null,
    })),
  };
}

async function runProductionThroughScript(client, {
  productionId,
  jobId,
  workerId,
  signal = {},
  providerCall = null,
  leaseSeconds = 120,
  recover = true,
} = {}) {
  requireClient(client);
  requireWorker(workerId);
  if (!productionId || !jobId) throw new Error('productionId and jobId are required');

  const initial = await loadProduction(client, productionId);
  if (initial.status !== 'RUNNING') throw new Error(`Production is not RUNNING: ${initial.status}`);
  const contextFingerprint = initial.context_fingerprint;

  if (recover) await recoverExpiredWork(client);

  const claimedJob = await claimJob(client, { workerId, leaseSeconds });
  if (!claimedJob || claimedJob.id !== jobId) throw new Error('Production job was not claimed by this worker');

  const completed = [];
  while (completed.length < FIRST_VERTICAL_SLICE.length) {
    await assertContextUnchanged(client, productionId, contextFingerprint);
    await heartbeatJob(client, { jobId, workerId, leaseSeconds });

    const stage = await claimNextStage(client, { jobId, workerId, leaseSeconds });
    if (!stage) throw new Error('Execution engine returned no runnable stage before SCRIPT completed');
    if (!FIRST_VERTICAL_SLICE.includes(stage.stage)) {
      throw new Error(`Execution engine advanced beyond the vertical slice at ${stage.stage}`);
    }

    try {
      await executeClaimedStage(client, {
        productionId,
        stage: stage.stage,
        stageRunId: stage.id,
        workerId,
        signal,
        providerCall,
      });
      completed.push(stage.stage);
      await heartbeatJob(client, { jobId, workerId, leaseSeconds });
    } catch (error) {
      await failStage(client, {
        stageRunId: stage.id,
        workerId,
        error: { name: error.name, message: error.message },
        retryable: true,
      });
      throw error;
    }
  }

  await assertContextUnchanged(client, productionId, contextFingerprint);
  const provenance = await verifyVerticalSliceProvenance(client, { productionId, jobId, contextFingerprint });

  return {
    productionId,
    jobId,
    workerId,
    status: 'SCRIPT_COMPLETED',
    completedStages: completed,
    provenance,
  };
}

module.exports = {
  FIRST_VERTICAL_SLICE,
  HANDLERS,
  normalizeSignal,
  verifyVerticalSliceProvenance,
  runProductionThroughScript,
};
