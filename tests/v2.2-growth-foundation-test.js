'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'migrations', '20260822_v2_2_growth_foundation.sql');
const architecturePath = path.join(root, 'docs', 'V2.2-GROWTH-ARCHITECTURE.md');

const sql = fs.readFileSync(migrationPath, 'utf8');
const architecture = fs.readFileSync(architecturePath, 'utf8');

const requiredTables = [
  'brands',
  'products',
  'markets',
  'audiences',
  'offers',
  'funnels',
  'campaigns',
  'content_series',
  'content_items',
];

for (const table of requiredTables) {
  assert.match(
    sql,
    new RegExp(`CREATE TABLE IF NOT EXISTS v2_2\\.${table}\\s*\\(`, 'i'),
    `missing V2.2 table: ${table}`
  );
}

for (const column of ['brand_id', 'product_id', 'campaign_id', 'content_item_id', 'objective']) {
  assert.match(
    sql,
    new RegExp(`ALTER TABLE v2_1\\.productions ADD COLUMN IF NOT EXISTS ${column}\\b`, 'i'),
    `V2.1 production growth context is missing: ${column}`
  );
}

// Compatibility invariant: all new growth foreign keys on existing productions are nullable.
assert.doesNotMatch(
  sql,
  /ALTER TABLE v2_1\.productions ADD COLUMN IF NOT EXISTS (brand_id|product_id|campaign_id|content_item_id)[^;]*NOT NULL/i,
  'V2.2 must not invalidate legacy V2.1 production rows'
);

// Protected-foundation invariant: this migration must not rewrite the execution stage graph/functions.
assert.doesNotMatch(sql, /stage_definitions/i, 'V2.2 growth migration must not rewrite V2.1 stage definitions');
assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+v2_1\.(claim_|heartbeat_|fail_|complete_)/i,
  'V2.2 growth migration must not rewrite certified V2.1 execution functions');

const objectives = [
  'ORGANIC_REACH',
  'ENGAGEMENT',
  'TRAFFIC',
  'LEAD_GENERATION',
  'APP_INSTALL',
  'PURCHASE',
  'BOOKING',
  'SEO_AUTHORITY',
  'RETENTION',
  'EXPERIMENT',
];

for (const objective of objectives) {
  assert.ok(sql.includes(`'${objective}'`), `missing canonical objective in migration: ${objective}`);
  assert.ok(architecture.includes(objective), `missing canonical objective in architecture: ${objective}`);
}

for (const concept of ['Brand Brain', 'Opportunity engine', 'Experiment model', 'Funnel model', 'Attribution', 'Economic intelligence']) {
  assert.ok(architecture.toLowerCase().includes(concept.toLowerCase()), `architecture missing concept: ${concept}`);
}

assert.ok(
  architecture.includes('SIGNAL -> IDEA -> BRIEF -> BIBLE -> CONCEPT -> SCRIPT -> SHOT_PLAN'),
  'V2.2 architecture must explicitly preserve the V2.1 production pipeline'
);

console.log('V2.2 growth foundation contract certification passed.');
