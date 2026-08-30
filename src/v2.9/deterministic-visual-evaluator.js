'use strict';

const { REASON_CODES, TIER_POLICIES, normalizeTier, qualityCheck, qualityResult } = require('./quality-contract');

const PANEL_EVALUATOR_VERSION = 'v2.10.1-temporal-panel-detector';
const DIVIDER_DARK_RATIO = 0.82;
const DIVIDER_POSITION_TOLERANCE = 0.03;
const DIVIDER_PERSISTENCE_FRACTION = 0.60;

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

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;
}

function normalizedCandidate({ group, values, orientation, frameIndex, frame }) {
  const length = values.length || 1;
  const span = values.slice(group.start, group.end + 1);
  return Object.freeze({
    orientation,
    frameIndex,
    frameRatio: frame?.ratio ?? null,
    timestampMs: frame?.timestampMs ?? null,
    analysisHash: frame?.analysisHash || null,
    start: group.start,
    end: group.end,
    normalizedCenter: Number((((group.start + group.end + 1) / 2) / length).toFixed(6)),
    normalizedThickness: Number(((group.end - group.start + 1) / length).toFixed(6)),
    strength: Number(average(span).toFixed(6)),
  });
}

function dividerCandidates(frames) {
  const candidates = [];
  frames.forEach((frame, frameIndex) => {
    const rows = frame.metrics?.rowDarkRatios || [];
    const columns = frame.metrics?.columnDarkRatios || [];
    groups(rows, (ratio) => ratio >= DIVIDER_DARK_RATIO).forEach((group) => candidates.push(normalizedCandidate({
      group, values: rows, orientation: 'horizontal', frameIndex, frame,
    })));
    groups(columns, (ratio) => ratio >= DIVIDER_DARK_RATIO).forEach((group) => candidates.push(normalizedCandidate({
      group, values: columns, orientation: 'vertical', frameIndex, frame,
    })));
  });
  return candidates;
}

function clusterCandidates(candidates, frameCount, tolerance = DIVIDER_POSITION_TOLERANCE) {
  const clusters = [];
  for (const candidate of [...candidates].sort((a, b) => a.normalizedCenter - b.normalizedCenter)) {
    const compatible = clusters
      .filter((cluster) => cluster.orientation === candidate.orientation
        && Math.abs(cluster.meanPosition - candidate.normalizedCenter) <= tolerance)
      .sort((a, b) => Math.abs(a.meanPosition - candidate.normalizedCenter)
        - Math.abs(b.meanPosition - candidate.normalizedCenter))[0];
    if (!compatible) {
      clusters.push({ orientation: candidate.orientation, items: [candidate], meanPosition: candidate.normalizedCenter });
      continue;
    }
    const existingIndex = compatible.items.findIndex((item) => item.frameIndex === candidate.frameIndex);
    if (existingIndex >= 0) {
      if (candidate.strength > compatible.items[existingIndex].strength) compatible.items[existingIndex] = candidate;
    } else compatible.items.push(candidate);
    compatible.meanPosition = average(compatible.items.map((item) => item.normalizedCenter));
  }
  return clusters.map((cluster) => {
    const positions = cluster.items.map((item) => item.normalizedCenter);
    const uniqueFrames = new Set(cluster.items.map((item) => item.frameIndex));
    return Object.freeze({
      orientation: cluster.orientation,
      frameCount: uniqueFrames.size,
      persistence: Number((uniqueFrames.size / Math.max(1, frameCount)).toFixed(6)),
      meanPosition: Number(average(positions).toFixed(6)),
      positionSpread: Number((Math.max(...positions) - Math.min(...positions)).toFixed(6)),
      meanThickness: Number(average(cluster.items.map((item) => item.normalizedThickness)).toFixed(6)),
      meanStrength: Number(average(cluster.items.map((item) => item.strength)).toFixed(6)),
      samples: Object.freeze(cluster.items),
    });
  });
}

function dividerEvidence(frames) {
  const candidates = dividerCandidates(frames);
  const clusters = clusterCandidates(candidates, frames.length);
  const minimumPersistentFrames = Math.max(3, Math.ceil(frames.length * DIVIDER_PERSISTENCE_FRACTION));
  const persistent = clusters.filter((cluster) => cluster.frameCount >= minimumPersistentFrames
    && cluster.positionSpread <= DIVIDER_POSITION_TOLERANCE);
  const horizontalPersistent = persistent.filter((cluster) => cluster.orientation === 'horizontal');
  const verticalPersistent = persistent.filter((cluster) => cluster.orientation === 'vertical');
  const contactSheet = horizontalPersistent.length >= 1 && verticalPersistent.length >= 1;
  const multiPanel = !contactSheet && (horizontalPersistent.length >= 2 || verticalPersistent.length >= 2);
  const split = !contactSheet && !multiPanel && persistent.length === 1;
  const classification = contactSheet ? 'CONTACT_SHEET'
    : multiPanel ? 'PERSISTENT_MULTI_PANEL'
      : split ? 'PERSISTENT_SPLIT_SCREEN'
        : candidates.length ? 'TRANSIENT_INTERNAL_DIVIDER' : 'NONE';
  const legacyRange = (cluster) => cluster?.samples?.[0]
    ? { start: cluster.samples[0].start, end: cluster.samples[0].end } : null;
  return Object.freeze({
    evaluatorVersion: PANEL_EVALUATOR_VERSION,
    classification,
    minimumPersistentFrames,
    totalFrames: frames.length,
    darkRatioThreshold: DIVIDER_DARK_RATIO,
    normalizedPositionTolerance: DIVIDER_POSITION_TOLERANCE,
    horizontal: Object.freeze(horizontalPersistent.map(legacyRange).filter(Boolean)),
    vertical: Object.freeze(verticalPersistent.map(legacyRange).filter(Boolean)),
    candidates: Object.freeze(candidates),
    clusters: Object.freeze(clusters),
    persistentClusters: Object.freeze(persistent),
  });
}

