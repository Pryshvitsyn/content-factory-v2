'use strict';

const assert = require('node:assert/strict');
const { ProviderError } = require('../src/providers/provider-contract');
const { safeFailure, safeFailureDiagnostic } = require('../src/avatar-studio/passport-execution-service');

function sdkError(name, status, code, type, requestId, message = 'provider error') {
  const error = new Error(message);
  error.name = name;
  error.status = status;
  error.code = code;
  error.type = type;
  error.requestID = requestId;
  return error;
}

function main() {
  const badRequest = sdkError('BadRequestError', 400, 'invalid_image', 'invalid_request_error', 'req_bad');
  const wrappedBadRequest = new ProviderError('OpenAI image request failed', {
    provider: 'openai-media', model: 'gpt-image-2', cause: badRequest,
  });
  assert.equal(wrappedBadRequest.status, 400);
  assert.equal(wrappedBadRequest.code, 'invalid_image');
  assert.equal(wrappedBadRequest.requestId, 'req_bad');
  const rejected = safeFailure(wrappedBadRequest);
  assert.equal(rejected.classification, 'PROVIDER_REJECTED_INPUT');
  assert.equal(rejected.mayHaveSpent, false);
  assert.deepEqual(rejected.diagnostic.statuses, [400]);
  assert(rejected.diagnostic.names.includes('BadRequestError'));

  const auth = new ProviderError('OpenAI image request failed', {
    provider: 'openai-media', model: 'gpt-image-2',
    cause: sdkError('AuthenticationError', 401, 'invalid_api_key', 'invalid_request_error', 'req_auth'),
  });
  assert.equal(safeFailure(auth).classification, 'PROVIDER_AUTH');

  const rate = new ProviderError('OpenAI image request failed', {
    provider: 'openai-media', model: 'gpt-image-2',
    cause: sdkError('RateLimitError', 429, 'rate_limit_exceeded', 'rate_limit_error', 'req_rate'),
  });
  assert.equal(safeFailure(rate).classification, 'PROVIDER_RATE_LIMIT');

  const timeout = new ProviderError('OpenAI image request failed', {
    provider: 'openai-media', model: 'gpt-image-2', cause: Object.assign(new Error('timed out'), { name: 'APIConnectionTimeoutError' }),
  });
  assert.equal(safeFailure(timeout).classification, 'PROVIDER_TIMEOUT');

  const secret = 'sk-this-must-never-be-persisted';
  const opaque = new ProviderError('OpenAI image request failed', {
    provider: 'openai-media', model: 'gpt-image-2', cause: new TypeError(`local failure ${secret}`),
  });
  const unknown = safeFailure(opaque);
  assert.equal(unknown.classification, 'UNKNOWN');
  const serialized = JSON.stringify({ safeMessage: unknown.safeMessage, diagnostic: unknown.diagnostic });
  assert(!serialized.includes(secret));
  assert(unknown.diagnostic.names.includes('TypeError'));
  assert.equal(safeFailureDiagnostic(opaque).depth, 2);

  console.log('Avatar Studio provider error diagnostics passed; nested SDK status/code/name/request-id preserved without provider messages or secrets; external calls=0');
}

main();
