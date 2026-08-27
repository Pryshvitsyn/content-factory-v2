'use strict';

const { REASON_CODES, TIER_POLICIES, normalizeTier, qualityCheck, qualityResult } = require('./quality-contract');

function groups(values, predicate, edgeFraction = 0.08) {
  const start = Math.floor(values.length * edgeFraction);
  const end = Math.ceil(values.length * (1 - edgeFraction));
  const result = []; let active = null;
  for (let index = start; index < end; index += 1) {
    if (predicate(values[index])) { if (!active) active = { start: index, end: index }; else active.end = index; }
    else if (active) { result.push(active); active = null; }
  }
  if (active) result.push(active);
  return result;
}

function dividerEvidence(frames) {
  let horizontal = []; let vertical = [];
  for (const frame of frames) {
    const rows = groups(frame.metrics.rowDarkRatios, (ratio) => ratio >= 0.82);
    const columns = groups(frame.metrics.columnDarkRatios, (ratio) => ratio >= 0.82);
    if (rows.length > horizontal.length) horizontal = rows;
    if (columns.length > vertical.length) vertical = columns;
  }
  return { horizontal, vertical };
}

function deterministicVisualChecks({ frames, probe, expectedAspectRatio = '9:16', qualityTier = 'STANDARD' } = {}) {
  const tier = normalizeTier(qualityTier); const policy = TIER_POLICIES[tier]; const checks = [];
  const shortEdge = Math.min(Number(probe?.width || 0), Number(probe?.height || 0));
  checks.push(qualityCheck({ code: 'SOURCE_MEDIA_READABLE', status: 'PASS', qualityClass: 'SOURCE_TECHNICAL',
    reason: 'The immutable source decoded into deterministic timestamp samples.', evidence: { sampleCount: frames.length } }));
  checks.push(qualityCheck({ code: REASON_CODES.SOURCE_RESOLUTION_BELOW_POLICY,
    status: shortEdge >= policy.minimumShortEdge ? 'PASS' : tier === 'ECONOMY' ? 'WARN' : 'FAIL',
    qualityClass: 'SOURCE_VISUAL', hardFailure: false,
    reason: shortEdge >= policy.minimumShortEdge ? 'Source resolution meets the selected tier policy.'
      : `Source short edge ${shortEdge}px is below the ${tier} policy minimum of ${policy.minimumShortEdge}px.`,
    evidence: { width: probe?.width, height: probe?.height, minimumShortEdge: policy.minimumShortEdge } }));
  const portraitExpected = expectedAspectRatio === '9:16';
  const orientationMatches = portraitExpected ? probe?.height > probe?.width : probe?.width > probe?.height;
  checks.push(qualityCheck({ code: REASON_CODES.WRONG_ORIENTATION, status: orientationMatches ? 'PASS' : 'FAIL',
    qualityClass: 'SOURCE_TECHNICAL', reason: orientationMatches ? 'Source orientation matches the creative plan.' : 'Source orientation does not match the creative plan.',
    evidence: { expectedAspectRatio, width: probe?.width, height: probe?.height } }));

  const black = frames.filter((frame) => frame.metrics.mean <= policy.blackMean);
  const blank = frames.filter((frame) => frame.metrics.standardDeviation <= policy.blankStandardDeviation);
  checks.push(qualityCheck({ code: REASON_CODES.BLACK_FRAME, status: black.length ? 'FAIL' : 'PASS', qualityClass: 'SOURCE_VISUAL',
    reason: black.length ? 'One or more representative frames are substantially black.' : 'No representative black frames were detected.',
    evidence: { timestampsMs: black.map((frame) => frame.timestampMs), thresholdMean: policy.blackMean } }));
  checks.push(qualityCheck({ code: REASON_CODES.BLANK_FRAME, status: blank.length ? 'FAIL' : 'PASS', qualityClass: 'SOURCE_VISUAL',
    reason: blank.length ? 'One or more representative frames are visually blank or near-uniform.' : 'No representative blank frames were detected.',
    evidence: { timestampsMs: blank.map((frame) => frame.timestampMs), thresholdStandardDeviation: policy.blankStandardDeviation } }));

  const dividers = dividerEvidence(frames);
  const triptych = dividers.horizontal.length >= 2 || dividers.vertical.length >= 2;
  const split = !triptych && (dividers.horizontal.length === 1 || dividers.vertical.length === 1);
  const contactSheet = dividers.horizontal.length >= 1 && dividers.vertical.length >= 1;
  const panelCode = contactSheet ? REASON_CODES.CONTACT_SHEET_DETECTED
    : triptych ? REASON_CODES.TRIPTYCH_DETECTED : split ? REASON_CODES.SPLIT_SCREEN_DETECTED : REASON_CODES.MULTI_PANEL_COMPOSITION;
  checks.push(qualityCheck({ code: panelCode, status: (triptych || split || contactSheet) ? 'FAIL' : 'PASS', qualityClass: 'SOURCE_VISUAL',
    reason: contactSheet ? 'A grid/contact-sheet structure was detected.' : triptych ? 'Multiple strong internal dividers form a triptych or multi-panel layout.'
      : split ? 'A strong internal divider forms a split-screen layout.' : 'No strong deterministic panel divider was detected.',
    hardFailure: triptych || contactSheet,
    evidence: dividers }));

  const edgeBorderFrames = frames.filter((frame) => {
    const rows = frame.metrics.rowDarkRatios; const cols = frame.metrics.columnDarkRatios;
    const edge = Math.max(1, Math.floor(Math.min(rows.length, cols.length) * 0.04));
    return rows.slice(0, edge).some((value) => value > 0.9) || rows.slice(-edge).some((value) => value > 0.9)
      || cols.slice(0, edge).some((value) => value > 0.9) || cols.slice(-edge).some((value) => value > 0.9);
  });
  checks.push(qualityCheck({ code: REASON_CODES.LARGE_UNINTENDED_BORDER, status: edgeBorderFrames.length >= Math.ceil(frames.length / 2) ? 'WARN' : 'PASS',
    qualityClass: 'SOURCE_VISUAL', hardFailure: false,
    reason: edgeBorderFrames.length >= Math.ceil(frames.length / 2) ? 'Persistent dark outer borders may indicate unintended matte content.' : 'No persistent large outer border was detected.',
    evidence: { timestampsMs: edgeBorderFrames.map((frame) => frame.timestampMs) } }));
  return qualityResult({ qualityClass: 'DETERMINISTIC_VISUAL', tier, checks, metadata: { evaluator: 'v2.9-deterministic-visual' } });
}

