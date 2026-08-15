'use strict';

const crypto = require('node:crypto');
const OpenAI = require('openai');
const { jsonrepair } = require('jsonrepair');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function extractJson(text) {
  if (!text) throw new Error('NVIDIA returned an empty response');
  try { return JSON.parse(text); } catch {}
  try { return JSON.parse(jsonrepair(text)); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(jsonrepair(text.slice(start, end + 1)));
  throw new Error('NVIDIA response did not contain valid JSON');
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required for live NVIDIA generation`);
  return value.trim();
}

function createNvidiaClient() {
  return new OpenAI({ apiKey: requireEnv('NVIDIA_API_KEY'), baseURL: 'https://integrate.api.nvidia.com/v1' });
}

function buildConceptRequest({ production, context, brief, signal }) {
  return {
    capability: 'TEXT_GENERATION',
    production: { id: production.id, request: production.request_snapshot || {}, contextFingerprint: production.context_fingerprint },
    context,
    sources: {
      briefArtifactId: brief.id,
      briefArtifactVersion: brief.version,
      briefOutputHash: brief.outputHash,
      brief: brief.value,
    },
    input: { signal: signal || {} },
    outputContract: {
      type: 'CONCEPT',
      required: ['concept', 'corePromise', 'creativeThesis', 'narrativeApproach', 'emotionalArc', 'visualWorld', 'differentiation', 'constraints'],
    },
  };
}

function buildMessages(request) {
  return [
    { role: 'system', content: 'You are the CONCEPT stage of a production content factory. Creative truth is authoritative: tenant, business, brand, audience, offering, strategy, universe and canonical CONTENT_BRIEF must be respected. Turn the brief into one coherent, distinctive creative concept that can later be scripted and produced. Preserve the brief objective and constraints; do not invent unsupported claims. Return JSON only. Do not mention providers, models, APIs or implementation details.' },
    { role: 'user', content: JSON.stringify(request) },
  ];
}

async function callNvidia({ request, client, model }) {
  const actualClient = client || createNvidiaClient();
  const actualModel = model || requireEnv('NVIDIA_MODEL');
  const response = await actualClient.chat.completions.create({
    model: actualModel,
    messages: buildMessages(request),
    temperature: 0.55,
    max_tokens: 2800,
  });
  return { parsed: extractJson(response.choices?.[0]?.message?.content), raw: response };
}

function validateConcept(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CONCEPT must be an object');
  const fields = ['concept', 'corePromise', 'creativeThesis', 'narrativeApproach', 'emotionalArc', 'visualWorld', 'differentiation'];
  for (const field of fields) {
    if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error(`CONCEPT is missing ${field}`);
  }
  if (!value.constraints || typeof value.constraints !== 'object' || Array.isArray(value.constraints)) throw new Error('CONCEPT is missing constraints');
  return true;
}

async function loadBriefArtifact(client, productionId) {
  const result = await client.query(
    `SELECT gr.id AS generation_run_id, gr.artifact_id, gr.response, av.version, av.output_hash
       FROM v2_1.generation_runs gr
       JOIN v2_1.stage_runs sr ON sr.id = gr.stage_run_id
       JOIN v2_1.jobs j ON j.id = sr.job_id
       JOIN v2_1.productions p ON p.id = j.production_id
       JOIN v2_1.artifact_versions av ON av.artifact_id = gr.artifact_id
      WHERE p.id = $1 AND sr.stage = 'BRIEF' AND gr.status = 'COMPLETED' AND gr.artifact_id IS NOT NULL
      ORDER BY av.version DESC, gr.completed_at DESC LIMIT 1`, [productionId]);
  const row = result.rows[0];
  if (!row) throw new Error('Completed CONTENT_BRIEF artifact is required before CONCEPT generation');
  return { id: row.artifact_id, generationRunId: row.generation_run_id, version: row.version, outputHash: row.output_hash, value: row.response };
}

async function executeConceptStage({ client, productionId, stageRunId, workerId, signal = {}, provider = 'nvidia', providerCall = null } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  if (!productionId || !stageRunId || !workerId) throw new Error('productionId, stageRunId and workerId are required');
  if (provider !== 'nvidia') throw new Error(`Unsupported provider: ${provider}`);

  const productionResult = await client.query(`SELECT id, business_id, brand_id, context_fingerprint, context_snapshot, request_snapshot, status FROM v2_1.productions WHERE id = $1 FOR SHARE`, [productionId]);
  const production = productionResult.rows[0];
  if (!production) throw new Error('Production not found');
  if (production.status !== 'RUNNING') throw new Error('Production is not RUNNING');

  const stageResult = await client.query(`SELECT id, job_id, stage, attempt, status, worker_id FROM v2_1.stage_runs WHERE id = $1 AND job_id IN (SELECT id FROM v2_1.jobs WHERE production_id = $2)`, [stageRunId, productionId]);
  const stage = stageResult.rows[0];
  if (!stage || stage.stage !== 'CONCEPT') throw new Error('Stage run is not a CONCEPT stage for this production');
  if (stage.status !== 'RUNNING' || stage.worker_id !== workerId) throw new Error('CONCEPT stage lease is not owned by this worker');

  const brief = await loadBriefArtifact(client, productionId);
  const request = buildConceptRequest({ production, context: production.context_snapshot, brief, signal });
  const requestHash = fingerprint(request);
  const existing = await client.query(`SELECT id, status, artifact_id FROM v2_1.generation_runs WHERE request_hash = $1 ORDER BY created_at DESC LIMIT 1`, [requestHash]);
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.status === 'COMPLETED' && row.artifact_id) return { generationRunId: row.id, artifactId: row.artifact_id, sourceArtifactId: brief.id, reused: true };
    if (row.status === 'RUNNING') throw new Error('Identical CONCEPT generation is already running');
  }

  const providerRow = await client.query(`INSERT INTO v2_1.providers(name, capabilities) VALUES ('nvidia', '["TEXT_GENERATION"]'::jsonb) ON CONFLICT (name) DO UPDATE SET enabled = true RETURNING id`);
  const providerId = providerRow.rows[0].id;
  const modelName = requireEnv('NVIDIA_MODEL');
  const modelRow = await client.query(`INSERT INTO v2_1.models(provider_id, name, capability) VALUES ($1, $2, 'TEXT_GENERATION') ON CONFLICT (provider_id, name) DO UPDATE SET enabled = true RETURNING id, name`, [providerId, modelName]);
  const modelId = modelRow.rows[0].id;
  const generation = await client.query(`INSERT INTO v2_1.generation_runs(stage_run_id, provider_id, model_id, capability, request_hash, request, status) VALUES ($1,$2,$3,'TEXT_GENERATION',$4,$5::jsonb,'RUNNING') ON CONFLICT (request_hash) WHERE status IN ('QUEUED','RUNNING','COMPLETED') DO NOTHING RETURNING id`, [stageRunId, providerId, modelId, requestHash, JSON.stringify(request)]);
  if (!generation.rowCount) throw new Error('Identical CONCEPT generation was claimed by another worker');
  const generationRunId = generation.rows[0].id;

  try {
    const result = await (providerCall ? providerCall({ request, model: modelName }) : callNvidia({ request, model: modelName }));
    validateConcept(result.parsed);
    const outputHash = fingerprint(result.parsed);
    const artifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type, production_id, status) VALUES ('CONCEPT', $1, 'VALID') RETURNING id`, [productionId]);
    const artifactId = artifact.rows[0].id;
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id, version, provider_id, model_id, input_hash, output_hash, metadata) VALUES ($1,1,$2,$3,$4,$5,$6::jsonb)`, [artifactId, providerId, modelId, requestHash, outputHash, JSON.stringify({ capability: 'TEXT_GENERATION', generationRunId, sourceArtifactId: brief.id, sourceArtifactVersion: brief.version, sourceOutputHash: brief.outputHash })]);
    await client.query(`UPDATE v2_1.generation_runs SET status='COMPLETED', response=$1::jsonb, artifact_id=$2, completed_at=now() WHERE id=$3`, [JSON.stringify(result.parsed), artifactId, generationRunId]);
    const stageUpdated = await client.query(`UPDATE v2_1.stage_runs SET output_artifacts=$1::jsonb, output_fingerprint=$2, completed_at=now(), heartbeat_at=now(), lease_expires_at=NULL, worker_id=NULL, status='COMPLETED' WHERE id=$3 AND status='RUNNING' AND worker_id=$4 RETURNING id`, [JSON.stringify(['CONCEPT']), outputHash, stageRunId, workerId]);
    if (!stageUpdated.rowCount) throw new Error('CONCEPT generation succeeded but stage lease was lost before completion');
    return { generationRunId, artifactId, sourceArtifactId: brief.id, reused: false };
  } catch (error) {
    await client.query(`UPDATE v2_1.generation_runs SET status='FAILED', response=$1::jsonb, completed_at=now() WHERE id=$2`, [JSON.stringify({ error: { name: error.name, message: error.message } }), generationRunId]);
    throw error;
  }
}

module.exports = { stableStringify, fingerprint, buildConceptRequest, validateConcept, callNvidia, executeConceptStage };