function panelCheckFromEvidence(dividers) {
  if (dividers.classification === 'CONTACT_SHEET') return qualityCheck({
    code: REASON_CODES.CONTACT_SHEET_DETECTED, status: 'FAIL', qualityClass: 'SOURCE_VISUAL', hardFailure: true,
    reason: 'Persistent horizontal and vertical internal dividers form a contact-sheet or grid layout.', evidence: dividers,
  });
  if (dividers.classification === 'PERSISTENT_MULTI_PANEL') return qualityCheck({
    code: REASON_CODES.TRIPTYCH_DETECTED, status: 'FAIL', qualityClass: 'SOURCE_VISUAL', hardFailure: true,
    reason: 'Multiple persistent internal dividers form a stable multi-panel layout.', evidence: dividers,
  });
  if (dividers.classification === 'PERSISTENT_SPLIT_SCREEN') return qualityCheck({
    code: REASON_CODES.PERSISTENT_SPLIT_SCREEN, status: 'FAIL', qualityClass: 'SOURCE_VISUAL', hardFailure: true,
    reason: 'A strong internal divider persists at a stable normalized position across representative frames.', evidence: dividers,
  });
  if (dividers.classification === 'TRANSIENT_INTERNAL_DIVIDER') return qualityCheck({
    code: REASON_CODES.TRANSIENT_INTERNAL_DIVIDER, status: 'WARN', qualityClass: 'SOURCE_VISUAL', hardFailure: false,
    reason: 'A dark internal line appears transiently or inconsistently and is insufficient by itself to prove split-screen content.', evidence: dividers,
  });
  return qualityCheck({
    code: REASON_CODES.MULTI_PANEL_COMPOSITION, status: 'PASS', qualityClass: 'SOURCE_VISUAL', hardFailure: false,
    reason: 'No persistent internal panel divider was detected across representative frames.', evidence: dividers,
  });
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

  checks.push(panelCheckFromEvidence(dividerEvidence(frames)));

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
  return qualityResult({ qualityClass: 'DETERMINISTIC_VISUAL', tier, checks,
    metadata: { evaluator: PANEL_EVALUATOR_VERSION } });
}

function deterministicTemporalChecks({ frames, qualityTier = 'STANDARD', motionExpected = true } = {}) {
  const tier = normalizeTier(qualityTier); const differences = frames.map((frame) => frame.differenceFromPrevious).filter(Number.isFinite);
  const averageDifference = differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : 0;
  const threshold = TIER_POLICIES[tier].staticMeanDifference;
  const staticFailure = motionExpected && differences.length > 0 && averageDifference < threshold;
  const luminanceChanges = frames.slice(1).map((frame, index) => Math.abs(frame.metrics.mean - frames[index].metrics.mean));
  const flickerThreshold = { ECONOMY: 55, STANDARD: 42, PREMIUM: 32 }[tier];
  const severeFlicker = luminanceChanges.filter((value) => value >= flickerThreshold).length >= 2;
  const checks = [qualityCheck({ code: REASON_CODES.EXCESSIVE_STATIC_CONTENT, status: staticFailure ? 'FAIL' : 'PASS',
    qualityClass: 'TEMPORAL_QUALITY', hardFailure: false,
    reason: staticFailure ? 'Representative frames change too little for the requested moving shot.' : 'Sample-to-sample change is consistent with non-frozen content.',
    evidence: { meanAbsoluteDifferences: differences, average: Number(averageDifference.toFixed(3)), threshold, motionExpected } }),
  qualityCheck({ code: REASON_CODES.TEMPORAL_FLICKER, status: severeFlicker ? 'FAIL' : 'PASS',
    qualityClass: 'TEMPORAL_QUALITY', hardFailure: false,
    reason: severeFlicker ? 'Repeated severe whole-frame luminance changes indicate possible temporal flicker.'
      : 'No repeated severe whole-frame luminance changes were detected in representative samples.',
    evidence: { luminanceChanges: luminanceChanges.map((value) => Number(value.toFixed(3))), threshold: flickerThreshold } })];
  return qualityResult({ qualityClass: 'TEMPORAL_QUALITY', tier, checks, metadata: { evaluator: 'v2.9-deterministic-temporal' } });
}

module.exports = {
  DIVIDER_DARK_RATIO,
  DIVIDER_PERSISTENCE_FRACTION,
  DIVIDER_POSITION_TOLERANCE,
  PANEL_EVALUATOR_VERSION,
  clusterCandidates,
  deterministicTemporalChecks,
  deterministicVisualChecks,
  dividerCandidates,
  dividerEvidence,
  groups,
  panelCheckFromEvidence,
};
