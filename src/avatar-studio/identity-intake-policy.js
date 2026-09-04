'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AvatarStudioError } = require('./domain');

const policyPath = path.resolve(__dirname, '../../config/avatar-studio/identity-intake-policy.json');
function loadIdentityIntakePolicy(file = policyPath) {
  let value; try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new AvatarStudioError(503, 'IDENTITY_INTAKE_POLICY_UNAVAILABLE', 'Identity intake policy cannot be loaded'); }
  const views = value?.canonicalViewpoints; const required = value?.minimumIdentityCoverage?.required; const recommended = value?.minimumIdentityCoverage?.recommended;
  if (value?.schemaVersion !== 1 || !Array.isArray(views) || views.length !== 5 || new Set(views).size !== 5
    || !Array.isArray(required) || required.join(',') !== 'FRONTAL,THREE_QUARTER_LEFT,THREE_QUARTER_RIGHT'
    || !Array.isArray(recommended) || recommended.join(',') !== 'PROFILE_LEFT,PROFILE_RIGHT'
    || value?.photoBatch?.minimum !== 1 || value?.photoBatch?.maximum !== 10
    || value?.humanControl?.identityConfirmationRequired !== true || value?.minorSafety?.neverInferMinorStatusFromImage !== true) {
    throw new AvatarStudioError(503, 'IDENTITY_INTAKE_POLICY_INVALID', 'Identity intake policy is invalid');
  }
  return Object.freeze({ ...value, canonicalViewpoints: Object.freeze([...views]), minimumIdentityCoverage: Object.freeze({ required: Object.freeze([...required]), recommended: Object.freeze([...recommended]) }) });
}
module.exports = { loadIdentityIntakePolicy, policyPath };
