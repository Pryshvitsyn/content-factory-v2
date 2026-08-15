'use strict';

const crypto = require('node:crypto');
const { getStageDefinition, STAGE_DEFINITIONS } = require('./v2.1-production-contract');

function requireClient(client) {
  if (!client || typeof client.query !== 'function') throw new Error('client is required');
}

function requireWorker(workerId) {
  if (typeof workerId !== 'string' || workerId.trim() === '') throw new Error('workerId is required');
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

async function recoverExpiredWork(client) {
  requireClient(client);
  const result = await client.query('SELECT * FROM v2_1.recover_expired_work()');
  return result.rows[0] || { jobs_recovered: 0, jobs_failed: 0, stages_recovered: 0, stages_failed: 0 };
}

async function claimJob(client, { workerId, leaseSeconds = 120 } = {}) {
  requireClient(client);
  requireWorker(workerId);
  const result = await client.query(
    'SELECT * FROM v2_1.claim_job($1, $2)',
    [workerId, Math.max(5, leaseSeconds)]
  );
  return result.rows[0] || null;
}

async function claimJobForProduction(client, { jobId, productionId, workerId, leaseSeconds = 120 } = {}) {
  requireClient(client);
  requireWorker(workerId);
  if (!jobId || !productionId) throw new Error('jobId and productionId are required');
  const result = await client.query(
    'SELECT * FROM v2_1.claim_job_for_production($1, $2, $3, $4)',
    [jobId, productionId, workerId, Math.max(5, leaseSeconds)]
  );
  return result.rows[0] || null;
}

async function heartbeatJob(client, { jobId, workerId, leaseSeconds = 120 } = {}) {
  requireClient(client);
  requireWorker(workerId);
  const result = await client.query(
    'SELECT v2_1.heartbeat_job($1, $2, $3) AS renewed',
    [jobId, workerId, Math.max(5, leaseSeconds)]
  );
  if (!result.rows[0]?.renewed) throw new Error('Job lease is not owned by this worker or is no longer running');
  return true;
}

async function claimNextStage(client, { jobId, workerId, leaseSeconds = 120 } = {}) {
  requireClient(client);
  requireWorker(workerId);
  const result = await client.query(
    'SELECT * FROM v2_1.claim_stage($1, $2, $3)',
    [jobId, workerId, Math.max(5, leaseSeconds)]
  );
  return result.rows[0] || null;
}

async function heartbeatStage(client, { stageRunId, workerId, leaseSeconds = 120 } = {}) {
  requireClient(client);
  requireWorker(workerId);
  const result = await client.query(
    'SELECT v2_1.heartbeat_stage($1, $2, $3) AS renewed',
    [stageRunId, workerId, Math.max(5, leaseSeconds)]
  );
  if (!result.rows[0]?.renewed) throw new Error('Stage lease is not owned by this worker or is no longer running');
  return true;
}

async function completeStage(client, {
  stageRunId,
  workerId,
  outputArtifacts = [],
  outputFingerprint = null,
} = {}) {
  requireClient(client);
  requireWorker(workerId);
  const outputs = [...new Set(outputArtifacts)];
  const result = await client.query(
    `UPDATE v2_1.stage_runs
        SET status = 'COMPLETED',
            output_artifacts = $1::jsonb,
            output_fingerprint = $2,
            completed_at = now(),
            heartbeat_at = now(),
            lease_expires_at = NULL,
            worker_id = NULL
      WHERE id = $3
        AND status = 'RUNNING'
        AND worker_id = $4
      RETURNING id, job_id, stage, attempt, status`,
    [JSON.stringify(outputs), outputFingerprint, stageRunId, workerId]
  );
  if (!result.rowCount) throw new Error('Stage completion rejected: lease ownership or stage state is invalid');
  return result.rows[0];
}

async function failStage(client, {
  stageRunId,
  workerId,
  error,
  retryable = true,
} = {}) {
  requireClient(client);
  requireWorker(workerId);
  await client.query('BEGIN');
  try {
    const current = await client.query(
      `SELECT id, job_id, stage, attempt, max_attempts, input_artifacts, input_fingerprint
         FROM v2_1.stage_runs
        WHERE id = $1 AND status = 'RUNNING' AND worker_id = $2
        FOR UPDATE`,
      [stageRunId, workerId]
    );
    if (!current.rowCount) throw new Error('Stage failure rejected: lease ownership or stage state is invalid');
    const row = current.rows[0];

    await client.query(
      `UPDATE v2_1.stage_runs
          SET status = 'FAILED', error = $1::jsonb, completed_at = now(),
              lease_expires_at = NULL, heartbeat_at = now(), worker_id = NULL
        WHERE id = $2`,
      [JSON.stringify(error || { code: 'STAGE_FAILED' }), stageRunId]
    );

    if (retryable && row.attempt < row.max_attempts) {
      const nextAttempt = row.attempt + 1;
      await client.query(
        `INSERT INTO v2_1.stage_runs
          (job_id, stage, attempt, status, input_artifacts, input_fingerprint, max_attempts, next_attempt_at, error)
         VALUES ($1, $2, $3, 'RETRYING', $4::jsonb, $5, $6,
                 now() + make_interval(secs => LEAST(300, 2 ^ LEAST($3, 8))), $7::jsonb)`,
        [row.job_id, row.stage, nextAttempt, row.input_artifacts, row.input_fingerprint, row.max_attempts, JSON.stringify(error || { code: 'STAGE_RETRYING' })]
      );
    } else {
      await client.query(
        `UPDATE v2_1.jobs
            SET status = 'FAILED', error = $1::jsonb, last_error = $1::jsonb,
                completed_at = now(), worker_id = NULL, lease_expires_at = NULL, heartbeat_at = now()
          WHERE id = $2 AND status = 'RUNNING' AND worker_id = $3`,
        [JSON.stringify(error || { code: 'STAGE_FAILED_PERMANENT' }), row.job_id, workerId]
      );
    }

    await client.query('COMMIT');
    return { stage: row.stage, attempt: row.attempt, retried: retryable && row.attempt < row.max_attempts };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  }
}

async function completeJob(client, { jobId, workerId } = {}) {
  requireClient(client);
  requireWorker(workerId);
  await client.query('BEGIN');
  try {
    const job = await client.query(
      `SELECT id, production_id FROM v2_1.jobs
        WHERE id = $1 AND status = 'RUNNING' AND worker_id = $2
        FOR UPDATE`,
      [jobId, workerId]
    );
    if (!job.rowCount) throw new Error('Job completion rejected: lease ownership or job state is invalid');

    const incomplete = await client.query(
      `SELECT sr.stage
         FROM v2_1.stage_runs sr
        WHERE sr.job_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM v2_1.stage_runs done
             WHERE done.job_id = sr.job_id AND done.stage = sr.stage AND done.status = 'COMPLETED'
          )
        ORDER BY sr.stage`,
      [jobId]
    );
    if (incomplete.rowCount) throw new Error(`Job cannot complete; incomplete stages: ${incomplete.rows.map((row) => row.stage).join(', ')}`);

    const terminal = await client.query(
      `SELECT 1 FROM v2_1.stage_runs WHERE job_id = $1 AND stage = 'LEARN' AND status = 'COMPLETED' LIMIT 1`,
      [jobId]
    );
    if (!terminal.rowCount) throw new Error('Job cannot complete without a completed LEARN stage');

    await client.query(
      `UPDATE v2_1.jobs
          SET status = 'COMPLETED', completed_at = now(), worker_id = NULL,
              lease_expires_at = NULL, heartbeat_at = now()
        WHERE id = $1`,
      [jobId]
    );

    if (job.rows[0].production_id) {
      await client.query(
        `UPDATE v2_1.productions
            SET status = 'COMPLETED', completed_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'RUNNING'`,
        [job.rows[0].production_id]
      );
    }

    await client.query('COMMIT');
    return true;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  }
}

function stageContract(stage) {
  return getStageDefinition(stage);
}

function allStageNames() {
  return Object.keys(STAGE_DEFINITIONS);
}

module.exports = {
  fingerprint,
  stableStringify,
  recoverExpiredWork,
  claimJob,
  claimJobForProduction,
  heartbeatJob,
  claimNextStage,
  heartbeatStage,
  completeStage,
  failStage,
  completeJob,
  stageContract,
  allStageNames,
};
