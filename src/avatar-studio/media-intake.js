'use strict';

const path = require('node:path');
const { AvatarStudioError } = require('./domain');

const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_EMBEDDED_TEXT_CHARS = 20000;
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

function printableMetadata(value, limit = MAX_EMBEDDED_TEXT_CHARS) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
  return text.replace(/[^\x20-\x7e\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function extractPngText(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20) return '';
  const parts = []; let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset); const dataStart = offset + 8; const dataEnd = dataStart + length;
    const next = dataEnd + 4;
    if (length > MAX_ASSET_BYTES || next > bytes.length) break;
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii'); const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'tEXt') {
      const separator = data.indexOf(0); if (separator >= 0 && separator + 1 < data.length) parts.push(data.subarray(separator + 1).toString('latin1'));
    } else if (type === 'iTXt') {
      const keywordEnd = data.indexOf(0); let cursor = keywordEnd + 1;
      if (keywordEnd >= 0 && cursor + 2 <= data.length) {
        const compressionFlag = data[cursor]; cursor += 2;
        const languageEnd = data.indexOf(0, cursor); if (languageEnd >= 0) cursor = languageEnd + 1; else cursor = data.length;
        const translatedEnd = data.indexOf(0, cursor); if (translatedEnd >= 0) cursor = translatedEnd + 1; else cursor = data.length;
        if (compressionFlag === 0 && cursor < data.length) parts.push(data.subarray(cursor).toString('utf8'));
      }
    }
    offset = next;
    if (type === 'IEND') break;
    if (parts.join('\n').length >= MAX_EMBEDDED_TEXT_CHARS) break;
  }
  return printableMetadata(parts.join('\n'));
}

function extractJpegText(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return '';
  const parts = []; let offset = 2;
  const xmpHeader = Buffer.from('http://ns.adobe.com/xap/1.0/\0','ascii');
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset]; offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset); if (length < 2) break;
    const dataStart = offset + 2; const dataEnd = offset + length; if (dataEnd > bytes.length) break;
    const data = bytes.subarray(dataStart, dataEnd);
    if (marker === 0xfe) parts.push(data.toString('latin1'));
    else if (marker === 0xe1 && data.length > xmpHeader.length && data.subarray(0,xmpHeader.length).equals(xmpHeader)) {
      parts.push(data.subarray(xmpHeader.length).toString('utf8'));
    }
    offset = dataEnd;
    if (parts.join('\n').length >= MAX_EMBEDDED_TEXT_CHARS) break;
  }
  return printableMetadata(parts.join('\n'));
}

function extractWebpText(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20 || bytes.subarray(0,4).toString('ascii') !== 'RIFF'
    || bytes.subarray(8,12).toString('ascii') !== 'WEBP') return '';
  const parts = []; let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset,offset + 4).toString('ascii'); const length = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8; const dataEnd = dataStart + length; if (dataEnd > bytes.length) break;
    if (type === 'XMP ') parts.push(bytes.subarray(dataStart,dataEnd).toString('utf8'));
    offset = dataEnd + (length % 2);
    if (parts.join('\n').length >= MAX_EMBEDDED_TEXT_CHARS) break;
  }
  return printableMetadata(parts.join('\n'));
}

function extractEmbeddedText(bytes, mimeType) {
  const mime = normalizedMime(mimeType);
  if (mime === 'image/png') return extractPngText(bytes);
  if (mime === 'image/jpeg') return extractJpegText(bytes);
  if (mime === 'image/webp') return extractWebpText(bytes);
  return '';
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
  let embeddedText = extractEmbeddedText(bytes, mime);
  if (kind === 'image' && detectedMime) dimensions = imageDimensions(bytes, mime);
  if (mediaInspector && kind && findings.every((item) => item.severity !== 'BLOCK')) {
    try {
      const probe = await mediaInspector.inspect({ bytes, contentType: mime, kind });
      dimensions = { width: probe.width || dimensions.width, height: probe.height || dimensions.height };
      durationMs = Number.isFinite(probe.durationMs) ? probe.durationMs : null;
      if (probe.embeddedText) embeddedText = printableMetadata([embeddedText,probe.embeddedText].filter(Boolean).join('\n'));
    } catch (error) {
      findings.push({ severity: 'BLOCK', code: error.code || 'MEDIA_UNREADABLE' });
    }
  }
  return Object.freeze({ mimeType: mime, extension, kind, detectedMime, byteSize: bytes.length,
    width: dimensions.width || null, height: dimensions.height || null, durationMs, findings: Object.freeze(findings), embeddedText });
}

module.exports = { MAX_ASSET_BYTES, MIME_EXTENSIONS, decodeBase64, extensionOf, extractEmbeddedText, imageDimensions, inspectMedia,
  mediaKind, normalizedMime, printableMetadata, sniffMime };
