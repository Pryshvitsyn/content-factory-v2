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

const PLATFORM_PROFILES = Object.freeze({
  TIKTOK: Object.freeze({ version: 1, aspectRatio: '9:16', renderIntent: 'SHORT_FORM_VERTICAL' }),
  INSTAGRAM_REELS: Object.freeze({ version: 1, aspectRatio: '9:16', renderIntent: 'SHORT_FORM_VERTICAL' }),
  YOUTUBE_SHORTS: Object.freeze({ version: 1, aspectRatio: '9:16', renderIntent: 'SHORT_FORM_VERTICAL' }),
  YOUTUBE: Object.freeze({ version: 1, aspectRatio: 'DECLARED', renderIntent: 'LONG_FORM_OR_DECLARED' }),
});

function normalizePlatforms(value) {
  const platforms = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const normalized = [...new Set(platforms.map((platform) => String(platform).trim().toUpperCase()).filter(Boolean))];
  if (!normalized.length) throw new Error('PLATFORM_ADAPTATION requires at least one declared target platform');
  for (const platform of normalized) if (!PLATFORM_PROFILES[platform]) throw new Error(`Unsupported target platform: ${platform}`);
  return normalized.sort();
}

function validateEditionManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Edition manifest must be an object');
  if (manifest.type !== 'PLATFORM_EDITION') throw new Error('Edition manifest type must be PLATFORM_EDITION');
  if (manifest.version !== 1) throw new Error('Edition manifest version must be 1');
  if (!manifest.contextFingerprint || !manifest.sourceEditArtifactId || !manifest.sourceEditFingerprint) throw new Error('Edition provenance is incomplete');
  if (!PLATFORM_PROFILES[manifest.platform]) throw new Error(`Unsupported platform: ${manifest.platform}`);
  if (!Number.isInteger(manifest.durationMs) || manifest.durationMs <= 0) throw new Error('Edition durationMs must be positive');
  if (!Array.isArray(manifest.timeline) || manifest.timeline.length < 1) throw new Error('Edition timeline must be non-empty');
  let previousEnd = 0;
  for (const [index, item] of manifest.timeline.entries()) {
    if (item.index !== index + 1) throw new Error('Edition timeline numbering must be contiguous');
    if (item.startMs !== previousEnd || item.endMs <= item.startMs) throw new Error('Edition timeline timing is invalid');
    previousEnd = item.endMs;
  }
  if (previousEnd !== manifest.durationMs) throw new Error('Edition duration does not match timeline');
  return true;
}

async function loadProduction(client, productionId) {
  const result = await client.query(`SELECT id, status, context_fingerprint, request_snapshot FROM v2_1.productions WHERE id=$1 FOR SHARE`, [productionId]);
  const production = result.rows[0];
  if (!production) throw new Error('Production not found');
  if (production.status !== 'RUNNING') throw new Error('Production is not RUNNING');
  if (!production.context_fingerprint) throw new Error('Production context fingerprint is missing');
  return production;
}

async function loadEdit(client, productionId, contextFingerprint) {
  const result = await client.query(`
    SELECT a.id AS artifact_id, av.output_hash, av.metadata
      FROM v2_1.artifacts a
      JOIN v2_1.artifact_versions av ON av.artifact_id=a.id AND av.version=1
     WHERE a.production_id=$1 AND a.artifact_type='EDIT' AND a.status='VALID'
     ORDER BY a.created_at DESC LIMIT 2`, [productionId]);
  if (result.rows.length !== 1) throw new Error('PLATFORM_ADAPTATION requires exactly one canonical VALID EDIT artifact');
  const edit = result.rows[0];
  if (edit.metadata?.contextFingerprint !== contextFingerprint) throw new Error('EDIT context fingerprint does not match production');
  return edit;
}

function buildEditionManifest({ platform, contextFingerprint, editArtifactId, editFingerprint, editMetadata }) {
  const profile = PLATFORM_PROFILES[platform];
  const sourceTimeline = Array.isArray(editMetadata?.timeline) ? editMetadata.timeline : editMetadata?.manifest?.timeline;
  if (!Array.isArray(sourceTimeline) || !sourceTimeline.length) throw new Error('EDIT artifact metadata does not contain a canonical timeline');
  const timeline = sourceTimeline.map((item, index) => ({
    index: index + 1,
    shotId: item.shotId,
    shotNumber: item.shotNumber,
    startMs: item.startMs,
    endMs: item.endMs,
    durationMs: item.durationMs,
    assetVersionIds: [...(item.assetVersionIds || [])],
    transition: index === 0 ? null : 'CUT',
  }));
  const manifest = {
    type: 'PLATFORM_EDITION',
    version: 1,
    platform,
    profileVersion: profile.version,
    aspectRatio: profile.aspectRatio,
    renderIntent: profile.renderIntent,
    contextFingerprint,
    sourceEditArtifactId: editArtifactId,
    sourceEditFingerprint: editFingerprint,
    durationMs: Number(editMetadata?.durationMs ?? editMetadata?.manifest?.durationMs ?? timeline.at(-1).endMs),
    timeline,
    adaptationPolicy: { crop: 'DECLARED_BY_RENDERER', captions: 'PRESERVE_SOURCE', audio: 'PRESERVE_SOURCE', branding: 'PRESERVE_BIBLE' },
  };
  validateEditionManifest(manifest);
  return manifest;
}

