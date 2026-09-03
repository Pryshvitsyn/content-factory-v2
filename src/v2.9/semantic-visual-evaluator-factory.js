'use strict';

const { DisabledSemanticVisualEvaluatorAdapter } = require('./semantic-visual-evaluator');
const { OpenAISemanticVisualEvaluatorAdapter } = require('./openai-semantic-visual-evaluator');
const { REASON_CODES } = require('./quality-contract');

function integerSetting(name, value, fallback, { min = 0, max = 120000 } = {}) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return { error: `${name} must be an integer from ${min} to ${max}` };
  return { value: parsed };
}

function unavailable({ provider, model, reasonCode, reason, errors, status }) {
  return new DisabledSemanticVisualEvaluatorAdapter({ provider, model, reasonCode, reason,
    configurationStatus: status, configurationErrors: errors });
}

function createSemanticVisualEvaluatorAdapter({ env = process.env, fetchImpl = global.fetch, sleep } = {}) {
  const enabledValue = env.SEMANTIC_VISUAL_ENABLED;
  if (enabledValue == null || enabledValue === '' || enabledValue === 'false') return new DisabledSemanticVisualEvaluatorAdapter();
  if (enabledValue !== 'true') return unavailable({ provider: env.SEMANTIC_VISUAL_PROVIDER || 'unconfigured',
    model: env.SEMANTIC_VISUAL_MODEL || null, reasonCode: REASON_CODES.SEMANTIC_VISUAL_QA_NOT_CONFIGURED,
    reason: 'SEMANTIC_VISUAL_ENABLED must be explicitly true or false.',
    errors: ['SEMANTIC_VISUAL_ENABLED_INVALID'], status: 'INVALID_CONFIGURATION' });
  const provider = String(env.SEMANTIC_VISUAL_PROVIDER || '').toLowerCase();
  const model = typeof env.SEMANTIC_VISUAL_MODEL === 'string' && env.SEMANTIC_VISUAL_MODEL.trim()
    ? env.SEMANTIC_VISUAL_MODEL.trim() : null;
  const errors = [];
  if (provider !== 'openai') errors.push('SEMANTIC_VISUAL_PROVIDER_UNSUPPORTED');
  if (!model) errors.push('SEMANTIC_VISUAL_MODEL_REQUIRED');
  if (!env.OPENAI_API_KEY) errors.push('OPENAI_API_KEY_REQUIRED');
  if (!['true','false'].includes(env.LIVE_PAID_VISUAL_EVALUATION || '')) errors.push('LIVE_PAID_VISUAL_EVALUATION_REQUIRED');
  const timeout = integerSetting('SEMANTIC_VISUAL_TIMEOUT_MS', env.SEMANTIC_VISUAL_TIMEOUT_MS, 30000, { min: 100, max: 120000 });
  const retries = integerSetting('SEMANTIC_VISUAL_MAX_RETRIES', env.SEMANTIC_VISUAL_MAX_RETRIES, 1, { min: 0, max: 2 });
  if (timeout.error) errors.push('SEMANTIC_VISUAL_TIMEOUT_MS_INVALID');
  if (retries.error) errors.push('SEMANTIC_VISUAL_MAX_RETRIES_INVALID');
  if (errors.length) return unavailable({ provider: provider || 'unconfigured', model,
    reasonCode: REASON_CODES.SEMANTIC_VISUAL_QA_NOT_CONFIGURED,
    reason: `Semantic visual evaluator configuration is invalid: ${errors.join(', ')}.`, errors,
    status: 'INVALID_CONFIGURATION' });
  const authorized = env.LIVE_PAID_VISUAL_EVALUATION === 'true';
  return new OpenAISemanticVisualEvaluatorAdapter({ apiKey: env.OPENAI_API_KEY, model,
    paidExecutionAuthorized: authorized, fetchImpl, timeoutMs: timeout.value, maxRetries: retries.value, sleep });
}

module.exports = { createSemanticVisualEvaluatorAdapter, integerSetting };
