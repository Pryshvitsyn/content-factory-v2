'use strict';

const assert = require('node:assert/strict');
const {
  IMPULSEOFF_SPHERE_ASSETS,
  SPHERE_VISUAL_LOCK,
  TRANSITIONS,
  buildIdleToTriggerPilot,
  generationPrompt,
  negativeGuidance,
  spherePilotPreflightProjection,
} = require('../src/v2.10/impulseoff-sphere-motion-pack');
const {
  buildVoiceEnvelope,
  buildVoiceReactiveFfmpegArgs,
  buildVoiceReactiveFilter,
} = require('../src/v2.10/sphere-voice-reactive-renderer');

function contractTests() {
  assert.equal(Object.keys(IMPULSEOFF_SPHERE_ASSETS).length, 6);
  assert.equal(IMPULSEOFF_SPHERE_ASSETS.idle.file, 'idle_loop.mp4');
  assert.equal(IMPULSEOFF_SPHERE_ASSETS.idle.sha256, '126bc915c36cbb6759bd12cbe08735a1d61770e4e0dd1e4f129970a1bc13e642');
  assert.equal(IMPULSEOFF_SPHERE_ASSETS.triggerToHold.sha256, '86dc9f033920e3ba1e07bf47b969e39ee08acd139d6d62f60cdcc0add4f41c88');
  assert.equal(TRANSITIONS.IDLE_TO_TRIGGER.status, 'READY_FOR_PILOT');
  assert.equal(TRANSITIONS.TRIGGER_TO_HOLD.status, 'LOCKED_REFERENCE_AVAILABLE');
  assert.equal(TRANSITIONS.HOLD_TO_RELEASE.status, 'BLOCKED_REFERENCE_NOT_APPROVED');
  assert.match(TRANSITIONS.HOLD_TO_RELEASE.blocker, /Do not substitute archived HOLD_TO_RELAX/);
  assert.equal(TRANSITIONS.HOLD_TO_RELAX, undefined);
  assert.equal(SPHERE_VISUAL_LOCK.objectCount, 1);
  assert.equal(SPHERE_VISUAL_LOCK.camera, 'FIXED');

  const prompt = generationPrompt();
  assert.match(prompt, /START STATE:/);
  assert.match(prompt, /ACTION:/);
  assert.match(prompt, /INTENDED END STATE:/);
  assert.match(prompt, /Portrait 9:16/);
  const negative = negativeGuidance();
  for (const required of ['split screen', 'triptych', 'multiple panels', 'multiple spheres', 'pseudo-text', 'white outer ring']) {
    assert.match(negative, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  assert.throws(() => buildIdleToTriggerPilot(), (error) => error.code === 'SPHERE_MASTER_REFERENCE_REQUIRED');
  assert.throws(() => buildIdleToTriggerPilot({ referenceArtifact: { storageKey: 'x', contentHash: 'a'.repeat(64), contentType: 'video/mp4' } }),
    (error) => error.code === 'SPHERE_MASTER_REFERENCE_IMAGE_REQUIRED');
  const pilot = buildIdleToTriggerPilot({ referenceArtifact: {
    artifactId: 'sphere-idle-reference', version: 1, storageKey: 'brand/impulseoff/reference.jpg',
    contentHash: 'a'.repeat(64), contentType: 'image/jpeg',
  } });
  assert.equal(pilot.brand, 'ImpulseOff');
  assert.equal(pilot.pilotOnly, true);
  assert.equal(pilot.remainingProductionScheduled, false);
  assert.equal(pilot.generation_requirements.capability, 'IMAGE_TO_VIDEO');
  assert.equal(pilot.generation_requirements.aspect_ratio, '9:16');
  assert.equal(pilot.generation_requirements.duration, 5);
  assert.equal(pilot.generation_requirements.audio.requested, false);
  assert.equal(pilot.generation_requirements.v210_reference.policy, 'UPLOADED_REFERENCE');
  assert.deepEqual(pilot.generation_requirements.expectedHistoricalFailureChecks, [
    'NO_SPLIT_SCREEN_OR_TRIPTYCH', 'NO_MULTIPLE_SCENES_OR_PANELS', 'NO_BROKEN_VISUAL_QUALITY', 'NO_PSEUDO_TEXT',
  ]);

  const projection = spherePilotPreflightProjection({ semanticCalls: 1 });
  assert.equal(projection.provider, 'replicate');
  assert.equal(projection.model, 'alibaba/wan-3');
  assert.equal(projection.expectedVideoGenerations, 1);
  assert.equal(projection.expectedAudioGenerations, 0);
  assert.equal(projection.maximumExternalCalls, 2);
  assert.equal(projection.videoKnownCostUsd, 0.50);
  assert.equal(projection.totalCostStatus, 'UNKNOWN');
  assert.equal(projection.autoRegeneration, false);
  assert.equal(projection.humanApprovalRequired, true);
  assert.equal(projection.autoPublish, false);
}

function voiceResponseTests() {
  const sampleRate = 1000;
  const samples = new Float32Array(sampleRate * 2);
  for (let index = sampleRate; index < samples.length; index += 1) {
    samples[index] = 0.45 * Math.sin(2 * Math.PI * 40 * index / sampleRate);
  }
  const envelope = buildVoiceEnvelope(samples, { sampleRate, windowMs: 40, hopMs: 40, silenceThreshold: 0.025 });
  assert.ok(envelope.length >= 45);
  assert.ok(envelope.slice(0, 20).every((point) => point.intensity === 0));
  assert.ok(envelope.slice(-10).some((point) => point.intensity > 0.5));

  const filter = buildVoiceReactiveFilter({ envelope });
  assert.match(filter, /split=2\[base\]\[sphere_src\]/);
  assert.match(filter, /crop=/);
  assert.match(filter, /overlay=/);
  assert.match(filter, /\[base\]\[reactive\]/);
  assert.doesNotMatch(filter, /drawtext|drawbox|showwaves|vectorscope/i);

  const args = buildVoiceReactiveFfmpegArgs({
    videoPath: '/tmp/sphere.mp4', audioPath: '/tmp/voice.wav', outputPath: '/tmp/out.mp4', envelope,
  });
  assert.deepEqual(args.slice(0, 8), ['-hide_banner','-loglevel','error','-y','-i','/tmp/sphere.mp4','-i','/tmp/voice.wav']);
  assert.ok(args.includes('[vout]'));
  assert.ok(args.includes('[aout]'));
  assert.ok(args.includes('-shortest'));
}

contractTests();
voiceResponseTests();
console.log('ImpulseOff sphere pilot contract: PASS');
