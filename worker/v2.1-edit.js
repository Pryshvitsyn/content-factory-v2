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

function validateEditManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('EDIT manifest must be an object');
  if (manifest.type !== 'EDIT') throw new Error('EDIT.type must be EDIT');
  if (manifest.version !== 1) throw new Error('EDIT.version must be 1');
  if (typeof manifest.contextFingerprint !== 'string' || !manifest.contextFingerprint.trim()) throw new Error('EDIT.contextFingerprint is required');
  if (typeof manifest.continuityFingerprint !== 'string' || !manifest.continuityFingerprint.trim()) throw new Error('EDIT.continuityFingerprint is required');
  if (!Array.isArray(manifest.timeline) || manifest.timeline.length < 1) throw new Error('EDIT.timeline must be non-empty');
  let previousEnd = 0;
  manifest.timeline.forEach((item, index) => {
    if (item.index !== index + 1) throw new Error(`EDIT timeline numbering must be contiguous at ${index + 1}`);
    if (typeof item.shotId !== 'string' || !item.shotId) throw new Error(`EDIT timeline item ${index + 1} is missing shotId`);
    if (!Number.isInteger(item.startMs) || !Number.isInteger(item.endMs) || item.endMs <= item.startMs) throw new Error(`EDIT timeline item ${index + 1} has invalid timing`);
    if (item.startMs !== previousEnd) throw new Error(`EDIT timeline item ${index + 1} has a timing gap or overlap`);
    if (!Array.isArray(item.assetVersionIds) || item.assetVersionIds.length < 1) throw new Error(`EDIT timeline item ${index + 1} has no asset versions`);
    previousEnd = item.endMs;
  });
  if (!Number.isInteger(manifest.durationMs) || manifest.durationMs !== previousEnd) throw new Error('EDIT.durationMs must equal the timeline end');
  return true;
}

async function loadProduction(client, productionId) {
  const result = await client.query(`SELECT id, context_fingerprint, status FROM v2_1.productions WHERE id=$1 FOR SHARE`, [productionId]);
  const production = result.rows[0];
  if (!production) throw new Error('Production not found');
  if (production.status !== 'RUNNING') throw new Error('Production is not RUNNING');
  if (!production.context_fingerprint) throw new Error('Production context fingerprint is missing');
  return production;
}

async function loadStage(client, productionId, stageRunId, workerId) {
  const result = await client.query(`
    SELECT sr.id, sr.stage, sr.status, sr.worker_id
      FROM v2_1.stage_runs sr
      JOIN v2_1.jobs j ON j.id=sr.job_id
     WHERE sr.id=$1 AND j.production_id=$2`, [stageRunId, productionId]);
  const stage = result.rows[0];
  if (!stage || stage.stage !== 'EDIT') throw new Error('Stage run is not EDIT for this production');
  if (stage.status !== 'RUNNING' || stage.worker_id !== workerId) throw new Error('EDIT stage lease is not owned by this worker');
  return stage;
}

async function loadContinuity(client, productionId, contextFingerprint) {
  const result = await client.query(`
    SELECT a.id AS artifact_id, av.output_hash, av.metadata
      FROM v2_1.artifacts a
      JOIN v2_1.artifact_versions av ON av.artifact_id=a.id AND av.version=1
     WHERE a.production_id=$1 AND a.artifact_type='CONTINUITY_REPORT' AND a.status='VALID'
     ORDER BY a.created_at DESC LIMIT 2`, [productionId]);
  if (result.rows.length !== 1) throw new Error('EDIT requires exactly one canonical CONTINUITY_REPORT');
  const report = result.rows[0];
  if (report.metadata?.contextFingerprint !== contextFingerprint) throw new Error('CONTINUITY_REPORT context does not match production');
  return report;
}

async function loadShotsAndAssets(client, productionId, contextFingerprint) {
  const shots = await client.query(`SELECT s.id, s.shot_number, s.duration_ms, s.instructions, s.context_fingerprint FROM v2_1.shots s WHERE s.production_id=$1 ORDER BY s.shot_number`, [productionId]);
  if (!shots.rows.length) throw new Error('EDIT requires durable SHOTS');
  if (shots.rows.some((s) => s.context_fingerprint !== contextFingerprint)) throw new Error('EDIT cannot proceed with shot context drift');
  const requirements = await client.query(`SELECT ar.id, ar.shot_id, ar.required_asset_type, ar.resolved_asset_id, ar.resolved_asset_version_id, ar.status FROM v2_1.asset_requirements ar JOIN v2_1.shots s ON s.id=ar.shot_id WHERE s.production_id=$1 ORDER BY s.shot_number, ar.id`, [productionId]);
  if (!requirements.rows.length) throw new Error('EDIT requires durable ASSET_PLAN requirements');
  if (requirements.rows.some((r) => r.status !== 'SATISFIED' || !r.resolved_asset_id || !r.resolved_asset_version_id)) throw new Error('EDIT requires all asset requirements to be satisfied');
  const versions = await client.query(`SELECT av.id AS version_id, av.asset_id, av.version, a.asset_type FROM v2_1.asset_versions av JOIN v2_1.assets a ON a.id=av.asset_id WHERE av.id = ANY($1::uuid[])`, [requirements.rows.map((r) => r.resolved_asset_version_id)]);
  const byId = new Map(versions.rows.map((v) => [String(v.version_id), v]));
  for (const requirement of requirements.rows) {
    const version = byId.get(String(requirement.resolved_asset_version_id));
    if (!version) throw new Error(`Resolved asset version ${requirement.resolved_asset_version_id} does not exist`);
    if (String(version.asset_id) !== String(requirement.resolved_asset_id)) throw new Error(`Asset version ${requirement.id} points to a different asset`);
    if (version.asset_type !== requirement.required_asset_type) throw new Error(`Asset type mismatch for requirement ${requirement.id}`);
  }
  return { shots: shots.rows, requirements: requirements.rows, versions: [...byId.values()] };
}

