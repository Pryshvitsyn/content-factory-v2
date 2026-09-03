'use strict';

const { AvatarStudioError, fingerprint } = require('./domain');
const { PASSPORT_OUTPUT } = require('./passport-contract');

const PASSPORT_PROVIDER_STRATEGY = 'ONE_EDIT_CALL_PER_THREE_VIEW_COMPOSITE';
const PASSPORT_CALLS_PER_CANDIDATE = 1;

function compilePassportProviderRequest({ generationSpec, sourceImages, candidateOrdinal } = {}) {
  if (!generationSpec?.id || !generationSpec?.identityVersionId || !generationSpec?.identityLockVersionId) {
    throw new AvatarStudioError(409, 'PASSPORT_GENERATION_SPEC_INVALID', 'A durable canonical Passport Generation Spec is required');
  }
  if (!Array.isArray(sourceImages) || !sourceImages.length) throw new AvatarStudioError(409,
    'PASSPORT_SOURCE_BYTES_REQUIRED', 'At least one approved source identity image is required');
  const ordinal = Number(candidateOrdinal);
  if (!Number.isInteger(ordinal) || ordinal < 1) throw new AvatarStudioError(400,
    'PASSPORT_CANDIDATE_ORDINAL_INVALID', 'Candidate ordinal must be positive');
  const minorWardrobe = generationSpec.minorWardrobe || generationSpec.studioSpecification?.minorWardrobe || null;
  const requirements = {
    prompt: [
      'Create one canonical horizontal three-panel identity passport composite.',
      'Panel 1: frontal 0 degrees. Panel 2: three-quarter 45 degrees. Panel 3: profile 90 degrees.',
      `Studio: ${JSON.stringify(generationSpec.studioSpecification || {})}`,
      `Camera: ${JSON.stringify(generationSpec.cameraSpecification || {})}`,
      `Permanent identity constraints: ${JSON.stringify(generationSpec.identityConstraints || {})}`,
      `Temporary elements to exclude are source details, not identity traits, and must not be preserved: ${JSON.stringify(generationSpec.negativeConstraints?.temporaryExclusions || {})}. This never means removing required standardized production clothing.`,
      minorWardrobe ? 'MINOR SAFETY CLOTHING CONTRACT: Subject wears a plain, age-appropriate neutral crew-neck T-shirt or simple top. Shoulders and torso remain fully covered in every panel. Use identical simple standardized production clothing across all views; it is not an identity trait. Never use bare torso, shirtless appearance, exposed chest, underwear, swimwear, adultized wardrobe, logos, text, jewellery, hats, fashion styling, or source-specific wardrobe.' : null,
      generationSpec.repairDelta ? `Repair delta only: ${JSON.stringify(generationSpec.repairDelta)}` : null,
    ].filter(Boolean).join('\n'),
    visual_style: 'photorealistic, neutral studio, natural skin, tack sharp, no text',
    negative_prompt: [typeof generationSpec.negativeConstraints === 'string'
      ? generationSpec.negativeConstraints : generationSpec.negativeConstraints?.canonical,
      minorWardrobe ? 'No bare torso, shirtless appearance, exposed chest, underwear, swimwear, adultized wardrobe, logos, text, jewellery, hats, fashion styling, or source-specific wardrobe.' : null].filter(Boolean).join(' '),
    size: PASSPORT_OUTPUT.size, quality: 'high',
  };
  const minimal = {
    capability: 'multi-view-identity-reference', provider: generationSpec.preferredProvider,
    model: generationSpec.preferredModel, strategy: PASSPORT_PROVIDER_STRATEGY,
    candidateOrdinal: ordinal, identityVersionId: generationSpec.identityVersionId,
    identityLockVersionId: generationSpec.identityLockVersionId, generationSpecId: generationSpec.id,
    promptVersion: generationSpec.promptVersion, specVersion: generationSpec.specVersion,
    referenceCount: sourceImages.length,
  };
  return Object.freeze({ ...minimal, requestFingerprint: fingerprint({ ...minimal, requirements }),
    prompt: JSON.stringify({ description: 'Canonical Avatar Studio three-view identity passport', generation_requirements: requirements }),
    referenceImages: Object.freeze(sourceImages.map((item) => Object.freeze({ bytes: item.bytes,
      filename: item.filename, contentType: item.contentType }))),
    externalCalls: 1 });
}

module.exports = { PASSPORT_CALLS_PER_CANDIDATE, PASSPORT_PROVIDER_STRATEGY, compilePassportProviderRequest };
