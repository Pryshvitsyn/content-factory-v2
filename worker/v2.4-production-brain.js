'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const contractPath = path.resolve(__dirname, '..', 'contracts/intelligence/production-brain.v1.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function planNextStage({ artifacts = {}, requestedStage }) {
  const stage = contract.stages.find((item) => item.id === requestedStage);
  if (!stage) throw new Error(`Unknown production brain stage: ${requestedStage}`);

  const missingInputs = stage.inputs.filter((input) => !artifacts[input]);
  if (missingInputs.length) {
    return { status: 'BLOCK', stage: stage.id, missing_inputs: missingInputs };
  }

  const inputFingerprint = fingerprint(
    Object.fromEntries(stage.inputs.map((input) => [input, artifacts[input].fingerprint || artifacts[input]]))
  );

  return {
    status: 'READY',
    stage: stage.id,
    output_type: stage.output,
    input_fingerprint: inputFingerprint,
    requires_independent_validation: true,
    self_approval_forbidden: true
  };
}

module.exports = { contract, fingerprint, planNextStage };
