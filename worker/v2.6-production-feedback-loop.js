'use strict';

function recordOutcome(prediction, actual) {
  if (!prediction?.prediction_id || !actual?.observed_at || !actual?.metrics) throw new TypeError('prediction and actual metrics are required');
  const errors = {};
  for (const [metric, value] of Object.entries(actual.metrics)) {
    if (!Number.isFinite(value)) throw new TypeError(`actual metric ${metric} must be numeric`);
    if (Number.isFinite(prediction.predicted_metrics?.[metric])) errors[metric] = value - prediction.predicted_metrics[metric];
  }
  return { prediction_id: prediction.prediction_id, opportunity_id: prediction.opportunity_id, actual: { observed_at: actual.observed_at, metrics: actual.metrics }, calibration: { status: 'CALIBRATED', errors } };
}

module.exports = { recordOutcome };
