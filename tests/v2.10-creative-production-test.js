'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalCreativeBrief, buildShotPrompt } = require('../src/v2.10/creative-contract');
const { validateCreativeCompleteness } = require('../src/v2.10/creative-completeness');
const { resolveReferenceEvidence, validateContinuity } = require('../src/v2.10/continuity-contract');
const { VoicePreviewService, applyVoiceChange, approveVoice, validateUploadedAudio, validateVoiceTiming, ATTESTATION } = require('../src/v2.10/voice-studio');
const { buildProductionPreflight, assertStartAllowed } = require('../src/v2.10/production-preflight');
const { buildFfmpegArgs } = require('../src/v2.1/ffmpeg-master-renderer');
const { buildExecutionPlan, V210ProductionStarter } = require('../src/v2.10/production-starter');

function shot(number, roles) {
  return { shotId: `s${number}`, assetId: `a${number}`, durationSeconds: 5, roles,
    purpose: `Advance advertising story beat number ${number}`, subject: 'A specific adult product customer wearing a blue jacket',
    action: `The customer performs visible action number ${number} with deliberate restraint`,
    environment: 'A concrete warm apartment living room with sofa and oak table', emotionalIntent: 'Quiet authentic attentive connection',
    framing: 'Vertical eye-level medium shot', camera: 'Restrained slow observational movement',
    lensComposition: 'Natural perspective balanced two-person composition', lighting: 'Warm practical lamps with soft evening contrast',
    continuity: 'Preserve the same person wardrobe room layout and props', negativeGuidance: ['generated text', 'watermarks'],
    referencePolicy: 'NONE', voiceoverSegment: number === 1 ? 'Notice the moment before assuming.' : 'Choose calm attention today.' };
}
function brief(count = 2) {
  const roles = count === 2 ? [['HOOK', 'TENSION', 'INSIGHT'], ['ACTION', 'RESOLUTION', 'CTA']]
    : Array.from({ length: count }, (_, i) => i === 0 ? ['HOOK', 'TENSION'] : i === count - 1 ? ['RESOLUTION', 'CTA'] : ['INSIGHT', 'ACTION']);
  return { title: 'Concrete Campaign', objective: 'Move attentive couples toward the approved product idea', targetPlatform: 'Instagram Reels',
    targetDurationSeconds: count * 5, hook: 'A specific moment of hesitation opens the story', coreMessage: 'Attention changes an ambiguous relationship moment',
    cta: 'Notice the moment today', audienceIntent: 'Help thoughtful couples pause before assuming', creativeConcept: 'A visible progression from tension through attentive action to relief',
    visualStyle: 'Warm restrained cinematic realism with natural micro-expressions', storyboard: roles.map((role, i) => shot(i + 1, role)),
    continuity: { identity: 'One consistent adult couple throughout all shots', appearance: 'Partner one has short dark curls and partner two has shoulder-length auburn hair',
      wardrobe: 'Blue cotton jacket and cream knit sweater remain unchanged', environment: 'Warm apartment with green sofa oak table and two brass lamps',
      props: 'Green sofa oak table ceramic mug and two brass lamps', lightingColorLanguage: 'Warm amber practical lights with soft evening contrast',
      cameraLanguage: 'Vertical eye-level restrained observational camera with natural perspective', referencePolicy: 'NONE' },
    voice: { sourceType: 'UPLOADED_AUDIO', uploadedArtifactId: 'voice-artifact-1', previewArtifact: { artifactId: 'voice-artifact-1', durationSeconds: count * 5 - 1 }, approved: true },
    postProduction: { endTitle: { enabled: true, text: 'Notice the moment today', startTime: count * 5 - 2, duration: 2 } },
    publicationPolicy: { humanApprovalRequired: true, autoPublish: false } };
}
function check(input, name) { return validateCreativeCompleteness(input).checks.find((entry) => entry.name === name); }

