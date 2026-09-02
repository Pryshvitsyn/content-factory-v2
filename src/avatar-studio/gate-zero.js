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

const FINDING_EXPLANATIONS = Object.freeze({
  PROMPT_INJECTION: 'Structured metadata attempts to override trusted instructions.',
  CONCEALED_ACTION: 'Structured metadata asks for an action to be hidden from the operator.',
  EMBEDDED_EXECUTION: 'Structured metadata contains an executable command pattern.',
  SECRET_REQUEST: 'Structured metadata requests disclosure of a secret or credential.',
  EXTERNAL_UPLOAD: 'Structured metadata requests transfer of private or credential data.',
  TRACKING_PARAMETERS: 'The source URL contains tracking parameters.',
  PII_RISK: 'Structured metadata contains a possible email address or telephone number.',
  FACE_VOICE_RIGHTS: 'Structured metadata refers to copying a real person, face, or voice.',
  UNSUPPORTED_CLAIM: 'Structured metadata contains a claim that needs human review.',
  EXTERNAL_URL_SOURCE: 'The media came from an explicit external URL import.',
  PROVENANCE_UNCERTAIN: 'The operator has not recorded who owns or supplied this source.',
  FACE_CONSENT_REQUIRED: 'Use of a real person image requires explicit face consent.',
  VOICE_CONSENT_REQUIRED: 'Use of a real person recording requires explicit voice consent.',
  FORMAT_UNSUPPORTED: 'The detected image encoding is intentionally unsupported by Avatar Studio.',
  INVALID_MIME_TYPE: 'The declared MIME type is not in the media intake contract.',
  MIME_EXTENSION_MISMATCH: 'The filename extension does not match the declared media type.',
  UNRECOGNIZED_MEDIA_SIGNATURE: 'The file signature is not recognized as supported media.',
  MIME_SIGNATURE_MISMATCH: 'The detected file signature does not match the declared media type.',
  MEDIA_UNREADABLE: 'The media decoder could not read the file.',
  MEDIA_VIDEO_STREAM_MISSING: 'The decoder found no readable image stream.',
  MEDIA_DIMENSIONS_INVALID: 'The decoder found no positive image dimensions.',
  DERIVED_PROVIDER_LINEAGE_INVALID: 'Provider output is missing verified source, consent, identity, lock, or approval lineage.',
});

function explainFinding(item) {
  return Object.freeze({ severity: item.severity, code: item.code,
    explanation: FINDING_EXPLANATIONS[item.code] || 'The source did not satisfy a bounded intake policy check.' });
}

function approvedDerivedProviderOutput({ sourceType, provenance = {} } = {}) {
  const lineage = provenance.executionLineage || {};
  const assurances = provenance.assurances || {};
  return sourceType === 'PROVIDER_OUTPUT'
    && provenance.provenanceClass === 'DERIVED_PROVIDER_OUTPUT'
    && provenance.source === 'APPROVED_PROVIDER_EXECUTION'
    && Boolean(lineage.executionId && lineage.attemptId && lineage.generationSpecId
      && lineage.identityVersionId && lineage.identityLockVersionId
      && (Array.isArray(lineage.sourceAssetIds) && lineage.sourceAssetIds.length || lineage.certifiedReferenceId))
    && assurances.originalSourceEligible === true
    && assurances.originalSourceGate0Status === 'PASS'
    && ['VALID','NOT_REQUIRED'].includes(assurances.requiredFaceConsent)
    && assurances.identityVersionCurrent === true
    && assurances.identityLockCurrent === true
    && assurances.providerExecutionApproved === true;
}

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

function inspectAssetGateZero({ media = {}, sourceType, sourceLocator = null, provenance = {}, subjectType = 'SYNTHETIC',
  consentVerified = false, voiceConsentVerified = false, visualOnly = false } = {}) {
  const scanProvenance = sourceType === 'PROVIDER_OUTPUT' ? {
    provenanceClass: provenance.provenanceClass, source: provenance.source, provider: provenance.provider,
    model: provenance.model, repairDelta: provenance.repairDelta || null, identityContract: provenance.identityContract || null,
  } : provenance;
  const base = inspectGateZero({ sourceLocator, text: media.embeddedText || 'immutable media asset',
    metadata: { filename: media.filename, mimeType: media.mimeType, extension: media.extension,
      detectedMime: media.detectedMime, byteSize: media.byteSize }, provenance: scanProvenance });
  const findings = [...(media.findings || []), ...base.findings];
  if (sourceType === 'SAFE_URL_IMPORT') findings.push({ severity: 'REVIEW', code: 'EXTERNAL_URL_SOURCE' });
  const approvedDerivative = approvedDerivedProviderOutput({ sourceType, provenance });
  if (sourceType === 'PROVIDER_OUTPUT' && !approvedDerivative) findings.push({ severity: 'REVIEW', code: 'DERIVED_PROVIDER_LINEAGE_INVALID' });
  if (!provenance.owner && subjectType !== 'SYNTHETIC' && !approvedDerivative) findings.push({ severity: 'REVIEW', code: 'PROVENANCE_UNCERTAIN' });
  if (subjectType !== 'SYNTHETIC' && media.kind === 'image' && !consentVerified) findings.push({ severity: 'REVIEW', code: 'FACE_CONSENT_REQUIRED' });
  if (subjectType !== 'SYNTHETIC' && media.kind === 'audio' && !voiceConsentVerified) findings.push({ severity: 'REVIEW', code: 'VOICE_CONSENT_REQUIRED' });
  if (subjectType !== 'SYNTHETIC' && media.kind === 'video') {
    if (!consentVerified) findings.push({ severity: 'REVIEW', code: 'FACE_CONSENT_REQUIRED' });
    if (!(visualOnly || provenance.visualOnly === true) && !voiceConsentVerified) findings.push({ severity: 'REVIEW', code: 'VOICE_CONSENT_REQUIRED' });
  }
  const unique = [...new Map(findings.map((item) => [`${item.severity}:${item.code}`, explainFinding(item)])).values()];
  const status = unique.some((item) => item.severity === 'BLOCK') ? 'BLOCK'
    : unique.some((item) => item.severity === 'REVIEW') ? 'REVIEW' : 'PASS';
  return Object.freeze({ ...base, status, findings: Object.freeze(unique), policyVersion: 'GATE_0_AVATAR_STUDIO_V1_2_STRUCTURED_MEDIA_TEXT',
    externalCalls: sourceType === 'SAFE_URL_IMPORT' ? 1 : 0, paidProviderCalls: 0 });
}

function assertGateUsable(source, { allowReview = true } = {}) {
  const status = source?.gate0Status || source?.gate0_status || source?.gate0?.status;
  if (status === 'BLOCK') throw new AvatarStudioError(409, 'GATE0_BLOCKED', 'Blocked source cannot be used by Avatar Studio');
  if (status === 'REVIEW' && !allowReview) throw new AvatarStudioError(409, 'GATE0_REVIEW_REQUIRED', 'Source requires human Gate 0 review');
  if (!['PASS','REVIEW'].includes(status)) throw new AvatarStudioError(409, 'GATE0_MISSING', 'Every imported source must carry a Gate 0 decision');
  return true;
}

module.exports = { FINDING_EXPLANATIONS, RULES, approvedDerivedProviderOutput, assertGateUsable, inspectAssetGateZero, inspectGateZero };
