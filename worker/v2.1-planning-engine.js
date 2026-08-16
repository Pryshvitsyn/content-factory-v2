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

function assertObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
}

function normalizeAssetType(value) {
  const type = String(value || '').toUpperCase();
  const aliases = { CHARACTER: 'CHARACTER', LOCATION: 'LOCATION', STYLE: 'STYLE', VOICE: 'VOICE', PROP: 'PROP', BRAND: 'BRAND', PRODUCT: 'PRODUCT' };
  if (!aliases[type]) throw new Error(`Unsupported asset type: ${value}`);
  return aliases[type];
}

function normalizeAssetRequirements(bible) {
  assertObject(bible, 'bible');
  assertObject(bible.productionPlan, 'bible.productionPlan');
  const declared = Array.isArray(bible.productionPlan.assetRequirements) ? bible.productionPlan.assetRequirements : [];
  const byId = new Map(declared.filter((item) => item && item.id).map((item) => [item.id, item]));
  const result = [];
  const shotNumbers = (bible.productionPlan.shots || []).map((shot) => {
    positiveInteger(shot.number, 'shot.number');
    return shot.number;
  });

  for (const shot of bible.productionPlan.shots || []) {
    for (const ref of shot.assetRefs || []) {
      assertObject(ref, 'shot.assetRefs[]');
      if (!ref.id) throw new Error(`Shot ${shot.number} contains an asset reference without id`);
      const declaredRequirement = byId.get(ref.id) || {};
      const assetType = normalizeAssetType(ref.type || declaredRequirement.type);
      const role = String(declaredRequirement.role || ref.role || ref.id).trim();
      if (!role) throw new Error(`Shot ${shot.number} asset ${ref.id} has no role`);
      const version = ref.version ?? declaredRequirement.version ?? null;
      if (version !== null) positiveInteger(version, `asset ${ref.id} version`);
      result.push({
        shotNumber: shot.number,
        assetRole: role,
        requiredAssetType: assetType,
        requiredAssetId: ref.id,
        requiredAssetVersion: version,
        status: declaredRequirement.status || 'MISSING',
        constraints: { ...(declaredRequirement.constraints || {}), ...(ref.constraints || {}) },
      });
    }
  }

  for (const item of declared) {
    if (!item || !item.id || !item.role) continue;
    if (!result.some((row) => row.requiredAssetId === item.id)) {
      const version = item.version ?? null;
      if (version !== null) positiveInteger(version, `asset ${item.id} version`);
      for (const shotNumber of shotNumbers) {
        result.push({
          shotNumber,
          assetRole: String(item.role).trim(),
          requiredAssetType: normalizeAssetType(item.type),
          requiredAssetId: item.id,
          requiredAssetVersion: version,
          status: item.status || 'MISSING',
          constraints: { ...(item.constraints || {}) },
        });
      }
    }
  }

  result.sort((a, b) => a.shotNumber - b.shotNumber
    || a.assetRole.localeCompare(b.assetRole)
    || a.requiredAssetId.localeCompare(b.requiredAssetId));

  const seen = new Set();
  return result.filter((row) => {
    const key = `${row.shotNumber}|${row.assetRole}`;
    if (seen.has(key)) throw new Error(`Duplicate ASSET_PLAN requirement: ${key}`);
    seen.add(key);
    return true;
  });
}

function normalizeShots({ bible, script }) {
  assertObject(bible, 'bible');
  assertObject(bible.productionPlan, 'bible.productionPlan');
  const shots = bible.productionPlan.shots;
  if (!Array.isArray(shots) || shots.length < 1) throw new Error('BIBLE productionPlan.shots must contain at least one shot');

  const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
  const sorted = [...shots].sort((a, b) => a.number - b.number);
  sorted.forEach((shot, index) => {
    positiveInteger(shot.number, `shot ${index + 1} number`);
    if (shot.number !== index + 1) throw new Error(`SHOT_PLAN numbering must be contiguous; expected ${index + 1}, got ${shot.number}`);
    if (!Number.isInteger(shot.durationMs) || shot.durationMs <= 0) throw new Error(`Shot ${shot.number} durationMs must be positive`);
  });

  return sorted.map((shot) => {
    const scene = scenes[shot.number - 1] || {};
    const assetRoles = [...new Set((shot.assetRefs || []).map((ref) => String(ref.role || ref.id || '').trim()).filter(Boolean))];
    return {
      shotNumber: shot.number,
      durationMs: shot.durationMs,
      instructions: {
        description: shot.description || scene.visual || '',
        action: shot.action || '',
        purpose: shot.purpose || scene.purpose || '',
        dialogue: shot.dialogue || scene.dialogue || '',
        audio: shot.audio || scene.audio || '',
        continuityRequirements: [...new Set([...(shot.continuityRequirements || []), ...(shot.continuity || [])])],
        assetRefs: (shot.assetRefs || []).map((ref) => ({ id: ref.id, type: normalizeAssetType(ref.type), version: ref.version ?? null })),
        assetRoles,
      },
    };
  });
}

