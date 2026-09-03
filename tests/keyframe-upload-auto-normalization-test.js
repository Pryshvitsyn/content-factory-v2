'use strict';

const assert = require('node:assert/strict');
const {
  keyframeUploadResolution,
  normalizeUploadedKeyframeArgs,
} = require('../src/v2.10/quality-locked-keyframe-service-hardened');

async function main() {
  assert.equal(keyframeUploadResolution({ QUALITY_VIDEO_RESOLUTION: '1080p' }), '1080p');
  assert.equal(keyframeUploadResolution({ QUALITY_VIDEO_RESOLUTION: 'weird' }), '720p');

  let called = 0;
  const fakeNormalizer = {
    async normalize(input) {
      called += 1;
      assert.equal(input.expectedAspectRatio, '9:16');
      assert.equal(input.resolution, '720p');
      assert.equal(input.contentType, 'image/png');
      assert.equal(input.bytes.toString('utf8'), 'square-source');
      return {
        bytes: Buffer.from('normalized-9x16'),
        contentType: 'image/jpeg',
        normalizationApplied: true,
        normalizationVersion: 'test-v1',
        policy: 'PROPORTIONAL_SCALE_TO_FIT_THEN_PAD',
        before: { width: 1024, height: 1024, aspectRatio: 1, orientation: 'SQUARE' },
        after: { width: 720, height: 1280, aspectRatio: 0.5625, orientation: 'PORTRAIT' },
      };
    },
  };

  const sourceArgs = Object.freeze({
    id: 'draft-1',
    contentBase64: Buffer.from('square-source').toString('base64'),
    contentType: 'image/png',
  });
  const normalized = await normalizeUploadedKeyframeArgs(sourceArgs, {
    normalizer: fakeNormalizer,
    resolution: '720p',
  });

  assert.equal(called, 1);
  assert.equal(Buffer.from(normalized.args.contentBase64, 'base64').toString('utf8'), 'normalized-9x16');
  assert.equal(normalized.args.contentType, 'image/jpeg');
  assert.equal(normalized.args.id, sourceArgs.id);
  assert.equal(normalized.normalization.applied, true);
  assert.equal(normalized.normalization.expectedAspectRatio, '9:16');
  assert.deepEqual(normalized.normalization.after, {
    width: 720, height: 1280, aspectRatio: 0.5625, orientation: 'PORTRAIT',
  });

  const noUpload = await normalizeUploadedKeyframeArgs({ id: 'ai-keyframe' }, {
    normalizer: { async normalize() { throw new Error('must not run'); } },
  });
  assert.equal(noUpload.normalization, null);
  assert.equal(noUpload.args.id, 'ai-keyframe');

  const unsupported = await normalizeUploadedKeyframeArgs({
    contentBase64: Buffer.from('x').toString('base64'),
    contentType: 'application/pdf',
  }, {
    normalizer: { async normalize() { throw new Error('must not run'); } },
  });
  assert.equal(unsupported.normalization, null);
  assert.equal(unsupported.args.contentType, 'application/pdf');

  console.log('Uploaded keyframe automatic 9:16 normalization contract passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
