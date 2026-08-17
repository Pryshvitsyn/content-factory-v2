'use strict';

const crypto = require('node:crypto');
const { PLATFORM_PROFILES } = require('./v2.1-platform-adaptation');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function normalizePlatforms(value) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const platforms = [...new Set(raw.map((v) => String(v).trim().toUpperCase()).filter(Boolean))].sort();
  if (!platforms.length) throw new Error('VALIDATION requires at least one declared target platform');
  for (const platform of platforms) if (!PLATFORM_PROFILES[platform]) throw new Error(`Unsupported target platform: ${platform}`);
  return platforms;
}

function validateTimeline(timeline, durationMs) {
  if (!Array.isArray(timeline) || !timeline.length) throw new Error('EDIT timeline is missing');
  let cursor = 0;
  for (const [index, item] of timeline.entries()) {
    if (item.index !== index + 1) throw new Error('Timeline numbering is not contiguous');
    if (!Number.isInteger(item.startMs) || !Number.isInteger(item.endMs) || item.startMs !== cursor || item.endMs <= item.startMs) throw new Error('Timeline timing is invalid');
    if (!Array.isArray(item.assetVersionIds) || item.assetVersionIds.length === 0) throw new Error(`Timeline item ${index + 1} has no asset versions`);
    cursor = item.endMs;
  }
  if (cursor !== durationMs) throw new Error('Timeline duration does not match canonical duration');
}

function validateEdition({ platform, edition, edit, contextFingerprint }) {
  if (!PLATFORM_PROFILES[platform]) throw new Error(`Unsupported platform: ${platform}`);
  if (edition.version !== 1) throw new Error(`Edition ${platform} has unsupported version`);
  if (edition.metadata?.stage !== 'PLATFORM_ADAPTATION') throw new Error(`Edition ${platform} has invalid stage provenance`);
  if (edition.metadata?.contextFingerprint !== contextFingerprint) throw new Error(`Edition ${platform} context drift detected`);
  if (String(edition.metadata?.sourceEditArtifactId) !== String(edit.artifact_id)) throw new Error(`Edition ${platform} does not point to canonical EDIT`);
  if (edition.metadata?.sourceEditFingerprint !== edit.output_hash) throw new Error(`Edition ${platform} EDIT fingerprint drift detected`);
  if (edition.metadata?.profileVersion !== PLATFORM_PROFILES[platform].version) throw new Error(`Edition ${platform} profile version mismatch`);
  const manifest = edition.metadata?.manifest;
  if (!manifest || manifest.type !== 'PLATFORM_EDITION' || manifest.platform !== platform || manifest.contextFingerprint !== contextFingerprint) throw new Error(`Edition ${platform} manifest is not canonical`);
  if (manifest.sourceEditArtifactId !== edit.artifact_id || manifest.sourceEditFingerprint !== edit.output_hash) throw new Error(`Edition ${platform} manifest EDIT provenance is invalid`);
  if (!Number.isInteger(manifest.durationMs) || manifest.durationMs <= 0) throw new Error(`Edition ${platform} duration is invalid`);
  validateTimeline(manifest.timeline, manifest.durationMs);
  return fingerprint(manifest);
}

async function loadProduction(client, productionId) {
  const result = await client.query(`SELECT id,status,context_fingerprint,request_snapshot FROM v2_1.productions WHERE id=$1 FOR SHARE`, [productionId]);
  const production = result.rows[0];
  if (!production) throw new Error('Production not found');
  if (production.status !== 'RUNNING') throw new Error(`Production is not RUNNING: ${production.status}`);
  if (!production.context_fingerprint) throw new Error('Production context fingerprint is missing');
  return production;
}

async function loadCanonicalEdit(client, productionId, contextFingerprint) {
  const result = await client.query(`
    SELECT a.id AS artifact_id,av.output_hash,av.metadata
      FROM v2_1.artifacts a
      JOIN v2_1.artifact_versions av ON av.artifact_id=a.id AND av.version=1
     WHERE a.production_id=$1 AND a.artifact_type='EDIT' AND a.status='VALID'
       AND av.metadata->>'contextFingerprint'=$2`, [productionId, contextFingerprint]);
  if (result.rowCount !== 1) throw new Error('VALIDATION requires exactly one context-bound VALID EDIT artifact');
  return result.rows[0];
}

