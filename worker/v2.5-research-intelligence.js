'use strict';

const crypto = require('node:crypto');

const CLASSIFICATIONS = new Set(['FACT','INFERENCE','ASSUMPTION']);
const CONFIDENCE = new Set(['HIGH','MEDIUM','LOW','UNVERIFIED']);

function normalizeSource(source) {
  if (!source?.url || !source?.title || !source?.retrieved_at) throw new Error('source requires url, title, retrieved_at');
  return { source_id: source.source_id || crypto.randomUUID(), url: source.url, title: source.title, published_at: source.published_at ?? null, retrieved_at: source.retrieved_at };
}

function buildResearch({ claims = [], sources = [], independentSourceCount = 0, contradictionsFound = false } = {}) {
  const normalizedSources = sources.map(normalizeSource);
  const sourceIds = new Set(normalizedSources.map(s => s.source_id));
  const normalizedClaims = claims.map(c => {
    if (!c?.claim || !CLASSIFICATIONS.has(c.classification) || !CONFIDENCE.has(c.confidence)) throw new Error('invalid research claim');
    if (!Array.isArray(c.source_ids) || c.source_ids.length === 0 || c.source_ids.some(id => !sourceIds.has(id))) throw new Error('claim must reference known sources');
    return { claim: c.claim, classification: c.classification, confidence: c.confidence, source_ids: [...c.source_ids] };
  });
  const confidence = contradictionsFound ? 'LOW' : independentSourceCount >= 2 && normalizedClaims.every(c => c.confidence === 'HIGH' || c.confidence === 'MEDIUM') ? 'HIGH' : 'MEDIUM';
  return { research_id: crypto.randomUUID(), claims: normalizedClaims, sources: normalizedSources, confidence, cross_check: { independent_source_count: independentSourceCount, contradictions_found: contradictionsFound } };
}

module.exports = { normalizeSource, buildResearch };
