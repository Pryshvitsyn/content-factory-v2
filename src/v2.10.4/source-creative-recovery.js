'use strict';

const SOURCE_CREATIVE_RECOVERY_KIND = 'SOURCE_CREATIVE';
const SOURCE_CREATIVE_FAILURE_CODE = 'CREATIVE_PLAN_MISMATCH';
const SOURCE_CREATIVE_RECOVERY_INSTRUCTION = 'Opening frame must show clear physical separation and unresolved tension. The couple are seated with visible space between them. No embrace, cuddling, arm around shoulders, handholding, touching, leaning into each other, affectionate physical contact, or smiling together in the opening state. The woman looks away or remains emotionally distant; the partner notices without touching her. Preserve ambiguity, hesitation, and pre-connection tension. Connection may develop only later if required by the approved shot plan.';

function creativeFailureCodes(candidate) {
  const checks = [
    ...(candidate?.semantic?.checks || []),
    ...(candidate?.checks || []),
  ];
  return checks.filter((check) => check?.status === 'FAIL'
    && check?.code === SOURCE_CREATIVE_FAILURE_CODE)
    .map((check) => check.code)
    .filter((code, index, all) => all.indexOf(code) === index);
}

module.exports = {
  SOURCE_CREATIVE_FAILURE_CODE,
  SOURCE_CREATIVE_RECOVERY_INSTRUCTION,
  SOURCE_CREATIVE_RECOVERY_KIND,
  creativeFailureCodes,
};