async function executeValidationStage({ client, productionId, stageRunId, workerId } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  if (!productionId || !stageRunId || !workerId) throw new Error('productionId, stageRunId and workerId are required');
  const production = await loadProduction(client, productionId);
  const stage = await client.query(`SELECT sr.id,sr.stage,sr.status,sr.worker_id FROM v2_1.stage_runs sr JOIN v2_1.jobs j ON j.id=sr.job_id WHERE sr.id=$1 AND j.production_id=$2`, [stageRunId, productionId]);
  if (stage.rows[0]?.stage !== 'VALIDATION' || stage.rows[0]?.status !== 'RUNNING' || stage.rows[0]?.worker_id !== workerId) throw new Error('VALIDATION stage lease is not owned by this worker');

  const platforms = normalizePlatforms(production.request_snapshot?.targetPlatforms || production.request_snapshot?.platforms);
  const edit = await loadCanonicalEdit(client, productionId, production.context_fingerprint);
  const editions = await client.query(`SELECT id,platform,version,metadata FROM v2_1.editions WHERE production_id=$1 AND version=1 ORDER BY platform`, [productionId]);
  const byPlatform = new Map(editions.rows.map((row) => [row.platform, row]));
  if (editions.rowCount !== platforms.length) throw new Error('VALIDATION found unexpected or missing platform editions');

  const editionFingerprints = [];
  for (const platform of platforms) {
    const edition = byPlatform.get(platform);
    if (!edition) throw new Error(`Missing canonical edition for ${platform}`);
    editionFingerprints.push(validateEdition({ platform, edition, edit, contextFingerprint: production.context_fingerprint }));
  }

  const report = {
    type: 'VALIDATION_REPORT',
    version: 1,
    contextFingerprint: production.context_fingerprint,
    sourceEditArtifactId: edit.artifact_id,
    sourceEditFingerprint: edit.output_hash,
    platforms,
    editionIds: platforms.map((platform) => byPlatform.get(platform).id),
    editionFingerprints,
    checks: {
      edit: 'PASS',
      provenance: 'PASS',
      timeline: 'PASS',
      platformProfiles: 'PASS',
      editionCardinality: 'PASS',
    },
    passed: true,
  };
  const reportHash = fingerprint(report);

  await client.query('BEGIN');
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,$2))`, [String(productionId), 20260817]);
    const existing = await client.query(`SELECT a.id AS artifact_id,av.output_hash FROM v2_1.artifacts a JOIN v2_1.artifact_versions av ON av.artifact_id=a.id AND av.version=1 WHERE a.production_id=$1 AND a.artifact_type='VALIDATION_REPORT' AND a.status='VALID' FOR UPDATE`, [productionId]);
    if (existing.rowCount && existing.rows[0].output_hash !== reportHash) throw new Error('Existing canonical VALIDATION_REPORT conflicts with current immutable production inputs');
    let reportArtifactId = existing.rows[0]?.artifact_id;
    if (!reportArtifactId) {
      const artifact = await client.query(`INSERT INTO v2_1.artifacts(artifact_type,production_id,status) VALUES('VALIDATION_REPORT',$1,'VALID') RETURNING id`, [productionId]);
      reportArtifactId = artifact.rows[0].id;
      await client.query(`INSERT INTO v2_1.artifact_versions(artifact_id,version,input_hash,output_hash,metadata) VALUES($1,1,$2,$3,$4::jsonb)`, [reportArtifactId, edit.output_hash, reportHash, JSON.stringify({ stage:'VALIDATION', contextFingerprint:production.context_fingerprint, sourceEditArtifactId:edit.artifact_id, sourceEditFingerprint:edit.output_hash, report })]);
    }
    const completed = await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED',output_artifacts='["VALIDATION_REPORT"]'::jsonb,output_fingerprint=$1,completed_at=now(),heartbeat_at=now(),lease_expires_at=NULL,worker_id=NULL WHERE id=$2 AND status='RUNNING' AND worker_id=$3 RETURNING id`, [reportHash, stageRunId, workerId]);
    if (!completed.rowCount) throw new Error('VALIDATION completion rejected: lease ownership or stage state is invalid');
    await client.query(`INSERT INTO v2_1.events(event_type,entity_type,entity_id,payload) VALUES('VALIDATION_COMPLETED','artifact',$1,$2::jsonb)`, [reportArtifactId, JSON.stringify({ productionId, stageRunId, reportHash, contextFingerprint:production.context_fingerprint, platforms })]);
    await client.query('COMMIT');
    return { artifactId: reportArtifactId, reportHash, report, reused: Boolean(existing.rowCount) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

module.exports = { stableStringify, fingerprint, normalizePlatforms, validateTimeline, validateEdition, executeValidationStage };
