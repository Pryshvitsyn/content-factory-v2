'use strict';

const REGISTRY_VERSION = 1;

const CANONICAL_BRANDS = Object.freeze([
  Object.freeze({
    name: 'edilemi.com', slug: 'edilemi-com', domain: 'edilemi.com',
    aliases: [], parentBrand: null, workingTitle: false,
  }),
  Object.freeze({
    name: 'tgsimon.com', slug: 'tgsimon-com', domain: 'tgsimon.com',
    aliases: [], parentBrand: null, workingTitle: false,
  }),
  Object.freeze({
    name: 'delsole.cc', slug: 'delsole-cc', domain: 'delsole.cc',
    aliases: [], parentBrand: null, workingTitle: false,
  }),
  Object.freeze({
    name: 'ImpulseOff', slug: 'impulseoff', domain: null,
    aliases: [], parentBrand: 'Elio Genesis', workingTitle: false,
  }),
  Object.freeze({
    name: 'LuxuryItaly.net', slug: 'luxuryitaly-net', domain: 'luxuryitaly.net',
    aliases: [], parentBrand: null, workingTitle: false,
  }),
  Object.freeze({
    name: 'pastamore', slug: 'pastamore', domain: null,
    aliases: [], parentBrand: null, workingTitle: false,
  }),
  Object.freeze({
    name: 'NOW', slug: 'now', domain: null,
    aliases: [], parentBrand: 'Elio Genesis', workingTitle: true,
  }),
  Object.freeze({
    name: 'Tune Into Her', slug: 'tune-into-her', domain: null,
    aliases: ['Attune'], parentBrand: 'Elio Genesis', workingTitle: false,
  }),
]);

function brandMetadata(brand) {
  return Object.freeze({
    canonicalRegistry: true,
    canonicalRegistryVersion: REGISTRY_VERSION,
    canonicalContext: brand.name,
    domain: brand.domain,
    aliases: [...brand.aliases],
    parentBrand: brand.parentBrand,
    workingTitle: brand.workingTitle,
    brandPack: {
      status: 'NEEDS_COMPLETION',
      knownFields: ['name', ...(brand.domain ? ['domain'] : []), ...(brand.parentBrand ? ['parentBrand'] : []),
        ...(brand.aliases.length ? ['aliases'] : []), ...(brand.workingTitle ? ['workingTitle'] : [])],
      unknownFields: ['mission', 'positioning', 'audience', 'voice', 'visualLanguage', 'claimPolicy', 'preferredAssets'],
    },
    source: 'operator-approved-canonical-registry-2026-09-03',
  });
}

function validateCanonicalBrands(brands = CANONICAL_BRANDS) {
  const names = new Set();
  const slugs = new Set();
  for (const brand of brands) {
    if (!brand.name || !brand.slug) throw new Error('Canonical brand requires name and slug');
    if (names.has(brand.name.toLowerCase())) throw new Error(`Duplicate canonical brand name: ${brand.name}`);
    if (slugs.has(brand.slug)) throw new Error(`Duplicate canonical brand slug: ${brand.slug}`);
    names.add(brand.name.toLowerCase()); slugs.add(brand.slug);
  }
  if (brands.some((brand) => brand.name.toLowerCase() === 'attune')) {
    throw new Error('Attune is a legacy alias and must not be a canonical active brand');
  }
  return true;
}

module.exports = { CANONICAL_BRANDS, REGISTRY_VERSION, brandMetadata, validateCanonicalBrands };