async function loadEditMetadata(client, artifactId) {
  const result = await client.query(`SELECT av.output_hash, av.metadata FROM v2_1.artifact_versions av WHERE av.artifact_id=$1 AND av.version=1`, [artifactId]);
  if (result.rowCount !== 1) throw new Error('Canonical EDIT artifact version is missing');
  return result.rows[0];
}

async function executePlatformAdaptationStage({ client, productionId, stageRunId, workerId, platforms } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  if (!productionId || !stageRunId || !workerId) throw new Error('productionId, stageRunId and workerId are required');
  const production = await loadProduction(client, productionId);
  const stage = await client.query(`SELECT sr.id, sr.stage, sr.status, sr.worker_id FROM v2_1.stage_runs sr JOIN v2_1.jobs j ON j.id=sr.job_id WHERE sr.id=$1 AND j.production_id=$2`, [stageRunId, productionId]);
  if (stage.rows[0]?.stage !== 'PLATFORM_ADAPTATION' || stage.rows[0]?.status !== 'RUNNING' || stage.rows[0]?.worker_id !== workerId) throw new Error('PLATFORM_ADAPTATION stage lease is not owned by this worker');

  const requested = normalizePlatforms(platforms || production.request_snapshot?.targetPlatforms || production.request_snapshot?.platforms);
  const edit = await loadEdit(client, productionId, production.context_fingerprint);
  const editMetadata = await loadEditMetadata(client, edit.artifact_id);
  const sourceManifest = editMetadata.metadata?.manifest || editMetadata.metadata?.editManifest || editMetadata.metadata;

  await client.query('BEGIN');
  try {
    const editionIds = [];
    const editionFingerprints = [];
    for (const platform of requested) {
      const manifest = buildEditionManifest({ platform, contextFingerprint: production.context_fingerprint, editArtifactId: edit.artifact_id, editFingerprint: edit.output_hash, editMetadata: sourceManifest });
      const editionFingerprint = fingerprint(manifest);
      const existing = await client.query(`SELECT id, metadata FROM v2_1.editions WHERE production_id=$1 AND platform=$2 AND version=1 FOR UPDATE`, [productionId, platform]);
      if (existing.rowCount) {
        if (existing.rows[0].metadata?.editionFingerprint !== editionFingerprint || existing.rows[0].metadata?.sourceEditArtifactId !== edit.artifact_id) throw new Error(`Conflicting canonical edition already exists for ${platform}`);
        editionIds.push(existing.rows[0].id);
        editionFingerprints.push(editionFingerprint);
        continue;
      }
      const edition = await client.query(`INSERT INTO v2_1.editions(production_id,platform,version,metadata,artifact_id) VALUES($1,$2,1,$3::jsonb,$4) RETURNING id`, [productionId, platform, JSON.stringify({ stage:'PLATFORM_ADAPTATION', contextFingerprint:production.context_fingerprint, sourceEditArtifactId:edit.artifact_id, sourceEditFingerprint:edit.output_hash, editionFingerprint, profileVersion:PLATFORM_PROFILES[platform].version, manifest }), edit.artifact_id]);
      editionIds.push(edition.rows[0].id);
      editionFingerprints.push(editionFingerprint);
    }

    const completed = await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED', output_artifacts='["EDITIONS"]'::jsonb, output_fingerprint=$1, completed_at=now(), heartbeat_at=now(), lease_expires_at=NULL, worker_id=NULL WHERE id=$2 AND status='RUNNING' AND worker_id=$3 RETURNING id`, [fingerprint({ contextFingerprint: production.context_fingerprint, requested, editionFingerprints }), stageRunId, workerId]);
    if (!completed.rowCount) throw new Error('PLATFORM_ADAPTATION completion rejected: lease ownership or stage state is invalid');
    await client.query(`INSERT INTO v2_1.events(event_type,entity_type,entity_id,payload) VALUES('PLATFORM_ADAPTATION_COMPLETED','production',$1,$2::jsonb)`, [productionId, JSON.stringify({ productionId, stageRunId, contextFingerprint: production.context_fingerprint, sourceEditArtifactId: edit.artifact_id, platforms: requested, editionIds })]);
    await client.query('COMMIT');
    return { editionIds, platforms: requested, outputFingerprint: fingerprint({ contextFingerprint: production.context_fingerprint, requested, editionFingerprints }) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

module.exports = { stableStringify, fingerprint, PLATFORM_PROFILES, normalizePlatforms, validateEditionManifest, buildEditionManifest, executePlatformAdaptationStage };