async function main() {
  assert.equal(validateCreativeCompleteness(brief(2)).status, 'PASS', '2-shot storyboard PASS');
  assert.equal(validateCreativeCompleteness(brief(5)).status, 'PASS', '5-shot storyboard PASS');
  assert.equal(validateCreativeCompleteness(brief(1)).status, 'FAIL', '1-shot storyboard FAIL');
  assert.equal(validateCreativeCompleteness(brief(6)).status, 'FAIL', '6-shot storyboard FAIL');
  for (const [field, checkName] of [['subject', 'SUBJECT_SPECIFICITY'], ['environment', 'ENVIRONMENT_SPECIFICITY']]) {
    const missing = brief(); missing.storyboard[0][field] = ''; assert.equal(check(missing, checkName).status, 'FAIL');
    const placeholder = brief(); placeholder.storyboard[0][field] = `${field} exactly as specified by the operator creative brief`; assert.equal(check(placeholder, checkName).status, 'FAIL');
  }
  const mismatch = brief(); mismatch.targetDurationSeconds = 15; assert.equal(check(mismatch, 'DURATION_ALIGNMENT').status, 'FAIL');
  const meaningless = brief(); meaningless.storyboard.forEach((s) => { s.roles = []; }); assert.equal(check(meaningless, 'STORY_ARC').status, 'WARN');

  const continuityBrief = brief(); continuityBrief.storyboard[1].referencePolicy = 'PREVIOUS_SHOT_FRAME';
  assert.equal(validateContinuity(continuityBrief, { capabilities: ['TEXT_TO_VIDEO'] }).status, 'BLOCKED');
  assert.equal(validateContinuity(continuityBrief, { capabilities: ['IMAGE_TO_VIDEO'] }).status, 'READY');
  assert.throws(() => resolveReferenceEvidence({ brief: continuityBrief, shotIndex: 1, artifacts: [] }), { code: 'REFERENCE_EVIDENCE_MISSING' });
  assert.equal(resolveReferenceEvidence({ brief: continuityBrief, shotIndex: 1, artifacts: [{ artifactId: 'frame-1', version: 1,
    shotId: 's1', kind: 'FRAME', status: 'SUCCEEDED', immutable: true, contentHash: 'abc', storageKey: 'immutable/frame-1' }] }).artifactId, 'frame-1');

  let providerCalls = 0;
  const previews = new Map();
  const repository = { async findVoicePreview({ fingerprint }) { return previews.get(fingerprint); }, async storeVoicePreview(data) { const value = { artifactId: 'preview-1', durationSeconds: 4, ...data }; previews.set(data.fingerprint, value); return value; } };
  const service = new VoicePreviewService({ repository, providerGateway: { async generatePreview() { providerCalls += 1; return { bytes: Buffer.from('mock'), contentType: 'audio/wav', durationSeconds: 4 }; } } });
  const aiVoice = { sourceType: 'AI_PRESET', provider: 'mock-media', model: 'mock-tts', voiceId: 'calm', language: 'en', instructions: 'Warm and restrained' };
  applyVoiceChange(aiVoice, { ...aiVoice, voiceId: 'other' }); assert.equal(providerCalls, 0, 'dropdown change has zero calls');
  const first = await service.generate({ workspaceId: 'w', brandId: 'b', voice: aiVoice, previewText: 'Before you assume', confirmed: true });
  assert.equal(first.externalCalls, 1); assert.equal(providerCalls, 1);
  const second = await service.generate({ workspaceId: 'w', brandId: 'b', voice: aiVoice, previewText: 'Before you assume', confirmed: true });
  assert.equal(second.externalCalls, 0); assert.equal(providerCalls, 1, 'identical preview reused');
  const approved = approveVoice({ ...aiVoice, previewArtifact: first.artifact });
  assert.equal(applyVoiceChange(approved, { ...approved, voiceId: 'different' }).approved, false);
  assert.equal(applyVoiceChange(approved, { ...approved, instructions: 'Different' }).approved, false);

  const uploadValidation = validateUploadedAudio({ contentType: 'audio/wav', size: 1000,
    metadata: { durationSeconds: 9, decodable: true, hasAudio: true, sampleRate: 48000, channels: 1 },
    operatorAttestation: { confirmed: true, text: ATTESTATION, actor: 'operator-1', confirmedAt: '2026-08-29T10:00:00Z' } });
  assert.equal(uploadValidation.status, 'PASS'); assert.equal(providerCalls, 1, 'uploaded preview has zero provider calls');
  const tooLongInput = brief(); tooLongInput.voice.previewArtifact.durationSeconds = 999;
  const tooLong = canonicalCreativeBrief(tooLongInput).voice;
  assert.equal(validateVoiceTiming({ voice: tooLong, targetDurationSeconds: 10 }).status, 'BLOCKED');

  const ready = brief();
  ready.voice.approvedConfigurationFingerprint = require('../src/v2.10/voice-studio').voiceConfigurationFingerprint(ready.voice);
  const input = { brief: ready, video: { provider: 'mock-video', model: 'mock-v1', modelFamily: 'mock', profile: 'quality', capability: 'TEXT_TO_VIDEO', resolution: '1080x1920', capabilities: ['TEXT_TO_VIDEO'] },
    quality: { semanticCritic: 'mock-semantic', semanticCalls: 2, otherEvaluatorCalls: 0 }, master: { profile: 'reels', resolution: '1080x1920', fps: 30, audioStrategy: 'uploaded-human' } };
  const preflight = buildProductionPreflight(input);
  assert.equal(preflight.status, 'READY'); assert.deepEqual(preflight.externalCalls, { video: 2, speech: 0, semantic: 2, otherEvaluator: 0, maximum: 4 });
  assert.equal(assertStartAllowed({ preflight, currentInput: input, confirmed: true }), true);
  const executionPlan = buildExecutionPlan({ draft: { id: 'draft-1', revision: 1, workspaceId: 'w', brandId: 'b', creativeBrief: ready }, preflight });
  assert.equal(executionPlan.video.shots.length, 2); assert.equal(executionPlan.voice.generationRequired, false);
  assert.match(executionPlan.video.shots[0].prompt, /Appearance: Partner one has short dark curls/);
  let starts = 0; const starter = new V210ProductionStarter({ executor: { async start({ plan }) { starts += 1; return { productionId: `mock-${plan.draftId}` }; } } });
  assert.equal((await starter.start({ draft: { id: 'draft-1', revision: 1, creativeBrief: ready }, preflight })).productionId, 'mock-draft-1'); assert.equal(starts, 1);
  const edited = JSON.parse(JSON.stringify(input)); edited.brief.storyboard[0].action += ' now';
  assert.throws(() => assertStartAllowed({ preflight, currentInput: edited, confirmed: true }), { code: 'STALE_PREFLIGHT' });
  const prompt = buildShotPrompt(ready, ready.storyboard[0]);
  assert.doesNotMatch(prompt, /Notice the moment today/); assert.match(prompt, /Do not render typography/);
  const ffmpeg = buildFfmpegArgs({ assembly: { durationMs: 10000, clips: [{ kind: 'video', durationMs: 10000, sourceOffsetMs: 0 }] },
    inputPaths: ['/mock/video.mp4'], outputPath: '/mock/master.mp4', postProduction: ready.postProduction, endTitlePath: '/mock/end-title.png' });
  assert.match(ffmpeg[ffmpeg.indexOf('-filter_complex') + 1], /overlay=.*between/);

  const attune = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/v2.10/attune-creative-2-draft.json')));
  assert.equal(attune.status, 'CREATIVE_INCOMPLETE'); assert.equal(attune.voice.state, 'VOICE_SELECTION_REQUIRED');
  assert.equal(validateCreativeCompleteness(attune).status, 'FAIL', 'missing operator appearance facts remain fail-closed');
  assert.equal(attune.publicationPolicy.autoPublish, false); assert.equal(attune.startedAt, undefined);
  assert.equal(providerCalls, 1, 'all external calls were injected mocks');
  console.log('V2.10 creative production contract tests passed; real external calls = 0');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
