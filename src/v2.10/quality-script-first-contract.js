'use strict';

const { canonicalCreativeBrief, fingerprint, freeze } = require('./creative-contract');

const DIRECTOR_STAGES = Object.freeze(['SCRIPT', 'STORYBOARD', 'LOOK', 'PILOT']);
const TRANSITION_POLICIES = Object.freeze([
  'CONTINUOUS',
  'SAME_SCENE',
  'MATCH_CUT',
  'NEW_SCENE',
  'CHARACTER_ONLY',
]);

class QualityDirectorError extends Error {
  constructor(code, message, details = null, status = 409) {
    super(message);
    this.name = 'QualityDirectorError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function text(value) { return String(value ?? '').trim(); }
function list(value) { return Array.isArray(value) ? value.map(text).filter(Boolean) : []; }
function required(value, field, code = 'QUALITY_DIRECTOR_INCOMPLETE') {
  const normalized = text(value);
  if (!normalized) throw new QualityDirectorError(code, `${field} is required`, { field }, 422);
  return normalized;
}

function canonicalTimelineBlock(raw = {}, index = 0) {
  const startTime = Number(raw.startTime);
  const endTime = Number(raw.endTime);
  return freeze({
    id: text(raw.id) || `beat-${index + 1}`,
    startTime: Number.isFinite(startTime) ? startTime : 0,
    endTime: Number.isFinite(endTime) ? endTime : 0,
    purpose: text(raw.purpose),
    storyBeat: text(raw.storyBeat),
    visualAction: text(raw.visualAction),
    spokenContent: text(raw.spokenContent) || null,
    onScreenContent: text(raw.onScreenContent) || null,
  });
}

function canonicalScript(raw = {}, briefInput = {}) {
  const brief = canonicalCreativeBrief(briefInput);
  const timelineSource = Array.isArray(raw.timeline) ? raw.timeline : [];
  return freeze({
    schemaVersion: 'quality-script-first/1',
    objective: text(raw.objective) || brief.objective,
    targetAudience: text(raw.targetAudience) || brief.audienceIntent,
    platform: text(raw.platform) || brief.targetPlatform,
    aspectRatio: text(raw.aspectRatio) || '9:16',
    durationSeconds: Number(raw.durationSeconds || brief.targetDurationSeconds),
    hook: text(raw.hook) || brief.hook,
    coreMessage: text(raw.coreMessage) || brief.coreMessage,
    cta: text(raw.cta) || brief.cta,
    timeline: timelineSource.map(canonicalTimelineBlock),
    voiceover: text(raw.voiceover) || null,
    dialogue: text(raw.dialogue) || null,
    onScreenCopy: text(raw.onScreenCopy) || null,
    creativeConcept: text(raw.creativeConcept) || brief.creativeConcept,
    visualStyle: text(raw.visualStyle) || brief.visualStyle,
    tone: text(raw.tone) || null,
  });
}

function buildScriptScaffold(briefInput = {}) {
  const brief = canonicalCreativeBrief(briefInput);
  let cursor = 0;
  const timeline = brief.storyboard.map((shot, index) => {
    const startTime = cursor;
    cursor += Number(shot.durationSeconds || 0);
    return canonicalTimelineBlock({
      id: `beat-${index + 1}`,
      startTime,
      endTime: cursor,
      purpose: shot.purpose,
      storyBeat: shot.roles?.join('/') || shot.purpose,
      visualAction: shot.action,
      spokenContent: shot.voiceoverSegment || shot.dialogue || null,
      onScreenContent: null,
    }, index);
  });
  return canonicalScript({
    objective: brief.objective,
    targetAudience: brief.audienceIntent,
    platform: brief.targetPlatform,
    aspectRatio: '9:16',
    durationSeconds: brief.targetDurationSeconds,
    hook: brief.hook,
    coreMessage: brief.coreMessage,
    cta: brief.cta,
    timeline,
    voiceover: brief.storyboard.map((shot) => shot.voiceoverSegment).filter(Boolean).join(' '),
    dialogue: brief.storyboard.map((shot) => shot.dialogue).filter(Boolean).join(' '),
    creativeConcept: brief.creativeConcept,
    visualStyle: brief.visualStyle,
  }, brief);
}

function validateScript(scriptInput = {}, briefInput = {}) {
  const script = canonicalScript(scriptInput, briefInput);
  const missing = [];
  for (const field of ['objective', 'targetAudience', 'platform', 'hook', 'coreMessage', 'cta', 'creativeConcept', 'visualStyle']) {
    if (!text(script[field])) missing.push(field);
  }
  if (!Number.isFinite(script.durationSeconds) || script.durationSeconds <= 0) missing.push('durationSeconds');
  if (!Array.isArray(script.timeline) || !script.timeline.length) missing.push('timeline');
  script.timeline.forEach((beat, index) => {
    if (!(beat.endTime > beat.startTime)) missing.push(`timeline[${index}].timeRange`);
    if (!beat.purpose) missing.push(`timeline[${index}].purpose`);
    if (!beat.visualAction) missing.push(`timeline[${index}].visualAction`);
  });
  return freeze({ status: missing.length ? 'FAIL' : 'PASS', missing, script });
}

function canonicalCamera(raw, legacy = {}) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return freeze({
      framing: text(raw.framing) || text(legacy.framing),
      angle: text(raw.angle),
      movement: text(raw.movement) || text(legacy.camera),
      lensIntent: text(raw.lensIntent) || text(legacy.lensComposition),
      composition: text(raw.composition) || text(legacy.lensComposition),
    });
  }
  return freeze({
    framing: text(legacy.framing),
    angle: '',
    movement: text(raw) || text(legacy.camera),
    lensIntent: text(legacy.lensComposition),
    composition: text(legacy.lensComposition),
  });
}

