'use strict';

const { REASON_CODES } = require('../../../src/v2.9/quality-contract');

function check(code, status, reason, qualityClass, confidence = 0.96) {
  return Object.freeze({ code, status, confidence, qualityClass, reason,
    evidence: Object.freeze({ frameRatios: Object.freeze([0.1, 0.5, 0.9]),
      timestampsMs: Object.freeze([500, 2500, 4500]) }) });
}

function result(code, status, reason, qualityClass = 'SEMANTIC_VISUAL', confidence = 0.96) {
  const source = [
    check(REASON_CODES.SINGLE_COHERENT_COMPOSITION, 'PASS', 'One coherent full-frame scene is visible.', qualityClass),
    check(REASON_CODES.PSEUDO_TEXT_ARTIFACT, 'PASS', 'No prohibited text-like artifact is visible.', qualityClass),
    check(REASON_CODES.HUMAN_VISUAL_INTEGRITY, 'PASS', 'No severe visible human deformation is present.', qualityClass),
    check(REASON_CODES.CREATIVE_PLAN_MISMATCH, 'PASS', 'Visible content materially matches the creative plan.', qualityClass),
    check(REASON_CODES.REALISM_QUALITY, 'PASS', 'Requested cinematic naturalism is plausible.', qualityClass),
    check(REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT, 'PASS', 'No prohibited visible element is present.', qualityClass),
    check(REASON_CODES.TEMPORAL_SEMANTIC_CONSISTENCY, 'PASS', 'Ordered frames remain semantically coherent.', qualityClass),
  ];
  const continuity = [
    check(REASON_CODES.VISUAL_IDENTITY_CONTINUITY, 'PASS', 'Character appearance remains plausible.', qualityClass),
    check(REASON_CODES.WARDROBE_CONTINUITY, 'PASS', 'Wardrobe remains plausible.', qualityClass),
    check(REASON_CODES.LOCATION_CONTINUITY, 'PASS', 'Location remains plausible.', qualityClass),
    check(REASON_CODES.PROP_CONTINUITY, 'PASS', 'Key props remain plausible.', qualityClass),
    check(REASON_CODES.LIGHTING_COLOR_CONTINUITY, 'PASS', 'Lighting and color language remain plausible.', qualityClass),
  ];
  const checks = qualityClass === 'CONTINUITY_QUALITY' ? continuity : source;
  const family = qualityClass === 'CONTINUITY_QUALITY'
    ? code === REASON_CODES.CONTINUITY_FAILURE ? [REASON_CODES.VISUAL_IDENTITY_CONTINUITY, REASON_CODES.CONTINUITY_FAILURE, REASON_CODES.IDENTITY_DRIFT]
      : [code]
    : code === REASON_CODES.TRIPTYCH_DETECTED ? [REASON_CODES.SINGLE_COHERENT_COMPOSITION, REASON_CODES.TRIPTYCH_DETECTED]
      : code === REASON_CODES.SEVERE_ANATOMY_DEFORMATION ? [REASON_CODES.HUMAN_VISUAL_INTEGRITY, REASON_CODES.SEVERE_ANATOMY_DEFORMATION]
        : [code];
  const replaceIndex = checks.findIndex((item) => family.includes(item.code));
  if (replaceIndex >= 0) checks[replaceIndex] = check(code, status, reason, qualityClass, confidence);
  const aggregate = checks.some((item) => item.status === 'FAIL') ? 'FAIL'
    : checks.some((item) => item.status === 'WARN') ? 'WARN' : 'PASS';
  return Object.freeze({ status: aggregate, checks: Object.freeze(checks) });
}

const SEMANTIC_FIXTURES = Object.freeze({
  pass: result(REASON_CODES.SINGLE_COHERENT_COMPOSITION, 'PASS', 'One coherent full-frame scene is visible.'),
  triptych: result(REASON_CODES.TRIPTYCH_DETECTED, 'FAIL', 'Three independent simultaneous panels are visible.'),
  pseudoText: result(REASON_CODES.PSEUDO_TEXT_ARTIFACT, 'FAIL', 'Prominent unreadable text-like artifacts are visible.'),
  humanDeformation: result(REASON_CODES.SEVERE_ANATOMY_DEFORMATION, 'FAIL', 'A prominent subject has visibly fused limbs.'),
  creativeMismatch: result(REASON_CODES.CREATIVE_PLAN_MISMATCH, 'FAIL', 'The requested couple and home environment are absent.'),
  warning: result(REASON_CODES.REALISM_QUALITY, 'WARN', 'A minor ambiguous hand artifact is visible.', 'SEMANTIC_VISUAL', 0.67),
  continuityPass: result(REASON_CODES.VISUAL_IDENTITY_CONTINUITY, 'PASS', 'Character and location identity remain plausible.', 'CONTINUITY_QUALITY'),
  continuityFail: result(REASON_CODES.CONTINUITY_FAILURE, 'FAIL', 'The primary character changes identity between shots.', 'CONTINUITY_QUALITY'),
});

module.exports = { SEMANTIC_FIXTURES, result };
