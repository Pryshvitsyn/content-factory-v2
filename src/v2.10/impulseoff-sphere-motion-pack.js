'use strict';

const crypto = require('node:crypto');

const IMPULSEOFF_SPHERE_BRAND = 'ImpulseOff';
const IMPULSEOFF_SPHERE_ASSETS = Object.freeze({
  brand: Object.freeze({ file: 'impulseoff.mp4', sha256: 'f81d5658a60548171a36be7e1084cbac4e24e759873d1c31d1ed02999329839d', role: 'BRAND_SPHERE' }),
  idle: Object.freeze({ file: 'idle_loop.mp4', sha256: '126bc915c36cbb6759bd12cbe08735a1d61770e4e0dd1e4f129970a1bc13e642', role: 'IDLE_LOOP' }),
  idleToTrigger: Object.freeze({ file: 'idle_to_trigger.mp4', sha256: 'ac38fb708321c8fcf04328ad0254899dddd85b58df6b993e9ff59fa302c29f08', role: 'IDLE_TO_TRIGGER_REFERENCE' }),
  trigger: Object.freeze({ file: 'trigger_loop.mp4', sha256: 'b1c6d46c86d18dd252f1e63344844970ac57f8db3d53cac8b89922beef034ac9', role: 'TRIGGER_LOOP' }),
  triggerToHold: Object.freeze({ file: 'trigger_to_hold.mp4', sha256: '86dc9f033920e3ba1e07bf47b969e39ee08acd139d6d62f60cdcc0add4f41c88', role: 'TRIGGER_TO_HOLD_REFERENCE' }),
  hold: Object.freeze({ file: 'hold_loop.mp4', sha256: '64b7b0856640c238244e1924262af0d8559ecd4cd8f00ee5f4d9968e708e8a08', role: 'HOLD_LOOP' }),
});

const SPHERE_VISUAL_LOCK = Object.freeze({
  objectCount: 1,
  framing: 'SINGLE_CENTERED_SPHERE',
  camera: 'FIXED',
  background: 'DARK_STABLE',
  shell: 'SOFT_GLASS_MEMBRANE',
  internalMotion: 'SMOOTH_ORGANIC_FLUID_MASSES',
  mustKeep: Object.freeze([
    'same living sphere identity',
    'same sphere geometry and scale',
    'same centered composition',
    'same dark background',
    'same fixed camera and lighting language',
    'soft glass-like membrane shell',
    'organic continuous internal motion',
  ]),
  forbidden: Object.freeze([
    'split screen', 'triptych', 'collage', 'multiple panels', 'multiple spheres', 'multiple simultaneous scenes',
    'generated text', 'pseudo-text', 'letters', 'symbols', 'logo', 'watermark', 'UI overlay',
    'hard cut', 'camera orbit', 'environment change', 'subject substitution', 'identity drift',
    'visible technical lines', 'polar caps', 'poles', 'photographic-negative inversion', 'outer halo', 'white outer ring',
  ]),
});

const TRANSITIONS = Object.freeze({
  IDLE_TO_TRIGGER: Object.freeze({
    id: 'idle_to_trigger', status: 'READY_FOR_PILOT', durationSeconds: 5,
    startState: 'IDLE', endState: 'TRIGGER', referenceAsset: 'idle', comparisonAsset: 'idleToTrigger',
    start: 'The approved calm icy-white/pale-blue ImpulseOff IDLE sphere, almost-still shell, subtle living internal motion.',
    action: 'Activation originates inside the same sphere. Internal motion accelerates continuously and green/emerald energy spreads through the existing fluid mass without a cut, flash, replacement object, or hard morph.',
    end: 'The same sphere reaches the approved TRIGGER language: saturated dirty/emerald green, faster internal motion, increased activation and density, same soft shell, same background and camera.',
  }),
  TRIGGER_TO_HOLD: Object.freeze({
    id: 'trigger_to_hold', status: 'LOCKED_REFERENCE_AVAILABLE', durationSeconds: 5,
    startState: 'TRIGGER', endState: 'HOLD', referenceAsset: 'trigger', comparisonAsset: 'triggerToHold',
    start: 'The approved activated emerald-green ImpulseOff TRIGGER sphere.',
    action: 'Energy becomes denser and contained while green resolves toward natural deep purple with true black depth. The transition is relatively fast but remains one continuous object.',
    end: 'The same soft-shell sphere reaches HOLD: natural dark purple, true black depth, no red/pink cast, no halo, no poles, no inversion.',
  }),
  HOLD_TO_RELEASE: Object.freeze({
    id: 'hold_to_release', status: 'BLOCKED_REFERENCE_NOT_APPROVED', durationSeconds: 5,
    startState: 'HOLD', endState: 'RELEASE_IDLE', referenceAsset: 'hold', comparisonAsset: null,
    start: 'The approved HOLD sphere.',
    action: 'Reserved for the future approved RELEASE / return-to-IDLE motion.',
    end: 'RELEASE / IDLE.',
    blocker: 'No separately approved RELEASE visual master exists. Do not substitute archived HOLD_TO_RELAX terminology or invent a new state.',
  }),
});

