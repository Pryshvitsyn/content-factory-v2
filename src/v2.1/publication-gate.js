'use strict';

const BLOCKING_STATUSES = new Set(['FAIL']);

function evaluatePublicationGate({ requiredValidations = [], results = [] }) {
  const byType = new Map();
  for (const result of results) {
    if (!result || typeof result.validation_type !== 'string') continue;
    const current = byType.get(result.validation_type);
    if (!current || new Date(result.created_at || 0) > new Date(current.created_at || 0)) {
      byType.set(result.validation_type, result);
    }
  }

  const missing = [];
  const blocking = [];
  const warnings = [];

  for (const type of requiredValidations) {
    const result = byType.get(type);
    if (!result) {
      missing.push(type);
      continue;
    }
    if (BLOCKING_STATUSES.has(result.status)) blocking.push(result);
    if (result.status === 'WARN') warnings.push(result);
  }

  return {
    allowed: missing.length === 0 && blocking.length === 0,
    missing,
    blocking,
    warnings,
  };
}

function assertPublicationReady(input) {
  const decision = evaluatePublicationGate(input);
  if (!decision.allowed) {
    const reasons = [
      ...decision.missing.map((type) => `missing required validation: ${type}`),
      ...decision.blocking.map((result) => `blocking validation failed: ${result.validation_type}`),
    ];
    const error = new Error(`Publication blocked: ${reasons.join('; ')}`);
    error.code = 'PUBLICATION_BLOCKED';
    error.decision = decision;
    throw error;
  }
  return decision;
}

module.exports = { evaluatePublicationGate, assertPublicationReady };
