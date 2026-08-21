'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const tests = [
  'v2.1-contract-test.js',
  'v2.1-stage-sequence-test.js',
  'v2.1-execution-engine-test.js',
  'v2.2-production-orchestrator-test.js',
];

for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log('V2.1 execution foundation + V2.2 vertical slice bootstrap: PASS');
