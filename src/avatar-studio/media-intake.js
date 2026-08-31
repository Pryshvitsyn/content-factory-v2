'use strict';

const path = require('node:path');
const { AvatarStudioError } = require('./domain');

const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': ['.jpg','.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'], 'image/gif': ['.gif'],
  'video/mp4': ['.mp4','.m4v'], 'video/webm': ['.webm'], 'video/quicktime': ['.mov'],
  'audio/mpeg': ['.mp3'], 'audio/mp4': ['.m4a','.mp4'], 'audio/wav': ['.wav'],
  'audio/x-wav': ['.wav'], 'audio/ogg': ['.ogg','.oga'], 'audio/webm': ['.webm'],
});

function normalizedMime(value) { return String(value || '').split(';')[0].trim().toLowerCase(); }
function extensionOf(filename = '') { return path.extname(String(filename)).toLowerCase(); }
function mediaKind(mimeType) {
  const mime = normalizedMime(mimeType);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

function sniffMime(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (bytes.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return 'video/webm';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if (bytes.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

function imageDimensions(bytes, mimeType) {
  const mime = normalizedMime(mimeType);
  if (mime === 'image/png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mime === 'image/gif' && bytes.length >= 10) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (mime === 'image/webp' && bytes.length >= 30 && bytes.subarray(12,16).toString('ascii') === 'VP8X') {
    return { width: 1 + bytes.readUIntLE(24,3), height: 1 + bytes.readUIntLE(27,3) };
  }
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]; const length = bytes.readUInt16BE(offset + 2);
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      if (length < 2) break; offset += 2 + length;
    }
  }
  return { width: null, height: null };
}

function printableMetadata(bytes, limit = 1024 * 1024) {
  return bytes.subarray(0, Math.min(bytes.length, limit)).toString('latin1')
    .replace(/[^\x20-\x7e\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
}

function decodeBase64(value) {
  const source = String(value || '').replace(/^data:[^,]+,/, '').trim();
  if (!source || !/^[A-Za-z0-9+/]*={0,2}$/.test(source) || source.length % 4 === 1) {
    throw new AvatarStudioError(400, 'ASSET_BYTES_INVALID', 'Asset content must be valid base64');
  }
  const bytes = Buffer.from(source, 'base64');
  if (!bytes.length) throw new AvatarStudioError(400, 'ASSET_EMPTY', 'Uploaded asset is empty');
  if (bytes.length > MAX_ASSET_BYTES) throw new AvatarStudioError(413, 'ASSET_TOO_LARGE', `Asset exceeds ${MAX_ASSET_BYTES} bytes`);
  return bytes;
}

async function inspectMedia({ bytes, filename, mimeType, mediaInspector = null } = {}) {
  const mime = normalizedMime(mimeType); const extension = extensionOf(filename); const kind = mediaKind(mime);
  const findings = [];
  if (!MIME_EXTENSIONS[mime] || !kind) findings.push({ severity: 'BLOCK', code: 'INVALID_MIME_TYPE' });
  if (!extension || !MIME_EXTENSIONS[mime]?.includes(extension)) findings.push({ severity: 'BLOCK', code: 'MIME_EXTENSION_MISMATCH' });
  const detectedMime = sniffMime(bytes);
  if (!detectedMime) findings.push({ severity: 'BLOCK', code: 'UNRECOGNIZED_MEDIA_SIGNATURE' });
  else if (detectedMime !== mime && !(mime === 'video/quicktime' && detectedMime === 'video/mp4')
    && !(mime === 'audio/mp4' && detectedMime === 'video/mp4') && !(mime === 'audio/webm' && detectedMime === 'video/webm')) {
    findings.push({ severity: 'BLOCK', code: 'MIME_SIGNATURE_MISMATCH' });
  }
  let dimensions = { width: null, height: null }; let durationMs = null;
  if (kind === 'image' && detectedMime) dimensions = imageDimensions(bytes, mime);
  if (mediaInspector && kind && findings.every((item) => item.severity !== 'BLOCK')) {
    try {
      const probe = await mediaInspector.inspect({ bytes, contentType: mime, kind });
      dimensions = { width: probe.width || dimensions.width, height: probe.height || dimensions.height };
      durationMs = Number.isFinite(probe.durationMs) ? probe.durationMs : null;
    } catch (error) {
      findings.push({ severity: 'BLOCK', code: error.code || 'MEDIA_UNREADABLE' });
    }
  }
  return Object.freeze({ mimeType: mime, extension, kind, detectedMime, byteSize: bytes.length,
    width: dimensions.width || null, height: dimensions.height || null, durationMs, findings: Object.freeze(findings),
    embeddedText: printableMetadata(bytes) });
}

module.exports = { MAX_ASSET_BYTES, MIME_EXTENSIONS, decodeBase64, extensionOf, imageDimensions, inspectMedia,
  mediaKind, normalizedMime, printableMetadata, sniffMime };
