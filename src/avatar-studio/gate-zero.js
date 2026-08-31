'use strict';

const { AvatarStudioError } = require('./domain');

const RULES = Object.freeze([
  { severity: 'BLOCK', code: 'PROMPT_INJECTION', pattern: /(ignore|override|disregard).{0,40}(instruction|system|owner)|system\s*prompt|developer\s*message/i },
  { severity: 'BLOCK', code: 'CONCEALED_ACTION', pattern: /(do not|don'?t)\s+(tell|show|notify).{0,30}(owner|user)|hide\s+(this|the action)/i },
  { severity: 'BLOCK', code: 'EMBEDDED_EXECUTION', pattern: /(?:curl|wget|powershell|bash|sh)\s+[^\n]+|(?:rm\s+-rf|drop\s+table|format\s+disk)/i },
  { severity: 'BLOCK', code: 'SECRET_REQUEST', pattern: /(api[_ -]?key|password|private[_ -]?key|access[_ -]?token).{0,30}(send|upload|paste|reveal)/i },
  { severity: 'BLOCK', code: 'EXTERNAL_UPLOAD', pattern: /(upload|exfiltrat|send).{0,50}(credential|secret|customer data|private)/i },
  { severity: 'REVIEW', code: 'TRACKING_PARAMETERS', pattern: /[?&](utm_[a-z]+|ref|affiliate|fbclid|gclid)=/i },
  { severity: 'REVIEW', code: 'PII_RISK', pattern: /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b(?:\+?\d[\d ()-]{8,}\d)\b/ },
  { severity: 'REVIEW', code: 'FACE_VOICE_RIGHTS', pattern: /(clone|imitate|replicate).{0,30}(face|voice|person|celebrity)|real person/i },
  { severity: 'REVIEW', code: 'UNSUPPORTED_CLAIM', pattern: /(guaranteed|guarantees|100%).{0,30}(result|cure|viral|return|success)/i },
]);

function inspectGateZero(input = {}) {
  const text = [input.sourceLocator, input.text, input.metadata && JSON.stringify(input.metadata),
    input.provenance && JSON.stringify(input.provenance)].filter(Boolean).join('\n');
  if (!text.trim()) throw new AvatarStudioError(400, 'GATE0_SOURCE_EMPTY', 'Gate 0 requires source content, location or metadata');
  const findings = RULES.filter((rule) => rule.pattern.test(text)).map(({ severity, code }) => Object.freeze({ severity, code }));
  const status = findings.some((item) => item.severity === 'BLOCK') ? 'BLOCK'
    : findings.some((item) => item.severity === 'REVIEW') ? 'REVIEW' : 'PASS';
  return Object.freeze({ status, findings: Object.freeze(findings), authority: 'UNTRUSTED_DATA',
    externalCalls: 0, inspectedAt: new Date().toISOString(), policyVersion: 'GATE_0_AVATAR_STUDIO_V1' });
}

function inspectAssetGateZero({ media = {}, sourceType, sourceLocator = null, provenance = {}, subjectType = 'SYNTHETIC' } = {}) {
  const base = inspectGateZero({ sourceLocator, text: media.embeddedText || 'immutable media asset',
    metadata: { filename: media.filename, mimeType: media.mimeType, extension: media.extension,
      detectedMime: media.detectedMime, byteSize: media.byteSize }, provenance });
  const findings = [...(media.findings || []), ...base.findings];
  if (sourceType === 'SAFE_URL_IMPORT') findings.push({ severity: 'REVIEW', code: 'EXTERNAL_URL_SOURCE' });
  if (!provenance.owner && subjectType !== 'SYNTHETIC') findings.push({ severity: 'REVIEW', code: 'PROVENANCE_UNCERTAIN' });
  if (subjectType !== 'SYNTHETIC' && media.kind === 'image') findings.push({ severity: 'REVIEW', code: 'FACE_CONSENT_REQUIRED' });
  if (subjectType !== 'SYNTHETIC' && media.kind === 'audio') findings.push({ severity: 'REVIEW', code: 'VOICE_CONSENT_REQUIRED' });
  if (subjectType !== 'SYNTHETIC' && media.kind === 'video') {
    findings.push({ severity: 'REVIEW', code: 'FACE_CONSENT_REQUIRED' }, { severity: 'REVIEW', code: 'VOICE_CONSENT_REQUIRED' });
  }
  const unique = [...new Map(findings.map((item) => [`${item.severity}:${item.code}`, Object.freeze({ severity: item.severity, code: item.code })])).values()];
  const status = unique.some((item) => item.severity === 'BLOCK') ? 'BLOCK'
    : unique.some((item) => item.severity === 'REVIEW') ? 'REVIEW' : 'PASS';
  return Object.freeze({ ...base, status, findings: Object.freeze(unique), policyVersion: 'GATE_0_AVATAR_STUDIO_V1_1',
    externalCalls: sourceType === 'SAFE_URL_IMPORT' ? 1 : 0, paidProviderCalls: 0 });
}

function assertGateUsable(source, { allowReview = true } = {}) {
  const status = source?.gate0Status || source?.gate0_status || source?.gate0?.status;
  if (status === 'BLOCK') throw new AvatarStudioError(409, 'GATE0_BLOCKED', 'Blocked source cannot be used by Avatar Studio');
  if (status === 'REVIEW' && !allowReview) throw new AvatarStudioError(409, 'GATE0_REVIEW_REQUIRED', 'Source requires human Gate 0 review');
  if (!['PASS','REVIEW'].includes(status)) throw new AvatarStudioError(409, 'GATE0_MISSING', 'Every imported source must carry a Gate 0 decision');
  return true;
}

module.exports = { RULES, assertGateUsable, inspectAssetGateZero, inspectGateZero };
