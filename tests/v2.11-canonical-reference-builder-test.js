'use strict';

const assert = require('node:assert/strict');
const {
  HEIGHT,
  SPHERE_SIZE,
  SPHERE_TOP,
  WIDTH,
  renderCosmosPpm,
  renderRecordedMaskPgm,
} = require('../scripts/impulseoff-build-canonical-reference');

function payloadOffset(buffer) {
  let newlines = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0x0a) newlines += 1;
    if (newlines === 3) return i + 1;
  }
  throw new Error('PNM header incomplete');
}

function main() {
  assert.equal(WIDTH, 720);
  assert.equal(HEIGHT, 1280);
  assert.equal(SPHERE_SIZE, 720);
  assert.equal(SPHERE_TOP, 280);

  const cosmos = renderCosmosPpm();
  const cosmosOffset = payloadOffset(cosmos);
  assert.equal(cosmos.subarray(0, cosmosOffset).toString('ascii'), 'P6\n720 1280\n255\n');
  assert.equal(cosmos.length - cosmosOffset, 720 * 1280 * 3);

  const mask = renderRecordedMaskPgm();
  const maskOffset = payloadOffset(mask);
  assert.equal(mask.subarray(0, maskOffset).toString('ascii'), 'P5\n720 720\n255\n');
  const pixels = mask.subarray(maskOffset);
  assert.equal(pixels.length, 720 * 720);
  assert.equal(pixels[0], 0);
  assert.equal(pixels[359 * 720 + 359], 255);
  assert.ok(pixels[359 * 720] > 0 && pixels[359 * 720] < 255);

  console.log('v2.11 canonical reference builder tests passed');
}

main();
