'use strict';

const assert = require('node:assert/strict');
const {
  PostgresSemanticEvaluationAttemptRepository,
  reusableSemanticPassFromHistory,
} = require('../src/v2.9/semantic-evaluation-retry');
const { installSemanticRetryState } = require('../apps/dashboard/server/semantic-retry-state');

const sourceArtifact = Object.freeze({
  artifactId: 'brand:b:asset:operator-video-1',
  version: 1,
  storageKey: 'video.mp4',
  contentHash: 'video-hash',
});
const evidenceArtifact = Object.freeze({ artifactId: 'quality:evaluation', version: 1, contentHash: 'evidence-hash' });
const semanticPass = Object.freeze({
  status: 'PASS',
  semantic: Object.freeze({ status: 'PASS', checks: Object.freeze([
    Object.freeze({ code: 'BRAND_SAFETY_PROHIBITED_ELEMENT', status: 'PASS' }),
  ]) }),
});

function attempt(overrides = {}) {
  return {
    id: 'attempt-3', attempt: 3, status: 'SUCCEEDED',
    source_artifact: sourceArtifact,
    previous_evidence: { evidenceArtifact },
    result_evidence: semanticPass,
    evaluator_provider: 'openai', evaluator_model: 'semantic-test',
    ...overrides,
  };
}

async function main() {
  const newestFailure = attempt({ id: 'attempt-4', attempt: 4, status: 'FAILED',
    result_evidence: { status: 'FAIL', semantic: { status: 'FAIL', checks: [{ status: 'FAIL' }] } } });
  const olderPass = attempt();
  const reusable = reusableSemanticPassFromHistory({
    attempts: [newestFailure, olderPass], sourceArtifact, previousEvidenceArtifact: evidenceArtifact,
    evaluator: { provider: 'openai', model: 'semantic-test' },
  });
  assert.equal(reusable.reusable, true);
  assert.equal(reusable.attempt, 3);
  assert.equal(reusable.attemptId, 'attempt-3');
  assert.strictEqual(reusable.evaluation, semanticPass);

  const stalePass = attempt({ id: 'stale', attempt: 2,
    source_artifact: { ...sourceArtifact, contentHash: 'different-video' } });
  const none = reusableSemanticPassFromHistory({
    attempts: [newestFailure, stalePass], sourceArtifact, previousEvidenceArtifact: evidenceArtifact,
    evaluator: { provider: 'openai', model: 'semantic-test' },
  });
  assert.equal(none.reusable, false, 'a PASS for a different immutable source must not be reused');

  const fencedRepository = new PostgresSemanticEvaluationAttemptRepository({
    db: { async query() { const error = new Error('duplicate'); error.code = '23505'; throw error; } },
  });
  await assert.rejects(() => fencedRepository.start({
    workspaceId: 'w', brandId: 'b', productionId: 'p', jobId: 'j', assetId: 'operator-video-1',
    sourceArtifact, previousEvidence: { evidenceArtifact }, evaluator: { provider: 'openai', model: 'semantic-test' },
  }), (error) => error.code === 'SEMANTIC_RETRY_ALREADY_RUNNING');

  let historySql = '';
  const dashboardRepository = installSemanticRetryState({
    db: { async query(sql) {
      if (String(sql).includes('to_regclass')) return { rows: [{ ready: true }] };
      historySql = String(sql);
      return { rows: [olderPass] };
    } },
  });
  const dashboardAttempt = await dashboardRepository.latestSemanticRetryAttempt('p', 'b', 'operator-video-1');
  assert.equal(dashboardAttempt.attempt, 3);
  assert.match(historySql, /result_evidence->>'status'='PASS'/);
  assert.match(historySql, /ORDER BY CASE/);

  console.log('V2.9.2.6 historical semantic PASS reuse and running-attempt fence passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
