'use strict';

const { fingerprint } = require('./v2.1-execution-engine');
const { executeIdeaStage } = require('./v2.1-idea-generation');
const { executeBriefStage } = require('./v2.1-brief-generation');
const { executeConceptStage } = require('./v2.1-concept-generation');
const { executeScriptStage } = require('./v2.1-script-generation');
const { executeBibleStage } = require('./v2.1-bible-generation');
const { executeShotPlanStage } = require('./v2.1-shot-plan');
const { executeAssetPlanStage } = require('./v2.1-asset-plan');
const { executeEditStage } = require('./v2.1-edit');
const { executePlatformAdaptationStage } = require('./v2.1-platform-adaptation');
const { recoverExpiredWork, claimJobForProduction, heartbeatJob, claimNextStage, completeStage, failStage } = require('./v2.1-execution-engine');

const BIBLE_VERTICAL_SLICE = Object.freeze(['SIGNAL', 'IDEA', 'BRIEF', 'CONCEPT', 'SCRIPT', 'BIBLE']);
const FIRST_VERTICAL_SLICE = Object.freeze([...BIBLE_VERTICAL_SLICE, 'SHOT_PLAN', 'ASSET_PLAN']);
const EDIT_VERTICAL_SLICE = Object.freeze([...FIRST_VERTICAL_SLICE, 'ASSET_GENERATION', 'CONTINUITY', 'EDIT']);
const PLATFORM_ADAPTATION_VERTICAL_SLICE = Object.freeze([...EDIT_VERTICAL_SLICE, 'PLATFORM_ADAPTATION']);

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
  const result = await client.query(`SELECT id, status, context_fingerprint, context_snapshot, request_snapshot FROM v2_1.productions WHERE id=$1`, [productionId]);
  if (!result.rowCount) throw new Error('Production not found');
  return result.rows[0];
}

async function assertContextUnchanged(client, productionId, expectedFingerprint) {
  const production = await loadProduction(client, productionId);
  if (production.context_fingerprint !== expectedFingerprint) throw new Error('Production context fingerprint changed during execution');
  if (production.status !== 'RUNNING') throw new Error(`Production is no longer RUNNING: ${production.status}`);
  return production;
}

async function completeSignalStage(client, { productionId, stageRunId, workerId, signal }) {
  const production = await loadProduction(client, productionId);
  const effectiveSignal = normalizeSignal(signal || production.request_snapshot?.signal || {});
  return completeStage(client, { stageRunId, workerId, outputArtifacts: ['SIGNAL_SET'], outputFingerprint: fingerprint(effectiveSignal) });
}

const HANDLERS = Object.freeze({ IDEA: executeIdeaStage, BRIEF: executeBriefStage, CONCEPT: executeConceptStage, SCRIPT: executeScriptStage, BIBLE: executeBibleStage, SHOT_PLAN: executeShotPlanStage, ASSET_PLAN: executeAssetPlanStage, EDIT: executeEditStage, PLATFORM_ADAPTATION: executePlatformAdaptationStage });

async function executeClaimedStage(client, { productionId, stage, stageRunId, workerId, signal, providerCall }) {
  if (stage === 'SIGNAL') return completeSignalStage(client, { productionId, stageRunId, workerId, signal });
  if (stage === 'EDIT') return executeEditStage({ client, productionId, stageRunId, workerId });
  if (stage === 'PLATFORM_ADAPTATION') return executePlatformAdaptationStage({ client, productionId, stageRunId, workerId });
  const handler = HANDLERS[stage];
  if (!handler) throw new Error(`No production handler is registered for stage ${stage}`);
  return handler({ client, productionId, stageRunId, workerId, signal: normalizeSignal(signal), provider: 'nvidia', providerCall });
}

