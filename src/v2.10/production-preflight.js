'use strict';

const { canonicalCreativeBrief, fingerprint } = require('./creative-contract');
const { validateCreativeCompleteness } = require('./creative-completeness');
const { validateContinuity } = require('./continuity-contract');
const { validateConsent, validateVoiceTiming } = require('./voice-studio');

function buildProductionPreflight({ brief: input, video = {}, quality = {}, master = {}, timingToleranceSeconds = 0 } = {}) {
  const brief = canonicalCreativeBrief(input);
  const creative = validateCreativeCompleteness(brief);
  const continuity = validateContinuity(brief, video);
  const voiceEnabled = brief.storyboard.some((shot) => shot.voiceoverSegment || shot.dialogue) || Boolean(brief.voice.sourceType);
  const approvedSpokenCopy = brief.storyboard.flatMap((shot) => [shot.dialogue, shot.voiceoverSegment]).filter(Boolean).join(' ').trim();
  const voiceTiming = voiceEnabled ? validateVoiceTiming({ voice: brief.voice, targetDurationSeconds: brief.targetDurationSeconds,
    availableDurationSeconds: master.availableVoiceDurationSeconds ?? brief.targetDurationSeconds, toleranceSeconds: timingToleranceSeconds })
    : { status: 'READY', checks: [], durationSeconds: 0 };
  const consent = validateConsent(brief.voice);
  const calls = {
    video: brief.storyboard.length,
    speech: voiceEnabled && brief.voice.sourceType !== 'UPLOADED_AUDIO' ? 1 : 0,
    semantic: Number(quality.semanticCalls || 0), otherEvaluator: Number(quality.otherEvaluatorCalls || 0),
  };
  calls.maximum = calls.video + calls.speech + calls.semantic + calls.otherEvaluator;
  const blockers = [];
  if (creative.status === 'FAIL') blockers.push('CREATIVE_COMPLETENESS_FAILED');
  if (continuity.status === 'BLOCKED') blockers.push('CONTINUITY_UNSUPPORTED');
  if (voiceTiming.status === 'BLOCKED') blockers.push('VOICE_NOT_READY');
  if (voiceEnabled && !approvedSpokenCopy) blockers.push('VOICE_SPOKEN_COPY_MISSING');
  if (consent.status === 'FAIL') blockers.push('VOICE_CONSENT_REQUIRED');
  if (!video.provider || !video.model || !video.profile) blockers.push('VIDEO_SELECTION_INCOMPLETE');
  const fingerprintInput = { brief, video, quality, master, timingToleranceSeconds };
  const result = {
    schemaVersion: '2.10', status: blockers.length ? 'BLOCKED' : 'READY', blockers,
    creative: { storyboardShots: brief.storyboard.length, completeness: creative.status,
      storyArc: creative.checks.find((check) => check.name === 'STORY_ARC')?.status, continuity: continuity.status },
    video: { provider: video.provider || null, modelFamily: video.modelFamily || null, model: video.model || null,
      profile: video.profile || null, capability: video.capability || null, resolution: video.resolution || null,
      numberOfGenerations: calls.video },
    voice: { sourceType: brief.voice.sourceType, provider: brief.voice.provider, model: brief.voice.model,
      voiceId: brief.voice.voiceId, uploadedArtifactId: brief.voice.uploadedArtifactId,
      previewApproved: brief.voice.approved, approvedSpokenCopy, expectedTtsCalls: calls.speech, timing: voiceTiming },
    quality: { semanticCritic: quality.semanticCritic || 'NONE', expectedSemanticCalls: calls.semantic },
    master: { profile: master.profile || null, resolution: master.resolution || null, fps: master.fps || null,
      durationSeconds: brief.targetDurationSeconds, audioStrategy: master.audioStrategy || null },
    externalCalls: calls, knownCost: video.knownCost ?? null, costStatus: video.knownCost == null ? 'UNKNOWN' : 'KNOWN',
    humanApprovalRequired: true, autoPublish: false,
  };
  result.fingerprint = fingerprint(fingerprintInput);
  return Object.freeze(result);
}

function assertStartAllowed({ preflight, currentInput, confirmed }) {
  if (!confirmed) throw Object.assign(new Error('Explicit START PRODUCTION confirmation is required'), { code: 'EXPLICIT_CONFIRMATION_REQUIRED' });
  if (!preflight || preflight.status !== 'READY') throw Object.assign(new Error('A READY final production preflight is required'), { code: 'PREFLIGHT_BLOCKED' });
  const current = buildProductionPreflight(currentInput);
  if (current.fingerprint !== preflight.fingerprint) throw Object.assign(new Error('Production input changed after preflight'), { code: 'STALE_PREFLIGHT' });
  return true;
}

module.exports = { assertStartAllowed, buildProductionPreflight };
