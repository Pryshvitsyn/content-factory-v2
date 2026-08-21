'use strict';

const assert = require('node:assert/strict');
const { proposeOpportunity, decideOpportunity, assertProductionAuthorized } = require('../worker/v2.5-opportunity-gate');

const proposal = proposeOpportunity({
  thesis: 'test opportunity',
  scores: { demand: 90, momentum: 80, competition: 40, content_gap: 85, production_cost: 20, monetization: 75, platform_fit: 90 },
  signals: [],
  sources: []
});
assert.equal(proposal.status, 'PROPOSED');
assert.equal(proposal.decision_policy.human_approval_required, true);
assert.throws(() => assertProductionAuthorized(proposal), /PRODUCTION_BLOCKED/);

const rejected = decideOpportunity(proposal, 'REJECT', { approvedBy: 'human-1' });
assert.equal(rejected.status, 'REJECTED');
assert.throws(() => assertProductionAuthorized(rejected), /PRODUCTION_BLOCKED/);

const approved = decideOpportunity(proposal, 'APPROVE', { approvedBy: 'human-1', note: 'Proceed' });
assert.equal(approved.status, 'APPROVED');
assert.equal(approved.approved_by, 'human-1');
assert.equal(assertProductionAuthorized(approved), true);

assert.throws(() => decideOpportunity(proposal, 'APPROVE'), /approvedBy is required/);

console.log('V2.5 opportunity human approval gate certification: PASS');
