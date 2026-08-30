'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const dashboard = fs.readFileSync(require.resolve('../apps/dashboard/client/src/App.jsx'), 'utf8');

assert.match(dashboard, /const shotContinuity = evaluation\?\.continuity \|\| null;/,
  'Shot Inspector must use per-shot incremental continuity evidence');
assert(dashboard.includes('Cross-shot continuity · per-shot gate'));
assert(dashboard.includes('Continuity evaluator'));
assert(dashboard.includes('Compared artifacts'));

for (const label of ['Character identity','Wardrobe','Environment','Visual style','Acting / motion']) {
  assert(dashboard.includes(`label: '${label}'`), `Shot Inspector must expose ${label} as a dedicated field`);
}

assert(dashboard.includes('VISUAL_IDENTITY_CONTINUITY'));
assert(dashboard.includes('CHARACTER_IDENTITY_DRIFT'));
assert(dashboard.includes('WARDROBE_CONTINUITY_DRIFT'));
assert(dashboard.includes('ENVIRONMENT_CONTINUITY_DRIFT'));
assert(dashboard.includes('VISUAL_STYLE_CONTINUITY_DRIFT'));
assert(dashboard.includes('ACTING_STYLE_CONTINUITY_DRIFT'));

console.log('V2.10.3 Shot Inspector continuity UI contract passed.');
