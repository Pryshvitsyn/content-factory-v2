'use strict';

const { SemanticVisualEvaluatorAdapter } = require('./semantic-visual-evaluator');
const { REASON_CODES, qualityCheck, qualityResult, normalizeTier } = require('./quality-contract');

const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const EVALUATOR_VERSION = 'v2.10.3';
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const ALLOWED_CODES = Object.freeze(Object.values(REASON_CODES));
const REQUIRED_SOURCE_GROUPS = Object.freeze([
  Object.freeze([REASON_CODES.SINGLE_COHERENT_COMPOSITION, REASON_CODES.MULTI_PANEL_COMPOSITION,
    REASON_CODES.TRIPTYCH_DETECTED, REASON_CODES.SPLIT_SCREEN_DETECTED, REASON_CODES.CONTACT_SHEET_DETECTED,
    REASON_CODES.PICTURE_IN_PICTURE_UNEXPECTED]),
  Object.freeze([REASON_CODES.UNEXPECTED_GENERATED_TEXT, REASON_CODES.PSEUDO_TEXT_ARTIFACT]),
  Object.freeze([REASON_CODES.HUMAN_VISUAL_INTEGRITY, REASON_CODES.SEVERE_FACE_DEFORMATION,
    REASON_CODES.SEVERE_ANATOMY_DEFORMATION]),
  Object.freeze([REASON_CODES.CREATIVE_PLAN_MISMATCH, REASON_CODES.SUBJECT_MISMATCH]),
  Object.freeze([REASON_CODES.REALISM_QUALITY]),
  Object.freeze([REASON_CODES.BRAND_SAFETY_PROHIBITED_ELEMENT]),
  Object.freeze([REASON_CODES.TEMPORAL_SEMANTIC_CONSISTENCY, REASON_CODES.IDENTITY_DRIFT,
    REASON_CODES.OBJECT_DISAPPEARANCE]),
]);
const REQUIRED_CONTINUITY_GROUPS = Object.freeze([
  Object.freeze([REASON_CODES.VISUAL_IDENTITY_CONTINUITY, REASON_CODES.CHARACTER_IDENTITY_DRIFT,
    REASON_CODES.CONTINUITY_FAILURE, REASON_CODES.IDENTITY_DRIFT]),
  Object.freeze([REASON_CODES.WARDROBE_CONTINUITY, REASON_CODES.WARDROBE_CONTINUITY_DRIFT]),
  Object.freeze([REASON_CODES.LOCATION_CONTINUITY, REASON_CODES.ENVIRONMENT_CONTINUITY_DRIFT]),
  Object.freeze([REASON_CODES.PROP_CONTINUITY, REASON_CODES.PROP_CONTINUITY_DRIFT]),
  Object.freeze([REASON_CODES.LIGHTING_COLOR_CONTINUITY, REASON_CODES.LIGHTING_COLOR_CONTINUITY_DRIFT]),
  Object.freeze([REASON_CODES.VISUAL_STYLE_CONTINUITY, REASON_CODES.VISUAL_STYLE_CONTINUITY_DRIFT]),
  Object.freeze([REASON_CODES.CROSS_SHOT_REALISM_CONTINUITY, REASON_CODES.CROSS_SHOT_REALISM_DRIFT]),
  Object.freeze([REASON_CODES.ACTING_STYLE_CONTINUITY, REASON_CODES.ACTING_STYLE_CONTINUITY_DRIFT]),
]);