function canonicalShotContract(raw = {}, index = 0, legacy = {}) {
  const transitionFromPrevious = String(raw.transitionFromPrevious || raw.transitionPolicy || (index === 0 ? 'NEW_SCENE' : 'SAME_SCENE')).toUpperCase();
  const transitionToNext = String(raw.transitionToNext || 'SAME_SCENE').toUpperCase();
  return freeze({
    shotId: text(raw.shotId) || text(legacy.shotId) || `shot-${index + 1}`,
    assetId: text(raw.assetId) || text(legacy.assetId) || `asset-${index + 1}`,
    order: Number(raw.order || index + 1),
    startTime: Number(raw.startTime || 0),
    endTime: Number(raw.endTime || 0),
    durationSeconds: Number(raw.durationSeconds || legacy.durationSeconds || 0),
    purpose: text(raw.purpose) || text(legacy.purpose),
    startState: text(raw.startState) || text(legacy.startState),
    action: text(raw.action) || text(legacy.action),
    intendedEndState: text(raw.intendedEndState) || text(legacy.intendedEndState),
    subject: text(raw.subject) || text(legacy.subject),
    environment: text(raw.environment) || text(legacy.environment),
    camera: canonicalCamera(raw.camera, legacy),
    lighting: text(raw.lighting) || text(legacy.lighting),
    mustKeep: list(raw.mustKeep?.length ? raw.mustKeep : legacy.mustKeep),
    mayChange: list(raw.mayChange?.length ? raw.mayChange : legacy.mayChange),
    spokenContent: text(raw.spokenContent) || text(legacy.voiceoverSegment) || text(legacy.dialogue) || null,
    onScreenText: text(raw.onScreenText) || null,
    transitionFromPrevious: TRANSITION_POLICIES.includes(transitionFromPrevious) ? transitionFromPrevious : 'SAME_SCENE',
    transitionToNext: TRANSITION_POLICIES.includes(transitionToNext) ? transitionToNext : 'SAME_SCENE',
    generationPrompt: text(raw.generationPrompt) || null,
    negativeGuidance: list(raw.negativeGuidance?.length ? raw.negativeGuidance : legacy.negativeGuidance),
    visualSource: raw.visualSource?.type === 'REGISTERED_RENDERER' && text(raw.visualSource.rendererId)
      ? freeze({ type: 'REGISTERED_RENDERER', rendererId: text(raw.visualSource.rendererId), fromState: text(raw.visualSource.fromState).toUpperCase() || null, toState: text(raw.visualSource.toState).toUpperCase() || null }) : null,
  });
}

function buildStoryboardScaffold(briefInput = {}, scriptInput = {}) {
  const brief = canonicalCreativeBrief(briefInput);
  const script = canonicalScript(scriptInput, brief);
  let cursor = 0;
  return freeze({
    schemaVersion: 'quality-script-first/1',
    scriptFingerprint: fingerprint(script),
    shots: brief.storyboard.map((shot, index) => {
      const startTime = cursor;
      cursor += Number(shot.durationSeconds || 0);
      const beat = script.timeline[index] || {};
      return canonicalShotContract({
        ...shot,
        order: index + 1,
        startTime,
        endTime: cursor,
        startState: shot.startState || `Opening state for ${shot.subject || 'subject'} in ${shot.environment || 'approved environment'}`,
        intendedEndState: shot.intendedEndState || `End state after: ${shot.action || beat.visualAction || 'approved action'}`,
        mustKeep: shot.mustKeep || [brief.continuity.identity, brief.continuity.wardrobe, brief.continuity.environment].filter(Boolean),
        mayChange: shot.mayChange || ['facial expression', 'body position', 'camera distance'],
        transitionFromPrevious: shot.transitionFromPrevious || (index === 0 ? 'NEW_SCENE' : 'SAME_SCENE'),
        transitionToNext: shot.transitionToNext || (index === brief.storyboard.length - 1 ? 'NEW_SCENE' : 'SAME_SCENE'),
      }, index, shot);
    }),
  });
}

