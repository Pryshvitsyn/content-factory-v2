'use strict';

const SPOKEN_COPY_CONTRACT_VERSION = 'v2.8.1';

function cleanCopy(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSpokenCopy(value) {
  return cleanCopy(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function spokenTokens(value) {
  const normalized = normalizeSpokenCopy(value);
  return normalized ? normalized.split(' ') : [];
}

function semanticCopyEqual(left, right) {
  const a = spokenTokens(left);
  const b = spokenTokens(right);
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

function semanticSegmentsEqual(segments, copy) {
  const actual = (segments || []).flatMap(spokenTokens);
  const expected = spokenTokens(copy);
  return actual.length === expected.length && actual.every((token, index) => token === expected[index]);
}

function containsSemanticSegment(copy, segment) {
  const source = spokenTokens(copy);
  const expected = spokenTokens(segment);
  if (!expected.length) return false;
  return source.some((_, start) => expected.every((token, offset) => source[start + offset] === token));
}

function balancedChunks(copy, count) {
  const words = cleanCopy(copy).split(/\s+/u).filter(Boolean);
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * words.length) / count);
    const end = Math.floor(((index + 1) * words.length) / count);
    return words.slice(start, end).join(' ');
  });
}

function distributeDefaultCopy({ hook, coreMessage, cta, sceneCount }) {
  if (sceneCount === 1) return [[hook, coreMessage, cta].filter(Boolean).join(' ')];
  if (sceneCount === 2) {
    const [firstCore, secondCore] = balancedChunks(coreMessage, 2);
    return [
      [hook, firstCore].filter(Boolean).join(' '),
      [secondCore, cta].filter(Boolean).join(' '),
    ];
  }
  if (sceneCount === 3) return [hook, coreMessage, cta].map(cleanCopy);
  return [cleanCopy(hook), ...balancedChunks(coreMessage, sceneCount - 2), cleanCopy(cta)];
}

function createSpokenCopyPlan({ hook, coreMessage, cta, explicitVoiceover = null, sceneCount }) {
  if (!Number.isInteger(sceneCount) || sceneCount < 1) throw new Error('sceneCount must be a positive integer');
  const suppliedVoiceover = cleanCopy(explicitVoiceover);
  const source = suppliedVoiceover ? 'explicit_operator_voiceover' : 'derived_editorial_sections';
  const approvedSpokenCopy = suppliedVoiceover || [hook, coreMessage, cta].map(cleanCopy).filter(Boolean).join(' ');
  const sceneSpokenCopy = suppliedVoiceover
    ? balancedChunks(approvedSpokenCopy, sceneCount)
    : distributeDefaultCopy({ hook, coreMessage, cta, sceneCount });
  if (!semanticSegmentsEqual(sceneSpokenCopy, approvedSpokenCopy)) {
    throw new Error('Spoken-copy distribution did not preserve the approved narrative');
  }
  return Object.freeze({
    contractVersion: SPOKEN_COPY_CONTRACT_VERSION,
    source,
    strictApprovedCopy: true,
    approvedSpokenCopy,
    sceneSpokenCopy: Object.freeze(sceneSpokenCopy),
  });
}

module.exports = {
  SPOKEN_COPY_CONTRACT_VERSION,
  containsSemanticSegment,
  createSpokenCopyPlan,
  normalizeSpokenCopy,
  semanticCopyEqual,
  semanticSegmentsEqual,
  spokenTokens,
};
