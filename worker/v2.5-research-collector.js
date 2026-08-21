'use strict';

const { buildResearch } = require('./v2.5-research-intelligence');

const DEFAULT_MAX_BYTES = 250_000;
const DEFAULT_TIMEOUT_MS = 8_000;

function assertHttpUrl(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('only HTTP(S) sources are allowed');
  return parsed;
}

async function fetchSource(url, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const parsed = assertHttpUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(parsed, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`source HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error('source exceeds configured byte budget');
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('source exceeds configured byte budget');
    return {
      url: parsed.toString(),
      title: response.headers.get('x-title') || parsed.hostname,
      published_at: response.headers.get('x-published-at') || null,
      retrieved_at: new Date().toISOString(),
      content_type: contentType,
      byte_count: Buffer.byteLength(body, 'utf8'),
      body
    };
  } finally {
    clearTimeout(timer);
  }
}

function collectEvidence({ sources, extractClaims, fetchOptions } = {}) {
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('at least one source URL is required');
  if (typeof extractClaims !== 'function') throw new TypeError('extractClaims function is required');
  return Promise.all(sources.map(url => fetchSource(url, fetchOptions))).then(fetched => {
    const sourceRecords = fetched.map((s, i) => ({ source_id: `src-${i + 1}`, url: s.url, title: s.title, published_at: s.published_at, retrieved_at: s.retrieved_at }));
    const claims = extractClaims(fetched, sourceRecords);
    return buildResearch({ claims, sources: sourceRecords, independentSourceCount: new Set(sourceRecords.map(s => new URL(s.url).hostname)).size, contradictionsFound: false });
  });
}

module.exports = { fetchSource, collectEvidence };
