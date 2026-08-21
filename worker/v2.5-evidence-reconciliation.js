'use strict';

const crypto = require('node:crypto');

const CLASSIFICATIONS = new Set(['FACT', 'INFERENCE', 'ASSUMPTION']);

function hostOf(url) {
  return new URL(url).hostname.toLowerCase();
}

function reconcileEvidence({ claims = [], sources = [] } = {}) {
  const sourceMap = new Map(sources.map((s) => [s.source_id, s]));
  const groups = new Map();
  for (const source of sources) {
    const group = source.independence_group || `${source.publisher || hostOf(source.url)}`.toLowerCase();
    groups.set(group, (groups.get(group) || 0) + 1);
  }

  const normalizedClaims = claims.map((claim) => {
    if (!claim?.claim || !CLASSIFICATIONS.has(claim.classification)) throw new Error('invalid claim');
    const referenced = (claim.source_ids || []).map((id) => sourceMap.get(id));
    if (!referenced.length || referenced.some((source) => !source)) throw new Error('claim references unknown source');
    const independentGroups = new Set(referenced.map((source) => source.independence_group || `${source.publisher || hostOf(source.url)}`.toLowerCase()));
    return {
      claim_id: claim.claim_id || crypto.randomUUID(),
      claim: claim.claim,
      classification: claim.classification,
      source_ids: [...claim.source_ids],
      independent_source_count: independentGroups.size,
      corroborated: independentGroups.size >= 2,
      contradictions: Array.isArray(claim.contradictions) ? claim.contradictions : [],
      confidence: claim.confidence || 'UNVERIFIED'
    };
  });

  const contradictionsFound = normalizedClaims.some((c) => c.contradictions.length > 0);
  const independentSourceCount = new Set(sources.map((s) => s.independence_group || `${s.publisher || hostOf(s.url)}`.toLowerCase())).size;
  const confidence = contradictionsFound ? 'LOW' : normalizedClaims.some((c) => c.confidence === 'UNVERIFIED') ? 'UNVERIFIED' : normalizedClaims.every((c) => c.corroborated && (c.confidence === 'HIGH' || c.confidence === 'MEDIUM')) ? 'HIGH' : 'MEDIUM';

  return {
    reconciliation_id: crypto.randomUUID(),
    claims: normalizedClaims,
    independent_source_count: independentSourceCount,
    contradictions_found: contradictionsFound,
    confidence
  };
}

module.exports = { reconcileEvidence, hostOf };
