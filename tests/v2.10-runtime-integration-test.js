'use strict';

const assert = require('node:assert/strict');
const { normalizeV210Video } = require('../src/v2.10/creative-production-service');

assert.deepEqual(normalizeV210Video({
  provider: 'replicate', model: 'alibaba/wan-3', profile: 'QUALITY', resolution: '1080x1920',
}), {
  provider: 'replicate', model: 'alibaba/wan-3', profile: 'STANDARD', resolution: null,
});
assert.deepEqual(normalizeV210Video({
  provider: 'replicate', model: 'alibaba/wan-3', profile: 'PREMIUM', resolution: '1080p',
}), {
  provider: 'replicate', model: 'alibaba/wan-3', profile: 'PREMIUM', resolution: '1080p',
});

require('./v2.10-runtime-integration-core-test');
