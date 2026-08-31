'use strict';

const SOURCE_CREATIVE_RECOVERY_KIND = 'SOURCE_CREATIVE';
const SOURCE_CREATIVE_FAILURE_CODE = 'CREATIVE_PLAN_MISMATCH';

function creativeFailureChecks(candidate) {
  const checks = [
    ...(candidate?.semantic?.checks || []),
    ...(candidate?.checks || []),
  ];
  return checks.filter((check) => check?.status === 'FAIL'
    && check?.code === SOURCE_CREATIVE_FAILURE_CODE)
    .filter((check, index, all) => all.findIndex((item) => item.code === check.code) === index);
}

function creativeFailureCodes(candidate) {
  return creativeFailureChecks(candidate).map((check) => check.code);
}

function oneLine(value, maximum = 600) {
  const normalized = String(value || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`;
}

const EVIDENCE_FIELDS = Object.freeze(['observedCondition','observedState','approvedCondition',
  'approvedState','expectedCondition','expectedState','mismatchType','framePosition']);

function knownEvidenceText(failure) {
  const evidence = failure?.evidence;
  const values = [failure?.reason];
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    for (const field of EVIDENCE_FIELDS) {
      if (typeof evidence[field] === 'string' || typeof evidence[field] === 'number'
        || typeof evidence[field] === 'boolean') values.push(evidence[field]);
    }
  }
  return values.map((value) => oneLine(value, 240).toLowerCase()).filter(Boolean).join(' ');
}

function sanitizeCreativeFailureObservation(failure) {
  if (!failure || failure.code !== SOURCE_CREATIVE_FAILURE_CODE) return null;
  const source = knownEvidenceText(failure);
  const opening = /\b(opening|initial|first frame|first-frame)\b/.test(source);
  const physicalConnection = /\b(embrac\w*|cuddl\w*|handhold\w*|holding hands|touch\w*|physical connection|leaning into)\b/.test(source);
  const separation = /\b(separation|spaced apart|visible space|pre-connection|emotionally distant|distance between)\b/.test(source);
  const earlyReveal = /\b(before (the )?(planned|approved) reveal|premature reveal|revealed too early|already visible|visible before)\b/.test(source);
  const subject = /\b(subject mismatch|wrong subject|missing subject|subject absent)\b/.test(source);
  const action = /\b(action mismatch|wrong action|missing action|action absent)\b/.test(source);
  const environment = /\b(environment mismatch|wrong environment|wrong location|setting mismatch)\b/.test(source);
  const observations = [];
  if (opening && physicalConnection && separation) observations.push('opening state showed physical connection before the approved separated state');
  else if (opening && physicalConnection) observations.push('opening state showed physical connection inconsistent with the approved shot state');
  else if (opening && earlyReveal) observations.push('opening state revealed planned content before the approved reveal timing');
  else if (opening) observations.push('opening state contradicted the approved opening state');
  else if (physicalConnection && separation) observations.push('physical connection contradicted the approved separated state');
  else if (earlyReveal) observations.push('planned content was revealed before the approved timing');
  if (subject) observations.push('visible subject did not match the approved subject');
  if (action) observations.push('visible action did not match the approved action');
  if (environment) observations.push('visible environment did not match the approved environment');
  if (!observations.length) observations.push('visible content contradicted the approved shot state');
  return `Observed mismatch: ${observations.join('; ')}.`;
}

function selectedShotPlan(shot) {
  if (!shot) return null;
  const fields = ['shotId','assetId','purpose','subject','subjectDescription','action','environment',
    'emotionalIntent','framing','camera','lensComposition','lighting','continuityIdentity'];
  return Object.freeze(Object.fromEntries(fields.filter((field) => shot[field] != null)
    .map((field) => [field, shot[field]])));
}

function selectedGenerationRequirements(requirements) {
  if (!requirements) return null;
  const fields = ['provider','model','profile','capability','resolution','aspect_ratio','generate_audio','audio_strategy'];
  return Object.freeze(Object.fromEntries(fields.filter((field) => requirements[field] != null)
    .map((field) => [field, requirements[field]])));
}

function sourceCreativeRecoveryContext({ candidate, approvedShot, originalGenerationRequirements } = {}) {
  const failure = creativeFailureChecks(candidate)[0] || null;
  if (!failure) return null;
  return Object.freeze({ failureCode: failure.code,
    failureReason: oneLine(failure.reason || failure.message || failure.evidence?.reason
      || 'The previous immutable source contradicted the approved shot plan.'),
    failureEvidence: failure.evidence || null,
    sanitizedObservation: sanitizeCreativeFailureObservation(failure),
    approvedShotPlan: selectedShotPlan(approvedShot),
    originalGenerationRequirements: selectedGenerationRequirements(originalGenerationRequirements) });
}

function planText(plan) {
  if (!plan) return 'the approved shot plan already present in this canonical generation prompt';
  return Object.entries(plan).map(([key, value]) => `${key}=${oneLine(value, 180)}`).join('; ');
}

function requirementsText(requirements) {
  if (!requirements) return 'the original canonical generation requirements';
  return Object.entries(requirements).map(([key, value]) => `${key}=${oneLine(value, 120)}`).join('; ');
}

function buildSourceCreativeRecoveryInstruction({ context, operatorInstruction = null } = {}) {
  if (!context || context.failureCode !== SOURCE_CREATIVE_FAILURE_CODE) {
    const error = new Error('Durable CREATIVE_PLAN_MISMATCH evidence is required to build source creative recovery');
    error.code = 'CREATIVE_RECOVERY_CONTEXT_INVALID'; throw error;
  }
  const parts = [
    `Regenerate this source shot because the previous immutable version failed ${context.failureCode}.`,
    `Strictly follow the approved shot plan: ${planText(context.approvedShotPlan)}.`,
    `Keep the original generation requirements: ${requirementsText(context.originalGenerationRequirements)}.`,
    context.sanitizedObservation || 'Observed mismatch: visible content contradicted the approved shot state.',
    'Preserve all approved creative requirements not contradicted by this corrective instruction.',
    operatorInstruction?.trim() ? `Explicit operator corrective instruction: ${operatorInstruction.trim()}` : null,
  ];
  return parts.filter(Boolean).join('\n');
}

module.exports = {
  SOURCE_CREATIVE_FAILURE_CODE,
  SOURCE_CREATIVE_RECOVERY_KIND,
  buildSourceCreativeRecoveryInstruction,
  creativeFailureChecks,
  creativeFailureCodes,
  sanitizeCreativeFailureObservation,
  sourceCreativeRecoveryContext,
};
