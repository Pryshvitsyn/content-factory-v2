'use strict';

const { AvatarStudioError, assertBrandPermission, fingerprint } = require('./domain');
const { assertGateUsable } = require('./gate-zero');
const { validateAvatarContinuityReadiness } = require('../v2.10/continuity-contract');

const FORMAT_LEVELS = Object.freeze({ STATIC_PORTRAIT: 1, TALKING_HEAD: 4, MULTI_SHOT: 7 });

function compilePlanOnlyTest({ avatar, levelState, vertical, brandId, format, reference, script, shotPlan,
  providerSelection = null, actor = 'local-operator' } = {}) {
  const normalizedFormat = String(format || '').toUpperCase();
  if (!(normalizedFormat in FORMAT_LEVELS)) throw new AvatarStudioError(400, 'TEST_FORMAT_INVALID', 'Choose a supported test content format');
  assertBrandPermission(avatar, brandId, vertical);
  assertGateUsable(reference, { allowReview: false });
  const currentLevel = Number(levelState?.currentLevel ?? avatar.currentLevel ?? 0);
  if (currentLevel < FORMAT_LEVELS[normalizedFormat]) throw new AvatarStudioError(409, 'AVATAR_LEVEL_BLOCKED',
    `${normalizedFormat} requires Avatar Level ${FORMAT_LEVELS[normalizedFormat]}`, { currentLevel, requiredLevel: FORMAT_LEVELS[normalizedFormat] });
  if (!script || (typeof script === 'string' && !script.trim())) throw new AvatarStudioError(400, 'SCRIPT_REQUIRED', 'Test content script is required');
  if (!Array.isArray(shotPlan) || !shotPlan.length) throw new AvatarStudioError(400, 'SHOT_PLAN_REQUIRED', 'At least one planned shot is required');
  let continuity = null;
  if (normalizedFormat === 'MULTI_SHOT') {
    continuity = validateAvatarContinuityReadiness(avatar.continuityEvidence || {});
    if (continuity.status !== 'PASS') throw new AvatarStudioError(409, 'AVATAR_CONTINUITY_BLOCKED', 'Existing continuity contract is not ready', continuity);
  }
  const compiledProviderPlan = Object.freeze({ mode: 'PLAN_ONLY', executionAuthorized: false,
    paidProviderCallsAllowed: false, expectedExternalCalls: 0, expectedPaidCalls: 0,
    selection: providerSelection ? Object.freeze({ ...providerSelection }) : null,
    preflight: Object.freeze({ status: 'PLAN_ONLY_READY', humanApprovalRequiredBeforeExecution: true,
      providerCatalogResolutionDeferred: true, publicationDisabled: true }) });
  const canonical = { schemaVersion: 'avatar-studio-v1', vertical, brandId,
    avatarId: avatar.id, avatarVersion: avatar.version || avatar.identityVersion || 1, currentLevel,
    format: normalizedFormat, referenceSourceId: reference.id, script, shotPlan, continuity, compiledProviderPlan };
  return Object.freeze({ ...canonical, planFingerprint: fingerprint(canonical), externalCallCount: 0,
    provenance: Object.freeze({ actor, source: 'AVATAR_STUDIO_PLAN_ONLY', compiledAt: new Date().toISOString() }) });
}

module.exports = { FORMAT_LEVELS, compilePlanOnlyTest };
