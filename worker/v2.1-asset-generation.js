'use strict';

const crypto = require('node:crypto');
const OpenAI = require('openai');
const { jsonrepair } = require('jsonrepair');

const ASSET_TYPES = new Set(['CHARACTER', 'LOCATION', 'STYLE', 'VOICE', 'PROP', 'BRAND', 'PRODUCT']);

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

function buildAssetGenerationRequest({ production, requirements }) {
  return {
    capability: 'ASSET_GENERATION',
    production: {
      id: production.id,
      request: production.request_snapshot || {},
      contextFingerprint: production.context_fingerprint,
    },
    context: production.context_snapshot || {},
    sources: {
      assetPlan: requirements.map((row) => ({
        requirementId: row.id,
        shotId: row.shot_id,
        role: row.asset_role,
        assetType: row.required_asset_type,
        requiredAssetId: row.required_asset_id,
        constraints: row.constraints || {},
        planFingerprint: row.plan_fingerprint,
      })),
    },
    outputContract: {
      type: 'ASSETS',
      required: ['assets'],
      assets: 'one object per unresolved requirement; preserve requirementId and assetType exactly',
    },
  };
}

function buildMessages(request) {
  return [
    {
      role: 'system',
      content: 'You are the ASSET_GENERATION stage of a production content factory. Creative truth and the canonical production context are authoritative. Generate only the reusable creative assets requested by the ASSET_PLAN. Do not change the production context, invent unsupported brand claims, or mention providers, models, APIs, or implementation details. Return JSON only.',
    },
    { role: 'user', content: JSON.stringify(request) },
  ];
}

async function callNvidia({ request, client, model }) {
  const actualClient = client || createNvidiaClient();
  const actualModel = model || requireEnv('NVIDIA_MODEL');
  const response = await actualClient.chat.completions.create({
    model: actualModel,
    messages: buildMessages(request),
    temperature: 0.4,
    max_tokens: 5000,
  });
  return { parsed: extractJson(response.choices?.[0]?.message?.content), raw: response };
}

function validateAssetGeneration(value, requirements) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ASSETS output must be an object');
  if (!Array.isArray(value.assets)) throw new Error('ASSETS.assets must be an array');

  const expected = new Map(requirements.map((row) => [String(row.id), row]));
  const seen = new Set();
  for (const [index, asset] of value.assets.entries()) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw new Error(`Asset ${index + 1} is invalid`);
    const requirement = expected.get(String(asset.requirementId));
    if (!requirement) throw new Error(`Asset ${index + 1} references unknown requirement`);
    if (seen.has(String(asset.requirementId))) throw new Error(`Requirement ${asset.requirementId} was generated more than once`);
    seen.add(String(asset.requirementId));
    if (asset.assetType !== requirement.required_asset_type) throw new Error(`Asset ${index + 1} type does not match requirement`);
    if (!ASSET_TYPES.has(asset.assetType)) throw new Error(`Asset ${index + 1} has unsupported assetType`);
    if (typeof asset.name !== 'string' || !asset.name.trim()) throw new Error(`Asset ${index + 1} is missing name`);
    if (!asset.canonicalData || typeof asset.canonicalData !== 'object' || Array.isArray(asset.canonicalData)) throw new Error(`Asset ${index + 1} is missing canonicalData`);
    if (!asset.versionData || typeof asset.versionData !== 'object' || Array.isArray(asset.versionData)) throw new Error(`Asset ${index + 1} is missing versionData`);
  }

  if (seen.size !== requirements.length) throw new Error(`ASSETS output must contain exactly ${requirements.length} generated assets`);
  return true;
}

async function loadProduction(client, productionId) {
  const result = await client.query(
    `SELECT id, tenant_id, business_id, brand_id, context_fingerprint, context_snapshot, request_snapshot, status
       FROM v2_1.productions WHERE id=$1 FOR SHARE`,
    [productionId]
  );
  const production = result.rows[0];
  if (!production) throw new Error('Production not found');
  if (production.status !== 'RUNNING') throw new Error('Production is not RUNNING');
  if (!production.tenant_id || !production.business_id || !production.context_fingerprint) throw new Error('Production ownership/context is incomplete');
  return production;
}

async function loadStage(client, productionId, stageRunId) {
  const result = await client.query(
    `SELECT sr.id, sr.job_id, sr.stage, sr.status, sr.worker_id
       FROM v2_1.stage_runs sr
       JOIN v2_1.jobs j ON j.id=sr.job_id
      WHERE sr.id=$1 AND j.production_id=$2`,
    [stageRunId, productionId]
  );
  const stage = result.rows[0];
  if (!stage || stage.stage !== 'ASSET_GENERATION') throw new Error('Stage run is not an ASSET_GENERATION stage for this production');
  return stage;
}

