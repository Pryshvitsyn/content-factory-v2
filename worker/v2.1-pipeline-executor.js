'use strict';

const { StageRunner } = require('./v2.1-stage-runner');

class PipelineExecutor {
  constructor({ execution, stageRunner } = {}) {
    if (!execution) throw new Error('execution is required');
    if (!(stageRunner instanceof StageRunner)) throw new Error('stageRunner must be a StageRunner');
    this.execution = execution;
    this.stageRunner = stageRunner;
  }

  async run({ client, jobId, workerId, maxStages = 100 } = {}) {
    if (!client) throw new Error('client is required');
    if (!jobId) throw new Error('jobId is required');
    if (!workerId) throw new Error('workerId is required');
    if (!Number.isInteger(maxStages) || maxStages < 1) throw new Error('maxStages must be a positive integer');

    const completed = [];
    for (let count = 0; count < maxStages; count += 1) {
      const stageRun = await this.execution.claimNextStage(client, { jobId, workerId });
      if (!stageRun) break;

      const result = await this.stageRunner.run({ client, stageRun, workerId });
      completed.push(result);
    }

    if (!completed.length) throw new Error('Pipeline made no progress: no stage was claimed');

    await this.execution.completeJob(client, { jobId, workerId });
    return { jobId, workerId, completedStages: completed };
  }
}

module.exports = { PipelineExecutor };
