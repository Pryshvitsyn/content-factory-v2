'use strict';

const {
  fingerprint,
  normalizeAssetRequirements,
  buildPlanFingerprint,
  loadProduction,
  loadCanonicalBible,
  assertContextContinuity,
} = require('./v2.1-planning-engine');

async function executeAssetPlanStage({ client, productionId, stageRunId, workerId } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  if (!productionId || !stageRunId || !workerId) throw new Error('productionId, stageRunId and workerId are required');

  const production = await loadProduction(client, productionId);
  const stage = (await client.query(
    `SELECT id, job_id, stage, status, worker_id
       FROM v2_1.stage_runs
      WHERE id = $1 AND job_id IN (SELECT id FROM v2_1.jobs WHERE production_id = $2)`,
    [stageRunId, productionId]
  )).rows[0];
  if (!stage || stage.stage !== 'ASSET_PLAN') throw new Error('Stage run is not an ASSET_PLAN stage for this production');
  if (stage.status !== 'RUNNING' || stage.worker_id !== workerId) throw new Error('ASSET_PLAN stage lease is not owned by this worker');

  const bible = await loadCanonicalBible(client, productionId);
  assertContextContinuity(production, bible);
  const requirements = normalizeAssetRequirements(bible.value);
  const document = { type: 'ASSET_REQUIREMENTS', version: 1, requirements };
  const planFingerprint = buildPlanFingerprint({ production, bible, kind: 'ASSET_PLAN', document });
  const outputFingerprint = fingerprint(document);

  const existing = (await client.query(
    `SELECT a.id AS artifact_id, av.output_hash, av.metadata
       FROM v2_1.artifacts a
       JOIN v2_1.artifact_versions av ON av.artifact_id = a.id AND av.version = 1
      WHERE a.production_id = $1 AND a.artifact_type = 'ASSET_REQUIREMENTS'
        AND av.metadata->>'planFingerprint' = $2
      ORDER BY a.created_at DESC
      LIMIT 1`,
    [productionId, planFingerprint]
  )).rows[0];

  await client.query('BEGIN');
  try {
    let artifactId;
    if (existing) {
      artifactId = existing.artifact_id;
    } else {
      const artifact = await client.query(
        `INSERT INTO v2_1.artifacts(artifact_type, production_id, status)
         VALUES ('ASSET_REQUIREMENTS', $1, 'VALID') RETURNING id`,
        [productionId]
      );
      artifactId = artifact.rows[0].id;

      await client.query(
        `INSERT INTO v2_1.artifact_versions
          (artifact_id, version, input_hash, output_hash, metadata)
         VALUES ($1,1,$2,$3,$4::jsonb)`,
        [artifactId, planFingerprint, outputFingerprint, JSON.stringify({
          producer: 'deterministic-planner',
          stage: 'ASSET_PLAN',
          planFingerprint,
          contextFingerprint: production.context_fingerprint,
          sourceArtifacts: { bible: { id: bible.id, version: bible.version, outputHash: bible.outputHash } },
        })]
      );
    }

    for (const requirement of requirements) {
      const shot = requirement.shotNumber === null
        ? null
        : (await client.query(
          `SELECT id FROM v2_1.shots WHERE production_id = $1 AND shot_number = $2`,
          [productionId, requirement.shotNumber]
        )).rows[0];

      if (requirement.shotNumber !== null && !shot) {
        // ASSET_PLAN can run in parallel with SHOT_PLAN; defer shot-bound rows until
        // the SHOT_PLAN exists rather than inventing ownership or bypassing the graph.
        continue;
      }

      const shotId = shot?.id || (await client.query(
        `SELECT id FROM v2_1.shots WHERE production_id = $1 AND shot_number = $2`,
        [productionId, requirement.shotNumber]
      )).rows[0]?.id;
      if (requirement.shotNumber !== null && !shotId) continue;

      await client.query(
        `INSERT INTO v2_1.asset_requirements
          (shot_id, asset_role, required_asset_type, required_asset_id, status, constraints,
           production_bible_id, context_fingerprint, plan_fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
         ON CONFLICT (shot_id, asset_role) DO NOTHING`,
        [shotId, requirement.assetRole, requirement.requiredAssetType, null, requirement.status, JSON.stringify({
          ...requirement.constraints,
          requiredAssetId: requirement.requiredAssetId,
          requiredAssetVersion: requirement.requiredAssetVersion,
        }), bible.productionBibleId, production.context_fingerprint, planFingerprint]
      );
    }

    const completed = await client.query(
      `UPDATE v2_1.stage_runs
          SET status='COMPLETED', output_artifacts='["ASSET_REQUIREMENTS"]'::jsonb,
              output_fingerprint=$1, completed_at=now(), heartbeat_at=now(), lease_expires_at=NULL, worker_id=NULL
        WHERE id=$2 AND status='RUNNING' AND worker_id=$3 RETURNING id`,
      [outputFingerprint, stageRunId, workerId]
    );
    if (!completed.rowCount) throw new Error('ASSET_PLAN completion rejected: lease ownership or stage state is invalid');

    await client.query(
      `INSERT INTO v2_1.events(event_type, entity_type, entity_id, payload)
       VALUES ('ASSET_PLAN_COMPLETED','artifact',$1,$2::jsonb)`,
      [artifactId, JSON.stringify({ productionId, stageRunId, planFingerprint, contextFingerprint: production.context_fingerprint })]
    );

    await client.query('COMMIT');
    return { artifactId, planFingerprint, outputFingerprint, requirementCount: requirements.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

module.exports = { executeAssetPlanStage };
