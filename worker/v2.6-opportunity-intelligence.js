'use strict';

const OBJECTIVES = new Set(['GROWTH','REVENUE','AUTHORITY','LEAD_GENERATION','EXPERIMENT']);
const TYPES = new Set(['TREND','EVERGREEN','NEWS','EDUCATIONAL','PRODUCT','AFFILIATE','LEAD_GENERATION','BRAND','AUTHORITY']);

function assertMetric(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new TypeError(`${name} must be 0..100`);
}

function evaluateOpportunity(input) {
  if (!OBJECTIVES.has(input.objective)) throw new Error('invalid objective');
  if (!TYPES.has(input.type)) throw new Error('invalid opportunity type');
  const potentialKeys = ['demand','momentum','content_gap','audience_fit','monetization','platform_fit'];
  const feasibilityKeys = ['production_cost','complexity','asset_availability','time_to_publish'];
  [...potentialKeys, ...feasibilityKeys].forEach(k => assertMetric(input.potential?.[k] ?? input.feasibility?.[k], k));
  assertMetric(input.confidence, 'confidence');
  const potential = potentialKeys.reduce((s,k) => s + input.potential[k], 0) / potentialKeys.length;
  const feasibility = (input.feasibility.production_cost + input.feasibility.asset_availability + input.feasibility.time_to_publish + (100 - input.feasibility.complexity)) / 4;
  const riskPenalty = Math.min(100, ((input.risk?.policy ?? 0) + (input.risk?.factual ?? 0) + (input.risk?.brand ?? 0)) / 3);
  const expectedValue = Math.round((potential * 0.55 + feasibility * 0.45) * (input.confidence / 100) * (1 - riskPenalty / 200));
  const hardGate = (input.risk?.policy ?? 0) >= 80 || input.confidence < 40;
  return { potential: Math.round(potential), feasibility: Math.round(feasibility), expected_value: expectedValue, decision: hardGate ? 'HOLD' : 'HUMAN_APPROVAL_REQUIRED' };
}

function decideAfterHuman(input, decision) {
  if (input?.decision !== 'HUMAN_APPROVAL_REQUIRED') throw new Error('decision gate not open');
  if (!['APPROVE','REJECT','EDIT'].includes(decision)) throw new Error('invalid human decision');
  return decision;
}

module.exports = { evaluateOpportunity, decideAfterHuman };