function canonicalStoryboard(raw = {}, briefInput = {}, scriptInput = {}) {
  const brief = canonicalCreativeBrief(briefInput);
  const script = canonicalScript(scriptInput, brief);
  const source = Array.isArray(raw.shots) ? raw.shots : Array.isArray(raw) ? raw : [];
  return freeze({
    schemaVersion: 'quality-script-first/1',
    scriptFingerprint: text(raw.scriptFingerprint) || fingerprint(script),
    shots: source.map((shot, index) => canonicalShotContract(shot, index, brief.storyboard[index] || {})),
  });
}

function validateStoryboard(storyboardInput = {}, briefInput = {}, scriptInput = {}) {
  const storyboard = canonicalStoryboard(storyboardInput, briefInput, scriptInput);
  const missing = [];
  if (!storyboard.shots.length) missing.push('shots');
  storyboard.shots.forEach((shot, index) => {
    for (const field of ['shotId', 'purpose', 'startState', 'action', 'intendedEndState', 'subject', 'environment', 'lighting']) {
      if (!text(shot[field])) missing.push(`shots[${index}].${field}`);
    }
    if (!Number.isFinite(shot.durationSeconds) || shot.durationSeconds <= 0) missing.push(`shots[${index}].durationSeconds`);
    if (!TRANSITION_POLICIES.includes(shot.transitionFromPrevious)) missing.push(`shots[${index}].transitionFromPrevious`);
    if (!TRANSITION_POLICIES.includes(shot.transitionToNext)) missing.push(`shots[${index}].transitionToNext`);
    if (!shot.camera.framing) missing.push(`shots[${index}].camera.framing`);
    if (!shot.camera.movement) missing.push(`shots[${index}].camera.movement`);
    if (!shot.camera.composition) missing.push(`shots[${index}].camera.composition`);
  });
  return freeze({ status: missing.length ? 'FAIL' : 'PASS', missing, storyboard });
}

function resolveTransitionReference({ policy, previousAcceptedFinalFrame = null, canonicalCharacterReference = null,
  sceneReference = null, matchReference = null } = {}) {
  const normalized = String(policy || 'NEW_SCENE').toUpperCase();
  if (!TRANSITION_POLICIES.includes(normalized)) throw new QualityDirectorError('TRANSITION_POLICY_INVALID',
    `Unsupported transition policy '${normalized}'`, { policy: normalized }, 422);
  if (normalized === 'CONTINUOUS') return freeze({ policy: normalized, source: previousAcceptedFinalFrame ? 'PREVIOUS_FINAL_FRAME' : 'MISSING_REQUIRED_REFERENCE',
    reference: previousAcceptedFinalFrame, inheritScene: true, inheritCharacter: true, forceSameComposition: false });
  if (normalized === 'SAME_SCENE') return freeze({ policy: normalized, source: sceneReference ? 'SCENE_REFERENCE' : 'STRUCTURED_CONTINUITY',
    reference: sceneReference, inheritScene: true, inheritCharacter: true, forceSameComposition: false });
  if (normalized === 'MATCH_CUT') return freeze({ policy: normalized, source: matchReference ? 'MATCH_REFERENCE' : 'STRUCTURED_MATCH',
    reference: matchReference, inheritScene: false, inheritCharacter: false, forceSameComposition: false });
  if (normalized === 'CHARACTER_ONLY') return freeze({ policy: normalized, source: canonicalCharacterReference ? 'CHARACTER_REFERENCE' : 'STRUCTURED_CHARACTER_IDENTITY',
    reference: canonicalCharacterReference, inheritScene: false, inheritCharacter: true, forceSameComposition: false });
  return freeze({ policy: normalized, source: 'NONE', reference: null, inheritScene: false, inheritCharacter: false, forceSameComposition: false });
}

function assertApprovedGate(gate, requiredStages = ['SCRIPT', 'STORYBOARD']) {
  for (const stage of requiredStages) {
    const current = gate?.[stage.toLowerCase()];
    if (!current || current.approved !== true || !current.fingerprint) {
      throw new QualityDirectorError(`${stage}_APPROVAL_REQUIRED`, `${stage} must be explicitly approved before QUALITY media generation`, { stage });
    }
  }
  return true;
}

module.exports = {
  DIRECTOR_STAGES,
  TRANSITION_POLICIES,
  QualityDirectorError,
  assertApprovedGate,
  buildScriptScaffold,
  buildStoryboardScaffold,
  canonicalScript,
  canonicalShotContract,
  canonicalStoryboard,
  resolveTransitionReference,
  validateScript,
  validateStoryboard,
  scriptFingerprint: (value, brief) => fingerprint(canonicalScript(value, brief)),
  storyboardFingerprint: (value, brief, script) => fingerprint(canonicalStoryboard(value, brief, script)),
  required,
};
