'use strict';

const { canonicalCreativeBrief, fingerprint } = require('./creative-contract');
const { validateCreativeCompleteness } = require('./creative-completeness');
const { validateContinuity } = require('./continuity-contract');
const { validateConsent, validateVoiceTiming } = require('./voice-studio');
const { estimateMediaStack } = require('../v2.9.2/pricing-registry');

function buildProductionPreflight({ brief: input, authoritativeVideo = {}, voiceRuntime = {}, quality = {}, master = {},
  canonicalPlan = null, canonicalInputFingerprint = null, workflowAuthority = null, timingToleranceSeconds = 0 } = {}) {
  const brief = canonicalCreativeBrief(input);
  const creative = validateCreativeCompleteness(brief);
  const continuity = validateContinuity(brief, authoritativeVideo);
  const voiceEnabled = brief.storyboard.some((shot) => shot.voiceoverSegment || shot.dialogue) || Boolean(brief.voice.sourceType);
  const approvedSpokenCopy = brief.storyboard.flatMap((shot) => [shot.dialogue, shot.voiceoverSegment]).filter(Boolean).join(' ').trim();
  const voiceTiming = voiceEnabled ? validateVoiceTiming({ voice: brief.voice, targetDurationSeconds: brief.targetDurationSeconds,
    availableDurationSeconds: master.availableVoiceDurationSeconds ?? brief.targetDurationSeconds, toleranceSeconds: timingToleranceSeconds })
    : { status: 'READY', checks: [], durationSeconds: 0 };
  const consent = validateConsent(brief.voice);
  const plan = canonicalPlan || {};
  const videoCalls = Number(plan.expectedVideoGenerations ?? brief.storyboard.length);
  const speechCalls = Number(plan.expectedAudioGenerations ?? (voiceEnabled && brief.voice.sourceType !== 'UPLOADED_AUDIO' ? 1 : 0));
  const semanticCalls = Number(plan.expectedSemanticEvaluationCalls ?? plan.expectedQualityEvaluatorCalls ?? quality.semanticCalls ?? 0);
  const otherEvaluatorCalls = Number(plan.expectedContinuityEvaluationCalls ?? quality.otherEvaluatorCalls ?? 0);
  const calls = { video: videoCalls, speech: speechCalls, semantic: semanticCalls, otherEvaluator: otherEvaluatorCalls };
  calls.maximum = calls.video + calls.speech + calls.semantic + calls.otherEvaluator;
  const blockers = [];
  if (creative.status === 'FAIL') blockers.push('CREATIVE_COMPLETENESS_FAILED');
  if (continuity.status === 'BLOCKED') blockers.push('CONTINUITY_UNSUPPORTED');
  if (voiceTiming.status === 'BLOCKED') blockers.push('VOICE_NOT_READY');
  if (voiceEnabled && !approvedSpokenCopy) blockers.push('VOICE_SPOKEN_COPY_MISSING');
  if (consent.status === 'FAIL') blockers.push('VOICE_CONSENT_REQUIRED');
  if (!authoritativeVideo.provider || !authoritativeVideo.model || !authoritativeVideo.profile
    || authoritativeVideo.configurationStatus !== 'CONFIGURED') blockers.push('VIDEO_SELECTION_INCOMPLETE');
  if (voiceRuntime.status === 'BLOCKED') blockers.push(voiceRuntime.code || 'VOICE_RUNTIME_NOT_READY');
  if (authoritativeVideo.continuityAuthorityStatus === 'BLOCKED') blockers.push(...authoritativeVideo.continuityAuthorityBlockers.map((item)=>item.code));
  if (plan.readiness === 'BLOCKED') blockers.push('CANONICAL_RUNTIME_BLOCKED');
  if (authoritativeVideo.modelContractVersion && authoritativeVideo.modelPricing?.status === 'UNKNOWN_CURRENT_PRICE') blockers.push('PRICE_NOT_VERIFIABLE');
  if (voiceEnabled && authoritativeVideo.shotModelRequests?.some((shot) => shot.modelRequest?.generateAudio === true)) blockers.push('AUDIO_OWNERSHIP_CONFLICT');
  const authoritative = {
    provider: authoritativeVideo.provider || null, providerDisplayName: authoritativeVideo.providerDisplayName || null,
    providerType: authoritativeVideo.providerType || null, vendor: authoritativeVideo.vendor || null,
    modelFamily: authoritativeVideo.modelFamily || null, model: authoritativeVideo.model || null,
    providerModelId: authoritativeVideo.providerModelId || authoritativeVideo.model || null,
    modelVersion: authoritativeVideo.modelVersion || null, adapterFamily: authoritativeVideo.adapterFamily || null,
    profile: authoritativeVideo.profile || null, capability: authoritativeVideo.capability || null,
    capabilities: [...(authoritativeVideo.capabilities || [])], shotCapabilities: [...(authoritativeVideo.shotCapabilities || [])],
    resolvedSettings: { ...(authoritativeVideo.resolvedSettings || {}) }, configurationStatus: authoritativeVideo.configurationStatus || null,
    availability: authoritativeVideo.availability || null, costStatus: authoritativeVideo.costStatus || 'UNKNOWN',
    experimental: authoritativeVideo.experimental === true,
    modelContractVersion: authoritativeVideo.modelContractVersion || null,
    modelSchemaVersion: authoritativeVideo.modelSchemaVersion || null,
    modelPricing: authoritativeVideo.modelPricing || null,
    shotModelRequests: [...(authoritativeVideo.shotModelRequests || [])],
    continuityAuthorityStatus:authoritativeVideo.continuityAuthorityStatus||'READY',
    continuityAuthorityBlockers:[...(authoritativeVideo.continuityAuthorityBlockers||[])],
    resolvedContinuityBindings:[...(authoritativeVideo.resolvedContinuityBindings||[])],
  };
  const masterResolved = { profile: master.profile || plan.masterAssemblyMode || 'SOCIAL_VERTICAL',
    resolution: master.resolution || '1080x1920', fps: Number(master.fps || 30), durationSeconds: brief.targetDurationSeconds,
    audioStrategy: master.audioStrategy || brief.voice.sourceType || 'NO_VOICE' };
  const semanticResolved = quality.semanticCriticResolved || { provider: plan.semanticEvaluatorProvider || null,
    model: plan.semanticEvaluatorModel || null };
  const pricing = estimateMediaStack({
    video: authoritative.provider && authoritative.model ? {
      provider: authoritative.provider, model: authoritative.model,
      resolution: authoritative.resolvedSettings?.resolution || authoritativeVideo.resolution || null,
      durationSeconds: brief.storyboard.reduce((sum, shot) => sum + Number(shot.durationSeconds || 0), 0), count: 1,
    } : null,
    voice: calls.speech > 0 ? {
      provider: brief.voice.provider || voiceRuntime.provider || null,
      model: brief.voice.model || voiceRuntime.model || null,
      characterCount: approvedSpokenCopy.length, count: calls.speech,
    } : null,
    semantic: (calls.semantic + calls.otherEvaluator) > 0 ? {
      provider: semanticResolved.provider || null, model: semanticResolved.model || null,
      count: calls.semantic + calls.otherEvaluator,
    } : null,
    master: { profile: masterResolved.profile },
  });
  const result = {
    schemaVersion: '2.10', status: blockers.length ? 'BLOCKED' : 'READY', blockers,
    creative: { storyboardShots: brief.storyboard.length, completeness: creative.status,
      storyArc: creative.checks.find((check) => check.name === 'STORY_ARC')?.status, continuity: continuity.status,
      checks: creative.checks },
    video: { ...authoritative, numberOfGenerations: calls.video },
    authoritativeVideo: authoritative,
    voice: { sourceType: brief.voice.sourceType, provider: brief.voice.provider, model: brief.voice.model,
      voiceId: brief.voice.voiceId, uploadedArtifactId: brief.voice.uploadedArtifactId,
      previewApproved: brief.voice.approved, approvedSpokenCopy, expectedTtsCalls: calls.speech,
      timing: voiceTiming, runtime: voiceRuntime },
    quality: { semanticCritic: quality.semanticCritic || plan.semanticEvaluatorModel || 'NONE',
      semanticCriticResolved: semanticResolved, expectedSemanticCalls: calls.semantic,
      expectedContinuityEvaluatorCalls: calls.otherEvaluator },
    master: masterResolved, externalCalls: calls,
    pricing,
    knownCost: pricing.estimatedTotalUsd,
    knownCostSubtotal: pricing.knownSubtotalUsd,
    costStatus: pricing.status,
    videoCostStatus: authoritative.costStatus,
    costNote: pricing.status === 'UNKNOWN'
      ? 'Total cost is not fully encoded. Known subtotal excludes UNKNOWN voice/evaluator components.'
      : 'Total estimated cost is fully encoded by the pricing registry.',
    canonicalInputFingerprint: canonicalInputFingerprint || null,
    canonicalReadiness: plan.readiness || null,
    workflowAuthority: workflowAuthority || null,
    operationPlans: workflowAuthority?.operationPlans || [],
    humanApprovalRequired: true, autoPublish: false,
  };
  result.fingerprint = fingerprint({ brief, authoritativeVideo: authoritative, voiceRuntime, quality: result.quality,
    master: masterResolved, timingToleranceSeconds, canonicalInputFingerprint: result.canonicalInputFingerprint,
    canonicalReadiness: result.canonicalReadiness, workflowAuthority: result.workflowAuthority,
    operationPlans: result.operationPlans });
  return Object.freeze(result);
}

function assertStartAllowed({ preflight, currentPreflight, confirmed }) {
  if (!confirmed) throw Object.assign(new Error('Explicit START PRODUCTION confirmation is required'), { code: 'EXPLICIT_CONFIRMATION_REQUIRED' });
  if (!preflight || preflight.status !== 'READY') throw Object.assign(new Error('A READY final production preflight is required'), { code: 'PREFLIGHT_BLOCKED' });
  if (!currentPreflight || currentPreflight.status !== 'READY' || currentPreflight.fingerprint !== preflight.fingerprint) {
    throw Object.assign(new Error('Authoritative production input changed after preflight'), { code: 'STALE_PREFLIGHT' });
  }
  return true;
}

module.exports = { assertStartAllowed, buildProductionPreflight };
