'use strict';

const assert = require('node:assert/strict');
const { evaluatorAccounting } = require('../apps/dashboard/server/control-service');

function main() {
  const item = {
    // The compact validation summary is intentionally incomplete and must not hide richer durable error truth.
    validationEvidence: { status: 'FAIL', metadata: {} },
    jobError: {
      details: {
        quality: {
          metadata: {
            externalCallAccounting: {
              semanticVisualEvaluations: 1,
              sourceSemanticEvaluations: 1,
              finalSemanticEvaluations: 0,
              continuityEvaluations: 0,
              totalEvaluatorCalls: 1,
            },
          },
        },
      },
    },
  };
  const accounting = evaluatorAccounting(item);
  assert.equal(accounting.actualSemanticEvaluations, 1);
  assert.equal(accounting.actualSourceSemanticEvaluations, 1);
  assert.equal(accounting.actualFinalSemanticEvaluations, 0);
  assert.equal(accounting.actualContinuityEvaluations, 0);
  assert.equal(accounting.actualEvaluatorCalls, 1);
  assert.equal(1 + accounting.actualEvaluatorCalls, 2,
    'one video provider request plus one semantic execution must report two actual external requests');

  const reusedEvidence = {
    jobResult: { quality: { metadata: { externalCallAccounting: {
      semanticVisualEvaluations: 0, sourceSemanticEvaluations: 0, finalSemanticEvaluations: 0,
      continuityEvaluations: 0, totalEvaluatorCalls: 0,
    } } } },
  };
  assert.equal(evaluatorAccounting(reusedEvidence).actualEvaluatorCalls, 0,
    'reused semantic evidence must not fabricate a new external execution');

  console.log('V2.10.1 durable evaluator accounting certified.');
}

main();
