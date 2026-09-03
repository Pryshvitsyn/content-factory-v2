'use strict';

const assert = require('node:assert/strict');
const { CANONICAL_BRANDS, brandMetadata, validateCanonicalBrands } = require('../src/brand-registry/canonical-brands');

validateCanonicalBrands();
assert.equal(CANONICAL_BRANDS.length, 8);
assert.deepEqual(CANONICAL_BRANDS.map((brand) => brand.name), [
  'edilemi.com',
  'tgsimon.com',
  'delsole.cc',
  'ImpulseOff',
  'LuxuryItaly.net',
  'pastamore',
  'NOW',
  'Tune Into Her',
]);
assert.equal(CANONICAL_BRANDS.some((brand) => brand.name === 'Attune'), false);

const tune = CANONICAL_BRANDS.find((brand) => brand.name === 'Tune Into Her');
assert.deepEqual(tune.aliases, ['Attune']);
assert.equal(tune.parentBrand, 'Elio Genesis');
assert.equal(brandMetadata(tune).brandPack.status, 'NEEDS_COMPLETION');

const impulse = CANONICAL_BRANDS.find((brand) => brand.name === 'ImpulseOff');
assert.equal(impulse.parentBrand, 'Elio Genesis');

const now = CANONICAL_BRANDS.find((brand) => brand.name === 'NOW');
assert.equal(now.parentBrand, 'Elio Genesis');
assert.equal(now.workingTitle, true);

for (const brand of CANONICAL_BRANDS) {
  const metadata = brandMetadata(brand);
  assert.equal(metadata.canonicalRegistry, true);
  assert.equal(metadata.canonicalContext, brand.name);
  assert.equal(metadata.brandPack.status, 'NEEDS_COMPLETION');
  assert.ok(metadata.brandPack.unknownFields.includes('mission'));
  assert.ok(metadata.brandPack.unknownFields.includes('audience'));
}

console.log('Canonical Content Factory brand registry contract: PASS');