function deterministicTemporalChecks({ frames, qualityTier = 'STANDARD', motionExpected = true } = {}) {
  const tier = normalizeTier(qualityTier); const differences = frames.map((frame) => frame.differenceFromPrevious).filter(Number.isFinite);
  const average = differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : 0;
  const threshold = TIER_POLICIES[tier].staticMeanDifference;
  const staticFailure = motionExpected && differences.length > 0 && average < threshold;
  const luminanceChanges = frames.slice(1).map((frame, index) => Math.abs(frame.metrics.mean - frames[index].metrics.mean));
  const flickerThreshold = { ECONOMY: 55, STANDARD: 42, PREMIUM: 32 }[tier];
  const severeFlicker = luminanceChanges.filter((value) => value >= flickerThreshold).length >= 2;
  const checks = [qualityCheck({ code: REASON_CODES.EXCESSIVE_STATIC_CONTENT, status: staticFailure ? 'FAIL' : 'PASS',
    qualityClass: 'TEMPORAL_QUALITY', hardFailure: false,
    reason: staticFailure ? 'Representative frames change too little for the requested moving shot.' : 'Sample-to-sample change is consistent with non-frozen content.',
    evidence: { meanAbsoluteDifferences: differences, average: Number(average.toFixed(3)), threshold, motionExpected } }),
  qualityCheck({ code: REASON_CODES.TEMPORAL_FLICKER, status: severeFlicker ? 'FAIL' : 'PASS',
    qualityClass: 'TEMPORAL_QUALITY', hardFailure: false,
    reason: severeFlicker ? 'Repeated severe whole-frame luminance changes indicate possible temporal flicker.'
      : 'No repeated severe whole-frame luminance changes were detected in representative samples.',
    evidence: { luminanceChanges: luminanceChanges.map((value) => Number(value.toFixed(3))), threshold: flickerThreshold } })];
  return qualityResult({ qualityClass: 'TEMPORAL_QUALITY', tier, checks, metadata: { evaluator: 'v2.9-deterministic-temporal' } });
}

module.exports = { deterministicTemporalChecks, deterministicVisualChecks, dividerEvidence, groups };
