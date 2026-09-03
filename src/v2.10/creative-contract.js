'use strict';

const crypto = require('node:crypto');

const SCHEMA_VERSION = '2.10';
const SHOT_ROLES = Object.freeze(['HOOK', 'TENSION', 'INSIGHT', 'ACTION', 'RESOLUTION', 'CTA']);
const REFERENCE_POLICIES = Object.freeze(['NONE', 'PREVIOUS_SHOT_FRAME', 'UPLOADED_REFERENCE']);
const TRANSITION_POLICIES = Object.freeze(['CONTINUOUS', 'SAME_SCENE', 'MATCH_CUT', 'NEW_SCENE', 'CHARACTER_ONLY']);
const VOICE_SOURCE_TYPES = Object.freeze(['AI_PRESET', 'PROVIDER_CUSTOM', 'UPLOADED_AUDIO']);

const REQUIRED_SHOT_FIELDS = Object.freeze([
  'shotId', 'assetId', 'durationSeconds', 'purpose', 'subject', 'action', 'environment',
  'emotionalIntent', 'framing', 'camera', 'lensComposition', 'lighting', 'continuity', 'negativeGuidance',
]);

function text(value) { return String(value ?? '').trim(); }
function array(value) { return Array.isArray(value) ? value : []; }
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stable(value[key]); return out;
  }, {});
  return value;
}
function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function canonicalContinuity(raw = {}) {
  return {
    identity: text(raw.identity), appearance: text(raw.appearance), wardrobe: text(raw.wardrobe),
    environment: text(raw.environment), props: text(raw.props),
    lightingColorLanguage: text(raw.lightingColorLanguage), cameraLanguage: text(raw.cameraLanguage),
    referencePolicy: REFERENCE_POLICIES.includes(raw.referencePolicy) ? raw.referencePolicy : 'NONE',
  };
}

function canonicalVoice(raw = {}) {
  return {
    sourceType: VOICE_SOURCE_TYPES.includes(raw.sourceType) ? raw.sourceType : null,
    provider: text(raw.provider) || null, model: text(raw.model) || null,
    voiceId: text(raw.voiceId) || null, displayName: text(raw.displayName) || null,
    language: text(raw.language) || null, instructions: text(raw.instructions) || null,
    uploadedArtifactId: text(raw.uploadedArtifactId) || null,
    consent: raw.consent ? {
      required: Boolean(raw.consent.required), confirmed: Boolean(raw.consent.confirmed),
      ownerRelationship: text(raw.consent.ownerRelationship) || null,
      confirmedAt: text(raw.consent.confirmedAt) || null, actor: text(raw.consent.actor) || null,
    } : null,
    previewArtifact: raw.previewArtifact || null, approved: Boolean(raw.approved),
    approvedConfigurationFingerprint: text(raw.approvedConfigurationFingerprint) || null,
    operatorAttestation: raw.operatorAttestation || null,
  };
}

function canonicalShot(raw = {}, index = 0) {
  const roleInput = Array.isArray(raw.roles) ? raw.roles : raw.roles || raw.role ? [raw.roles || raw.role] : [];
  const roles = roleInput.flatMap((role) => text(role).split('/')).map((role) => role.trim().toUpperCase())
    .filter((role) => SHOT_ROLES.includes(role));
  const transitionFromPrevious = String(raw.transitionFromPrevious || raw.transitionPolicy || (index === 0 ? 'NEW_SCENE' : 'SAME_SCENE')).toUpperCase();
  const transitionToNext = String(raw.transitionToNext || 'SAME_SCENE').toUpperCase();
  return {
    shotId: text(raw.shotId) || `shot-${index + 1}`, assetId: text(raw.assetId) || `asset-${index + 1}`,
    durationSeconds: Number(raw.durationSeconds), roles: [...new Set(roles)], purpose: text(raw.purpose),
    subject: text(raw.subject), action: text(raw.action), environment: text(raw.environment),
    emotionalIntent: text(raw.emotionalIntent), framing: text(raw.framing), camera: text(raw.camera),
    lensComposition: text(raw.lensComposition), lighting: text(raw.lighting), continuity: text(raw.continuity),
    negativeGuidance: array(raw.negativeGuidance).length ? array(raw.negativeGuidance).map(text).filter(Boolean) : text(raw.negativeGuidance),
    dialogue: text(raw.dialogue) || null, voiceoverSegment: text(raw.voiceoverSegment) || null,
    referenceMedia: raw.referenceMedia || null,
    referencePolicy: REFERENCE_POLICIES.includes(raw.referencePolicy) ? raw.referencePolicy : 'NONE',
    transitionIntent: text(raw.transitionIntent) || null,
    startState: text(raw.startState) || null,
    intendedEndState: text(raw.intendedEndState) || null,
    mustKeep: array(raw.mustKeep).map(text).filter(Boolean),
    mayChange: array(raw.mayChange).map(text).filter(Boolean),
    transitionFromPrevious: TRANSITION_POLICIES.includes(transitionFromPrevious) ? transitionFromPrevious : (index === 0 ? 'NEW_SCENE' : 'SAME_SCENE'),
    transitionToNext: TRANSITION_POLICIES.includes(transitionToNext) ? transitionToNext : 'SAME_SCENE',
    onScreenText: text(raw.onScreenText) || null,
  };
}

