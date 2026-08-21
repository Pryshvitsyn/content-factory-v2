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
  constructor({ execution, providerGateway, artifactService, handlers = {}, heartbeatIntervalMs = null } = {}) {
    requireDependency('execution', execution);
    requireDependency('providerGateway', providerGateway);
    requireDependency('artifactService', artifactService);
    this.execution = execution;
    this.providerGateway = providerGateway;
    this.artifactService = artifactService;
    this.handlers = { ...handlers };
    this.heartbeatIntervalMs = heartbeatIntervalMs;
  }

  register(stage, handler) {
    getStageDefinition(stage);
    if (typeof handler !== 'function') throw new Error('Stage handler must be a function');
    this.handlers[stage] = handler;
  }

  startHeartbeat({ client, stageRun, workerId }) {
    const configured = Number(this.heartbeatIntervalMs);
    if (!Number.isFinite(configured) || configured <= 0 || typeof this.execution.heartbeatStage !== 'function') return null;

    let heartbeatError = null;
    const timer = setInterval(() => {
      this.execution.heartbeatStage(client, {
        stageRunId: stageRun.id,
        workerId,
        leaseSeconds: Math.max(5, Math.ceil(configured / 1000) * 3),
      }).catch((error) => {
        heartbeatError = error;
      });
    }, configured);

    timer.unref?.();
    return {
      get error() { return heartbeatError; },
      stop() { clearInterval(timer); },
    };
  }

  async run({ client, stageRun, workerId } = {}) {
    if (!client) throw new Error('client is required');
    if (!stageRun?.id || !stageRun.stage) throw new Error('stageRun.id and stageRun.stage are required');
    if (!workerId) throw new Error('workerId is required');

    const definition = getStageDefinition(stageRun.stage);
    const handler = this.handlers[stageRun.stage];
    if (!handler) throw new Error(`No handler registered for V2.1 stage: ${stageRun.stage}`);

    const heartbeat = this.startHeartbeat({ client, stageRun, workerId });
    try {
      const inputArtifacts = stageRun.input_artifacts || [];
      if (stageRun.input_fingerprint) {
        const actualInputFingerprint = fingerprint(inputArtifacts);
        if (actualInputFingerprint !== stageRun.input_fingerprint) {
          const error = new Error('Stage input fingerprint mismatch');
          error.code = 'STAGE_INPUT_FINGERPRINT_MISMATCH';
          throw error;
        }
      }

      const result = await handler({
        stage: definition,
        stageRun,
        providerGateway: this.providerGateway,
        inputArtifacts,
      });

      if (heartbeat?.error) throw heartbeat.error;

      const produced = Array.isArray(result?.artifacts) ? result.artifacts : (result?.artifact ? [result.artifact] : []);
      const outputArtifacts = [];
      const provenance = result?.provenance || {};

      for (const artifact of produced) {
        const idempotencyKey = artifact.idempotencyKey || `${stageRun.job_id}:${stageRun.stage}:${artifact.artifactId}`;
        const created = await this.artifactService.createVersion({
          ...artifact,
          stageId: artifact.stageId || stageRun.id,
          attemptId: artifact.attemptId || `${stageRun.id}:${stageRun.attempt || 1}`,
          idempotencyKey,
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
    } finally {
      heartbeat?.stop();
    }
  }
}

module.exports = { StageRunner };
