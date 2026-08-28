'use strict';

const assert = require('node:assert/strict');
const { CONTINUITY_FAMILY_PROPERTIES, OpenAISemanticVisualEvaluatorAdapter, OPENAI_RESPONSES_ENDPOINT,
  SOURCE_FAMILY_PROPERTIES, strictSchema } = require('../src/v2.9/openai-semantic-visual-evaluator');
const { createSemanticVisualEvaluatorAdapter } = require('../src/v2.9/semantic-visual-evaluator-factory');
const { DisabledSemanticVisualEvaluatorAdapter, FunctionSemanticVisualEvaluatorAdapter } = require('../src/v2.9/semantic-visual-evaluator');
const { semanticEvaluationPlan } = require('../src/v2.9/semantic-evaluation-policy');
const { QualityRendererLane } = require('../src/v2.6/renderer-router');
const { REASON_CODES, qualityCheck, qualityResult } = require('../src/v2.9/quality-contract');
const { SEMANTIC_FIXTURES, result: semanticFixture } = require('./fixtures/v2.9.1/semantic-results');

const API_KEY = 'synthetic-test-key-never-log';
const MODEL = 'explicit-vision-test-model';
const creativePlan = Object.freeze({ subject: 'A couple at home', action: 'One partner notices the other',
  environment: 'Soft natural morning light', framing: 'one coherent full-frame cinematic shot',
  emotionalIntent: 'warmth and attention', visualStyle: 'cinematic naturalism' });
const negativeIntent = Object.freeze({ prohibited: ['split screen', 'triptych', 'text', 'logos', 'app UI', 'watermark'] });
const frames = Object.freeze([0.1, 0.5, 0.9].map((ratio, index) => Object.freeze({ ratio,
  timestampMs: [500, 2500, 4500][index], contentType: 'image/jpeg', bytes: Buffer.from(`jpeg-${index}`),
  analysisHash: `hash-${index}` })));

function httpResponse({ status = 200, body = {}, requestId = 'req_semantic_test' } = {}) {
  return { ok: status >= 200 && status < 300, status,
    headers: { get: (name) => name.toLowerCase() === 'x-request-id' ? requestId : null },
    async json() { return body; } };
}

function openAIResponse(value, usage = { input_tokens: 123, output_tokens: 45 }) {
  return { id: 'resp_semantic_test', status: 'completed', usage,
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] };
}

function adapter(fetchImpl, overrides = {}) {
  return new OpenAISemanticVisualEvaluatorAdapter({ apiKey: API_KEY, model: MODEL,
    paidExecutionAuthorized: true, fetchImpl, maxRetries: 0, timeoutMs: 50, sleep: async () => {}, ...overrides });
}

async function evaluate(instance, overrides = {}) {
  return instance.evaluate({ frames, creativePlan, negativeIntent, expectedAspectRatio: '9:16',
    intendedContentType: 'cinematic', qualityTier: 'STANDARD', evaluationClass: 'SOURCE', ...overrides });
}

function plan(adapterInstance, profile = 'STANDARD', videoCount = 1, audioCount = 1) {
  const lane = new QualityRendererLane({ masterOrchestrator: { build() {} },
    qualityEvaluator: { semanticAdapter: adapterInstance } });
  const assets = [...Array(videoCount)].map((_, index) => ({ asset_id: `video-${index + 1}`, kind: 'video',
    generation_requirements: { profile } })).concat([...Array(audioCount)].map((_, index) => ({
      asset_id: `voice-${index + 1}`, kind: 'voice', generation_requirements: {} })));
  return lane.plan({ input: { assetPlan: { assets }, captions: { enabled: false } }, config: {}, existing: null,
    laneState: { executions: [], availability: { configured: true, status: 'READY' } } });
}

