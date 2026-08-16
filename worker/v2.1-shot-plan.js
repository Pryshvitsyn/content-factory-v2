'use strict';

const {
  fingerprint,
  normalizeShots,
  buildPlanFingerprint,
  loadProduction,
  loadCanonicalBible,
  loadCanonicalScript,
  assertContextContinuity,
} = require('./v2.1-planning-engine');

async function executeShotPlanStage({ client, productionId, stageRunId, workerId } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
  if (!productionId || !stageRunId || !workerId) throw new Error('productionId, stageRunId and workerId are required');

  const production = await loadProduction(client, productionId);
  const stage = (await client.query(
    `SELECT id, job_id, stage, status, worker_id
       FROM v2_1.stage_runs
      WHERE id = $1 AND job_id IN (SELECT id FROM v2_1.jobs WHERE production_id = $2)`,
    [stageRunId, productionId]
  )).rows[0];
  if (!stage || stage.stage !== 'SHOT_PLAN') throw new Error('Stage run is not a SHOT_PLAN stage for this production');
  if (stage.status !== 'RUNNING' || stage.worker_id !== workerId) throw new Error('SHOT_PLAN stage lease is not owned by this worker');

  const bible = await loadCanonicalBible(client, productionId);
  const script = await loadCanonicalScript(client, productionId);
  assertContextContinuity(production, bible);

  const shots = normalizeShots({ bible: bible.value, script: script.value });
  const document = { type: 'SHOTS', version: 1, shots };
  const planFingerprint = buildPlanFingerprint({ production, bible, script, kind: 'SHOT_PLAN', document });
  const outputFingerprint = fingerprint(document);

  const existing = (await client.query(
    `SELECT a.id AS artifact_id
       FROM v2_1.artifacts a
       JOIN v2_1.artifact_versions av ON av.artifact_id = a.id AND av.version = 1
      WHERE a.production_id = $1 AND a.artifact_type = 'SHOTS'
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
         VALUES ('SHOTS', $1, 'VALID') RETURNING id`,
        [productionId]
      );
      artifactId = artifact.rows[0].id;

      await client.query(
        `INSERT INTO v2_1.artifact_versions
          (artifact_id, version, input_hash, output_hash, metadata)
         VALUES ($1,1,$2,$3,$4::jsonb)`,
        [artifactId, planFingerprint, outputFingerprint, JSON.stringify({
          producer: 'deterministic-planner',
          stage: 'SHOT_PLAN',
          planFingerprint,
          contextFingerprint: production.context_fingerprint,
          sourceArtifacts: {
            bible: { id: bible.id, version: bible.version, outputHash: bible.outputHash },
            script: { id: script.id, version: script.version, outputHash: script.outputHash },
          },
        })]
      );
    }

    for (const shot of shots) {
      const shotKey = `${productionId}:shot:${shot.shotNumber}`;
      await client.query(
        `INSERT INTO v2_1.shots
          (production_id, shot_number, duration_ms, instructions, status,
           shot_key, production_bible_id, source_script_artifact_id, context_fingerprint, plan_fingerprint)
         VALUES ($1,$2,$3,$4::jsonb,'PLANNED',$5,$6,$7,$8,$9)
         ON CONFLICT (production_id, shot_number) DO NOTHING`,
        [productionId, shot.shotNumber, shot.durationMs, JSON.stringify(shot.instructions), shotKey,
          bible.productionBibleId, script.id, production.context_fingerprint, planFingerprint]
      );
    }

    const completed = await client.query(
      `UPDATE v2_1.stage_runs
          SET status='COMPLETED', output_artifacts='["SHOTS"]'::jsonb,
              output_fingerprint=$1, completed_at=now(), heartbeat_at=now(), lease_expires_at=NULL, worker_id=NULL
        WHERE id=$2 AND status='RUNNING' AND worker_id=$3 RETURNING id`,
      [outputFingerprint, stageRunId, workerId]
    );
    if (!completed.rowCount) throw new Error('SHOT_PLAN completion rejected: lease ownership or stage state is invalid');

    await client.query(
      `INSERT INTO v2_1.events(event_type, entity_type, entity_id, payload)
       VALUES ('SHOT_PLAN_COMPLETED','artifact',$1,$2::jsonb)`,
      [artifactId, JSON.stringify({ productionId, stageRunId, planFingerprint, contextFingerprint: production.context_fingerprint, shotCount: shots.length })]
    );

    await client.query('COMMIT');
    return { artifactId, planFingerprint, outputFingerprint, shotCount: shots.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

module.exports = { executeShotPlanStage };
