'use strict';

const crypto = require('node:crypto');
const { canonicalGuidance, canonicalNegativeIntent } = require('../v2.9/negative-intent');

function clean(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function brandBrain(brand = {}) {
  const facts = [
    ['mission', brand.mission], ['positioning', brand.positioning],
    ['productValue', brand.products?.[0]?.valueProposition],
    ['audienceProblem', brand.audiences?.[0]?.problemStatement],
    ['offerPromise', brand.offers?.[0]?.promise], ['campaign', brand.campaigns?.[0]?.name],
  ].filter(([, value]) => clean(value)).map(([key, value]) => ({ key, value: clean(value) }));
  return Object.freeze({ status: facts.length ? 'AVAILABLE' : 'EMPTY_OPERATOR_ONLY', facts });
}

function purposeFor(index, count) {
  if (count === 1) return 'Establish the human tension, reveal the insight, and land the CTA in one restrained beat.';
  if (index === 0) return 'Create immediate emotional ambiguity without resolving it.';
  if (index === count - 1) return 'Resolve the ambiguity through attention and land the brand idea.';
  return index < count / 2 ? 'Deepen the human situation with a distinct observable beat.' : 'Turn the situation from assumption toward attentive understanding.';
}

function deterministicSeed(requestId, index, strategy) {
  if (strategy === 'provider-random') return undefined;
  const suffix = strategy === 'shared-deterministic' ? 'shared' : `shot:${index + 1}`;
  return Number.parseInt(hash(`${requestId}:${suffix}`).slice(0, 8), 16) % 2147483647;
}

function planCreative({ request, brand, qualityProfile }) {
  const duration = Number(request.targetDurationSeconds);
  const count = Math.max(1, Math.ceil(duration / 5));
  const shotDuration = duration / count;
  const ideas = (clean(request.sceneIdeas) || '').split(/\n|;/).map((item) => item.trim()).filter(Boolean);
  const brain = brandBrain(brand);
  const environment = clean(request.location) || 'Environment exactly as specified by the operator creative brief';
  const subject = clean(request.subject) || 'Human subjects exactly as specified by the operator creative brief';
  const lighting = clean(request.visualDirection) || 'Natural, motivated practical lighting; believable skin tones';
  const continuity = Object.freeze({
    identity: `continuity-${hash(`${request.requestId}:${subject}:${environment}:${lighting}`).slice(0, 16)}`,
    appearance: subject, wardrobe: 'Keep wardrobe exactly consistent unless the operator requests a change.',
    environment, lightingColorLanguage: lighting,
    props: 'Keep established props and spatial relationships consistent.',
    referenceMedia: [], imageToVideo: { requested: false, referenceAssetIds: [], capabilityRequired: false },
  });
  const negativeIntent = canonicalNegativeIntent();
  const negative = ['app UI', 'phone close-up', 'glossy stock-ad look', 'exaggerated emotional acting', 'generated text', 'melodrama'];
  const shots = Array.from({ length: count }, (_, index) => {
    const isLast = index === count - 1;
    const action = ideas[index] || (isLast ? `A distinct visual resolution supporting: ${request.cta}` : `A distinct visual beat supporting: ${request.hook}`);
    const emotionalIntent = isLast ? 'A subtle shift toward attention and understanding; never sentimental.' : 'Believable uncertainty created by assumption; restrained and non-melodramatic.';
    const framing = clean(request.framing) || (index === 0 ? 'Vertical cinematic medium-wide establishing frame' : 'Vertical cinematic medium two-shot with intimate negative space');
    const camera = clean(request.camera) || 'Restrained observational camera, subtle natural movement only';
    const prompt = [
      `Shot purpose: ${purposeFor(index, count)}`,
      `Subject: ${subject}. Action: ${action}.`,
      `Environment: ${environment}. Emotional intent: ${emotionalIntent}`,
      `Framing: ${framing}. Camera: ${camera}. Lens/composition: natural perspective, layered depth, vertical 9:16 composition.`,
      `Lighting/style: ${lighting}. Believable human behavior and cinematic naturalism.`,
      `Continuity identity ${continuity.identity}: preserve appearance, wardrobe, environment, practical lighting, and props across shots.`,
      brain.status === 'AVAILABLE' ? `Brand Brain factual context: ${brain.facts.map((fact) => `${fact.key}=${fact.value}`).join('; ')}. Operator brief remains authoritative.` : 'Brand Brain is empty; use only operator-supplied creative facts.',
      clean(request.additionalInstructions) && `Operator constraints: ${clean(request.additionalInstructions)}`,
      `Canonical negative intent: ${canonicalGuidance(negativeIntent)}`,
      `Additional creative exclusions: ${negative.join(', ')}.`,
    ].filter(Boolean).join('\n');
    return Object.freeze({
      shotId: `operator-shot-${index + 1}`, assetId: `operator-video-${index + 1}`,
      purpose: purposeFor(index, count), durationSeconds: shotDuration, subject, description: action,
      subjectDescription: subject,
      action, environment, emotionalIntent, framing, camera,
      lensComposition: 'Natural perspective, layered depth, vertical 9:16 composition', lighting,
      style: clean(request.visualDirection) || 'Cinematic naturalism; specific, restrained human behavior',
      continuityIdentity: continuity.identity, generationPrompt: prompt, negativeGuidance: negative,
      negativeIntent,
      seed: deterministicSeed(request.requestId, index, qualityProfile?.seedStrategy || 'per-shot-deterministic'),
    });
  });
  return Object.freeze({
    schemaVersion: 1, planner: 'v2.7.1-deterministic-creative-director', operatorBriefAuthoritative: true,
    brandBrain: brain, continuity, negativeIntent, shots,
  });
}

module.exports = { brandBrain, planCreative };
