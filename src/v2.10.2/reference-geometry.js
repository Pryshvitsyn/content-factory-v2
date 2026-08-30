'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { runProcess } = require('../v2.1/ffmpeg-master-renderer');
const { FfprobeMediaInspector } = require('../v2.5/media-validator');

const NORMALIZATION_VERSION = 'v2.10.2-scale-fit-pad-v1';
const ASPECT_TOLERANCE = 0.015;

class ReferenceGeometryError extends Error {
  constructor(code, message, details = null) { super(message); this.name = 'ReferenceGeometryError'; this.code = code; this.details = details; }
}

function parseAspectRatio(value) {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) throw new ReferenceGeometryError(
    'REFERENCE_GEOMETRY_MISMATCH', `Canonical aspect ratio '${value}' is invalid`);
  return Number(match[1]) / Number(match[2]);
}

function geometry(width, height) {
  const w = Number(width); const h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) throw new ReferenceGeometryError(
    'REFERENCE_GEOMETRY_MISMATCH', 'Decoded reference dimensions must be positive integers', { width, height });
  return Object.freeze({ width: w, height: h, aspectRatio: Number((w / h).toFixed(6)),
    orientation: w === h ? 'SQUARE' : w < h ? 'PORTRAIT' : 'LANDSCAPE' });
}

function compatible(actual, expectedAspectRatio, tolerance = ASPECT_TOLERANCE) {
  const expected = parseAspectRatio(expectedAspectRatio);
  return Math.abs(actual.aspectRatio - expected) / expected <= tolerance;
}

function targetDimensions(expectedAspectRatio, resolution = '720p') {
  const targets = { '480p': { '9:16': [480, 854], '16:9': [854, 480] },
    '720p': { '9:16': [720, 1280], '16:9': [1280, 720] },
    '1080p': { '9:16': [1080, 1920], '16:9': [1920, 1080] } };
  const selected = targets[resolution]?.[expectedAspectRatio];
  if (!selected) throw new ReferenceGeometryError('REFERENCE_GEOMETRY_MISMATCH',
    `No deterministic reference geometry is defined for ${resolution} ${expectedAspectRatio}`);
  return Object.freeze({ width: selected[0], height: selected[1] });
}

class FfmpegReferenceGeometryNormalizer {
  constructor({ ffmpegPath = 'ffmpeg', run = runProcess, inspector = new FfprobeMediaInspector() } = {}) {
    this.ffmpegPath = ffmpegPath; this.run = run; this.inspector = inspector;
  }

  async probe(bytes, contentType = 'image/jpeg') {
    const result = await this.inspector.inspect({ bytes, contentType, kind: 'image' });
    return geometry(result.width, result.height);
  }

  async normalize({ bytes, contentType = 'image/jpeg', expectedAspectRatio, resolution = '720p' } = {}) {
    const before = await this.probe(bytes, contentType);
    if (compatible(before, expectedAspectRatio)) return Object.freeze({ bytes, contentType, before, after: before,
      normalizationApplied: false, normalizationVersion: NORMALIZATION_VERSION, policy: 'NONE_ALREADY_COMPATIBLE' });
    const target = targetDimensions(expectedAspectRatio, resolution);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-reference-geometry-'));
    const inputPath = path.join(directory, 'input.jpg'); const outputPath = path.join(directory, 'normalized.jpg');
    try {
      await fs.writeFile(inputPath, bytes, { flag: 'wx' });
      // Preserve all source content: proportional scale-to-fit followed by deterministic black padding.
      // No stretching and no destructive crop are permitted by this policy.
      await this.run(this.ffmpegPath, ['-hide_banner','-loglevel','error','-y','-i',inputPath,'-frames:v','1',
        '-vf',`scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
        '-q:v','3',outputPath]);
      const normalized = await fs.readFile(outputPath);
      const after = await this.probe(normalized, 'image/jpeg');
      if (!compatible(after, expectedAspectRatio)) throw new ReferenceGeometryError('REFERENCE_GEOMETRY_MISMATCH',
        'Deterministic reference normalization did not produce canonical geometry', { before, after, expectedAspectRatio });
      return Object.freeze({ bytes: normalized, contentType: 'image/jpeg', before, after,
        normalizationApplied: true, normalizationVersion: NORMALIZATION_VERSION,
        policy: 'PROPORTIONAL_SCALE_TO_FIT_THEN_PAD', target });
    } catch (error) {
      if (error instanceof ReferenceGeometryError) throw error;
      throw new ReferenceGeometryError('REFERENCE_GEOMETRY_MISMATCH',
        `Reference normalization failed before provider execution: ${error.message}`, { before, expectedAspectRatio, resolution });
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
}

function referenceEvidence({ result, expectedAspectRatio, source = {}, referenceBytes }) {
  return Object.freeze({ referenceWidth: result.after.width, referenceHeight: result.after.height,
    referenceAspectRatio: result.after.aspectRatio, expectedAspectRatio, orientation: result.after.orientation,
    sourceArtifactId: source.artifactId || null, sourceArtifactVersion: source.version || null,
    sourceContentHash: source.contentHash || null,
    referenceHash: crypto.createHash('sha256').update(referenceBytes).digest('hex'),
    normalizationApplied: result.normalizationApplied, normalizationVersion: result.normalizationVersion,
    normalizationPolicy: result.policy, originalReferenceWidth: result.before.width,
    originalReferenceHeight: result.before.height, originalReferenceAspectRatio: result.before.aspectRatio });
}

module.exports = { ASPECT_TOLERANCE, FfmpegReferenceGeometryNormalizer, NORMALIZATION_VERSION,
  ReferenceGeometryError, compatible, geometry, parseAspectRatio, referenceEvidence, targetDimensions };
