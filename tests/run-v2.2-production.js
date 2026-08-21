'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const tests = [
  'v2.2-stage-spec-test.js',
  'v2.2-production-orchestrator-test.js',
  'v2.2-artifact-contract-test.js',
  'v2.2-intelligence-pipeline-test.js',
];

for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log('V2.2 production vertical slice certification: PASS');