async function verifyVerticalSliceProvenance(client, { productionId, jobId, contextFingerprint }) {
  const stages = FIRST_VERTICAL_SLICE;
  const result = await client.query(
    `SELECT sr.stage, sr.status AS stage_status, sr.output_artifacts,
            gr.id AS generation_run_id, gr.status AS generation_status, gr.artifact_id,
            gr.request->'production'->>'contextFingerprint' AS request_context_fingerprint,
            a.artifact_type, av.output_hash, av.metadata,
            pb.id AS production_bible_id, pb.context_fingerprint AS bible_context_fingerprint,
            pb.source_script_artifact_id AS bible_source_script_artifact_id, pb.bible_id
       FROM v2_1.stage_runs sr
       LEFT JOIN LATERAL (SELECT gr.* FROM v2_1.generation_runs gr WHERE gr.stage_run_id=sr.id ORDER BY gr.created_at DESC LIMIT 1) gr ON true
       LEFT JOIN v2_1.artifacts a ON a.id=gr.artifact_id
       LEFT JOIN v2_1.artifact_versions av ON av.artifact_id=gr.artifact_id
       LEFT JOIN LATERAL (SELECT pb.* FROM v2_1.production_bibles pb WHERE pb.production_id=$3 AND pb.artifact_id=gr.artifact_id ORDER BY pb.version DESC LIMIT 1) pb ON sr.stage='BIBLE'
      WHERE sr.job_id=$1 AND sr.stage=ANY($2::text[])
      ORDER BY array_position($2::text[], sr.stage), av.version DESC NULLS LAST`,
    [jobId, stages, productionId]
  );
  const rowsByStage = new Map();
  for (const row of result.rows) if (!rowsByStage.has(row.stage)) rowsByStage.set(row.stage, row);

  for (const stage of BIBLE_VERTICAL_SLICE) {
    const row = rowsByStage.get(stage);
    if (!row || row.stage_status !== 'COMPLETED') throw new Error(`Vertical slice stage ${stage} is not completed`);
    if (stage !== 'SIGNAL') {
      if (row.generation_status !== 'COMPLETED' || !row.artifact_id || !row.output_hash) throw new Error(`Generation provenance is incomplete for ${stage}`);
      if (row.request_context_fingerprint !== contextFingerprint) throw new Error(`Context fingerprint drift detected in ${stage} generation request`);
    }
  }

  const idea = rowsByStage.get('IDEA');
  const brief = rowsByStage.get('BRIEF');
  const concept = rowsByStage.get('CONCEPT');
  const script = rowsByStage.get('SCRIPT');
  const bible = rowsByStage.get('BIBLE');
  if (idea.artifact_type !== 'IDEA_SET') throw new Error('IDEA artifact type is not canonical');
  if (brief.artifact_type !== 'CONTENT_BRIEF') throw new Error('BRIEF artifact type is not canonical');
  if (concept.artifact_type !== 'CONCEPT') throw new Error('CONCEPT artifact type is not canonical');
  if (script.artifact_type !== 'SCRIPT') throw new Error('SCRIPT artifact type is not canonical');
  if (bible.artifact_type !== 'PRODUCTION_BIBLE') throw new Error('BIBLE artifact type is not canonical');
  if (brief.metadata?.sourceArtifactId !== idea.artifact_id) throw new Error('BRIEF provenance does not point to canonical IDEA artifact');
  if (concept.metadata?.sourceArtifactId !== brief.artifact_id) throw new Error('CONCEPT provenance does not point to canonical BRIEF artifact');
  const scriptSources = script.metadata?.sourceArtifactIds || [];
  if (!scriptSources.includes(idea.artifact_id) || !scriptSources.includes(concept.artifact_id)) throw new Error('SCRIPT provenance does not point to canonical IDEA and CONCEPT artifacts');
  if (!bible.production_bible_id) throw new Error('BIBLE has no durable production_bibles record');
  if (bible.bible_context_fingerprint !== contextFingerprint) throw new Error('BIBLE database context fingerprint drift detected');
  if (bible.bible_source_script_artifact_id !== script.artifact_id) throw new Error('BIBLE provenance does not point to canonical SCRIPT artifact');
  if (!bible.bible_id) throw new Error('BIBLE durable identity is missing');

  const deterministicArtifacts = await client.query(
    `SELECT DISTINCT ON (a.artifact_type) a.artifact_type, a.id AS artifact_id, av.metadata
       FROM v2_1.artifacts a JOIN v2_1.artifact_versions av ON av.artifact_id=a.id
      WHERE a.production_id=$1 AND a.artifact_type IN ('SHOTS','ASSET_REQUIREMENTS')
      ORDER BY a.artifact_type, a.created_at DESC, av.version DESC`,
    [productionId]
  );
  const planArtifacts = new Map(deterministicArtifacts.rows.map((row) => [row.artifact_type, row]));
  const shotArtifact = planArtifacts.get('SHOTS');
  const assetArtifact = planArtifacts.get('ASSET_REQUIREMENTS');
  if (!shotArtifact || !assetArtifact) throw new Error('Planning artifacts are incomplete');
  if (shotArtifact.metadata?.stage !== 'SHOT_PLAN' || assetArtifact.metadata?.stage !== 'ASSET_PLAN') throw new Error('Planning artifact provenance is invalid');
  if (shotArtifact.metadata?.contextFingerprint !== contextFingerprint || assetArtifact.metadata?.contextFingerprint !== contextFingerprint) throw new Error('Planning context fingerprint drift detected');
  if (rowsByStage.get('SHOT_PLAN')?.output_artifacts?.[0] !== 'SHOTS') throw new Error('SHOT_PLAN output vocabulary is invalid');
  if (rowsByStage.get('ASSET_PLAN')?.output_artifacts?.[0] !== 'ASSET_REQUIREMENTS') throw new Error('ASSET_PLAN output vocabulary is invalid');

  const shotRows = await client.query(`SELECT count(*)::integer AS count, count(*) FILTER (WHERE production_bible_id=$2 AND source_script_artifact_id=$3 AND context_fingerprint=$4 AND plan_fingerprint=$5)::integer AS valid_count FROM v2_1.shots WHERE production_id=$1`, [productionId, bible.production_bible_id, script.artifact_id, contextFingerprint, shotArtifact.metadata?.planFingerprint]);
  if (shotRows.rows[0].count < 1 || shotRows.rows[0].count !== shotRows.rows[0].valid_count) throw new Error('SHOT_PLAN durable provenance is incomplete');
  const assetRows = await client.query(`SELECT count(*)::integer AS count, count(*) FILTER (WHERE ar.production_bible_id=$2 AND ar.context_fingerprint=$3 AND ar.plan_fingerprint=$4)::integer AS valid_count FROM v2_1.asset_requirements ar JOIN v2_1.shots s ON s.id=ar.shot_id WHERE s.production_id=$1`, [productionId, bible.production_bible_id, contextFingerprint, assetArtifact.metadata?.planFingerprint]);
  if (assetRows.rows[0].count < 1 || assetRows.rows[0].count !== assetRows.rows[0].valid_count) throw new Error('ASSET_PLAN durable provenance is incomplete');

  return { productionId, contextFingerprint, stages: stages.map((stage) => ({ stage, artifactId: ['SHOT_PLAN','ASSET_PLAN'].includes(stage) ? (stage === 'SHOT_PLAN' ? shotArtifact.artifact_id : assetArtifact.artifact_id) : rowsByStage.get(stage)?.artifact_id || null, generationRunId: rowsByStage.get(stage)?.generation_run_id || null })) };
}

