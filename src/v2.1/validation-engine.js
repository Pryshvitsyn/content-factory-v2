'use strict';

const crypto = require('node:crypto');

const VALID_STATUSES = new Set(['PASS', 'WARN', 'FAIL']);
const VALID_TYPES = new Set(['schema', 'content', 'technical', 'continuity', 'readiness']);

function stablePolicyId(policy = {}) {
  return policy.id || crypto.createHash('sha256')
    .update(JSON.stringify(policy, Object.keys(policy).sort()))
    .digest('hex');
}

function validate({ artifactVersionId, validationType, policy = {}, checks = [] }) {
  if (!artifactVersionId) throw new Error('artifactVersionId is required');
  if (!VALID_TYPES.has(validationType)) throw new Error(`Unsupported validation type: ${validationType}`);
  if (!Array.isArray(checks) || checks.length === 0) throw new Error('At least one validation check is required');

  const findings = checks.map((check, index) => {
    if (!check || typeof check !== 'object') throw new Error(`Invalid validation check at index ${index}`);
    const status = check.status || (check.ok === true ? 'PASS' : check.ok === false ? 'FAIL' : 'WARN');
    if (!VALID_STATUSES.has(status)) throw new Error(`Invalid validation status: ${status}`);
    return {
      code: check.code || `check_${index + 1}`,
      status,
      message: String(check.message || ''),
      path: check.path || null,
      details: check.details || {},
    };
  });

  const status = findings.some((f) => f.status === 'FAIL')
    ? 'FAIL'
    : findings.some((f) => f.status === 'WARN')
      ? 'WARN'
      : 'PASS';

  const score = Number((findings.filter((f) => f.status === 'PASS').length / findings.length).toFixed(3));
  const policyId = stablePolicyId(policy);
  const identity = crypto.createHash('sha256')
    .update(`${artifactVersionId}:${validationType}:${policyId}`)
    .digest('hex');

  return {
    artifactVersionId,
    validationType,
    policyId,
    identity,
    status,
    score,
    findings,
  };
}

function publicationGate({ requiredTypes, results }) {
  if (!Array.isArray(requiredTypes) || requiredTypes.length === 0) {
    throw new Error('requiredTypes must contain at least one validation type');
  }
  const byType = new Map((results || []).map((result) => [result.validationType, result]));
  const missing = requiredTypes.filter((type) => !byType.has(type));
  const failed = requiredTypes.filter((type) => byType.has(type) && byType.get(type).status === 'FAIL');
  const warnings = requiredTypes.filter((type) => byType.has(type) && byType.get(type).status === 'WARN');

  return {
    allowed: missing.length === 0 && failed.length === 0,
    missing,
    failed,
    warnings,
  };
}

module.exports = {
  VALID_STATUSES,
  VALID_TYPES,
  validate,
  publicationGate,
};