function buildPlanFingerprint({ production, bible, script, kind, document }) {
  return fingerprint({
    kind,
    productionId: production.id,
    contextFingerprint: production.context_fingerprint,
    bible: { id: bible.id, version: bible.version, outputHash: bible.outputHash },
    script: script ? { id: script.id, version: script.version, outputHash: script.outputHash } : null,
    document,
  });
}

async function loadProduction(client, productionId) {
  const result = await client.query(
    `SELECT id, context_fingerprint, context_snapshot, status
       FROM v2_1.productions
      WHERE id = $1
      FOR SHARE`,
    [productionId]
  );
  const production = result.rows[0];
  if (!production) throw new Error('Production not found');
  if (production.status !== 'RUNNING') throw new Error('Production is not RUNNING');
  if (!production.context_fingerprint) throw new Error('Production immutable context fingerprint is missing');
  return production;
}

async function loadCanonicalBible(client, productionId) {
  const result = await client.query(
    `SELECT pb.id, pb.version, pb.bible_id, pb.context_fingerprint, pb.document,
            a.id AS artifact_id, av.output_hash
       FROM v2_1.production_bibles pb
       JOIN v2_1.artifacts a ON a.id = pb.artifact_id AND a.artifact_type = 'PRODUCTION_BIBLE'
       JOIN v2_1.artifact_versions av ON av.artifact_id = a.id AND av.version = 1
      WHERE pb.production_id = $1
      ORDER BY pb.version DESC
      LIMIT 1`,
    [productionId]
  );
  const bible = result.rows[0];
  if (!bible) throw new Error('Canonical PRODUCTION_BIBLE is required before planning');
  if (bible.context_fingerprint === null) throw new Error('BIBLE immutable context fingerprint is missing');
  return {
    id: bible.artifact_id,
    productionBibleId: bible.id,
    version: bible.version,
    bibleId: bible.bible_id,
    contextFingerprint: bible.context_fingerprint,
    outputHash: bible.output_hash,
    value: bible.document,
  };
}

async function loadCanonicalScript(client, productionId) {
  const result = await client.query(
    `SELECT a.id AS artifact_id, av.version, av.output_hash, gr.response
       FROM v2_1.generation_runs gr
       JOIN v2_1.stage_runs sr ON sr.id = gr.stage_run_id AND sr.stage = 'SCRIPT'
       JOIN v2_1.artifacts a ON a.id = gr.artifact_id AND a.artifact_type = 'SCRIPT'
       JOIN v2_1.artifact_versions av ON av.artifact_id = a.id
       JOIN v2_1.jobs j ON j.id = sr.job_id AND j.production_id = $1
      WHERE gr.status = 'COMPLETED'
      ORDER BY av.version DESC, gr.completed_at DESC
      LIMIT 1`,
    [productionId]
  );
  const script = result.rows[0];
  if (!script) throw new Error('Canonical SCRIPT artifact is required before SHOT_PLAN');
  return { id: script.artifact_id, version: script.version, outputHash: script.output_hash, value: script.response };
}

function assertContextContinuity(production, bible) {
  if (production.context_fingerprint !== bible.contextFingerprint) {
    throw new Error('Planning context fingerprint does not match immutable production context');
  }
}

module.exports = {
  stableStringify,
  fingerprint,
  normalizeAssetRequirements,
  normalizeShots,
  buildPlanFingerprint,
  loadProduction,
  loadCanonicalBible,
  loadCanonicalScript,
  assertContextContinuity,
};