function negativeGuidance() {
  return `Reject or avoid: ${SPHERE_VISUAL_LOCK.forbidden.join(', ')}. One scene, one centered sphere, one fixed camera. No text of any kind.`;
}

function generationPrompt(transition = TRANSITIONS.IDLE_TO_TRIGGER) {
  return [
    'IMPULSEOFF CONSISTENT SPHERE MOTION ASSET.',
    `START STATE: ${transition.start}`,
    `ACTION: ${transition.action}`,
    `INTENDED END STATE: ${transition.end}`,
    `MUST KEEP: ${SPHERE_VISUAL_LOCK.mustKeep.join('; ')}.`,
    'Portrait 9:16. One continuous shot. Preserve exact sphere identity and material. No creative scene variation.',
  ].join('\n');
}

function buildIdleToTriggerPilot({ referenceArtifact } = {}) {
  if (!referenceArtifact?.storageKey || !referenceArtifact?.contentHash) {
    const error = new Error('A verified immutable IDLE sphere reference artifact is required before pilot generation');
    error.code = 'SPHERE_MASTER_REFERENCE_REQUIRED';
    throw error;
  }
  return Object.freeze({
    brand: IMPULSEOFF_SPHERE_BRAND,
    productionType: 'CONSISTENT_MOTION_ASSET_SERIES',
    pilotOnly: true,
    remainingProductionScheduled: false,
    asset_id: 'sphere-idle-to-trigger-pilot',
    kind: 'video',
    purpose: 'Generate exactly one real IDLE → TRIGGER consistency pilot.',
    generation_prompt: generationPrompt(TRANSITIONS.IDLE_TO_TRIGGER),
    negative_guidance: negativeGuidance(),
    generation_requirements: Object.freeze({
      capability: 'IMAGE_TO_VIDEO', profile: 'STANDARD', resolution: '720p', aspect_ratio: '9:16', duration: 5,
      audio: Object.freeze({ requested: false }),
      v210_reference: Object.freeze({
        policy: 'UPLOADED_VIDEO_FRAME', capability: 'IMAGE_TO_VIDEO',
        artifact: Object.freeze({ ...referenceArtifact, contentType: referenceArtifact.contentType || 'video/mp4' }),
      }),
      sphereIdentityLock: SPHERE_VISUAL_LOCK,
      expectedHistoricalFailureChecks: Object.freeze([
        'NO_SPLIT_SCREEN_OR_TRIPTYCH', 'NO_MULTIPLE_SCENES_OR_PANELS', 'NO_BROKEN_VISUAL_QUALITY', 'NO_PSEUDO_TEXT',
      ]),
    }),
  });
}

function spherePilotPreflightProjection({ semanticCalls = 1 } = {}) {
  return Object.freeze({
    provider: 'replicate', model: 'alibaba/wan-3', capability: 'IMAGE_TO_VIDEO', profile: 'STANDARD',
    resolution: '720p', aspectRatio: '9:16', durationSeconds: 5,
    expectedVideoGenerations: 1, expectedAudioGenerations: 0,
    expectedSemanticEvaluationCalls: Number(semanticCalls), expectedContinuityEvaluationCalls: 0,
    maximumExternalCalls: 1 + Number(semanticCalls), videoKnownCostUsd: 0.50,
    totalCostStatus: semanticCalls > 0 ? 'UNKNOWN' : 'VERIFIED',
    reason: semanticCalls > 0 ? 'Video pricing is verified; semantic evaluator pricing is not fully encoded.' : 'Only verified Wan 3 video pricing applies.',
    autoRegeneration: false, remainingProductionScheduled: false, humanApprovalRequired: true, autoPublish: false,
  });
}

function verifyKnownAssetBytes(assetKey, bytes) {
  const expected = IMPULSEOFF_SPHERE_ASSETS[assetKey];
  if (!expected) throw new Error(`Unknown ImpulseOff sphere asset key: ${assetKey}`);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  return Object.freeze({ key: assetKey, file: expected.file, expectedSha256: expected.sha256, actualSha256: actual,
    status: actual === expected.sha256 ? 'VERIFIED' : 'HASH_MISMATCH' });
}

module.exports = {
  IMPULSEOFF_SPHERE_ASSETS,
  IMPULSEOFF_SPHERE_BRAND,
  SPHERE_VISUAL_LOCK,
  TRANSITIONS,
  buildIdleToTriggerPilot,
  generationPrompt,
  negativeGuidance,
  spherePilotPreflightProjection,
  verifyKnownAssetBytes,
};
