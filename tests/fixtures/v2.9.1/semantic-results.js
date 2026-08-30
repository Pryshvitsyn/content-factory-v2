'use strict';

const { REASON_CODES } = require('../../../src/v2.9/quality-contract');

function check(code, status, reason, qualityClass, confidence = 0.96) {
  return Object.freeze({ code, status, confidence, qualityClass, reason,
    evidence: Object.freeze({ frameRatios: Object.freeze([0.1, 0.5, 0.9]),
      timestampsMs: Object.freeze([500, 2500, 4500]) }) });
}

function result(code, status, reason, qualityClass = 'SEMANTIC_VISUAL', confidence = 0.96) {
  const source = {
    composition: check(REASON_CODES.SINGLE_COHERENT_COMPOSITION, 'PASS', 'One coherent full-frame scene is visible.', qualityClass),
    generatedText: check(REASON_CODES.PSEUDO_TEXT_ARTIFACT, 'PASS', 'No prohibited text-like artifact is visible.', qualityClass),
    humanIntegrity: check(REASON_CODES.HUMAN_VISUAL_INTEGRITY, 'PASS', 'No severe visible human deformation is present.', qualityClass),
    creativeCompliance: check(REASON_CODES.CREATIVE_PLAN_MISMATCH, 'PASS', 'Visible content materially matches the creative plan.', qualityClass),
    realism: check(REASON_CODES.REALISM_QUALITY, 'PASS', 'Requested cinematic naturalism is plausible.', qualityClass),
    brandSafety: check(REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT, 'PASS', 'No prohibited visible element is present.', qualityClass),
    temporalConsistency: check(REASON_CODES.TEMPORAL_SEMANTIC_CONSISTENCY, 'PASS', 'Ordered frames remain semantically coherent.', qualityClass),
  };
  const continuity = {
    characterIdentity: check(REASON_CODES.VISUAL_IDENTITY_CONTINUITY, 'PASS', 'The same character identity remains plausible.', qualityClass),
    wardrobe: check(REASON_CODES.WARDROBE_CONTINUITY, 'PASS', 'Wardrobe remains plausible.', qualityClass),
    environment: check(REASON_CODES.LOCATION_CONTINUITY, 'PASS', 'Environment and room layout remain plausible.', qualityClass),
    props: check(REASON_CODES.PROP_CONTINUITY, 'PASS', 'Key props remain plausible.', qualityClass),
    lightingColor: check(REASON_CODES.LIGHTING_COLOR_CONTINUITY, 'PASS', 'Lighting and color language remain plausible.', qualityClass),
    visualStyle: check(REASON_CODES.VISUAL_STYLE_CONTINUITY, 'PASS', 'Cinematography and rendering language remain plausible.', qualityClass),
    realism: check(REASON_CODES.CROSS_SHOT_REALISM_CONTINUITY, 'PASS', 'Perceived realism remains consistent between shots.', qualityClass),
    actingMotion: check(REASON_CODES.ACTING_STYLE_CONTINUITY, 'PASS', 'Acting and motion style remain consistent with the planned progression.', qualityClass),
  };
  const checks = qualityClass === 'CONTINUITY_QUALITY' ? continuity : source;
  const continuityAliases = [REASON_CODES.CONTINUITY_FAILURE, REASON_CODES.IDENTITY_DRIFT,
    REASON_CODES.CHARACTER_IDENTITY_DRIFT, REASON_CODES.VISUAL_IDENTITY_CONTINUITY];
  const family = qualityClass === 'CONTINUITY_QUALITY'
    ? continuityAliases.includes(code) ? continuityAliases : [code]
    : code === REASON_CODES.TRIPTYCH_DETECTED ? [REASON_CODES.SINGLE_COHERENT_COMPOSITION, REASON_CODES.TRIPTYCH_DETECTED]
      : code === REASON_CODES.SEVERE_ANATOMY_DEFORMATION ? [REASON_CODES.HUMAN_VISUAL_INTEGRITY, REASON_CODES.SEVERE_ANATOMY_DEFORMATION]
        : [code];
  const replaceKey = Object.keys(checks).find((key) => family.includes(checks[key].code));
  if (replaceKey) checks[replaceKey] = check(code, status, reason, qualityClass, confidence);
  const values = Object.values(checks);
  const aggregate = values.some((item) => item.status === 'FAIL') ? 'FAIL'
    : values.some((item) => item.status === 'WARN') ? 'WARN' : 'PASS';
  return Object.freeze({ status: aggregate, checks: Object.freeze(checks) });
}

const SEMANTIC_FIXTURES = Object.freeze({
  pass: result(REASON_CODES.SINGLE_COHERENT_COMPOSITION, 'PASS', 'One coherent full-frame scene is visible.'),
  triptych: result(REASON_CODES.TRIPTYCH_DETECTED, 'FAIL', 'Three independent simultaneous panels are visible.'),
  pseudoText: result(REASON_CODES.PSEUDO_TEXT_ARTIFACT, 'FAIL', 'Prominent unreadable text-like artifacts are visible.'),
  humanDeformation: result(REASON_CODES.SEVERE_ANATOMY_DEFORMATION, 'FAIL', 'A prominent subject has visibly fused limbs.'),
  creativeMismatch: result(REASON_CODES.CREATIVE_PLAN_MISMATCH, 'FAIL', 'The requested couple and home environment are absent.'),
  warning: result(REASON_CODES.REALISM_QUALITY, 'WARN', 'A minor ambiguous hand artifact is visible.', 'SEMANTIC_VISUAL', 0.67),
  continuityPass: result(REASON_CODES.VISUAL_IDENTITY_CONTINUITY, 'PASS', 'Character and environment identity remain plausible.', 'CONTINUITY_QUALITY'),
  continuityFail: result(REASON_CODES.CHARACTER_IDENTITY_DRIFT, 'FAIL', 'The primary character changes identity between shots.', 'CONTINUITY_QUALITY'),
});

module.exports = { SEMANTIC_FIXTURES, result };