const SOURCE_FAMILY_PROPERTIES = Object.freeze({
  composition: REQUIRED_SOURCE_GROUPS[0],
  generatedText: REQUIRED_SOURCE_GROUPS[1],
  humanIntegrity: REQUIRED_SOURCE_GROUPS[2],
  creativeCompliance: REQUIRED_SOURCE_GROUPS[3],
  realism: REQUIRED_SOURCE_GROUPS[4],
  brandSafety: REQUIRED_SOURCE_GROUPS[5],
  temporalConsistency: REQUIRED_SOURCE_GROUPS[6],
});
const CONTINUITY_FAMILY_PROPERTIES = Object.freeze({
  characterIdentity: REQUIRED_CONTINUITY_GROUPS[0],
  wardrobe: REQUIRED_CONTINUITY_GROUPS[1],
  environment: REQUIRED_CONTINUITY_GROUPS[2],
  props: REQUIRED_CONTINUITY_GROUPS[3],
  lightingColor: REQUIRED_CONTINUITY_GROUPS[4],
  visualStyle: REQUIRED_CONTINUITY_GROUPS[5],
  realism: REQUIRED_CONTINUITY_GROUPS[6],
  actingMotion: REQUIRED_CONTINUITY_GROUPS[7],
});
const CONTINUITY_DRIFT_CODE_BY_FAMILY = Object.freeze({
  characterIdentity: REASON_CODES.CHARACTER_IDENTITY_DRIFT,
  wardrobe: REASON_CODES.WARDROBE_CONTINUITY_DRIFT,
  environment: REASON_CODES.ENVIRONMENT_CONTINUITY_DRIFT,
  props: REASON_CODES.PROP_CONTINUITY_DRIFT,
  lightingColor: REASON_CODES.LIGHTING_COLOR_CONTINUITY_DRIFT,
  visualStyle: REASON_CODES.VISUAL_STYLE_CONTINUITY_DRIFT,
  realism: REASON_CODES.CROSS_SHOT_REALISM_DRIFT,
  actingMotion: REASON_CODES.ACTING_STYLE_CONTINUITY_DRIFT,
});

const CRITIC_INSTRUCTIONS = `You are a strict production visual-quality critic. Judge only visible evidence in the ordered frames and the supplied creative contract. Do not rewrite the brief, generate prompts, compliment the work, assume defects, or fabricate certainty. Be strict about visible production defects, but do not invent defects that are not visible. Use WARN for ambiguous or minor defects and FAIL for obvious material defects. Respect explicitly requested split-screen, panels, text, logos, UI, phones, or stylization. Return every required semantic family even when no defect is visible. A clean family must explicitly return PASS with a concrete reason and evidence arrays; never omit a family. Return only the required structured result.`;

function familyCheckSchema(qualityClass, allowedCodes) {
  return {
    type: 'object', additionalProperties: false,
    required: ['code', 'status', 'confidence', 'qualityClass', 'reason', 'evidence'],
    properties: {
      code: { type: 'string', enum: allowedCodes },
      status: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      qualityClass: { type: 'string', enum: [qualityClass] },
      reason: { type: 'string', minLength: 1, maxLength: 500 },
      evidence: { type: 'object', additionalProperties: false,
        required: ['frameRatios', 'timestampsMs'], properties: {
          frameRatios: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 } },
          timestampsMs: { type: 'array', items: { type: 'integer', minimum: 0 } },
        } },
    },
  };
}

function strictSchema(qualityClass) {
  const families = qualityClass === 'CONTINUITY_QUALITY'
    ? CONTINUITY_FAMILY_PROPERTIES : SOURCE_FAMILY_PROPERTIES;
  return {
    type: 'object', additionalProperties: false, required: ['status', 'checks'],
    properties: {
      status: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
      checks: { type: 'object', additionalProperties: false, required: Object.keys(families),
        properties: Object.fromEntries(Object.entries(families)
          .map(([name, codes]) => [name, familyCheckSchema(qualityClass, codes)])) },
    },
  };
}

function safeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const clean = {};
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = safeUsage(value); if (nested && Object.keys(nested).length) clean[key] = nested;
    }
  }
  return Object.keys(clean).length ? clean : null;
}

function outputText(response) {
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'refusal') throw Object.assign(new Error('Evaluator refused the structured request'),
        { code: REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE });
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw Object.assign(new Error('Evaluator response did not contain structured output text'),
    { code: REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE });
}

