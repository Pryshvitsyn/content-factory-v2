'use strict';

const assert = require('node:assert/strict');
const {
  TRANSITION_POLICIES,
  assertApprovedGate,
  buildScriptScaffold,
  buildStoryboardScaffold,
  canonicalScript,
  canonicalStoryboard,
  resolveTransitionReference,
  validateScript,
  validateStoryboard,
} = require('../src/v2.10/quality-script-first-contract');
const { canonicalCreativeBrief, buildShotPrompt } = require('../src/v2.10/creative-contract');

function brief() {
  return canonicalCreativeBrief({
    title: 'ImpulseOff Trigger',
    objective: 'Show interruption of an impulsive reaction before replying.',
    targetPlatform: 'Instagram Reels',
    targetDurationSeconds: 10,
    hook: 'The message lands before the reaction does.',
    coreMessage: 'Create one second between trigger and response.',
    cta: 'Turn the impulse off.',
    audienceIntent: 'Adults who want to respond more deliberately in difficult conversations.',
    creativeConcept: 'A tense message, a stopped reaction, then visible regulation.',
    visualStyle: 'Natural cinematic vertical realism.',
    continuity: {
      identity: 'same adult man', appearance: 'short dark hair', wardrobe: 'charcoal t-shirt',
      environment: 'same modern kitchen', props: 'same black phone',
      lightingColorLanguage: 'soft cool morning window light', cameraLanguage: 'restrained handheld realism',
    },
    storyboard: [
      {
        shotId: 'shot-1', assetId: 'video-1', durationSeconds: 5, roles: ['HOOK','TENSION'],
        purpose: 'Show the trigger arriving and the immediate impulse to answer.',
        subject: 'Adult man holding a black phone at the kitchen counter.',
        action: 'He reads a provoking message and starts typing an angry reply.',
        environment: 'Modern apartment kitchen beside a cool daylight window.',
        emotionalIntent: 'Tension rising quickly but still realistic.', framing: 'Medium close-up',
        camera: 'Slow restrained push-in', lensComposition: 'Natural 50mm feeling, phone and face both readable',
        lighting: 'Soft cool morning window light', continuity: 'Preserve subject, wardrobe, phone and kitchen.',
        negativeGuidance: ['no text rendered in the generated video', 'no extra people'],
      },
      {
        shotId: 'shot-2', assetId: 'video-2', durationSeconds: 5, roles: ['ACTION','RESOLUTION','CTA'],
        purpose: 'Show the interruption and calmer end state.',
        subject: 'Same adult man holding the same black phone.',
        action: 'He stops typing, lowers his shoulders and exhales before responding.',
        environment: 'Same modern apartment kitchen.', emotionalIntent: 'Controlled release of tension.',
        framing: 'Medium close-up from a slightly different angle', camera: 'Small lateral move',
        lensComposition: 'Natural 50mm feeling with more breathing room', lighting: 'Same soft cool morning window light',
        continuity: 'Keep identity, wardrobe, phone, kitchen and lighting; camera may change.',
        negativeGuidance: ['no text rendered in the generated video', 'no dramatic smile'],
      },
    ],
    publicationPolicy: { humanApprovalRequired: true, autoPublish: false },
  });
}

const source = brief();
const script = buildScriptScaffold(source);
const scriptValidation = validateScript(script, source);
assert.equal(scriptValidation.status, 'PASS');
assert.equal(script.timeline.length, 2);
assert.equal(script.timeline[0].startTime, 0);
assert.equal(script.timeline[1].endTime, 10);

const incompleteScript = canonicalScript({ ...script, cta: '' }, { ...source, cta: '' });
assert.equal(validateScript(incompleteScript, { ...source, cta: '' }).status, 'FAIL');

