'use strict';

const crypto = require('node:crypto');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizeShot(shot) {
  return {
    shotNumber: shot.shotNumber,
    durationMs: shot.durationMs,
    instructions: shot.instructions || {},
  };
}

function buildContinuityFingerprint({ production, bible, shots, requirements, assets }) {
  return fingerprint({
    production: { id: production.id, contextFingerprint: production.context_fingerprint },
    bible: { id: bible.id, version: bible.version, outputHash: bible.outputHash },
    shots: shots.map(normalizeShot),
    requirements: requirements.map((row) => ({
      id: row.id,
      shotId: row.shot_id,
      role: row.asset_role,
      requiredType: row.required_asset_type,
      requiredAssetId: row.required_asset_id,
      resolvedAssetId: row.resolved_asset_id,
      resolvedAssetVersionId: row.resolved_asset_version_id,
      resolutionFingerprint: row.resolution_fingerprint,
      contextFingerprint: row.context_fingerprint,
      planFingerprint: row.plan_fingerprint,
    })),
    assets: assets.map((row) => ({
      id: row.id,
      assetType: row.asset_type,
      identityFingerprint: row.identity_fingerprint,
      versionId: row.version_id,
      version: row.version,
      versionData: row.version_data,
    })),
  });
}

function validateContinuityReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('CONTINUITY_REPORT must be an object');
  if (report.type !== 'CONTINUITY_REPORT') throw new Error('CONTINUITY_REPORT.type must be CONTINUITY_REPORT');
  if (report.version !== 1) throw new Error('CONTINUITY_REPORT.version must be 1');
  if (typeof report.contextFingerprint !== 'string' || !report.contextFingerprint.trim()) throw new Error('CONTINUITY_REPORT.contextFingerprint is required');
  if (typeof report.continuityFingerprint !== 'string' || !report.continuityFingerprint.trim()) throw new Error('CONTINUITY_REPORT.continuityFingerprint is required');
  if (!Array.isArray(report.checks) || report.checks.length < 1) throw new Error('CONTINUITY_REPORT.checks must be non-empty');
  for (const check of report.checks) {
    if (!check || typeof check !== 'object') throw new Error('CONTINUITY_REPORT contains an invalid check');
    if (typeof check.name !== 'string' || !check.name.trim()) throw new Error('CONTINUITY check name is required');
    if (check.status !== 'PASS') throw new Error(`CONTINUITY check ${check.name} is not PASS`);
  }
  if (report.status !== 'PASS') throw new Error('CONTINUITY_REPORT.status must be PASS');
  return true;
}

async function loadProduction(client, productionId) {
  const result = await client.query(
    `SELECT id, tenant_id, business_id, brand_id, context_fingerprint, status
       FROM v2_1.productions WHERE id=$1 FOR SHARE`,
    [productionId]
  );
  const production = result.rows[0];
  if (!production) throw new Error('Production not found');
  if (production.status !== 'RUNNING') throw new Error('Production is not RUNNING');
  if (!production.context_fingerprint) throw new Error('Production immutable context fingerprint is missing');
  return production;
}

async function loadStage(client, productionId, stageRunId) {
  const result = await client.query(
    `SELECT sr.id, sr.stage, sr.status, sr.worker_id
       FROM v2_1.stage_runs sr
       JOIN v2_1.jobs j ON j.id=sr.job_id
      WHERE sr.id=$1 AND j.production_id=$2`,
    [stageRunId, productionId]
  );
  const stage = result.rows[0];
  if (!stage || stage.stage !== 'CONTINUITY') throw new Error('Stage run is not a CONTINUITY stage for this production');
  if (stage.status !== 'RUNNING' || !stage.worker_id) throw new Error('CONTINUITY stage lease is not active');
  return stage;
}

async function loadCanonicalBible(client, productionId) {
  const result = await client.query(
    `SELECT pb.id, pb.version, pb.context_fingerprint, a.id AS artifact_id, av.output_hash
       FROM v2_1.production_bibles pb
       JOIN v2_1.artifacts a ON a.id=pb.artifact_id AND a.artifact_type='PRODUCTION_BIBLE'
       JOIN v2_1.artifact_versions av ON av.artifact_id=a.id AND av.version=1
      WHERE pb.production_id=$1 ORDER BY pb.version DESC LIMIT 1`,
    [productionId]
  );
  const bible = result.rows[0];
  if (!bible) throw new Error('Canonical PRODUCTION_BIBLE is required before CONTINUITY');
  if (bible.context_fingerprint === null) throw new Error('BIBLE immutable context fingerprint is missing');
  return { id: bible.artifact_id, productionBibleId: bible.id, version: bible.version, contextFingerprint: bible.context_fingerprint, outputHash: bible.output_hash };
}

