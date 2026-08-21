'use strict';

const { fingerprint, planNextStage, contract } = require('./v2.4-production-brain');

/**
 * Executes one Production Brain stage through an injected provider.
 * The provider generates only; validation and artifact commitment remain outside it.
 */
async function executeStage({ stage, artifacts = {}, provider, validate, repair }) {
  if (typeof provider !== 'function') throw new TypeError('provider must be a function');
  if (typeof validate !== 'function') throw new TypeError('validate must be a function');

  const plan = planNextStage({ artifacts, requestedStage: stage });
  if (plan.status !== 'READY') return plan;

  const inputs = Object.fromEntries(contract.stages.find((item) => item.id === stage).inputs.map((key) => [key, artifacts[key]]));
  let attempt = 0;
  let proposal = await provider({ stage, inputs, inputFingerprint: plan.input_fingerprint });

  while (true) {
    const validation = await validate({ stage, proposal, inputs, attempt });
    if (validation?.status === 'PASS') {
      const artifact = {
        type: contract.stages.find((item) => item.id === stage).output,
        version: 1,
        fingerprint: fingerprint(proposal),
        source_input_fingerprint: plan.input_fingerprint,
        payload: proposal,
      };
      return { status: 'PASS', stage, artifact, validation, repair_attempts: attempt };
    }

    if (validation?.status !== 'REPAIR' || typeof repair !== 'function' || attempt >= 2) {
      return {
        status: validation?.status === 'HUMAN_REVIEW' ? 'HUMAN_REVIEW' : 'BLOCK',
        stage,
        validation,
        repair_attempts: attempt,
      };
    }

    attempt += 1;
    proposal = await repair({ stage, proposal, validation, inputs, attempt });
  }
}

module.exports = { executeStage };
