'use strict';

const { isDeepStrictEqual } = require('node:util');

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

function translateProviderPrompt({ canonicalPrompt, negativeIntent = DEFAULT_NEGATIVE_INTENT, provider, model, capability, promptCompilerVersion } = {}) {
  const base = String(canonicalPrompt || '').trim();
  if (!base) throw new Error('canonicalPrompt is required');
  const shared = canonicalGuidance(negativeIntent);
  const family = /(?:wan[-/]|wan3)/i.test(model || '') ? 'Wan'
    : /seedance/i.test(model || '') ? 'Seedance'
    : /^gen4/.test(model || '') ? 'Runway'
    : /^veo/.test(model || '') ? 'Veo'
    : /^ray-/.test(model || '') ? 'Luma' : null;
  const video = !capability || /VIDEO/.test(capability);
  // This compact rendering is allowed only for the versioned shot compiler
  // and the exact default policy. Custom policy and historical inputs retain
  // their existing translation; never discard custom instructions to fit.
  const compact = video && promptCompilerVersion === 'shot/4'
    && isDeepStrictEqual(negativeIntent, DEFAULT_NEGATIVE_INTENT);
  const compactGuidance = 'One full-frame take; safe margins. No panels, text, bad anatomy or duplicate subjects; copy in post.';
  const providerInstruction = video && family
    ? `${family} instruction: render one continuous cinematic shot; preserve the specified shot states, action and continuous geometry.` : '';
  return Object.freeze({
    canonicalPrompt: base,
    providerPrompt: compact ? `${base}\n${compactGuidance}`
      : video ? `${base}\n\nProduction constraints: ${shared} ${providerInstruction}`.trim() : base,
    provider: String(provider || '').toLowerCase() || null,
    model: model || null,
    negativeIntent: structuredClone(negativeIntent),
    adapterVersion: compact ? 'provider-prompt/3' : 'provider-prompt/2',
  });
}

module.exports = { DEFAULT_NEGATIVE_INTENT, canonicalGuidance, canonicalNegativeIntent, translateProviderPrompt };
