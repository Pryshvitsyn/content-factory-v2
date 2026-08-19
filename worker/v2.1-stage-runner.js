'use strict';

const { fingerprint } = require('./v2.1-execution-engine');
const { getStageDefinition } = require('./v2.1-production-contract');

function requireDependency(name, value) {
  if (!value) throw new Error(`${name} is required`);
}

/**
 * Runtime boundary between the execution engine and the production layers.
 * The runner owns orchestration of one claimed stage, while the execution
 * engine remains the authority for leases, retries and durable state.
 */
class StageRunner {
  constructor({ execution, providerGateway, artifactService, handlers = {} } = {}) {
    requireDependency('execution', execution);
    requireDependency('providerGateway', providerGateway);
    requireDependency('artifactService', artifactService);
    this.execution = execution;
    this.providerGateway = providerGateway;
    this.artifactService = artifactService;
    this.handlers = { ...handlers };
  }

  register(stage, handler) {
    getStageDefinition(stage);
    if (typeof handler !== 'function') throw new Error('Stage handler must be a function');
    this.handlers[stage] = handler;
  }

  async run({ client, stageRun, workerId } = {}) {
    if (!client) throw new Error('client is required');
    if (!stageRun?.id || !stageRun.stage) throw new Error('stageRun.id and stageRun.stage are required');
    if (!workerId) throw new Error('workerId is required');

    const definition = getStageDefinition(stageRun.stage);
    const handler = this.handlers[stageRun.stage];
    if (!handler) throw new Error(`No handler registered for V2.1 stage: ${stageRun.stage}`);

    try {
      const result = await handler({
        stage: definition,
        stageRun,
        providerGateway: this.providerGateway,
        inputArtifacts: stageRun.input_artifacts || [],
      });

      const produced = Array.isArray(result?.artifacts) ? result.artifacts : (result?.artifact ? [result.artifact] : []);
      const outputArtifacts = [];
      const provenance = result?.provenance || {};

      for (const artifact of produced) {
        const created = await this.artifactService.createVersion({
          ...artifact,
          stageId: artifact.stageId || stageRun.id,
          attemptId: artifact.attemptId || `${stageRun.id}:${stageRun.attempt || 1}`,
          provider: artifact.provider || provenance.provider,
          model: artifact.model || provenance.model,
        });
        outputArtifacts.push(created.storageKey);
      }

      const output = result?.output !== undefined ? result.output : produced.map((artifact) => artifact.content);
      const outputFingerprint = fingerprint({ stage: stageRun.stage, output });

      const completed = await this.execution.completeStage(client, {
        stageRunId: stageRun.id,
        workerId,
        outputArtifacts,
        outputFingerprint,
      });

      return { stage: stageRun.stage, status: completed.status, outputArtifacts, outputFingerprint, result };
    } catch (error) {
      await this.execution.failStage(client, {
        stageRunId: stageRun.id,
        workerId,
        error: { code: error.code || 'STAGE_RUN_FAILED', message: error.message, stage: stageRun.stage },
        retryable: definition.retryable,
      });
      throw error;
    }
  }
}

module.exports = { StageRunner };
