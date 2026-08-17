'use strict';

const crypto = require('node:crypto');
const { EDITION_PLATFORMS } = require('./v2.1-production-contract');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function validatePlatformManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('PLATFORM_ADAPTATION manifest must be an object');
  if (manifest.type !== 'EDITIONS') throw new Error('PLATFORM_ADAPTATION.type must be EDITIONS');
  if (manifest.version !== 1) throw new Error('PLATFORM_ADAPTATION.version must be 1');
  if (typeof manifest.contextFingerprint !== 'string' || !manifest.contextFingerprint.trim()) throw new Error('PLATFORM_ADAPTATION.contextFingerprint is required');
  if (typeof manifest.editFingerprint !== 'string' || !manifest.editFingerprint.trim()) throw new Error('PLATFORM_ADAPTATION.editFingerprint is required');
  if (typeof manifest.sourceEditArtifactId !== 'string' || !manifest.sourceEditArtifactId) throw new Error('PLATFORM_ADAPTATION.sourceEditArtifactId is required');
  if (!Array.isArray(manifest.editions) || manifest.editions.length < 1) throw new Error('PLATFORM_ADAPTATION.editions must be non-empty');
  const seen = new Set();
  for (const edition of manifest.editions) {
    if (!EDITION_PLATFORMS.includes(edition.platform)) throw new Error(`Unsupported platform: ${edition.platform}`);
    if (seen.has(edition.platform)) throw new Error(`Duplicate platform: ${edition.platform}`);
    seen.add(edition.platform);
    if (edition.version !== 1) throw new Error(`Edition version must be 1 for ${edition.platform}`);
    if (edition.durationMs !== manifest.durationMs) throw new Error(`Edition duration drift for ${edition.platform}`);
    if (!Array.isArray(edition.timeline) || edition.timeline.length < 1) throw new Error(`Edition timeline is empty for ${edition.platform}`);
  }
  return true;
}

async function loadProduction(client, productionId) {
  const result = await client.query(`
    SELECT p.id, p.status, p.context_fingerprint, p.metadata,
           cv.target_platform
      FROM v2_1.productions p
      JOIN v2_1.content_variants cv ON cv.id = p.content_variant_id
     WHERE p.id=$1`, [productionId]);
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
  if (!stage || stage.stage !== 'PLATFORM_ADAPTATION') throw new Error('Stage run is not PLATFORM_ADAPTATION for this production');
  if (stage.status !== 'RUNNING' || stage.worker_id !== workerId) throw new Error('PLATFORM_ADAPTATION stage lease is not owned by this worker');
  return stage;
}

async function loadEdit(client, productionId, contextFingerprint) {
  const result = await client.query(`
    SELECT a.id AS artifact_id, av.output_hash, av.metadata, av.storage_uri
      FROM v2_1.artifacts a
      JOIN v2_1.artifact_versions av ON av.artifact_id=a.id AND av.version=1
     WHERE a.production_id=$1 AND a.artifact_type='EDIT' AND a.status='VALID'
     ORDER BY a.created_at DESC LIMIT 2`, [productionId]);
  if (result.rows.length !== 1) throw new Error('PLATFORM_ADAPTATION requires exactly one canonical EDIT artifact');
  const edit = result.rows[0];
  if (edit.metadata?.contextFingerprint !== contextFingerprint) throw new Error('EDIT context does not match production');
  return edit;
}

function resolvePlatforms(production) {
  const configured = Array.isArray(production.metadata?.platforms) ? production.metadata.platforms : [];
  const target = typeof production.target_platform === 'string' && production.target_platform.trim() ? [production.target_platform.trim()] : [];
  const platforms = [...new Set([...configured, ...target])];
  if (!platforms.length) throw new Error('PLATFORM_ADAPTATION requires at least one target platform');
  for (const platform of platforms) {
    if (!EDITION_PLATFORMS.includes(platform)) throw new Error(`Unsupported target platform: ${platform}`);
  }
  return platforms;
}

function buildPlatformManifest({ production, edit, platforms }) {
  const editManifest = edit.metadata?.manifest;
  const durationMs = Number(edit.metadata?.durationMs);
  if (!Number.isInteger(durationMs) || durationMs <= 0) throw new Error('Canonical EDIT duration is missing or invalid');
  const timeline = Array.isArray(editManifest?.timeline) ? editManifest.timeline : null;
  if (!timeline || !timeline.length) throw new Error('Canonical EDIT timeline is not available in artifact metadata');

  const editions = platforms.map((platform) => ({
    platform,
    version: 1,
    durationMs,
    sourceEditArtifactId: edit.artifact_id,
    timeline: timeline.map((item) => ({
      index: item.index,
      shotId: item.shotId,
      startMs: item.startMs,
      endMs: item.endMs,
      durationMs: item.durationMs,
      assetVersionIds: [...item.assetVersionIds],
      adaptation: {
        captions: platform === 'YOUTUBE' ? 'OPTIONAL' : 'DOWNSTREAM_REQUIRED',
        framing: 'SOURCE_PRESERVED',
        audio: 'SOURCE_PRESERVED',
      },
    })),
    renderProfile: production.metadata?.platformProfiles?.[platform] || {},
  }));

  const manifest = {
    type: 'EDITIONS',
    version: 1,
    contextFingerprint: production.context_fingerprint,
    editFingerprint: edit.output_hash,
    sourceEditArtifactId: edit.artifact_id,
    durationMs,
    editions,
  };
  validatePlatformManifest(manifest);
  return manifest;
}

