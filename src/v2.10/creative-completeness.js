'use strict';

const { canonicalCreativeBrief, REQUIRED_SHOT_FIELDS } = require('./creative-contract');

const PLACEHOLDER_PATTERNS = [
  /exactly as specified/i, /operator(?:'s)? (?:creative )?brief/i, /explicitly described in (?:the )?brief/i,
  /to be (?:defined|determined|provided|specified)/i, /\b(?:tbd|todo|placeholder|lorem ipsum)\b/i,
  /(?:awaits?|requires?|needed from) (?:the )?operator input/i, /creative input required/i,
  /^(?:human subjects?|characters?|environment|location)(?: and .*)?$/i,
];
const VAGUE = /^(?:person|people|someone|something|somewhere|scene|nice|good|beautiful|cinematic|dynamic|emotional|engaging|interesting)$/i;

function isSpecific(value, minimumWords = 3) {
  const string = Array.isArray(value) ? value.join(' ') : String(value || '').trim();
  if (!string || PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(string)) || VAGUE.test(string)) return false;
  return string.split(/\s+/).filter(Boolean).length >= minimumWords;
}
function item(name, status, message) { return Object.freeze({ name, status, message }); }
function every(shots, field, words = 3) { return shots.length > 0 && shots.every((shot) => isSpecific(shot[field], words)); }
function arcStatus(brief) {
  const roles = new Set(brief.storyboard.flatMap((shot) => shot.roles));
  const hook = roles.has('HOOK');
  const context = roles.has('TENSION') || roles.has('INSIGHT');
  const change = roles.has('ACTION') || roles.has('INSIGHT');
  const resolution = roles.has('RESOLUTION');
  const cta = roles.has('CTA') || isSpecific(brief.cta, 2);
  if (!hook || !context || !change || !resolution || !cta) return 'WARN';
  return 'PASS';
}

function validateCreativeCompleteness(input) {
  const brief = canonicalCreativeBrief(input);
  const shots = brief.storyboard;
  const countOk = shots.length >= 2 && shots.length <= 5;
  const requiredTop = ['title', 'objective', 'targetPlatform', 'hook', 'coreMessage', 'cta', 'audienceIntent', 'creativeConcept', 'visualStyle'];
  const topOk = requiredTop.every((field) => isSpecific(brief[field], field === 'title' || field === 'targetPlatform' ? 1 : 2));
  const duration = shots.reduce((sum, shot) => sum + (Number.isFinite(shot.durationSeconds) ? shot.durationSeconds : 0), 0);
  const checks = [
    item('CREATIVE_BRIEF', topOk && countOk ? 'PASS' : 'FAIL', countOk ? 'Required brief fields must be concrete.' : 'Storyboard requires 2–5 shots.'),
    item('SUBJECT_SPECIFICITY', every(shots, 'subject') ? 'PASS' : 'FAIL', 'Every shot needs a concrete subject.'),
    item('ACTION_SPECIFICITY', every(shots, 'action') ? 'PASS' : 'FAIL', 'Every shot needs a concrete visible action.'),
    item('ENVIRONMENT_SPECIFICITY', every(shots, 'environment') ? 'PASS' : 'FAIL', 'Every shot needs a concrete environment.'),
    item('EMOTIONAL_BEAT', every(shots, 'emotionalIntent', 2) ? 'PASS' : 'FAIL', 'Every shot needs an emotional beat.'),
    item('CAMERA_INTENT', shots.length && shots.every((shot) => isSpecific(`${shot.framing} ${shot.camera} ${shot.lensComposition}`, 4)) ? 'PASS' : 'FAIL', 'Every shot needs framing, camera, and composition intent.'),
    item('LIGHTING_INTENT', every(shots, 'lighting', 2) ? 'PASS' : 'FAIL', 'Every shot needs lighting intent.'),
    item('SHOT_PURPOSE', every(shots, 'purpose', 3) && shots.every((shot) => REQUIRED_SHOT_FIELDS.every((field) => field === 'durationSeconds' ? shot[field] > 0 : Boolean(shot[field]?.length || shot[field]))) ? 'PASS' : 'FAIL', 'Every shot needs all required fields and a meaningful purpose.'),
    item('STORY_ARC', arcStatus(brief), 'Arc should cover hook, tension/insight, change/action, resolution, and CTA.'),
    item('CTA_RESOLUTION', isSpecific(brief.cta, 2) && (shots.some((shot) => shot.roles.includes('CTA')) || shots.some((shot) => shot.roles.includes('RESOLUTION'))) ? 'PASS' : 'FAIL', 'The approved CTA must resolve in the storyboard.'),
    item('DURATION_ALIGNMENT', Number.isFinite(brief.targetDurationSeconds) && brief.targetDurationSeconds > 0 && Math.abs(duration - brief.targetDurationSeconds) < 0.001 ? 'PASS' : 'FAIL', `Storyboard totals ${duration}s; target is ${brief.targetDurationSeconds}s.`),
    item('CONTINUITY_PLAN', ['identity', 'appearance', 'wardrobe', 'environment', 'props', 'lightingColorLanguage', 'cameraLanguage'].every((field) => isSpecific(brief.continuity[field], 2)) && shots.every((shot) => isSpecific(shot.continuity, 2)) ? 'PASS' : 'FAIL', 'Concrete continuity must cover identity, appearance, wardrobe, environment, props, lighting/color, and camera.'),
  ];
  const status = checks.some((check) => check.status === 'FAIL') ? 'FAIL' : checks.some((check) => check.status === 'WARN') ? 'WARN' : 'PASS';
  return Object.freeze({ validatorVersion: '2.10.0', status, paidPreflightAllowed: status !== 'FAIL', checks: Object.freeze(checks), evaluatedAt: null });
}

module.exports = { PLACEHOLDER_PATTERNS, isSpecific, validateCreativeCompleteness };