const storyboard = buildStoryboardScaffold(source, script);
const storyboardValidation = validateStoryboard(storyboard, source, script);
assert.equal(storyboardValidation.status, 'PASS');
assert.equal(storyboard.shots.length, 2);
assert.equal(storyboard.shots[0].transitionFromPrevious, 'NEW_SCENE');
assert.equal(storyboard.shots[1].transitionFromPrevious, 'SAME_SCENE');
assert.ok(storyboard.shots.every((shot) => shot.startState && shot.action && shot.intendedEndState));
assert.ok(storyboard.shots.every((shot) => shot.camera.framing && shot.camera.movement && shot.camera.composition));

const explicit = canonicalStoryboard({ ...storyboard, shots: storyboard.shots.map((shot, index) => ({
  ...shot,
  transitionFromPrevious: index === 1 ? 'CONTINUOUS' : shot.transitionFromPrevious,
})) }, source, script);
assert.equal(explicit.shots[1].transitionFromPrevious, 'CONTINUOUS');

assert.deepEqual(TRANSITION_POLICIES,
  ['CONTINUOUS','SAME_SCENE','MATCH_CUT','NEW_SCENE','CHARACTER_ONLY']);

const finalFrame = { artifactId: 'frame-1', contentHash: 'abc' };
const continuous = resolveTransitionReference({ policy: 'CONTINUOUS', previousAcceptedFinalFrame: finalFrame });
assert.equal(continuous.source, 'PREVIOUS_FINAL_FRAME');
assert.equal(continuous.reference, finalFrame);
assert.equal(continuous.forceSameComposition, false);

const sameScene = resolveTransitionReference({ policy: 'SAME_SCENE' });
assert.equal(sameScene.inheritScene, true);
assert.equal(sameScene.inheritCharacter, true);
assert.equal(sameScene.reference, null);
assert.equal(sameScene.forceSameComposition, false);

const characterOnly = resolveTransitionReference({ policy: 'CHARACTER_ONLY' });
assert.equal(characterOnly.inheritCharacter, true);
assert.equal(characterOnly.inheritScene, false);

const newScene = resolveTransitionReference({ policy: 'NEW_SCENE', previousAcceptedFinalFrame: finalFrame });
assert.equal(newScene.reference, null);
assert.equal(newScene.inheritScene, false);
assert.equal(newScene.inheritCharacter, false);

assert.throws(() => assertApprovedGate({ script: { approved: false } }, ['SCRIPT']), /SCRIPT must be explicitly approved/);
assert.doesNotThrow(() => assertApprovedGate({
  script: { approved: true, fingerprint: 's' }, storyboard: { approved: true, fingerprint: 'b' },
}, ['SCRIPT','STORYBOARD']));

const governedBrief = canonicalCreativeBrief({ ...source, storyboard: source.storyboard.map((shot, index) => ({
  ...shot,
  startState: index === 0 ? 'Phone just vibrated; shoulders already tense.' : 'Same man immediately after the first shot.',
  intendedEndState: index === 0 ? 'Thumb hovering over Send.' : 'Shoulders lowered; phone still visible.',
  mustKeep: ['same man', 'same charcoal t-shirt', 'same kitchen'],
  mayChange: ['facial expression', 'body position', 'camera angle'],
  transitionFromPrevious: index === 0 ? 'NEW_SCENE' : 'SAME_SCENE',
  transitionToNext: index === 0 ? 'SAME_SCENE' : 'NEW_SCENE',
})) });
const prompt = buildShotPrompt(governedBrief, governedBrief.storyboard[1]);
assert.match(prompt, /START STATE:/);
assert.match(prompt, /INTENDED END STATE:/);
assert.match(prompt, /Transition from previous: SAME_SCENE/);
assert.match(prompt, /MUST KEEP:/);
assert.match(prompt, /MAY CHANGE:/);

assert.equal(governedBrief.publicationPolicy.humanApprovalRequired, true);
assert.equal(governedBrief.publicationPolicy.autoPublish, false);

console.log('QUALITY script-first contract: PASS');
