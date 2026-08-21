'use strict';

const crypto = require('node:crypto');

const DECISIONS = Object.freeze(['APPROVE', 'REJECT', 'EDIT']);

function scoreOpportunity(input) {
  const keys = ['demand','momentum','competition','content_gap','production_cost','monetization','platform_fit'];
  for (const key of keys) if (!Number.isFinite(input?.scores?.[key])) throw new TypeError(`missing score: ${key}`);
  const values = keys.map((key) => key === 'production_cost' ? 100 - input.scores[key] : input.scores[key]);
  return Math.round(values.reduce((a,b) => a + b, 0) / values.length);
}

function proposeOpportunity(input) {
  const opportunity = {
    ...input,
    opportunity_id: input.opportunity_id || crypto.randomUUID(),
    status: 'PROPOSED',
    scores: { ...input.scores, overall: scoreOpportunity(input) },
    decision_policy: { human_approval_required: true, auto_production_allowed: false }
  };
  return opportunity;
}

function decideOpportunity(opportunity, decision, { approvedBy, note } = {}) {
  if (!DECISIONS.includes(decision)) throw new Error(`Unsupported decision: ${decision}`);
  if (decision === 'APPROVE' && !approvedBy) throw new Error('approvedBy is required for APPROVE');
  const status = { APPROVE: 'APPROVED', REJECT: 'REJECTED', EDIT: 'EDIT_REQUIRED' }[decision];
  return {
    ...opportunity,
    status,
    approved_by: decision === 'APPROVE' ? approvedBy : undefined,
    approved_at: decision === 'APPROVE' ? new Date().toISOString() : undefined,
    decision_note: note || undefined
  };
}

function assertProductionAuthorized(opportunity) {
  if (opportunity?.status !== 'APPROVED' || opportunity?.decision_policy?.human_approval_required !== true) {
    throw new Error('PRODUCTION_BLOCKED: human approval required');
  }
  return true;
}

module.exports = { proposeOpportunity, scoreOpportunity, decideOpportunity, assertProductionAuthorized };