function validateStructuredResult(value, qualityClass, tier) {
  const families = qualityClass === 'CONTINUITY_QUALITY'
    ? CONTINUITY_FAMILY_PROPERTIES : SOURCE_FAMILY_PROPERTIES;
  if (!value || typeof value !== 'object' || !['PASS','WARN','FAIL'].includes(value.status)
    || !value.checks || typeof value.checks !== 'object' || Array.isArray(value.checks)
    || Object.keys(families).some((name) => !value.checks[name])) {
    throw Object.assign(new Error('Evaluator returned an invalid structured result'),
      { code: REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE });
  }
  const checks = Object.entries(families).map(([familyName, allowedCodes]) => {
    const check = value.checks[familyName];
    const evidence = check?.evidence;
    if (!check || !allowedCodes.includes(check.code) || !['PASS','WARN','FAIL'].includes(check.status)
      || check.qualityClass !== qualityClass || typeof check.reason !== 'string' || !check.reason.trim()
      || !Number.isFinite(check.confidence) || check.confidence < 0 || check.confidence > 1
      || !evidence || !Array.isArray(evidence.frameRatios) || !Array.isArray(evidence.timestampsMs)
      || evidence.frameRatios.some((ratio) => !Number.isFinite(ratio) || ratio < 0 || ratio > 1)
      || evidence.timestampsMs.some((timestamp) => !Number.isInteger(timestamp) || timestamp < 0)) {
      throw Object.assign(new Error('Evaluator check failed local schema validation'),
        { code: REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE });
    }
    const code = qualityClass === 'CONTINUITY_QUALITY' && check.status !== 'PASS'
      ? (CONTINUITY_DRIFT_CODE_BY_FAMILY[familyName] || check.code) : check.code;
    return qualityCheck({ code, status: check.status, confidence: check.confidence,
      qualityClass, reason: check.reason.trim(), evidence });
  });
  const normalized = qualityResult({ qualityClass, tier, checks });
  if (normalized.status !== value.status) throw Object.assign(new Error('Evaluator aggregate status conflicts with its checks'),
    { code: REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE });
  return normalized;
}

function failureCodeForStatus(status) {
  if (status === 401 || status === 403) return REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_AUTH_FAILED;
  if (status === 429) return REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_RATE_LIMITED;
  return REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_HTTP_FAILED;
}

function evaluationFailure({ code, message, tier, qualityClass, provider, model, attempts, requestId = null } = {}) {
  return qualityResult({ qualityClass, tier, checks: [qualityCheck({ code, status: 'FAIL', qualityClass,
    confidence: 1, hardFailure: false, reason: message })], metadata: {
    configured: true, provider, model, evaluatorVersion: EVALUATOR_VERSION, externalCalls: attempts,
    attempts, requestId, usage: null, knownCost: 'UNKNOWN', evaluationType: qualityClass === 'CONTINUITY_QUALITY'
      ? 'continuity_evaluation' : 'semantic_visual_evaluation',
  } });
}

