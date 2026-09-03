'use strict';

const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { AvatarStudioError } = require('./domain');
const { MAX_ASSET_BYTES, normalizedMime } = require('./media-intake');

function privateAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || a >= 224;
  }
  if (net.isIP(address) === 6) {
    const value = address.toLowerCase(); return value === '::1' || value === '::' || value.startsWith('fc')
      || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
  }
  return true;
}

class SafeUrlImporter {
  constructor({ fetchImpl = null, resolver = (hostname) => dns.lookup(hostname, { all: true, verbatim: true }), maxBytes = MAX_ASSET_BYTES } = {}) {
    this.fetchImpl = fetchImpl; this.resolver = resolver; this.maxBytes = maxBytes;
  }

  requestPinned(url, resolved) {
    return new Promise((resolve, reject) => {
      const request = https.request(url, { method: 'GET', headers: { Accept: 'image/*,video/*,audio/*' }, servername: url.hostname, autoSelectFamily: false,
        lookup: (_hostname, _options, callback) => callback(null, resolved.address || resolved, resolved.family || net.isIP(resolved.address || resolved)) }, (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume(); reject(new AvatarStudioError(400, 'SAFE_URL_FETCH_FAILED', `URL returned HTTP ${response.statusCode}`)); return;
        }
        const length = Number(response.headers['content-length'] || 0);
        if (length > this.maxBytes) { response.resume(); reject(new AvatarStudioError(413, 'ASSET_TOO_LARGE', `Remote asset exceeds ${this.maxBytes} bytes`)); return; }
        const chunks = []; let size = 0;
        response.on('data', (chunk) => { size += chunk.length; if (size > this.maxBytes) {
          response.destroy(new AvatarStudioError(413, 'ASSET_TOO_LARGE', `Remote asset exceeds ${this.maxBytes} bytes`)); return;
        } chunks.push(chunk); });
        response.on('end', () => resolve({ bytes: Buffer.concat(chunks), mimeType: normalizedMime(response.headers['content-type']) }));
      });
      request.once('error', reject); request.end();
    });
  }

  async fetch(urlValue) {
    let url;
    try { url = new URL(String(urlValue || '')); } catch { throw new AvatarStudioError(400, 'SAFE_URL_INVALID', 'Enter a valid HTTPS URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.hostname === 'localhost') {
      throw new AvatarStudioError(400, 'SAFE_URL_BLOCKED', 'Safe URL import requires public HTTPS without credentials');
    }
    if (net.isIP(url.hostname) && privateAddress(url.hostname)) throw new AvatarStudioError(400, 'SAFE_URL_PRIVATE_NETWORK', 'Private network URLs are blocked');
    const addresses = await this.resolver(url.hostname);
    if (!Array.isArray(addresses) || !addresses.length || addresses.some((item) => privateAddress(item.address || item))) {
      throw new AvatarStudioError(400, 'SAFE_URL_PRIVATE_NETWORK', 'URL resolves to a private or unverified network');
    }
    let bytes; let mimeType;
    if (this.fetchImpl) {
      const response = await this.fetchImpl(url, { method: 'GET', redirect: 'error', headers: { Accept: 'image/*,video/*,audio/*' } });
      if (!response.ok) throw new AvatarStudioError(400, 'SAFE_URL_FETCH_FAILED', `URL returned HTTP ${response.status}`);
      const length = Number(response.headers.get('content-length') || 0);
      if (length > this.maxBytes) throw new AvatarStudioError(413, 'ASSET_TOO_LARGE', `Remote asset exceeds ${this.maxBytes} bytes`);
      bytes = Buffer.from(await response.arrayBuffer()); mimeType = normalizedMime(response.headers.get('content-type'));
    } else ({ bytes, mimeType } = await this.requestPinned(url, addresses[0]));
    if (!bytes.length || bytes.length > this.maxBytes) throw new AvatarStudioError(bytes.length ? 413 : 400,
      bytes.length ? 'ASSET_TOO_LARGE' : 'ASSET_EMPTY', bytes.length ? `Remote asset exceeds ${this.maxBytes} bytes` : 'Remote asset is empty');
    const filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'remote-asset');
    return Object.freeze({ bytes, mimeType, filename,
      sourceLocator: url.toString(), externalCalls: 1, paidProviderCalls: 0 });
  }
}

module.exports = { SafeUrlImporter, privateAddress };
