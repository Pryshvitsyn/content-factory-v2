'use strict';

function selectPortfolio(opportunities, { maxItems = 10, explorationRate = 0.2 } = {}) {
  if (!Array.isArray(opportunities) || maxItems < 1) throw new TypeError('invalid portfolio input');
  const sorted = [...opportunities].sort((a,b) => (b.expected_value ?? 0) - (a.expected_value ?? 0));
  const explorationCount = Math.min(Math.floor(maxItems * explorationRate), sorted.length);
  const exploit = sorted.slice(0, Math.max(0, maxItems - explorationCount));
  const remaining = sorted.slice(maxItems - explorationCount);
  const experiments = remaining.slice(0, explorationCount);
  return [...exploit, ...experiments];
}

function recordPrediction({ opportunityId, modelVersion, expectedValue, predictedMetrics = {} }) {
  if (!opportunityId || !modelVersion || !Number.isFinite(expectedValue)) throw new TypeError('invalid prediction');
  return { prediction_id: `${opportunityId}:${modelVersion}`, opportunity_id: opportunityId, model_version: modelVersion, expected_value: expectedValue, predicted_metrics: predictedMetrics };
}

function calibrate(prediction, actual) {
  if (!prediction || !actual || !Number.isFinite(actual.value)) throw new TypeError('invalid actual result');
  const error = actual.value - prediction.expected_value;
  return { prediction_id: prediction.prediction_id, actual_value: actual.value, error, absolute_error: Math.abs(error), observed_at: actual.observed_at ?? new Date().toISOString() };
}

module.exports = { selectPortfolio, recordPrediction, calibrate };
