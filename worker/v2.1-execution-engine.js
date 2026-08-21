'use strict';

const crypto = require('node:crypto');

const RETRYABLE_CODES = new Set(['PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMIT', 'TRANSIENT_NETWORK', 'LEASE_EXPIRED']);

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function claimJob(client, { workerId, leaseSeconds = 60 }) {
  const result = await client.query(`SELECT * FROM v2_1.claim_job($1, $2)`, [workerId, leaseSeconds]);
  return result.rows[0] || null;
}

async function claimJobForProduction(client, { jobId, productionId, workerId, leaseSeconds = 60 }) {
  const result = await client.query(`SELECT * FROM v2_1.claim_job_for_production($1, $2, $3, $4)`, [jobId, productionId, workerId, leaseSeconds]);
  return result.rows[0] || null;
}

async function claimNextStage(client, { jobId, workerId, leaseSeconds = 60 }) {
  const result = await client.query(`SELECT * FROM v2_1.claim_stage($1, $2, $3)`, [jobId, workerId, leaseSeconds]);
  return result.rows[0] || null;
}

async function completeStage(client, { stageRunId, workerId, outputArtifacts, outputFingerprint }) {
  const result = await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED', output_artifacts=$3::jsonb, output_fingerprint=$4, worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(), completed_at=now(), updated_at=now() WHERE id=$1 AND worker_id=$2 AND status='RUNNING' RETURNING *`, [stageRunId, workerId, JSON.stringify(outputArtifacts || []), outputFingerprint]);
  return result.rows[0] || null;
}

async function completeJob(client, { jobId, workerId }) {
  const result = await client.query(`UPDATE v2_1.jobs SET status='COMPLETED', worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(), completed_at=now(), updated_at=now() WHERE id=$1 AND worker_id=$2 AND status='RUNNING' RETURNING *`, [jobId, workerId]);
  const job = result.rows[0] || null;
  if (!job) return null;

  await client.query(`UPDATE v2_1.productions p SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE p.id=$1 AND p.status='RUNNING' AND NOT EXISTS (SELECT 1 FROM v2_1.jobs j WHERE j.production_id=p.id AND j.status NOT IN ('COMPLETED','CANCELLED'))`, [job.production_id]);
  return job;
}

async function failStage(client, { stageRunId, workerId, error, retryable = false }) {
  const result = await client.query(`UPDATE v2_1.stage_runs SET status=$3, error=$4::jsonb, worker_id=NULL, lease_expires_at=NULL, heartbeat_at=now(), completed_at=now(), updated_at=now() WHERE id=$1 AND worker_id=$2 AND status='RUNNING' RETURNING *`, [stageRunId, workerId, retryable ? 'RETRYING' : 'FAILED', JSON.stringify(error)]);
  return result.rows[0] || null;
}

async function recoverExpiredWork(client) {
  const result = await client.query(`SELECT * FROM v2_1.recover_expired_work()`);
  return result.rows[0] || { jobs_recovered: 0, jobs_failed: 0, stages_recovered: 0, stages_failed: 0 };
}

module.exports = { RETRYABLE_CODES, fingerprint, claimJob, claimJobForProduction, claimNextStage, completeStage, completeJob, failStage, recoverExpiredWork };
