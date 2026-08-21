'use strict';

const crypto = require('node:crypto');

const RETRYABLE_CODES = new Set(['PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMIT', 'TRANSIENT_NETWORK', 'LEASE_EXPIRED']);

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function claimJob(client, { workerId, leaseSeconds = 60 }) {
  const result = await client.query(
    `WITH candidate AS (
       SELECT id FROM v2_1.jobs
       WHERE status IN ('QUEUED','RETRYING')
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     UPDATE v2_1.jobs j
        SET status='RUNNING', worker_id=$1,
            lease_expires_at=now()+($2 * interval '1 second'),
            heartbeat_at=now(), started_at=COALESCE(started_at, now()), updated_at=now()
       FROM candidate c
      WHERE j.id=c.id
      RETURNING j.*`,
    [workerId, leaseSeconds]
  );
  return result.rows[0] || null;
}

async function claimJobForProduction(client, { jobId, productionId, workerId, leaseSeconds = 60 }) {
  const result = await client.query(
    `UPDATE v2_1.jobs
        SET status='RUNNING', worker_id=$3, lease_expires_at=now()+($4 * interval '1 second'), heartbeat_at=now(), updated_at=now()
      WHERE id=$1 AND production_id=$2 AND status IN ('QUEUED','RETRYING')
      RETURNING *`,
    [jobId, productionId, workerId, leaseSeconds]
  );
  return result.rows[0] || null;
}

async function claimNextStage(client, { jobId, workerId, leaseSeconds = 60 }) {
  const result = await client.query(
    `SELECT * FROM v2_1.claim_stage($1, $2, $3)`,
    [jobId, workerId, leaseSeconds]
  );
  return result.rows[0] || null;
}

async function completeStage(client, { stageRunId, workerId, outputArtifacts, outputFingerprint }) {
  const result = await client.query(
    `UPDATE v2_1.stage_runs
        SET status='COMPLETED', output_artifacts=$3, output_fingerprint=$4, worker_id=NULL, lease_expires_at=NULL,
            heartbeat_at=now(), completed_at=now(), updated_at=now()
      WHERE id=$1 AND worker_id=$2 AND status='RUNNING'
      RETURNING *`,
    [stageRunId, workerId, outputArtifacts, outputFingerprint]
  );
  return result.rows[0] || null;
}

async function failStage(client, { stageRunId, workerId, error, retryable = false }) {
  const result = await client.query(
    `UPDATE v2_1.stage_runs
        SET status=$3, error=$4, worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(), completed_at=now(), updated_at=now()
      WHERE id=$1 AND worker_id=$2 AND status='RUNNING'
      RETURNING *`,
    [stageRunId, workerId, retryable ? 'RETRYING' : 'FAILED', JSON.stringify(error)]
  );
  return result.rows[0] || null;
}

async function recoverExpiredWork(client) {
  const result = await client.query(`SELECT * FROM v2_1.recover_expired_work()`);
  return result.rows[0] || { jobs_recovered: 0, jobs_failed: 0, stages_recovered: 0, stages_failed: 0 };
}

module.exports = {
  RETRYABLE_CODES,
  fingerprint,
  claimJob,
  claimJobForProduction,
  claimNextStage,
  completeStage,
  failStage,
  recoverExpiredWork,
};
