'use strict';

const crypto = require('node:crypto');
const { planNextStage, fingerprint } = require('./v2.4-production-brain');

const STAGES = Object.freeze(['INTENT', 'RESEARCH', 'BIBLE']);

function artifact(type, payload, inputs) {
  const createdAt = new Date().toISOString();
  const body = { type, payload, inputs, created_at: createdAt };
  return {
    artifact_type: type,
    artifact_version: 1,
    artifact_id: crypto.randomUUID(),
    fingerprint: fingerprint(body),
    ...body
  };
}

async function executeBrainStage({ stage, artifacts, provider, validate, repair }) {
  if (!STAGES.includes(stage)) throw new Error(`Unsupported brain stage: ${stage}`);
  const plan = planNextStage({ requestedStage: stage, artifacts });
  if (plan.status !== 'READY') return plan;
  if (typeof provider !== 'function' || typeof validate !== 'function') {
    throw new TypeError('provider and validate must be functions');
  }

  const inputs = Object.fromEntries(
    Object.entries(artifacts).filter(([key]) => contractInputs(stage).includes(key))
  );
  let proposal = await provider({ stage, inputs });
  let attempts = 0;

  while (attempts <= 2) {
    const decision = await validate({ stage, proposal, inputs });
    if (decision?.status === 'PASS') {
      return { status: 'PASS', stage, artifact: artifact(stage, proposal, inputs), repair_attempts: attempts };
    }
    attempts += 1;
    if (attempts > 2 || typeof repair !== 'function') {
      return { status: 'HUMAN_REVIEW', stage, proposal, repair_attempts: attempts - 1, finding: decision };
    }
    proposal = await repair({ stage, proposal, finding: decision, inputs, attempt: attempts });
  }

  return { status: 'HUMAN_REVIEW', stage, proposal, repair_attempts: attempts };
}

function contractInputs(stage) {
  return {
    INTENT: ['IDEA'],
    RESEARCH: ['IDEA', 'INTENT'],
    BIBLE: ['IDEA', 'INTENT', 'RESEARCH']
  }[stage];
}

module.exports = { executeBrainStage, artifact, STAGES };
