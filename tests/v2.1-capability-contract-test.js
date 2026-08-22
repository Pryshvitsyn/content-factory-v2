'use strict';

const assert = require('node:assert/strict');
const { CAPABILITIES, normalizeCapability } = require('../src/providers/capability-contract');
const { ProviderGateway } = require('../src/providers/provider-gateway');

async function main() {
  assert.equal(normalizeCapability('text-generation'), CAPABILITIES.TEXT_GENERATION);
  assert.equal(normalizeCapability('image-generation'), CAPABILITIES.IMAGE_GENERATION);
  assert.equal(normalizeCapability('image_editing'), CAPABILITIES.IMAGE_EDITING);
  assert.equal(normalizeCapability('video-generation'), CAPABILITIES.VIDEO_GENERATION);
  assert.throws(() => normalizeCapability('made-up-capability'), /UNSUPPORTED_CAPABILITY/);

  const calls = [];
  const gateway = new ProviderGateway({
    providers: {
      nvidia: {
        model: 'nvidia/test-image',
        supports: ({ capability, model }) => capability === CAPABILITIES.IMAGE_GENERATION && model === 'nvidia/test-image',
        generate: async ({ capability, model }) => {
          calls.push({ capability, model });
          return { output: Buffer.from('real-test-artifact'), contentType: 'image/png' };
        },
      },
    },
  });

  const result = await gateway.generate({ capability: 'image-generation' });
  assert.deepEqual(calls, [{ capability: CAPABILITIES.IMAGE_GENERATION, model: 'nvidia/test-image' }]);
  assert.equal(result.provenance.capability, CAPABILITIES.IMAGE_GENERATION);
  assert.equal(result.provenance.provider, 'nvidia');
  assert.equal(result.provenance.model, 'nvidia/test-image');
  assert.ok(Buffer.isBuffer(result.output));

  console.log('v2.1 canonical capability contract certification passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
