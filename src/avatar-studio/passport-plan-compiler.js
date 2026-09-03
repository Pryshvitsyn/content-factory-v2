'use strict';

const base = require('./prompts/AVATAR_PASSPORT_BASE.v1.json');
const identityLockPrompt = require('./prompts/AVATAR_PASSPORT_IDENTITY_LOCK.v1.json');
const negative = require('./prompts/AVATAR_PASSPORT_NEGATIVE.v1.json');
const repair = require('./prompts/AVATAR_PASSPORT_REPAIR.v1.json');
const { AvatarStudioError, fingerprint } = require('./domain');
const { CAPABILITIES } = require('../v2.8/capabilities');
const { estimateOpenAIImagePlan } = require('../v2.9.2/pricing-registry');
const { PASSPORT_OUTPUT } = require('./passport-contract');
const { viewpointSnapshot } = require('./source-viewpoint');

const PASSPORT_SPEC_VERSION = 'avatar-passport-generation-spec-v1';
const PASSPORT_PROMPT_VERSION = [base,identityLockPrompt,negative,repair].map((item) => `${item.id}@${item.version}`).join('+');
const REQUIRED_VIEWS = Object.freeze([
  Object.freeze({ panel: 'LEFT', view: 'FRONTAL', angleDegrees: 0 }),
  Object.freeze({ panel: 'CENTER', view: 'THREE_QUARTER_45', angleDegrees: 45 }),
  Object.freeze({ panel: 'RIGHT', view: 'PROFILE_90', angleDegrees: 90 }),
]);

function minorPassportWardrobe(avatar = {}) {
  const identity = avatar.identity || avatar.identitySpec || {};
  const minor = identity.permanentAttributes?.subjectAgeClass === 'MINOR' || /\bminor\b/i.test(String(identity.agePresentation || ''));
  if (!minor) return null;
  return Object.freeze({ required: true, type: 'PLAIN_NEUTRAL_AGE_APPROPRIATE_CREW_NECK_TOP',
    coverage: 'SHOULDERS_AND_TORSO_FULLY_COVERED_IN_EVERY_PANEL', consistency: 'IDENTICAL_SIMPLE_STANDARDIZED_PRODUCTION_WARDROBE_ACROSS_ALL_VIEWS',
    prohibited: Object.freeze(['LOGOS','TEXT','JEWELLERY','HATS','FASHION_STYLING','SOURCE_SPECIFIC_WARDROBE','BARE_TORSO','SHIRTLESS','EXPOSED_CHEST','UNDERWEAR','SWIMWEAR','ADULT_STYLING']),
    explanation: 'Clothing is standardized production wardrobe and is not an identity trait.' });
}

function resolveProviderPlan(providerCatalog, preferred = {}) {
  let provider = String(preferred.provider || '').toLowerCase() || null;
  let model = preferred.model || null;
  if (!provider && !model && providerCatalog?.preferredModel) {
    const current = providerCatalog.preferredModel({ provider: 'openai', capability: CAPABILITIES.MULTI_VIEW_IDENTITY_REFERENCE,
      profile: 'PREMIUM' });
    if (current) { provider = current.provider; model = current.modelId; }
  }
  if (!provider && !model) return Object.freeze({ provider: null, model: null, capabilityStatus: 'UNSELECTED',
    availability: 'NOT_RESOLVED', costStatus: 'UNKNOWN', knownPricePerCandidate: null });
  if (!provider || !model) throw new AvatarStudioError(400, 'PASSPORT_PROVIDER_SELECTION_INCOMPLETE',
    'Preferred passport provider and model must be selected together');
  const selected = providerCatalog?.listModels(provider)?.find((item) => item.modelId === model);
  if (!selected) throw new AvatarStudioError(409, 'PASSPORT_MODEL_NOT_REGISTERED', 'Selected model is not registered in the existing Provider Catalog');
  if (!(selected.capabilities || []).includes(CAPABILITIES.MULTI_VIEW_IDENTITY_REFERENCE)) throw new AvatarStudioError(409,
    'PASSPORT_CAPABILITY_UNSUPPORTED', 'Selected model lacks MULTI_VIEW_IDENTITY_REFERENCE capability');
  return Object.freeze({ provider, model, capabilityStatus: 'SUPPORTED', availability: providerCatalog.getAvailability(provider),
    adapterFamily: selected.adapterFamily, costStatus: selected.costStatus || 'UNKNOWN', knownPricePerCandidate: null,
    modelStatus: selected.lifecycleStatus || 'CURRENT', deprecated: selected.deprecated === true,
    replacementModelId: selected.replacementModelId || null,
    reliability: 'ONE_EDIT_CALL_REQUESTS_THE_CANONICAL_THREE_PANEL_COMPOSITE_BUT_PROVIDER_OUTPUT_REQUIRES_GEOMETRY_IDENTITY_QA_AND_HUMAN_CERTIFICATION' });
}

