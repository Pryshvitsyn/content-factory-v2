'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(
  path.resolve(__dirname, '..', 'migrations', '20260822_v2_2_brand_brain_opportunities.sql'),
  'utf8'
);

const requiredTables = [
  'brand_knowledge',
  'brand_knowledge_versions',
  'signal_sources',
  'signal_observations',
  'opportunities',
  'opportunity_evidence',
  'approval_policies',
];

for (const table of requiredTables) {
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS v2_2\\.${table}\\s*\\(`, 'i'), `missing table: ${table}`);
}

assert.match(sql, /UNIQUE\(brand_id, knowledge_type, logical_key\)/i, 'Brand Brain requires stable logical identities');
assert.match(sql, /UNIQUE\(knowledge_id, version_no\)/i, 'Brand Brain versions must be immutable/version-addressable');
assert.match(sql, /PRIMARY KEY\(opportunity_id, observation_id\)/i, 'Opportunity evidence must be explicitly linked');
assert.match(sql, /confidence numeric\(5,4\)/i, 'Opportunity/evidence confidence must be explicit');
assert.match(sql, /mode IN \('AUTO','REVIEW','MANDATORY_APPROVAL'\)/i, 'Approval modes must be policy controlled');
assert.match(sql, /ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES v2_2\.opportunities/i, 'Campaigns must preserve originating opportunity');

assert.doesNotMatch(sql, /ALTER TABLE v2_1\.jobs/i, 'Growth intelligence must not mutate V2.1 jobs');
assert.doesNotMatch(sql, /ALTER TABLE v2_1\.stage_runs/i, 'Growth intelligence must not mutate V2.1 stage runs');
assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+v2_1\./i, 'Growth intelligence must not rewrite V2.1 execution functions');

console.log('V2.2 Brand Brain and opportunity model certification passed.');