async function loadShots(client, productionId, bible) {
  const result = await client.query(
    `SELECT id, shot_number, duration_ms, instructions, production_bible_id, source_script_artifact_id, context_fingerprint, plan_fingerprint
       FROM v2_1.shots WHERE production_id=$1 ORDER BY shot_number`,
    [productionId]
  );
  if (!result.rows.length) throw new Error('SHOT_PLAN is required before CONTINUITY');
  for (const shot of result.rows) {
    if (shot.production_bible_id !== bible.productionBibleId) throw new Error(`Shot ${shot.shot_number} references the wrong BIBLE`);
    if (shot.context_fingerprint !== bible.contextFingerprint) throw new Error(`Shot ${shot.shot_number} violates immutable context`);
  }
  return result.rows;
}

async function loadRequirements(client, productionId) {
  const result = await client.query(
    `SELECT ar.id, ar.shot_id, ar.asset_role, ar.required_asset_type, ar.required_asset_id,
            ar.status, ar.production_bible_id, ar.context_fingerprint, ar.plan_fingerprint,
            ar.resolved_asset_id, ar.resolved_asset_version_id, ar.resolution_fingerprint
       FROM v2_1.asset_requirements ar
       JOIN v2_1.shots s ON s.id=ar.shot_id
      WHERE s.production_id=$1 ORDER BY s.shot_number, ar.asset_role, ar.id`,
    [productionId]
  );
  if (!result.rows.length) throw new Error('ASSET_PLAN requirements are required before CONTINUITY');
  return result.rows;
}

async function loadResolvedAssets(client, productionId, requirements) {
  const ids = [...new Set(requirements.map((row) => row.resolved_asset_id).filter(Boolean))];
  if (ids.length !== requirements.length) throw new Error('CONTINUITY requires every asset requirement to be resolved');
  const result = await client.query(
    `SELECT a.id, a.tenant_id, a.business_id, a.brand_id, a.asset_type, a.identity_fingerprint,
            av.id AS version_id, av.version, av.data AS version_data
       FROM v2_1.assets a
       JOIN v2_1.asset_versions av ON av.id = ANY($1::uuid[])
      WHERE a.id=av.asset_id AND a.id = ANY($2::uuid[])`,
    [requirements.map((row) => row.resolved_asset_version_id), ids]
  );
  const byVersion = new Map(result.rows.map((row) => [String(row.version_id), row]));
  if (byVersion.size !== requirements.length) throw new Error('CONTINUITY could not resolve every selected asset version');
  return [...byVersion.values()].map((asset) => ({ ...asset, productionId }));
}

async function loadAssetsArtifact(client, productionId) {
  const result = await client.query(
    `SELECT a.id AS artifact_id, av.version, av.output_hash, av.metadata
       FROM v2_1.artifacts a
       JOIN v2_1.artifact_versions av ON av.artifact_id=a.id
      WHERE a.production_id=$1 AND a.artifact_type='ASSETS' AND a.status='VALID'
      ORDER BY av.version DESC, a.created_at DESC LIMIT 1`,
    [productionId]
  );
  const artifact = result.rows[0];
  if (!artifact) throw new Error('Canonical ASSETS artifact is required before CONTINUITY');
  return artifact;
}