async function executePlatformAdaptationStage({ client, productionId, stageRunId, workerId } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  if (!productionId || !stageRunId || !workerId) throw new Error('productionId, stageRunId and workerId are required');
  const production = await loadProduction(client, productionId);
  await loadStage(client, productionId, stageRunId, workerId);
  const edit = await loadEdit(client, productionId, production.context_fingerprint);
  const platforms = resolvePlatforms(production);

  // The EDIT boundary intentionally stores only a compact provenance manifest.
  // For adaptation we accept the timeline/provenance metadata already carried by EDIT.
  const manifest = buildPlatformManifest({ production, edit, platforms });
  const outputHash = fingerprint(manifest);

  await client.query('BEGIN');
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, $2))`, [String(productionId), 20260817]);

    const existing = await client.query(`
      SELECT a.id AS artifact_id, av.output_hash, av.metadata
        FROM v2_1.artifacts a
        JOIN v2_1.artifact_versions av ON av.artifact_id=a.id AND av.version=1
       WHERE a.production_id=$1 AND a.artifact_type='EDITIONS' AND a.status='VALID'
       ORDER BY a.created_at DESC LIMIT 1`, [productionId]);

    if (existing.rows.length) {
      const row = existing.rows[0];
      if (row.output_hash !== outputHash || row.metadata?.contextFingerprint !== production.context_fingerprint || row.metadata?.editArtifactId !== edit.artifact_id || row.metadata?.editFingerprint !== edit.output_hash) {
        throw new Error('Existing canonical EDITIONS artifact conflicts with requested EDIT provenance');
      }
      await client.query(`UPDATE v2_1.editions SET metadata=$1::jsonb WHERE production_id=$2 AND version=1`, [JSON.stringify({ contextFingerprint: production.context_fingerprint, editArtifactId: edit.artifact_id, editFingerprint: edit.output_hash, reused: true }), productionId]);
      const completed = await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED', output_artifacts='["EDITIONS"]'::jsonb, output_fingerprint=$1, completed_at=now(), heartbeat_at=now(), lease_expires_at=NULL, worker_id=NULL WHERE id=$2 AND status='RUNNING' AND worker_id=$3 RETURNING id`, [outputHash, stageRunId, workerId]);
      if (!completed.rowCount) throw new Error('PLATFORM_ADAPTATION completion rejected: lease ownership or stage state is invalid');
      await client.query(`INSERT INTO v2_1.events(event_type,entity_type,entity_id,payload) VALUES('PLATFORM_ADAPTATION_REUSED','artifact',$1,$2::jsonb)`, [row.artifact_id, JSON.stringify({ productionId, stageRunId, outputHash, contextFingerprint: production.context_fingerprint, editArtifactId: edit.artifact_id })]);
      await client.query('COMMIT');
      return { artifactId: row.artifact_id, outputHash, manifest, reused: true };
    }

    const artifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('EDITIONS',$1,'VALID') RETURNING id`, [productionId]);
    const artifactId = artifact.rows[0].id;
    await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,$2,$3,$4::jsonb)`, [edit.output_hash, outputHash, JSON.stringify({ stage: 'PLATFORM_ADAPTATION', contextFingerprint: production.context_fingerprint, editArtifactId: edit.artifact_id, editFingerprint: edit.output_hash, platforms: platforms, durationMs })]);
    for (const edition of manifest.editions) {
      await client.query(`INSERT INTO v2_1.editions(production_id,platform,version,metadata,artifact_id) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT (production_id,platform,version) DO UPDATE SET metadata=EXCLUDED.metadata, artifact_id=EXCLUDED.artifact_id`, [productionId, edition.platform, edition.version, JSON.stringify({ contextFingerprint: production.context_fingerprint, editArtifactId: edit.artifact_id, editFingerprint: edit.output_hash, outputHash }), artifactId]);
    }
    const completed = await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED', output_artifacts='["EDITIONS"]'::jsonb, output_fingerprint=$1, completed_at=now(), heartbeat_at=now(), lease_expires_at=NULL, worker_id=NULL WHERE id=$2 AND status='RUNNING' AND worker_id=$3 RETURNING id`, [outputHash, stageRunId, workerId]);
    if (!completed.rowCount) throw new Error('PLATFORM_ADAPTATION completion rejected: lease ownership or stage state is invalid');
    await client.query(`INSERT INTO v2_1.events(event_type,entity_type,entity_id,payload) VALUES('PLATFORM_ADAPTATION_COMPLETED','artifact',$1,$2::jsonb)`, [artifactId, JSON.stringify({ productionId, stageRunId, outputHash, contextFingerprint: production.context_fingerprint, editArtifactId: edit.artifact_id, platforms })]);
    await client.query('COMMIT');
    return { artifactId, outputHash, manifest, reused: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

module.exports = { stableStringify, fingerprint, validatePlatformManifest, resolvePlatforms, buildPlatformManifest, executePlatformAdaptationStage };
