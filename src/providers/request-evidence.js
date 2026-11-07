'use strict';
const { createHash } = require('node:crypto');
// Preserve input identity without copying inline reference bytes into execution journals.
function redactInlineMedia(value) {
  if (typeof value === 'string' && /^data:(image|video|audio)\/[^;,]+;base64,/.test(value)) {
    const comma = value.indexOf(','), bytes = Buffer.from(value.slice(comma + 1), 'base64');
    return { kind: 'INLINE_MEDIA', contentType: value.slice(5, value.indexOf(';')),
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  if (Array.isArray(value)) return value.map(redactInlineMedia);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactInlineMedia(item)]));
  return value;
}
module.exports = { redactInlineMedia };