function compilePassportGenerationSpec({ avatar, identityVersion, identityLock, sourceAssets, requestedCandidateCount = 4,
  preferred = {}, providerCatalog = null, originalGenerationSpecId = null, repairDelta = null, actor = 'local-operator' } = {}) {
  const count = Number(requestedCandidateCount);
  if (!Number.isInteger(count) || count < 3 || count > 12) throw new AvatarStudioError(400, 'PASSPORT_CANDIDATE_COUNT_INVALID',
    'Passport Lab supports 3 to 12 candidates per planned batch');
  if (!identityVersion?.id || !identityLock?.id || identityLock.identityVersionId !== identityVersion.id) throw new AvatarStudioError(409,
    'IDENTITY_LOCK_REQUIRED', 'A current immutable Identity Lock is required before planning a passport');
  if (!Array.isArray(sourceAssets) || !sourceAssets.length) throw new AvatarStudioError(409, 'PASSPORT_SOURCE_REQUIRED',
    'Select at least one eligible IDENTITY or PASSPORT_SOURCE asset');
  const providerPlan = resolveProviderPlan(providerCatalog, preferred);
  const promptVersion = PASSPORT_PROMPT_VERSION;
  const studioSpecification = Object.freeze({ composition: 'ONE_HORIZONTAL_THREE_PANEL_COMPOSITE', background: 'NEUTRAL_MID_GREY_SEAMLESS',
    pose: 'HEAD_AND_SHOULDERS_NEUTRAL_RELAXED_CLOSED_MOUTH', lighting: 'SOFT_EVEN_FRONTAL_NO_COLOUR_CAST',
    output: 'PHOTOREALISTIC_TACK_SHARP_NATURAL_CONTRAST_NO_TEXT' });
  const cameraSpecification = Object.freeze({ height: 'EYE_LEVEL', lensEquivalentMm: 85, distance: 'SAME_ALL_PANELS',
    headScale: 'SAME_ALL_PANELS', eyeLine: 'SAME_ALL_PANELS' });
  const costPlan = providerPlan.model === 'gpt-image-2'
    ? estimateOpenAIImagePlan({ model: providerPlan.model, size: PASSPORT_OUTPUT.size, quality: 'high', count,
      referenceImageCount: sourceAssets.length })
    : Object.freeze({ status: 'UNKNOWN', knownPricePerCandidate: providerPlan.knownPricePerCandidate, knownTotalCost: null,
      knownSubtotalCost: 0, unknownElements: Object.freeze(['PROVIDER_PRICE_PER_CANDIDATE','TOTAL_COST']), currency: 'USD',
      inventedCosts: false, unknownIsZero: false });
  const minorWardrobe = minorPassportWardrobe(avatar);
  const canonical = { schemaVersion: PASSPORT_SPEC_VERSION, workspaceId: avatar.workspaceId, brandId: sourceAssets[0].brandId,
    audienceVertical: avatar.vertical, avatarId: avatar.id, identityVersionId: identityVersion.id,
    identityLockVersionId: identityLock.id, sourceAssetIds: sourceAssets.map((item) => item.id), sourceViewpointSnapshot: viewpointSnapshot(sourceAssets), requiredViews: REQUIRED_VIEWS,
    studioSpecification: Object.freeze({ ...studioSpecification, ...(minorWardrobe ? { minorWardrobe } : {}) }), cameraSpecification, identityConstraints: identityLock.permanentAttributes,
    temporaryExclusions: identityLock.temporaryAttributes, uncertainFeatures: identityLock.uncertainAttributes, minorWardrobe,
    negativeConstraints: negative.text, requestedCandidateCount: count, promptVersion, specVersion: PASSPORT_SPEC_VERSION,
    providerCapabilityRequirements: [CAPABILITIES.IMAGE_TO_IMAGE,CAPABILITIES.MULTI_VIEW_IDENTITY_REFERENCE],
    preferredProvider: providerPlan.provider, preferredModel: providerPlan.model, providerPlan, costPlan,
    plannedExternalCallCount: count, executedExternalGenerationCalls: 0, paidProviderCalls: 0,
    executionAuthorized: false, humanApprovalState: 'EXECUTION_APPROVAL_REQUIRED', originalGenerationSpecId,
    repairDelta: repairDelta || null };
  return Object.freeze({ ...canonical, planFingerprint: fingerprint(canonical), promptAssets: Object.freeze([base,identityLockPrompt,negative,
    ...(repairDelta ? [repair] : [])]), provenance: Object.freeze({ source: 'AVATAR_STUDIO_PASSPORT_PLAN_ONLY', actor, sourceViewpointSnapshot: canonical.sourceViewpointSnapshot,
    createdAt: new Date().toISOString(), providerCallsExecuted: 0 }) });
}

module.exports = { PASSPORT_PROMPT_VERSION, PASSPORT_SPEC_VERSION, REQUIRED_VIEWS, compilePassportGenerationSpec, minorPassportWardrobe, resolveProviderPlan };
