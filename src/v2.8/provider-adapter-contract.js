'use strict';

const METHODS = Object.freeze(['supports','validate','estimate','submit','status','recover','download','normalizeResult']);

class UniversalMediaProviderAdapter {
  supports() { throw new Error('supports() must be implemented'); }
  validate() { throw new Error('validate() must be implemented'); }
  estimate() { throw new Error('estimate() must be implemented'); }
  submit() { throw new Error('submit() must be implemented'); }
  status() { throw new Error('status() must be implemented'); }
  recover() { throw new Error('recover() must be implemented'); }
  download() { throw new Error('download() must be implemented'); }
  normalizeResult() { throw new Error('normalizeResult() must be implemented'); }
}

function assertUniversalAdapter(adapter) {
  const missing = METHODS.filter((method) => typeof adapter?.[method] !== 'function');
  if (missing.length) {
    const error = new Error(`Universal provider adapter is missing: ${missing.join(', ')}`);
    error.code = 'PROVIDER_ADAPTER_INVALID'; throw error;
  }
  return adapter;
}

module.exports = { METHODS, UniversalMediaProviderAdapter, assertUniversalAdapter };