function canonicalCreativeBrief(raw = {}) {
  const storyboard = array(raw.storyboard).map(canonicalShot);
  const value = {
    creativeSchemaVersion: SCHEMA_VERSION, title: text(raw.title), objective: text(raw.objective),
    targetPlatform: text(raw.targetPlatform), targetDurationSeconds: Number(raw.targetDurationSeconds),
    hook: text(raw.hook), coreMessage: text(raw.coreMessage), cta: text(raw.cta),
    audienceIntent: text(raw.audienceIntent), creativeConcept: text(raw.creativeConcept), visualStyle: text(raw.visualStyle),
    storyboard, continuity: canonicalContinuity(raw.continuity), voice: canonicalVoice(raw.voice),
    qualityScript: raw.qualityScript || null,
    qualityStoryboardFingerprint: text(raw.qualityStoryboardFingerprint) || null,
    postProduction: {
      endTitle: {
        enabled: Boolean(raw.postProduction?.endTitle?.enabled), text: text(raw.postProduction?.endTitle?.text),
        startTime: Number(raw.postProduction?.endTitle?.startTime || 0), duration: Number(raw.postProduction?.endTitle?.duration || 0),
      },
      brandName: text(raw.postProduction?.brandName) || null, cta: text(raw.postProduction?.cta) || null,
    },
    publicationPolicy: { humanApprovalRequired: true, autoPublish: false, ...(raw.publicationPolicy || {}) },
  };
  value.publicationPolicy.humanApprovalRequired = true;
  value.publicationPolicy.autoPublish = false;
  return freeze(value);
}

function creativeInputFingerprint(brief, providerSelection = {}) {
  return fingerprint({ brief: canonicalCreativeBrief(brief), providerSelection });
}

function scriptSourceFingerprint(briefInput = {}) {
  const brief = canonicalCreativeBrief(briefInput);
  return fingerprint({
    objective: brief.objective,
    audienceIntent: brief.audienceIntent,
    targetPlatform: brief.targetPlatform,
    targetDurationSeconds: brief.targetDurationSeconds,
    hook: brief.hook,
    coreMessage: brief.coreMessage,
    cta: brief.cta,
    creativeConcept: brief.creativeConcept,
    visualStyle: brief.visualStyle,
    dialogue: brief.storyboard.map((shot) => shot.dialogue),
    voiceover: brief.storyboard.map((shot) => shot.voiceoverSegment),
  });
}

function storyboardSourceFingerprint(briefInput = {}) {
  const brief = canonicalCreativeBrief(briefInput);
  return fingerprint({
    continuity: brief.continuity,
    storyboard: brief.storyboard.map((shot) => ({
      shotId: shot.shotId,
      assetId: shot.assetId,
      durationSeconds: shot.durationSeconds,
      roles: shot.roles,
      purpose: shot.purpose,
      subject: shot.subject,
      action: shot.action,
      environment: shot.environment,
      emotionalIntent: shot.emotionalIntent,
      framing: shot.framing,
      camera: shot.camera,
      lensComposition: shot.lensComposition,
      lighting: shot.lighting,
      continuity: shot.continuity,
      negativeGuidance: shot.negativeGuidance,
      dialogue: shot.dialogue,
      voiceoverSegment: shot.voiceoverSegment,
      startState: shot.startState,
      intendedEndState: shot.intendedEndState,
      mustKeep: shot.mustKeep,
      mayChange: shot.mayChange,
      transitionFromPrevious: shot.transitionFromPrevious,
      transitionToNext: shot.transitionToNext,
      onScreenText: shot.onScreenText,
    })),
  });
}

function buildShotPrompt(briefInput, shotInput) {
  const brief = canonicalCreativeBrief(briefInput);
  const shot = canonicalShot(shotInput);
  const negative = Array.isArray(shot.negativeGuidance) ? shot.negativeGuidance.join(', ') : shot.negativeGuidance;
  const mustKeep = shot.mustKeep.length ? shot.mustKeep.join('; ') : 'approved continuity only';
  const mayChange = shot.mayChange.length ? shot.mayChange.join('; ') : 'only changes explicitly required by the action';
  return [
    `Advertising objective: ${brief.objective}. Creative concept: ${brief.creativeConcept}.`,
    `Shot purpose: ${shot.purpose}. Subject: ${shot.subject}. Environment: ${shot.environment}.`,
    shot.startState ? `START STATE: ${shot.startState}.` : '',
    `ACTION: ${shot.action}.`,
    shot.intendedEndState ? `INTENDED END STATE: ${shot.intendedEndState}.` : '',
    `Emotional intent: ${shot.emotionalIntent}. Framing: ${shot.framing}. Camera: ${shot.camera}. Lens/composition: ${shot.lensComposition}. Lighting: ${shot.lighting}.`,
    `Transition from previous: ${shot.transitionFromPrevious}. Transition to next: ${shot.transitionToNext}.`,
    `MUST KEEP: ${mustKeep}. MAY CHANGE: ${mayChange}.`,
    `Continuity identity: ${brief.continuity.identity}. Appearance: ${brief.continuity.appearance}. Wardrobe: ${brief.continuity.wardrobe}. Environment continuity: ${brief.continuity.environment}. Props: ${brief.continuity.props}. Lighting/color language: ${brief.continuity.lightingColorLanguage}. Camera language: ${brief.continuity.cameraLanguage}. Shot continuity: ${shot.continuity}.`,
    `Avoid: ${negative}. Do not render typography, captions, logos, watermarks, the CTA, or the end title; approved text is added only in post-production.`,
  ].filter(Boolean).join(' ');
}

module.exports = {
  SCHEMA_VERSION, SHOT_ROLES, REFERENCE_POLICIES, TRANSITION_POLICIES, VOICE_SOURCE_TYPES, REQUIRED_SHOT_FIELDS,
  canonicalCreativeBrief, canonicalContinuity, canonicalShot, canonicalVoice,
  creativeInputFingerprint, buildShotPrompt, fingerprint, freeze,
  scriptSourceFingerprint, storyboardSourceFingerprint,
};