function buildChecks({ production, bible, shots, requirements, assets, assetsArtifact }) {
  const assetByVersion = new Map(assets.map((asset) => [String(asset.version_id), asset]));
  const checks = [];
  checks.push({ name: 'production_context', status: production.context_fingerprint === bible.contextFingerprint ? 'PASS' : 'FAIL' });
  checks.push({ name: 'shot_bible_provenance', status: shots.every((shot) => shot.production_bible_id === bible.productionBibleId && shot.context_fingerprint === production.context_fingerprint) ? 'PASS' : 'FAIL' });
  checks.push({ name: 'shot_numbering', status: shots.every((shot, index) => shot.shot_number === index + 1) ? 'PASS' : 'FAIL' });
  checks.push({ name: 'asset_fulfillment', status: requirements.every((row) => row.status === 'SATISFIED' && row.resolved_asset_id && row.resolved_asset_version_id) ? 'PASS' : 'FAIL' });
  checks.push({ name: 'asset_version_existence', status: requirements.every((row) => assetByVersion.has(String(row.resolved_asset_version_id))) ? 'PASS' : 'FAIL' });
  checks.push({ name: 'asset_type_compatibility', status: requirements.every((row) => assetByVersion.get(String(row.resolved_asset_version_id))?.asset_type === row.required_asset_type) ? 'PASS' : 'FAIL' });
  checks.push({ name: 'asset_tenant_business_ownership', status: assets.every((asset) => asset.tenant_id === production.tenant_id && asset.business_id === production.business_id && (!production.brand_id || !asset.brand_id || asset.brand_id === production.brand_id)) ? 'PASS' : 'FAIL' });
  checks.push({ name: 'assets_artifact_provenance', status: assetsArtifact.metadata?.contextFingerprint === production.context_fingerprint ? 'PASS' : 'FAIL' });
  return checks;
}

async function executeContinuityStage({ client, productionId, stageRunId, workerId } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  if (!productionId || !stageRunId || !workerId) throw new Error('productionId, stageRunId and workerId are required');

  const production = await loadProduction(client, productionId);
  const stage = await loadStage(client, productionId, stageRunId);
  if (stage.worker_id !== workerId) throw new Error('CONTINUITY stage lease is not owned by this worker');

  const bible = await loadCanonicalBible(client, productionId);
  if (bible.contextFingerprint !== production.context_fingerprint) throw new Error('BIBLE context does not match production context');
  const shots = await loadShots(client, productionId, bible);
  const requirements = await loadRequirements(client, productionId);
  const assets = await loadResolvedAssets(client, productionId, requirements);
  const assetsArtifact = await loadAssetsArtifact(client, productionId);
  const checks = buildChecks({ production, bible, shots, requirements, assets, assetsArtifact });
  if (checks.some((check) => check.status !== 'PASS')) throw new Error(`CONTINUITY failed: ${checks.filter((check) => check.status !== 'PASS').map((check) => check.name).join(', ')}`);

  const continuityFingerprint = buildContinuityFingerprint({ production, bible, shots, requirements, assets });
  const report = {
    type: 'CONTINUITY_REPORT',
    version: 1,
    status: 'PASS',
    contextFingerprint: production.context_fingerprint,
    continuityFingerprint,
    sourceArtifacts: { bibleArtifactId: bible.id, assetsArtifactId: assetsArtifact.artifact_id },
    counts: { shots: shots.length, requirements: requirements.length, resolvedAssets: assets.length },
    checks,
  };
  validateContinuityReport(report);
  const outputHash = fingerprint(report);

  await client.query('BEGIN');
  try {
    const artifact = await client.query(
      `INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('CONTINUITY_REPORT',$1,'VALID') RETURNING id`,
      [productionId]
    );
    const artifactId = artifact.rows[0].id;
    await client.query(
      `INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata)
       VALUES($1,1,$2,$3,$4::jsonb)`,
      [artifactId, continuityFingerprint, outputHash, JSON.stringify({ stage: 'CONTINUITY', contextFingerprint: production.context_fingerprint, sourceArtifacts: report.sourceArtifacts, checkCount: checks.length })]
    );
    const completed = await client.query(
      `UPDATE v2_1.stage_runs
          SET status='COMPLETED', output_artifacts='["CONTINUITY_REPORT"]'::jsonb,
              output_fingerprint=$1, completed_at=now(), heartbeat_at=now(), lease_expires_at=NULL, worker_id=NULL
        WHERE id=$2 AND status='RUNNING' AND worker_id=$3 RETURNING id`,
      [outputHash, stageRunId, workerId]
    );
    if (!completed.rowCount) throw new Error('CONTINUITY completion rejected: lease ownership or stage state is invalid');
    await client.query(
      `INSERT INTO v2_1.events(event_type,entity_type,entity_id,payload)
       VALUES('CONTINUITY_COMPLETED','artifact',$1,$2::jsonb)`,
      [artifactId, JSON.stringify({ productionId, stageRunId, continuityFingerprint, outputHash, contextFingerprint: production.context_fingerprint })]
    );
    await client.query('COMMIT');
    return { artifactId, continuityFingerprint, outputFingerprint: outputHash, report };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

module.exports = { stableStringify, fingerprint, buildContinuityFingerprint, validateContinuityReport, buildChecks, executeContinuityStage };
