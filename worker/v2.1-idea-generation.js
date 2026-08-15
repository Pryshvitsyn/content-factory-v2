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
  return new OpenAI({
    apiKey: requireEnv('NVIDIA_API_KEY'),
    baseURL: 'https://integrate.api.nvidia.com/v1',
  });
}

function buildIdeaRequest({ production, context, signal }) {
  return {
    capability: 'TEXT_GENERATION',
    production: {
      id: production.id,
      request: production.request_snapshot || {},
      contextFingerprint: production.context_fingerprint,
    },
    context,
    input: { signal: signal || {} },
    outputContract: {
      type: 'IDEA_SET',
      required: ['ideas'],
      ideas: 'array of 3-5 distinct content ideas; each idea has id, title, premise, hook, angle, rationale',
    },
  };
}

function buildMessages(request) {
  return [
    {
      role: 'system',
      content: [
        'You are the IDEA stage of a production content factory.',
        'Creative truth is authoritative: tenant, business, brand, audience, offering, strategy and universe rules must be respected.',
        'Return JSON only. Do not mention providers, models, APIs or implementation details.',
        'Do not invent claims that conflict with compliance rules.',
        'Create 3-5 genuinely different ideas, not cosmetic rewrites.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify(request),
    },
  ];
}

async function callNvidia({ request, client = createNvidiaClient(), model = requireEnv('NVIDIA_MODEL') }) {
  const response = await client.chat.completions.create({
    model,
    messages: buildMessages(request),
    temperature: 0.7,
    max_tokens: 2000,
  });
  const text = response.choices?.[0]?.message?.content;
  return { parsed: extractJson(text), raw: response };
}

function validateIdeaSet(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('IDEA_SET must be an object');
  if (!Array.isArray(value.ideas) || value.ideas.length < 3) throw new Error('IDEA_SET must contain at least 3 ideas');
  for (const [index, idea] of value.ideas.entries()) {
    if (!idea || typeof idea !== 'object') throw new Error(`Idea ${index + 1} is invalid`);
    for (const field of ['id', 'title', 'premise', 'hook', 'angle', 'rationale']) {
      if (typeof idea[field] !== 'string' || !idea[field].trim()) throw new Error(`Idea ${index + 1} is missing ${field}`);
    }
  }
  return true;
}

async function executeIdeaStage({ client, productionId, stageRunId, workerId, signal = {}, provider = 'nvidia', providerCall = null } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  if (!productionId || !stageRunId || !workerId) throw new Error('productionId, stageRunId and workerId are required');
  if (provider !== 'nvidia') throw new Error(`Unsupported provider: ${provider}`);

  const productionResult = await client.query(
    `SELECT id, business_id, brand_id, context_fingerprint, context_snapshot, request_snapshot, status
       FROM v2_1.productions
      WHERE id = $1
      FOR SHARE`,
    [productionId]
  );
  const production = productionResult.rows[0];
  if (!production) throw new Error('Production not found');
  if (production.status !== 'RUNNING') throw new Error('Production is not RUNNING');

  const stageResult = await client.query(
    `SELECT id, job_id, stage, attempt, status
       FROM v2_1.stage_runs
      WHERE id = $1 AND job_id IN (SELECT id FROM v2_1.jobs WHERE production_id = $2)`,
    [stageRunId, productionId]
  );
  const stage = stageResult.rows[0];
  if (!stage || stage.stage !== 'IDEA') throw new Error('Stage run is not an IDEA stage for this production');
  if (stage.status !== 'RUNNING') throw new Error('IDEA stage must be RUNNING before generation');

  const context = production.context_snapshot;
  const request = buildIdeaRequest({ production, context, signal });
  const requestHash = fingerprint(request);

  const existing = await client.query(
    `SELECT id, status, response, artifact_id
       FROM v2_1.generation_runs
      WHERE request_hash = $1
      FOR SHARE`,
    [requestHash]
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.status === 'COMPLETED' && row.artifact_id) return { generationRunId: row.id, artifactId: row.artifact_id, reused: true };
    if (row.status === 'RUNNING') throw new Error('Identical IDEA generation is already running');
  }

  const providerRow = await client.query(
    `INSERT INTO v2_1.providers(name, capabilities)
     VALUES ('nvidia', '["TEXT_GENERATION"]'::jsonb)
     ON CONFLICT (name) DO UPDATE SET enabled = true
     RETURNING id`,
    []
  );
  const providerId = providerRow.rows[0].id;
  const modelName = requireEnv('NVIDIA_MODEL');
  const modelRow = await client.query(
    `INSERT INTO v2_1.models(provider_id, name, capability)
     VALUES ($1, $2, 'TEXT_GENERATION')
     ON CONFLICT (provider_id, name) DO UPDATE SET enabled = true
     RETURNING id, name`,
    [providerId, modelName]
  );
  const modelId = modelRow.rows[0].id;

  const generation = await client.query(
    `INSERT INTO v2_1.generation_runs
      (stage_run_id, provider_id, model_id, capability, request_hash, request, status)
     VALUES ($1,$2,$3,'TEXT_GENERATION',$4,$5::jsonb,'RUNNING')
     ON CONFLICT (request_hash) DO NOTHING
     RETURNING id`,
    [stageRunId, providerId, modelId, requestHash, JSON.stringify(request)]
  );
  if (!generation.rowCount) throw new Error('Identical IDEA generation was claimed by another worker');
  const generationRunId = generation.rows[0].id;

  try {
    const result = await (providerCall
      ? providerCall({ request, model: modelName })
      : callNvidia({ request, model: modelName }));
    validateIdeaSet(result.parsed);

    const outputHash = fingerprint(result.parsed);
    const artifact = await client.query(
      `INSERT INTO v2_1.artifacts(artifact_type, production_id, status)
       VALUES ('IDEA_SET', $1, 'VALID') RETURNING id`,
      [productionId]
    );
    const artifactId = artifact.rows[0].id;

    await client.query(
      `INSERT INTO v2_1.artifact_versions
        (artifact_id, version, provider_id, model_id, input_hash, output_hash, metadata)
       VALUES ($1,1,$2,$3,$4,$5,$6::jsonb)`,
      [artifactId, providerId, modelId, requestHash, outputHash, JSON.stringify({ capability: 'TEXT_GENERATION', generationRunId })]
    );

    await client.query(
      `UPDATE v2_1.generation_runs
          SET status='COMPLETED', response=$1::jsonb, artifact_id=$2, completed_at=now()
        WHERE id=$3`,
      [JSON.stringify(result.parsed), artifactId, generationRunId]
    );

    await client.query(
      `UPDATE v2_1.stage_runs
          SET output_artifacts=$1::jsonb, output_fingerprint=$2, completed_at=now(),
              heartbeat_at=now(), lease_expires_at=NULL, worker_id=NULL, status='COMPLETED'
        WHERE id=$3 AND status='RUNNING' AND worker_id=$4`,
      [JSON.stringify(['IDEA_SET']), outputHash, stageRunId, workerId]
    );

    return { generationRunId, artifactId, reused: false };
  } catch (error) {
    await client.query(
      `UPDATE v2_1.generation_runs SET status='FAILED', response=$1::jsonb, completed_at=now() WHERE id=$2`,
      [JSON.stringify({ error: { name: error.name, message: error.message } }), generationRunId]
    );
    throw error;
  }
}

module.exports = {
  stableStringify,
  fingerprint,
  buildIdeaRequest,
  validateIdeaSet,
  callNvidia,
  executeIdeaStage,
};
