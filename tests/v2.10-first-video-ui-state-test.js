'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../apps/dashboard/client/src/CreativeProduction.jsx'), 'utf8');

assert.match(source, /const invalidate = \(\) => \{\s*setPreflight\(null\);\s*setFirstVideoPreflight\(null\);\s*\};/,
  'Any canonical input change must invalidate both final and first-video preflight state');

assert.match(source, /setPreflight\(row\.final_preflight \|\| row\.finalPreflight \|\| null\);\s*setFirstVideoPreflight\(null\);/,
  'Loading a draft must never preserve first-video preflight state from a different render/session');

assert.match(source, /setBusy\('preflight'\); setPreflight\(null\); setFirstVideoPreflight\(null\);/,
  'Starting a fresh FINAL PRODUCTION PREFLIGHT must clear the displayed first-video plan immediately');

assert.match(source, /async function preflightLockedVideo\(\) \{\s*setBusy\('locked-video-preflight'\);\s*setFirstVideoPreflight\(null\);/,
  'Starting a fresh FIRST VIDEO PREFLIGHT must clear the previous first-video card before the response arrives');

console.log('V2.10 first-video stale UI state guard: PASS');
