'use strict';

const assert = require('node:assert/strict');
const { PipelineExecutor } = require('../worker/v2.1-pipeline-executor');

async function run() {
  const claimed = [
    { id: 'stage-1', stage: 'SIGNAL', attempt: 1, input_artifacts: [] },
    { id: 'stage-2', stage: 'IDEA', attempt: 1, input_artifacts: ['artifact-1'] },
    { id: 'stage-3', stage: 'BRIEF', attempt: 1, input_artifacts: ['artifact-2'] },
  ];
  const calls = [];
  const execution = {
    async claimNextStage(_client, args) {
      calls.push(['claim', args.jobId, args.workerId]);
      return claimed.shift() || null;
    },
    async completeJob(_client, args) {
      calls.push(['complete-job', args.jobId, args.workerId]);
      return true;
    },
  };
  const stageRunner = {
    async run({ stageRun, workerId }) {
      calls.push(['run', stageRun.stage, workerId]);
      return { stage: stageRun.stage, status: 'COMPLETED' };
    },
  };
  const executor = Object.create(PipelineExecutor.prototype);
  executor.execution = execution;
  executor.stageRunner = stageRunner;

  const result = await executor.run({ client: {}, jobId: 'job-1', workerId: 'worker-1' });

  assert.deepEqual(result.completedStages.map((item) => item.stage), ['SIGNAL', 'IDEA', 'BRIEF']);
  assert.deepEqual(calls, [
    ['claim', 'job-1', 'worker-1'],
    ['run', 'SIGNAL', 'worker-1'],
    ['claim', 'job-1', 'worker-1'],
    ['run', 'IDEA', 'worker-1'],
    ['claim', 'job-1', 'worker-1'],
    ['run', 'BRIEF', 'worker-1'],
    ['claim', 'job-1', 'worker-1'],
    ['complete-job', 'job-1', 'worker-1'],
  ]);

  console.log('V2.1 pipeline executor sequential orchestration: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
