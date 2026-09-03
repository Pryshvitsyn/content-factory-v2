'use strict';

const { geometry } = require('../v2.10.2/reference-geometry');
const { validatePassportIdentityContinuity } = require('../v2.10/continuity-contract');
const { PASSPORT_OUTPUT, PASSPORT_PANEL_COUNT } = require('./passport-contract');

function panelRegions(width, height) {
  const base = Math.floor(width / PASSPORT_PANEL_COUNT); const remainder = width - base * PASSPORT_PANEL_COUNT;
  return Object.freeze([
    Object.freeze({ view: 'FRONTAL', x: 0, y: 0, width: base, height }),
    Object.freeze({ view: 'THREE_QUARTER_45', x: base, y: 0, width: base, height }),
    Object.freeze({ view: 'PROFILE_90', x: base * 2, y: 0, width: base + remainder, height }),
  ]);
}

function analyzePassportCandidate({ width, height, observations = {}, profileDrift = false, evidence = {} } = {}) {
  let decoded = null; const geometryFailures = []; const geometryWarnings = [];
  try {
    decoded = geometry(width,height);
    if (decoded.orientation !== 'LANDSCAPE') geometryFailures.push('PASSPORT_NOT_HORIZONTAL');
    if (decoded.width < 900 || decoded.height < 300) geometryWarnings.push('PASSPORT_RESOLUTION_LOW');
    const panelAspect = (decoded.width / PASSPORT_PANEL_COUNT) / decoded.height;
    if (panelAspect < PASSPORT_OUTPUT.minimumPanelAspectRatio || panelAspect > PASSPORT_OUTPUT.maximumPanelAspectRatio) {
      geometryWarnings.push('PASSPORT_PANEL_GEOMETRY_UNUSUAL');
    }
  } catch (error) { geometryFailures.push('IMAGE_DIMENSIONS_INVALID'); }
  const continuity = validatePassportIdentityContinuity({ observations, profileDrift, evidence,
    noseChanged: observations.NOSE_CHANGED === true, jawChanged: observations.JAW_CHANGED === true,
    chinChanged: observations.CHIN_CHANGED === true, ageChanged: observations.AGE_CHANGED === true,
    hairChanged: observations.HAIR_CHANGED === true, hairlineChanged: observations.HAIRLINE_CHANGED === true,
    faceChanged: observations.FACE_CHANGED === true });
  const blockingFailures = [...new Set([...geometryFailures,...continuity.blockingFailures])];
  const warnings = [...new Set([...geometryWarnings,...continuity.warnings])];
  const status = blockingFailures.length ? 'REJECT' : warnings.length ? 'WARN' : 'PASS_FOR_REVIEW';
  return Object.freeze({ status, engine: continuity.engine, engineVersion: continuity.engineVersion,
    samePersonConfidence: continuity.samePersonConfidence, dimensions: decoded,
    panelRegions: decoded ? panelRegions(decoded.width,decoded.height) : [], checks: continuity.checks,
    warnings: Object.freeze(warnings), blockingFailures: Object.freeze(blockingFailures),
    reasoning: Object.freeze({ geometryContract: 'V2.10.2_REFERENCE_GEOMETRY', continuityContract: continuity.engine,
      profileScrutiny: continuity.profileScrutiny, humanCertificationRequired: true,
      localLimit: 'Deterministic local analysis cannot establish biometric identity; unmeasured identity dimensions require guided human review.' }) });
}

module.exports = { analyzePassportCandidate, panelRegions };