async function loadRequirements(client, productionId) {
  const result = await client.query(
    `SELECT ar.id, ar.shot_id, ar.asset_role, ar.required_asset_type, ar.required_asset_id,
            ar.constraints, ar.status, ar.production_bible_id, ar.context_fingerprint,
            ar.plan_fingerprint, ar.resolved_asset_id, ar.resolved_asset_version_id, ar.resolution_fingerprint
       FROM v2_1.asset_requirements ar
       JOIN v2_1.shots s ON s.id=ar.shot_id
      WHERE s.production_id=$1
      ORDER BY s.shot_number, ar.asset_role, ar.id`,
    [productionId]
  );
  if (!result.rows.length) throw new Error('ASSET_PLAN requirements are required before ASSET_GENERATION');
  return result.rows;
}

function assertRequirementContext(production, requirement) {
  if (requirement.context_fingerprint !== production.context_fingerprint) {
    throw new Error(`Asset requirement ${requirement.id} violates immutable production context`);
  }
}

async function executeAssetGenerationStage({ client, productionId, stageRunId, workerId, provider = 'nvidia', providerCall = null } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  if (!productionId || !stageRunId || !workerId) throw new Error('productionId, stageRunId and workerId are required');
  if (provider !== 'nvidia') throw new Error(`Unsupported provider: ${provider}`);

  const production = await loadProduction(client, productionId);
  const stage = await loadStage(client, productionId, stageRunId);
  if (stage.status !== 'RUNNING' || stage.worker_id !== workerId) throw new Error('ASSET_GENERATION stage lease is not owned by this worker');

  const requirements = await loadRequirements(client, productionId);
  requirements.forEach((row) => assertRequirementContext(production, row));

  const unresolved = requirements.filter((row) => row.resolved_asset_id === null);
  const request = buildAssetGenerationRequest({ production, requirements: unresolved });
  const requestHash = fingerprint(request);

  const existing = await client.query(
    `SELECT id, status, artifact_id FROM v2_1.generation_runs
      WHERE request_hash=$1 ORDER BY created_at DESC LIMIT 1`,
    [requestHash]
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.status === 'COMPLETED' && row.artifact_id) return { generationRunId: row.id, artifactId: row.artifact_id, reused: true };
    if (row.status === 'RUNNING') throw new Error('Identical ASSET_GENERATION is already running');
  }

  const providerRow = await client.query(
    `INSERT INTO v2_1.providers(name,capabilities) VALUES('nvidia','["ASSET_GENERATION"]'::jsonb)
     ON CONFLICT(name) DO UPDATE SET enabled=true RETURNING id`,
  );
  const providerId = providerRow.rows[0].id;
  const modelName = requireEnv('NVIDIA_MODEL');
  const modelRow = await client.query(
    `INSERT INTO v2_1.models(provider_id,name,capability) VALUES($1,$2,'ASSET_GENERATION')
     ON CONFLICT(provider_id,name) DO UPDATE SET enabled=true RETURNING id`,
    [providerId, modelName]
  );
  const modelId = modelRow.rows[0].id;

  const generation = await client.query(
    `INSERT INTO v2_1.generation_runs(stage_run_id,provider_id,model_id,capability,request_hash,request,status)
     VALUES($1,$2,$3,'ASSET_GENERATION',$4,$5::jsonb,'RUNNING')
     ON CONFLICT (request_hash) WHERE status IN ('QUEUED','RUNNING','COMPLETED') DO NOTHING
     RETURNING id`,
    [stageRunId, providerId, modelId, requestHash, JSON.stringify(request)]
  );
  if (!generation.rowCount) throw new Error('Identical ASSET_GENERATION was claimed by another worker');
  const generationRunId = generation.rows[0].id;

  try {
    let result;
    if (unresolved.length) {
      result = await (providerCall ? providerCall({ request, model: modelName }) : callNvidia({ request, model: modelName }));
      validateAssetGeneration(result.parsed, unresolved);
    } else {
      result = { parsed: { assets: [] }, raw: null };
    }

    await client.query('BEGIN');
    try {
      const generated = [];
      for (const item of result.parsed.assets) {
        const requirement = unresolved.find((row) => String(row.id) === String(item.requirementId));
        const identityFingerprint = fingerprint({ assetType: item.assetType, name: item.name, canonicalData: item.canonicalData });
        const assetResult = await client.query(
          `INSERT INTO v2_1.assets(tenant_id,business_id,brand_id,asset_type,name,identity_fingerprint,canonical_data)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
           ON CONFLICT DO NOTHING RETURNING id`,
          [production.tenant_id, production.business_id, production.brand_id, item.assetType, `${item.name} [${production.id.slice(0,8)}]`, identityFingerprint, JSON.stringify(item.canonicalData)]
        );
        let assetId;
        if (assetResult.rowCount) assetId = assetResult.rows[0].id;
        else {
          const existingAsset = await client.query(`SELECT id FROM v2_1.assets WHERE tenant_id=$1 AND business_id=$2 AND asset_type=$3 AND name=$4`, [production.tenant_id, production.business_id, item.assetType, `${item.name} [${production.id.slice(0,8)}]`]);
          if (!existingAsset.rowCount) throw new Error(`Unable to materialize generated asset for requirement ${requirement.id}`);
          assetId = existingAsset.rows[0].id;
        }

        const version = await client.query(
          `SELECT version FROM v2_1.asset_versions WHERE asset_id=$1 ORDER BY version DESC LIMIT 1`,
          [assetId]
        );
        const nextVersion = (version.rows[0]?.version || 0) + 1;
        const assetVersion = await client.query(
          `INSERT INTO v2_1.asset_versions(asset_id,version,data,source_artifact_id)
           VALUES($1,$2,$3::jsonb,NULL) RETURNING id,version`,
          [assetId, nextVersion, JSON.stringify({ ...item.versionData, generationRunId, requestHash, requirementId: requirement.id })]
        );
        const resolutionFingerprint = fingerprint({ productionId, requirementId: requirement.id, assetId, assetVersionId: assetVersion.rows[0].id, requestHash });
        await client.query(
          `UPDATE v2_1.asset_requirements
              SET resolved_asset_id=$1,resolved_asset_version_id=$2,resolution_fingerprint=$3,status='SATISFIED'
            WHERE id=$4 AND resolved_asset_id IS NULL`,
          [assetId, assetVersion.rows[0].id, resolutionFingerprint, requirement.id]
        );
        generated.push({ requirementId: requirement.id, assetId, assetVersionId: assetVersion.rows[0].id, version: nextVersion });
      }

      const remaining = await client.query(`SELECT count(*)::integer AS count FROM v2_1.asset_requirements ar JOIN v2_1.shots s ON s.id=ar.shot_id WHERE s.production_id=$1 AND ar.resolved_asset_id IS NULL`, [productionId]);
      if (remaining.rows[0].count !== 0) throw new Error('ASSET_GENERATION did not satisfy every asset requirement');

      const output = { type: 'ASSETS', version: 1, assets: generated };
      const outputHash = fingerprint(output);
      const artifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('ASSETS',$1,'VALID') RETURNING id`, [productionId]);
      const artifactId = artifact.rows[0].id;
      await client.query(
        `INSERT INTO v2_1.artifact_versions(artifact_id,version,provider_id,model_id,input_hash,output_hash,metadata)
         VALUES($1,1,$2,$3,$4,$5,$6::jsonb)`,
        [artifactId, providerId, modelId, requestHash, outputHash, JSON.stringify({ capability: 'ASSET_GENERATION', generationRunId, contextFingerprint: production.context_fingerprint, sourceArtifactTypes: ['ASSET_REQUIREMENTS'] })]
      );
      await client.query(`UPDATE v2_1.generation_runs SET status='COMPLETED',response=$1::jsonb,artifact_id=$2,completed_at=now() WHERE id=$3`, [JSON.stringify(result.parsed), artifactId, generationRunId]);
      const completed = await client.query(
        `UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["ASSETS"]'::jsonb,output_fingerprint=$1,completed_at=now(),heartbeat_at=now(),lease_expires_at=NULL,worker_id=NULL WHERE id=$2 AND status='RUNNING' AND worker_id=$3 RETURNING id`,
        [outputHash, stageRunId, workerId]
      );
      if (!completed.rowCount) throw new Error('ASSET_GENERATION completion rejected: lease ownership or stage state is invalid');
      await client.query(`INSERT INTO v2_1.events(event_type,entity_type,entity_id,payload) VALUES('ASSET_GENERATION_COMPLETED','artifact',$1,$2::jsonb)`, [artifactId, JSON.stringify({ productionId, stageRunId, generationRunId, requestHash, outputHash, assetCount: generated.length, contextFingerprint: production.context_fingerprint })]);
      await client.query('COMMIT');
      return { generationRunId, artifactId, outputFingerprint: outputHash, assets: generated, reused: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    await client.query(`UPDATE v2_1.generation_runs SET status='FAILED',response=$1::jsonb WHERE id=$2`, [JSON.stringify({ error: error.message }), generationRunId]).catch(() => {});
    throw error;
  }
}

module.exports = {
  stableStringify,
  fingerprint,
  buildAssetGenerationRequest,
  validateAssetGeneration,
  executeAssetGenerationStage,
};