async function main() {
  let captured = null;
  const successful = adapter(async (url, request) => {
    captured = { url, request, body: JSON.parse(request.body) };
    return httpResponse({ body: openAIResponse(SEMANTIC_FIXTURES.pass), requestId: 'req_safe_123' });
  });
  const passed = await evaluate(successful);
  assert.equal(passed.status, 'PASS');
  assert.equal(passed.metadata.provider, 'openai'); assert.equal(passed.metadata.model, MODEL);
  assert.equal(passed.metadata.requestId, 'req_safe_123'); assert.equal(passed.metadata.externalCalls, 1);
  assert.deepEqual(passed.metadata.usage, { input_tokens: 123, output_tokens: 45 });
  assert.equal(passed.metadata.knownCost, 'UNKNOWN');
  assert.equal(captured.url, OPENAI_RESPONSES_ENDPOINT);
  assert.equal(captured.request.method, 'POST');
  assert.equal(captured.body.model, MODEL); assert.equal(captured.body.store, false);
  assert.equal(captured.body.text.format.type, 'json_schema'); assert.equal(captured.body.text.format.strict, true);
  assert.equal(captured.body.text.format.schema.additionalProperties, false);
  assert.deepEqual(captured.body.text.format.schema.properties.checks.required, Object.keys(SOURCE_FAMILY_PROPERTIES));
  assert.equal(captured.body.text.format.schema.properties.checks.type, 'object');
  assert.equal(captured.body.text.format.schema.properties.checks.additionalProperties, false);
  const content = captured.body.input[0].content;
  assert.equal(content.filter((item) => item.type === 'input_image').length, 3);
  assert(content.filter((item) => item.type === 'input_image').every((item) => item.image_url.startsWith('data:image/jpeg;base64,')));
  const suppliedText = content.filter((item) => item.type === 'input_text').map((item) => item.text).join('\n');
  assert.match(suppliedText, /A couple at home/); assert.match(suppliedText, /split screen/);
  assert.match(suppliedText, /timestamp 2500ms/);
  assert(!JSON.stringify(passed).includes(API_KEY), 'credentials must not enter results/evidence');

  for (const [fixture, expectedCode, expectedStatus] of [
    ['triptych', REASON_CODES.TRIPTYCH_DETECTED, 'FAIL'],
    ['pseudoText', REASON_CODES.PSEUDO_TEXT_ARTIFACT, 'FAIL'],
    ['humanDeformation', REASON_CODES.SEVERE_ANATOMY_DEFORMATION, 'FAIL'],
    ['creativeMismatch', REASON_CODES.CREATIVE_PLAN_MISMATCH, 'FAIL'],
    ['warning', REASON_CODES.REALISM_QUALITY, 'WARN'],
  ]) {
    const result = await evaluate(adapter(async () => httpResponse({ body: openAIResponse(SEMANTIC_FIXTURES[fixture]) })));
    assert.equal(result.status, expectedStatus); assert(result.checks.some((check) => check.code === expectedCode));
  }

  const malformedJson = await evaluate(adapter(async () => httpResponse({ body: {
    output: [{ content: [{ type: 'output_text', text: '{bad-json' }] }], usage: { input_tokens: 1 },
  } })));
  assert.equal(malformedJson.status, 'FAIL');
  assert.equal(malformedJson.checks[0].code, REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE);
  const malformedSchema = await evaluate(adapter(async () => httpResponse({ body: openAIResponse({ status: 'PASS', checks: [] }) })));
  assert.equal(malformedSchema.status, 'FAIL');
  for (const family of Object.keys(SOURCE_FAMILY_PROPERTIES)) {
    const incomplete = structuredClone(SEMANTIC_FIXTURES.pass); delete incomplete.checks[family];
    const missingRequiredFamily = await evaluate(adapter(async () => httpResponse({ body: openAIResponse(incomplete) })));
    assert.equal(missingRequiredFamily.status, 'FAIL', `missing source family ${family} must fail closed`);
    assert.equal(missingRequiredFamily.checks[0].code, REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE);
  }
  const brandSafetyDefect = await evaluate(adapter(async () => httpResponse({ body: openAIResponse(semanticFixture(
    REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT, 'FAIL', 'A prohibited brand element is clearly visible.')) })));
  assert.equal(brandSafetyDefect.status, 'FAIL');
  assert.equal(brandSafetyDefect.checks.find((check) => check.code === REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT).status, 'FAIL');

  for (const [status, code] of [[401, REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_AUTH_FAILED],
    [429, REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_RATE_LIMITED], [500, REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_HTTP_FAILED]]) {
    const result = await evaluate(adapter(async () => httpResponse({ status, body: {} })));
    assert.equal(result.status, 'FAIL'); assert.equal(result.checks[0].code, code); assert.equal(result.metadata.externalCalls, 1);
  }
  const network = await evaluate(adapter(async () => { throw new Error('synthetic network reset'); }));
  assert.equal(network.checks[0].code, REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_NETWORK_FAILED);
  const timedOut = await evaluate(adapter(async () => new Promise(() => {}), { timeoutMs: 5 }));
  assert.equal(timedOut.checks[0].code, REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_TIMEOUT);

  let retryAttempts = 0;
  const retried = await evaluate(adapter(async () => {
    retryAttempts += 1;
    return retryAttempts === 1 ? httpResponse({ status: 429 })
      : httpResponse({ body: openAIResponse(SEMANTIC_FIXTURES.pass) });
  }, { maxRetries: 1 }));
  assert.equal(retried.status, 'PASS'); assert.equal(retried.metadata.externalCalls, 2); assert.equal(retryAttempts, 2);

  const singleContinuity = await successful.evaluateContinuity({ qualityTier: 'STANDARD',
    shotEvaluations: [{ assetId: 'one', evaluation: { sampledFrames: frames } }] });
  assert.equal(singleContinuity.status, 'PASS'); assert.equal(singleContinuity.metadata.externalCalls, 0);
  assert.equal(singleContinuity.checks[0].code, 'CONTINUITY_NOT_APPLICABLE');
  let continuityRequests = 0;
  const continuity = adapter(async () => { continuityRequests += 1;
    return httpResponse({ body: openAIResponse(SEMANTIC_FIXTURES.continuityPass) }); });
  const continuityPassed = await continuity.evaluateContinuity({ qualityTier: 'STANDARD', creativePlan,
    shotEvaluations: [{ assetId: 'one', evaluation: { sampledFrames: frames } },
      { assetId: 'two', evaluation: { sampledFrames: frames } }] });
  assert.equal(continuityPassed.status, 'PASS'); assert.equal(continuityRequests, 1);
  const continuitySchema = strictSchema('CONTINUITY_QUALITY');
  assert.deepEqual(continuitySchema.properties.checks.required, Object.keys(CONTINUITY_FAMILY_PROPERTIES));
  for (const family of Object.keys(CONTINUITY_FAMILY_PROPERTIES)) {
    const incomplete = structuredClone(SEMANTIC_FIXTURES.continuityPass); delete incomplete.checks[family];
    const result = await adapter(async () => httpResponse({ body: openAIResponse(incomplete) })).evaluateContinuity({
      qualityTier: 'STANDARD', creativePlan,
      shotEvaluations: [{ assetId: 'one', evaluation: { sampledFrames: frames } },
        { assetId: 'two', evaluation: { sampledFrames: frames } }],
    });
    assert.equal(result.status, 'FAIL', `missing continuity family ${family} must fail closed`);
    assert.equal(result.checks[0].code, REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE);
  }
  const continuityFailed = await adapter(async () => httpResponse({ body: openAIResponse(SEMANTIC_FIXTURES.continuityFail) }))
    .evaluateContinuity({ qualityTier: 'STANDARD', creativePlan,
      shotEvaluations: [{ evaluation: { sampledFrames: frames } }, { evaluation: { sampledFrames: frames } }] });
  assert.equal(continuityFailed.status, 'FAIL');

  const configured = createSemanticVisualEvaluatorAdapter({ env: { SEMANTIC_VISUAL_ENABLED: 'true',
    SEMANTIC_VISUAL_PROVIDER: 'openai', SEMANTIC_VISUAL_MODEL: MODEL, OPENAI_API_KEY: API_KEY,
    LIVE_PAID_VISUAL_EVALUATION: 'true' }, fetchImpl: async () => { throw new Error('must not run during factory/preflight'); } });
  assert.equal(configured.configured, true); assert.equal(configured.provider, 'openai');
  const missingKey = createSemanticVisualEvaluatorAdapter({ env: { SEMANTIC_VISUAL_ENABLED: 'true',
    SEMANTIC_VISUAL_PROVIDER: 'openai', SEMANTIC_VISUAL_MODEL: MODEL, LIVE_PAID_VISUAL_EVALUATION: 'true' } });
  assert.equal(missingKey.configured, false); assert(missingKey.configurationErrors.includes('OPENAI_API_KEY_REQUIRED'));
  const missingModel = createSemanticVisualEvaluatorAdapter({ env: { SEMANTIC_VISUAL_ENABLED: 'true',
    SEMANTIC_VISUAL_PROVIDER: 'openai', OPENAI_API_KEY: API_KEY, LIVE_PAID_VISUAL_EVALUATION: 'true' } });
  assert(missingModel.configurationErrors.includes('SEMANTIC_VISUAL_MODEL_REQUIRED'));
  const closedGate = createSemanticVisualEvaluatorAdapter({ env: { SEMANTIC_VISUAL_ENABLED: 'true',
    SEMANTIC_VISUAL_PROVIDER: 'openai', SEMANTIC_VISUAL_MODEL: MODEL, OPENAI_API_KEY: API_KEY,
    LIVE_PAID_VISUAL_EVALUATION: 'false' } });
  assert.equal(closedGate.reasonCode, REASON_CODES.SEMANTIC_VISUAL_PAID_GATE_REQUIRED);
  const disabled = new DisabledSemanticVisualEvaluatorAdapter();
  assert.equal(plan(disabled, 'STANDARD').readiness, 'BLOCKED');
  assert.equal(plan(disabled, 'ECONOMY').readiness, 'READY');
  assert.equal(plan(disabled, 'STANDARD').expectedQualityEvaluatorCalls, 0);

  const standardPlan = plan(configured, 'STANDARD', 1, 1);
  assert.equal(standardPlan.expectedSourceSemanticEvaluations, 1);
  assert.equal(standardPlan.expectedFinalSemanticEvaluations, 0);
  assert.equal(standardPlan.expectedContinuityEvaluations, 0);
  assert.equal(standardPlan.expectedQualityEvaluatorCalls, 1);
  assert.equal(standardPlan.expectedPaidProviderCalls, 2);
  assert.deepEqual(standardPlan.expectedExternalExecutionClasses,
    ['VIDEO_GENERATION','SPEECH_GENERATION','SEMANTIC_VISUAL_EVALUATION']);
  assert.equal(standardPlan.expectedPaidProviderCalls + standardPlan.expectedQualityEvaluatorCalls, 3,
    'one-shot Attune STANDARD preflight must show exactly three planned external calls');
  assert.equal(standardPlan.expectedExternalServiceCalls, 3);
  assert.equal(standardPlan.expectedExternalServiceCallCeiling, 4,
    'one bounded retry is a conditional ceiling, not a hidden planned call');
  const twoShotPlan = plan(configured, 'STANDARD', 2, 1);
  assert.equal(twoShotPlan.expectedSourceSemanticEvaluations, 2);
  assert.equal(twoShotPlan.expectedContinuityEvaluations, 1);
  assert.equal(twoShotPlan.expectedQualityEvaluatorCalls, 3);
  const premiumPlan = plan(configured, 'PREMIUM', 1, 1);
  assert.equal(premiumPlan.expectedSourceSemanticEvaluations, 1);
  assert.equal(premiumPlan.expectedFinalSemanticEvaluations, 1);
  assert.equal(premiumPlan.expectedQualityEvaluatorCalls, 2);
  assert.equal(semanticEvaluationPlan({ qualityTier: 'STANDARD', videoCount: 1,
    masterVisualTransforms: true, semanticAdapter: configured }).finalEvaluations, 1);

  let fakeCalls = 0;
  const deterministicFake = new FunctionSemanticVisualEvaluatorAdapter({ provider: 'fixture-semantic', model: 'v2.9.1-fixture',
    estimatedCallsPerEvaluation: 0, evaluate: async ({ qualityTier }) => { fakeCalls += 1;
      return qualityResult({ qualityClass: 'SEMANTIC_VISUAL', tier: qualityTier, checks: [qualityCheck({
        code: REASON_CODES.SINGLE_COHERENT_COMPOSITION, status: 'PASS', qualityClass: 'SEMANTIC_VISUAL',
        reason: 'Deterministic fixture pass.' })], metadata: { externalCalls: 0 } }); } });
  const fakeResult = await deterministicFake.evaluate({ qualityTier: 'STANDARD' });
  assert.equal(fakeResult.status, 'PASS'); assert.equal(fakeCalls, 1); assert.equal(fakeResult.metadata.externalCalls, 0);

  console.log('V2.9.1 OpenAI semantic adapter, strict schema, failures, retries, continuity, policy, and zero-call preflight passed (real external calls 0).');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