function buildEditManifest({ production, continuity, shots, requirements, versions }) {
  const versionsById = new Map(versions.map((v) => [String(v.version_id), v]));
  let cursor = 0;
  const timeline = shots.map((shot, index) => {
    const durationMs = shot.duration_ms;
    if (!Number.isInteger(durationMs) || durationMs <= 0) throw new Error(`Shot ${shot.shot_number} has invalid duration`);
    const assetVersionIds = requirements.filter((r) => String(r.shot_id) === String(shot.id)).map((r) => r.resolved_asset_version_id);
    if (!assetVersionIds.length) throw new Error(`Shot ${shot.shot_number} has no resolved assets`);
    assetVersionIds.forEach((id) => { if (!versionsById.has(String(id))) throw new Error(`Missing asset version ${id}`); });
    const item = { index: index + 1, shotId: shot.id, shotNumber: shot.shot_number, startMs: cursor, endMs: cursor + durationMs, durationMs, instructions: shot.instructions || {}, assetVersionIds, transitions: index === 0 ? [] : [{ type: 'CUT', atMs: cursor }] };
    cursor += durationMs;
    return item;
  });
  const manifest = { type: 'EDIT', version: 1, contextFingerprint: production.context_fingerprint, continuityFingerprint: continuity.output_hash, sourceArtifacts: { continuityReportArtifactId: continuity.artifact_id }, timeline, durationMs: cursor, renderPolicy: { mode: 'PROVIDER_NEUTRAL', resolution: 'SOURCE', audio: 'SOURCE', captions: 'DOWNSTREAM' } };
  validateEditManifest(manifest);
  return manifest;
}

async function executeEditStage({ client, productionId, stageRunId, workerId } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  if (!productionId || !stageRunId || !workerId) throw new Error('productionId, stageRunId and workerId are required');
  const production = await loadProduction(client, productionId);
  await loadStage(client, productionId, stageRunId, workerId);
  const continuity = await loadContinuity(client, productionId, production.context_fingerprint);
  const { shots, requirements, versions } = await loadShotsAndAssets(client, productionId, production.context_fingerprint);
  const manifest = buildEditManifest({ production, continuity, shots, requirements, versions });
  const outputHash = fingerprint(manifest);
  await client.query('BEGIN');
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, $2))`, [String(productionId), 20260816]);
    const existing = await client.query(`SELECT a.id AS artifact_id, av.output_hash, av.metadata FROM v2_1.artifacts a JOIN v2_1.artifact_versions av ON av.artifact_id=a.id AND av.version=1 WHERE a.production_id=$1 AND a.artifact_type='EDIT' AND a.status='VALID' ORDER BY a.created_at DESC LIMIT 1`, [productionId]);
    if (existing.rows.length) {
      const row = existing.rows[0];
      if (row.output_hash !== outputHash || row.metadata?.contextFingerprint !== production.context_fingerprint || row.metadata?.continuityArtifactId !== continuity.artifact_id || row.metadata?.continuityFingerprint !== continuity.output_hash) throw new Error('Existing canonical EDIT artifact conflicts with the requested immutable production context');
      const completed = await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED', output_artifacts='["EDIT"]'::jsonb, output_fingerprint=$1, completed_at=now(), heartbeat_at=now(), lease_expires_at=NULL, worker_id=NULL WHERE id=$2 AND status='RUNNING' AND worker_id=$3 RETURNING id`, [outputHash, stageRunId, workerId]);
      if (!completed.rowCount) throw new Error('EDIT completion rejected: lease ownership or stage state is invalid');
      await client.query(`INSERT INTO v2_1.events(event_type,entity_type,entity_id,payload) VALUES('EDIT_REUSED','artifact',$1,$2::jsonb)`, [row.artifact_id, JSON.stringify({ productionId, stageRunId, outputHash, contextFingerprint: production.context_fingerprint, continuityArtifactId: continuity.artifact_id })]);
      await client.query('COMMIT');
      return { artifactId: row.artifact_id, outputHash, manifest, reused: true };
    }
    const artifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('EDIT',$1,'VALID') RETURNING id`, [productionId]);
    const artifactId = artifact.rows[0].id;
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,$2,$3,$4::jsonb)`, [artifactId, continuity.output_hash, outputHash, JSON.stringify({ stage: 'EDIT', contextFingerprint: production.context_fingerprint, continuityArtifactId: continuity.artifact_id, continuityFingerprint: continuity.output_hash, durationMs: manifest.durationMs, shotCount: manifest.timeline.length, manifest })]);
    const completed = await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED', output_artifacts='["EDIT"]'::jsonb, output_fingerprint=$1, completed_at=now(), heartbeat_at=now(), lease_expires_at=NULL, worker_id=NULL WHERE id=$2 AND status='RUNNING' AND worker_id=$3 RETURNING id`, [outputHash, stageRunId, workerId]);
    if (!completed.rowCount) throw new Error('EDIT completion rejected: lease ownership or stage state is invalid');
    await client.query(`INSERT INTO v2_1.events(event_type,entity_type,entity_id,payload) VALUES('EDIT_COMPLETED','artifact',$1,$2::jsonb)`, [artifactId, JSON.stringify({ productionId, stageRunId, outputHash, contextFingerprint: production.context_fingerprint, continuityArtifactId: continuity.artifact_id })]);
    await client.query('COMMIT');
    return { artifactId, outputHash, manifest, reused: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

module.exports = { stableStringify, fingerprint, validateEditManifest, buildEditManifest, executeEditStage };
