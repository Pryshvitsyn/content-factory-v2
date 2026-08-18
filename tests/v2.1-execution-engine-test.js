'use strict';

const assert = require('node:assert/strict');
const engine = require('../worker/v2.1-execution-engine');

function mockClient(expectedSql, row = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (expectedSql && !sql.includes(expectedSql)) throw new Error(`Unexpected SQL: ${sql}`);
      return { rows: Object.keys(row).length ? [row] : [], rowCount: Object.keys(row).length ? 1 : 0 };
    },
  };
}

(async () => {
  const input = { z: 2, nested: { b: 1, a: 3 }, a: 1 };
  assert.equal(engine.stableStringify(input), '{"a":1,"nested":{"a":3,"b":1},"z":2}');
  assert.equal(engine.fingerprint(input), engine.fingerprint({ a: 1, nested: { a: 3, b: 1 }, z: 2 }));
  assert.deepEqual(engine.allStageNames(), [
    'SIGNAL', 'IDEA', 'BRIEF', 'BIBLE', 'CONCEPT', 'SCRIPT', 'SHOT_PLAN',
    'ASSET_PLAN', 'ASSETS', 'EDIT', 'PLATFORM_ADAPTATION', 'VALIDATION',
    'PUBLISH', 'ANALYZE', 'LEARN',
  ]);

  const claim = mockClient('claim_job', { id: 'job-1', status: 'RUNNING' });
  const claimed = await engine.claimJob(claim, { workerId: 'worker-1', leaseSeconds: 120 });
  assert.equal(claimed.id, 'job-1');
  assert.deepEqual(claim.calls[0].params, ['worker-1', 120]);

  const scoped = mockClient('claim_job_for_production', { id: 'job-1', production_id: 'prod-1' });
  await engine.claimJobForProduction(scoped, {
    jobId: 'job-1', productionId: 'prod-1', workerId: 'worker-1', leaseSeconds: 60,
  });
  assert.deepEqual(scoped.calls[0].params, ['job-1', 'prod-1', 'worker-1', 60]);

  const stage = mockClient('claim_stage', { id: 'stage-1', stage: 'SIGNAL' });
  const claimedStage = await engine.claimNextStage(stage, { jobId: 'job-1', workerId: 'worker-1' });
  assert.equal(claimedStage.stage, 'SIGNAL');

  // Completion is ownership-scoped and must send canonical, de-duplicated artifact JSON.
  const complete = mockClient('UPDATE v2_1.stage_runs', { id: 'stage-1', job_id: 'job-1', stage: 'SIGNAL', attempt: 1, status: 'COMPLETED' });
  const result = await engine.completeStage(complete, {
    stageRunId: 'stage-1', workerId: 'worker-1', outputArtifacts: ['a1', 'a1', 'a2'], outputFingerprint: 'fp',
  });
  assert.equal(result.status, 'COMPLETED');
  assert.match(complete.calls[0].sql, /status = 'COMPLETED'/);
  assert.deepEqual(JSON.parse(complete.calls[0].params[0]), ['a1', 'a2']);

  const recover = mockClient('recover_expired_work', { jobs_recovered: 1, jobs_failed: 0, stages_recovered: 1, stages_failed: 0 });
  assert.equal((await engine.recoverExpiredWork(recover)).jobs_recovered, 1);

  await assert.rejects(
    engine.claimJob(mockClient(), { workerId: '' }),
    /workerId is required/
  );
  await assert.rejects(
    engine.claimJobForProduction(mockClient(), { workerId: 'w' }),
    /jobId and productionId are required/
  );

  console.log('V2.1 execution engine unit contract: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
