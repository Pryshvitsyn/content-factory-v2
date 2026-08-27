'use strict';

const DEFAULT_NEGATIVE_INTENT = Object.freeze({
  composition: Object.freeze({ coherentFullFrame: true, singleCameraView: true,
    prohibitedLayouts: Object.freeze(['split-screen', 'diptych', 'triptych', 'quadrants', 'collage', 'storyboard', 'contact-sheet', 'picture-in-picture', 'divided-panels']) }),
  typography: Object.freeze({ policy: 'NO_GENERATED_TEXT', prohibited: Object.freeze(['subtitles', 'captions', 'logos', 'watermarks', 'UI', 'pseudo-text']) }),
  subjectIntegrity: Object.freeze({ prohibitMalformedAnatomy: true, prohibitDuplicatedSubjects: true }),
  delivery: Object.freeze({ importantCopyInPostProduction: true }),
});

function canonicalNegativeIntent(overrides = {}) {
  return Object.freeze({
    composition: Object.freeze({ ...DEFAULT_NEGATIVE_INTENT.composition, ...(overrides.composition || {}) }),
    typography: Object.freeze({ ...DEFAULT_NEGATIVE_INTENT.typography, ...(overrides.typography || {}) }),
    subjectIntegrity: Object.freeze({ ...DEFAULT_NEGATIVE_INTENT.subjectIntegrity, ...(overrides.subjectIntegrity || {}) }),
    delivery: Object.freeze({ ...DEFAULT_NEGATIVE_INTENT.delivery, ...(overrides.delivery || {}) }),
  });
}

function canonicalGuidance(intent = DEFAULT_NEGATIVE_INTENT) {
  const statements = [];
  if (intent.composition?.coherentFullFrame) statements.push('Render one coherent full-frame scene from one camera view.');
  if (intent.composition?.prohibitedLayouts?.length) statements.push('Do not divide the frame or show simultaneous independent scenes.');
  if (intent.typography?.policy === 'NO_GENERATED_TEXT') statements.push('Keep the image free of text-like marks; approved copy and brand typography are added in post-production.');
  if (intent.subjectIntegrity?.prohibitMalformedAnatomy) statements.push('Preserve believable human anatomy and a stable number of subjects.');
  return statements.join(' ');
}

function translateProviderPrompt({ canonicalPrompt, negativeIntent = DEFAULT_NEGATIVE_INTENT, provider, model } = {}) {
  const base = String(canonicalPrompt || '').trim();
  if (!base) throw new Error('canonicalPrompt is required');
  const shared = canonicalGuidance(negativeIntent);
  const providerInstruction = {
    replicate: 'Wan instruction: treat this as one continuous cinematic shot, never a montage or layout.',
    fal: 'Seedance instruction: preserve a single continuous scene and stable subject identity.',
    runway: 'Runway instruction: use one uninterrupted camera composition with no graphic overlays.',
    google: 'Veo instruction: maintain one coherent cinematic world and exclude typography or interface elements.',
    luma: 'Luma instruction: keep a single full-frame camera view with continuous geometry.',
  }[String(provider || '').toLowerCase()] || 'Provider instruction: preserve one coherent full-frame scene.';
  return Object.freeze({
    canonicalPrompt: base,
    providerPrompt: `${base}\n\nProduction constraints: ${shared} ${providerInstruction}`.trim(),
    provider: String(provider || '').toLowerCase() || null,
    model: model || null,
    negativeIntent: structuredClone(negativeIntent),
    adapterVersion: 'v2.9',
  });
}

module.exports = { DEFAULT_NEGATIVE_INTENT, canonicalGuidance, canonicalNegativeIntent, translateProviderPrompt };
