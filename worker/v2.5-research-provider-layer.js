'use strict';

const { collectEvidence } = require('./v2.5-research-collector');

const PROVIDER_TYPES = Object.freeze(['web', 'trend', 'statistics', 'industry']);

function createProvider({ id, type, discover, fetchOptions } = {}) {
  if (!id || !PROVIDER_TYPES.includes(type)) throw new Error('provider requires a valid id and type');
  if (typeof discover !== 'function') throw new TypeError('provider discover function is required');
  return Object.freeze({
    id,
    type,
    async research(query) {
      const sources = await discover(query);
      if (!Array.isArray(sources) || sources.length === 0) throw new Error(`provider ${id} returned no sources`);
      return collectEvidence({ sources, fetchOptions, extractClaims: (fetched, records) => {
        const claims = [];
        for (const item of fetched) {
          const record = records.find(r => r.url === item.url);
          const extracted = item.evidence;
          if (Array.isArray(extracted)) {
            for (const evidence of extracted) {
              claims.push({
                claim: evidence.claim,
                classification: evidence.classification || 'FACT',
                confidence: evidence.confidence || 'MEDIUM',
                source_ids: [record.source_id]
              });
            }
          }
        }
        return claims;
      }});
    }
  });
}

function createResearchRegistry(providers = []) {
  const registry = new Map();
  for (const provider of providers) {
    if (registry.has(provider.id)) throw new Error(`duplicate provider: ${provider.id}`);
    registry.set(provider.id, provider);
  }
  return Object.freeze({
    list: () => [...registry.values()].map(p => ({ id: p.id, type: p.type })),
    get: (id) => registry.get(id),
    async research(query, providerIds) {
      const selected = providerIds?.length ? providerIds.map(id => registry.get(id)) : [...registry.values()];
      if (selected.some(p => !p)) throw new Error('unknown research provider');
      if (!selected.length) throw new Error('no research providers configured');
      return Promise.all(selected.map(provider => provider.research(query)));
    }
  });
}

module.exports = { PROVIDER_TYPES, createProvider, createResearchRegistry };