class OpenAISemanticVisualEvaluatorAdapter extends SemanticVisualEvaluatorAdapter {
  constructor({ apiKey, model, paidExecutionAuthorized = false, fetchImpl = global.fetch,
    timeoutMs = 30000, maxRetries = 1, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    endpoint = OPENAI_RESPONSES_ENDPOINT } = {}) {
    if (!apiKey || typeof apiKey !== 'string') throw new Error('OPENAI_API_KEY is required');
    if (!model || typeof model !== 'string') throw new Error('SEMANTIC_VISUAL_MODEL is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
    super({ provider: 'openai', model, estimatedCallsPerEvaluation: 1, estimatedContinuityCalls: 1,
      configured: true, paidExecutionAuthorized, configurationStatus: paidExecutionAuthorized
        ? 'CONFIGURED' : 'PAID_GATE_CLOSED' });
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.sleep = sleep;
    this.endpoint = endpoint;
  }

  async request(body) {
    let attempts = 0; let lastRequestId = null;
    for (let retry = 0; retry <= this.maxRetries; retry += 1) {
      attempts += 1;
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('Semantic evaluator timed out'),
            { code: REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_TIMEOUT })); }, this.timeoutMs);
        });
        const response = await Promise.race([this.fetchImpl(this.endpoint, { method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body) }), timeout]);
        clearTimeout(timer);
        lastRequestId = response.headers?.get?.('x-request-id') || lastRequestId;
        if (!response.ok) {
          const error = Object.assign(new Error(`OpenAI semantic evaluator HTTP ${response.status}`), {
            code: failureCodeForStatus(response.status), status: response.status, requestId: lastRequestId,
          });
          if (TRANSIENT_STATUS.has(response.status) && retry < this.maxRetries) {
            await this.sleep(Math.min(1000, 200 * (2 ** retry))); continue;
          }
          throw error;
        }
        let parsed;
        try { parsed = await response.json(); }
        catch (cause) { throw Object.assign(new Error('OpenAI evaluator returned malformed JSON'), {
          code: REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE, cause,
        }); }
        return { response: parsed, attempts, requestId: lastRequestId };
      } catch (error) {
        clearTimeout(timer);
        if (!error.code) error.code = error.name === 'AbortError'
          ? REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_TIMEOUT : REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_NETWORK_FAILED;
        if ([REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_TIMEOUT, REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_NETWORK_FAILED]
          .includes(error.code) && retry < this.maxRetries) {
          await this.sleep(Math.min(1000, 200 * (2 ** retry))); continue;
        }
        error.attempts = attempts; error.requestId = error.requestId || lastRequestId; throw error;
      }
    }
    throw new Error('Unreachable evaluator retry state');
  }

  contentForFrames(frames) {
    const content = [];
    for (const [index, frame] of frames.entries()) {
      const shotLabel = frame.shotId || (frame.shotIndex == null ? null : `shot ${frame.shotIndex + 1}`);
      content.push({ type: 'input_text', text: `Ordered frame ${index + 1}${shotLabel ? ` from ${shotLabel}` : ''}: ratio ${frame.ratio}, timestamp ${frame.timestampMs}ms.` });
      content.push({ type: 'input_image', image_url: `data:${frame.contentType || 'image/jpeg'};base64,${Buffer.from(frame.bytes || frame.jpeg).toString('base64')}`, detail: 'high' });
    }
    return content;
  }

  async evaluateStructured({ frames, creativePlan, negativeIntent, expectedAspectRatio, intendedContentType,
    qualityTier, evaluationClass, qualityClass, continuity = false } = {}) {
    const tier = normalizeTier(qualityTier);
    if (!this.paidExecutionAuthorized) return evaluationFailure({
      code: REASON_CODES.SEMANTIC_VISUAL_PAID_GATE_REQUIRED,
      message: 'LIVE_PAID_VISUAL_EVALUATION=true is required before semantic evaluator execution.',
      tier, qualityClass, provider: this.provider, model: this.model, attempts: 0,
    });
    if (!Array.isArray(frames) || frames.length === 0) return evaluationFailure({
      code: REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE,
      message: 'Semantic evaluation requires sampled frame evidence; no external request was made.',
      tier, qualityClass, provider: this.provider, model: this.model, attempts: 0,
    });
    const schema = strictSchema(qualityClass);
    const criteria = continuity
      ? 'Judge whether this is convincingly the same film across shots: same character identity/facial structure/apparent age/hair/skin/build, wardrobe identity, environment/layout/props, lighting/color language, overall rendering and realism level, and acting/motion style. Respect the creative plan: intentional framing, camera-distance, angle, lens, blocking, and emotional-progression changes are allowed and must not be mislabeled as identity drift by themselves.'
      : 'Judge coherent composition and unexpected panels; text-like artifacts without relying on transcription; severe human defects; creative/subject/environment/action/framing/emotion/style/negative-intent compliance; requested realism; prohibited logos/UI/phones/watermarks; and temporal identity, duplication, object, and environment consistency.';
    const content = [{ type: 'input_text', text: `${criteria}\nEvaluation class: ${evaluationClass}.\nExpected aspect ratio: ${expectedAspectRatio || 'unspecified'}.\nIntended content: ${intendedContentType || 'unspecified'}.\nCreative plan: ${JSON.stringify(creativePlan || {})}\nCanonical negative intent: ${JSON.stringify(negativeIntent || {})}` },
      ...this.contentForFrames(frames || [])];
    let requested;
    try {
      requested = await this.request({ model: this.model, store: false, max_output_tokens: 3000,
        instructions: CRITIC_INSTRUCTIONS,
        input: [{ role: 'user', content }],
        text: { format: { type: 'json_schema', name: continuity
          ? 'visual_continuity_quality_v2_10_3' : 'semantic_visual_quality_v2_9_1', strict: true, schema } },
      });
      if (requested.response?.status && requested.response.status !== 'completed') {
        throw Object.assign(new Error(`Evaluator response status was ${requested.response.status}`),
          { code: REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE,
            attempts: requested.attempts, requestId: requested.requestId });
      }
      const parsed = JSON.parse(outputText(requested.response));
      const normalized = validateStructuredResult(parsed, qualityClass, tier);
      return Object.freeze({ ...normalized, metadata: Object.freeze({
        configured: true, provider: this.provider, model: this.model, evaluatorVersion: EVALUATOR_VERSION,
        externalCalls: requested.attempts, attempts: requested.attempts,
        requestId: requested.requestId || requested.response?.id || null,
        usage: safeUsage(requested.response?.usage), knownCost: 'UNKNOWN',
        sampledFrameHashes: Object.freeze((frames || []).map((frame) => frame.analysisHash).filter(Boolean)),
        sampledFrameTimestampsMs: Object.freeze((frames || []).map((frame) => frame.timestampMs)),
        evaluationType: continuity ? 'continuity_evaluation' : 'semantic_visual_evaluation',
      }) });
    } catch (error) {
      return evaluationFailure({ code: error.code || REASON_CODES.SEMANTIC_VISUAL_EVALUATOR_MALFORMED_RESPONSE,
        message: `Semantic visual evaluator failed closed: ${error.message}`, tier, qualityClass,
        provider: this.provider, model: this.model, attempts: error.attempts || requested?.attempts || 1,
        requestId: error.requestId || requested?.requestId || null });
    }
  }

  async evaluate(input = {}) {
    return this.evaluateStructured({ ...input, qualityClass: 'SEMANTIC_VISUAL', continuity: false });
  }

  async evaluateContinuity(input = {}) {
    const tier = normalizeTier(input.qualityTier); const shots = input.shotEvaluations || [];
    if (shots.length <= 1) return qualityResult({ qualityClass: 'CONTINUITY_QUALITY', tier, checks: [qualityCheck({
      code: 'CONTINUITY_NOT_APPLICABLE', status: 'PASS', qualityClass: 'CONTINUITY_QUALITY', hardFailure: false,
      reason: 'Cross-shot continuity is not applicable to a single-shot production.' })], metadata: {
      configured: true, provider: this.provider, model: this.model, evaluatorVersion: EVALUATOR_VERSION,
      externalCalls: 0, attempts: 0, shotCount: shots.length, comparedShots: shots.map((shot) => ({
        shotId: shot.shotId || null, assetId: shot.assetId || null, artifactId: shot.artifactId || null,
        artifactVersion: shot.artifactVersion || null, artifactContentHash: shot.artifactContentHash || null })),
      evaluationType: 'continuity_evaluation',
    } });
    const frames = shots.flatMap((shot, shotIndex) => (shot.evaluation?.sampledFrames || []).filter((_frame, index, all) => (
      index === 0 || index === all.length - 1)).map((frame) => ({ ...frame,
      bytes: frame.bytes || frame.jpeg, ratio: frame.ratio, timestampMs: frame.timestampMs,
      shotIndex, shotId: shot.shotId || null, assetId: shot.assetId || null, analysisHash: frame.analysisHash })));
    const result = await this.evaluateStructured({ frames, creativePlan: input.creativePlan, negativeIntent: null,
      expectedAspectRatio: null, intendedContentType: 'cross-shot-continuity', qualityTier: tier,
      evaluationClass: 'CONTINUITY', qualityClass: 'CONTINUITY_QUALITY', continuity: true });
    return Object.freeze({ ...result, metadata: Object.freeze({ ...result.metadata, shotCount: shots.length,
      comparedShots: shots.map((shot) => ({ shotId: shot.shotId || null, assetId: shot.assetId || null,
        artifactId: shot.artifactId || null, artifactVersion: shot.artifactVersion || null,
        artifactContentHash: shot.artifactContentHash || null })) }) });
  }
}

module.exports = {
  ALLOWED_CODES,
  CRITIC_INSTRUCTIONS,
  EVALUATOR_VERSION,
  OPENAI_RESPONSES_ENDPOINT,
  OpenAISemanticVisualEvaluatorAdapter,
  CONTINUITY_DRIFT_CODE_BY_FAMILY,
  CONTINUITY_FAMILY_PROPERTIES,
  REQUIRED_CONTINUITY_GROUPS,
  REQUIRED_SOURCE_GROUPS,
  SOURCE_FAMILY_PROPERTIES,
  strictSchema,
  validateStructuredResult,
};