async function runProductionThroughStages(client, { productionId, jobId, workerId, signal = {}, providerCall = null, leaseSeconds = 120, recover = true, stages, status }) {
  requireClient(client); requireWorker(workerId);
  if (!productionId || !jobId) throw new Error('productionId and jobId are required');
  const initial = await loadProduction(client, productionId);
  if (initial.status !== 'RUNNING') throw new Error(`Production is not RUNNING: ${initial.status}`);
  const contextFingerprint = initial.context_fingerprint;
  if (recover) await recoverExpiredWork(client);
  const claimedJob = await claimJobForProduction(client, { jobId, productionId, workerId, leaseSeconds });
  if (!claimedJob) throw new Error('Production job was not claimable by this worker for this production');
  if (claimedJob.id !== jobId || claimedJob.production_id !== productionId) throw new Error('Database returned a job outside the requested production boundary');
  const completed = [];
  while (completed.length < stages.length) {
    await assertContextUnchanged(client, productionId, contextFingerprint);
    await heartbeatJob(client, { jobId, workerId, leaseSeconds });
    const stage = await claimNextStage(client, { jobId, workerId, leaseSeconds });
    if (!stage) throw new Error(`Execution engine returned no runnable stage before ${status}`);
    if (!stages.includes(stage.stage)) throw new Error(`Execution engine advanced beyond the requested vertical slice at ${stage.stage}`);
    try {
      await executeClaimedStage(client, { productionId, stage: stage.stage, stageRunId: stage.id, workerId, signal, providerCall });
      completed.push(stage.stage);
      await heartbeatJob(client, { jobId, workerId, leaseSeconds });
    } catch (error) {
      await failStage(client, { stageRunId: stage.id, workerId, error: { name: error.name, message: error.message }, retryable: true });
      throw error;
    }
  }
  await assertContextUnchanged(client, productionId, contextFingerprint);
  return { productionId, jobId, workerId, status, completedStages: completed };
}

async function runProductionThroughBible(client, options = {}) {
  return runProductionThroughStages(client, { ...options, stages: BIBLE_VERTICAL_SLICE, status: 'BIBLE_COMPLETED' });
}

async function runProductionThroughPlanning(client, options = {}) {
  const result = await runProductionThroughStages(client, { ...options, stages: FIRST_VERTICAL_SLICE, status: 'PLANNING_COMPLETED' });
  const provenance = await verifyVerticalSliceProvenance(client, { productionId: result.productionId, jobId: result.jobId, contextFingerprint: (await loadProduction(client, result.productionId)).context_fingerprint });
  return { ...result, provenance };
}

async function runProductionThroughEdit(client, options = {}) {
  return runProductionThroughStages(client, { ...options, stages: EDIT_VERTICAL_SLICE, status: 'EDIT_COMPLETED' });
}

async function runProductionThroughPlatformAdaptation(client, options = {}) {
  return runProductionThroughStages(client, { ...options, stages: PLATFORM_ADAPTATION_VERTICAL_SLICE, status: 'PLATFORM_ADAPTATION_COMPLETED' });
}

const runProductionThroughScript = runProductionThroughBible;

module.exports = { BIBLE_VERTICAL_SLICE, FIRST_VERTICAL_SLICE, EDIT_VERTICAL_SLICE, PLATFORM_ADAPTATION_VERTICAL_SLICE, HANDLERS, normalizeSignal, verifyVerticalSliceProvenance, runProductionThroughPlanning, runProductionThroughEdit, runProductionThroughPlatformAdaptation, runProductionThroughBible, runProductionThroughScript };
