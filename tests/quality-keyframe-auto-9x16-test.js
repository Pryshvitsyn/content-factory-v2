'use strict';

const assert = require('node:assert/strict');
const {
  keyframeUploadResolution,
  normalizeUploadedKeyframeArgs,
} = require('../src/v2.10/quality-locked-keyframe-service');

async function main() {
  assert.equal(keyframeUploadResolution({ QUALITY_VIDEO_RESOLUTION: '1080p' }), '1080p');
  assert.equal(keyframeUploadResolution({ QUALITY_VIDEO_RESOLUTION: 'nonsense' }), '720p');

  const source = Buffer.from('square-keyframe-bytes');
  const normalizedBytes = Buffer.from('canonical-9x16-bytes');
  let calls = 0;
  const normalizer = {
    async normalize(input) {
      calls += 1;
      assert.equal(input.expectedAspectRatio, '9:16');
      assert.equal(input.resolution, '1080p');
      assert.equal(input.contentType, 'image/png');
      assert.deepEqual(input.bytes, source);
      return {
        bytes: normalizedBytes,
        contentType: 'image/jpeg',
        before: { width: 1024, height: 1024, aspectRatio: 1, orientation: 'SQUARE' },
        after: { width: 1080, height: 1920, aspectRatio: 0.5625, orientation: 'PORTRAIT' },
        normalizationApplied: true,
        normalizationVersion: 'test-v1',
        policy: 'PROPORTIONAL_SCALE_TO_FIT_THEN_PAD',
      };
    },
  };

  const result = await normalizeUploadedKeyframeArgs({
    id: 'draft-1',
    brandId: 'brand-1',
    shotId: 'shot-1',
    contentBase64: source.toString('base64'),
    contentType: 'image/png; charset=binary',
  }, { normalizer, resolution: '1080p' });

  assert.equal(calls, 1);
  assert.equal(result.args.contentType, 'image/jpeg');
  assert.deepEqual(Buffer.from(result.args.contentBase64, 'base64'), normalizedBytes);
  assert.equal(result.normalization.applied, true);
  assert.equal(result.normalization.expectedAspectRatio, '9:16');
  assert.equal(result.normalization.after.width, 1080);
  assert.equal(result.normalization.after.height, 1920);
  assert.equal(result.normalization.policy, 'PROPORTIONAL_SCALE_TO_FIT_THEN_PAD');

  const noUpload = await normalizeUploadedKeyframeArgs({ id: 'draft-2' }, { normalizer, resolution: '720p' });
  assert.equal(noUpload.normalization, null);
  assert.equal(calls, 1, 'non-upload paths must not invoke normalization');

  console.log('QUALITY keyframe automatic 9:16 normalization regression passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
