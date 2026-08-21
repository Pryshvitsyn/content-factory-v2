'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'contracts/quality/quality-policy.v1.json'), 'utf8'));

const rules = new Map(policy.rules.map((rule) => [rule.id, rule]));

function evaluate({ artifactId, findings = [], repairAttempts = 0, exceptions = [] }) {
  const exceptionKeys = new Set(
    exceptions
      .filter((exception) => exception && exception.approved_by_policy === true)
      .map((exception) => `${exception.rule_id}:${exception.scope?.scene_id || '*'}`)
  );

  const normalized = findings.map((finding) => {
    const rule = rules.get(finding.rule_id);
    if (!rule) {
      return { ...finding, severity: 'BLOCK', message: `Unknown quality rule: ${finding.rule_id}` };
    }
    const sceneId = finding.scope?.scene_id || '*';
    const excepted = rule.exception_required === true &&
      (exceptionKeys.has(`${rule.id}:${sceneId}`) || exceptionKeys.has(`${rule.id}:*`));
    return { ...finding, severity: excepted ? 'INFO' : rule.severity, excepted };
  });

  const unresolvedBlocks = normalized.filter((finding) => finding.severity === 'BLOCK' && !finding.excepted);
  let status = 'PASS';
  if (unresolvedBlocks.length > 0) {
    const repairable = unresolvedBlocks.every((finding) => Boolean(finding.repair_strategy));
    status = repairable && repairAttempts < policy.repair.max_attempts ? 'REPAIR' : 'BLOCK';
  }

  return {
    contract_version: policy.contract_version,
    artifact_id: artifactId,
    status,
    findings: normalized,
    unresolved_block_count: unresolvedBlocks.length,
    repair_attempts: repairAttempts,
    max_repair_attempts: policy.repair.max_attempts,
  };
}

module.exports = { evaluate, policy };
