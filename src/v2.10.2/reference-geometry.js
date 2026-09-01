'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { extensionFor, runProcess } = require('../v2.1/ffmpeg-master-renderer');
const { FfprobeMediaInspector } = require('../v2.5/media-validator');

const NORMALIZATION_VERSION = 'v2.10.3-safe-reference-geometry-v1';
const ASPECT_TOLERANCE = 0.015;
const MAX_SAFE_RELATIVE_ASPECT_DELTA = 0.12;

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

function expectedOrientation(expectedAspectRatio) {
  const ratio = parseAspectRatio(expectedAspectRatio);
  return ratio === 1 ? 'SQUARE' : ratio < 1 ? 'PORTRAIT' : 'LANDSCAPE';
}

function relativeAspectDelta(actual, expectedAspectRatio) {
  const expected = parseAspectRatio(expectedAspectRatio);
  return Math.abs(Number(actual.aspectRatio) - expected) / expected;
}

function compatible(actual, expectedAspectRatio, tolerance = ASPECT_TOLERANCE) {
  return relativeAspectDelta(actual, expectedAspectRatio) <= tolerance;
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

function normalizeRotationDegrees(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = ((Math.round(numeric) % 360) + 360) % 360;
  const nearest = [0, 90, 180, 270].reduce((best, candidate) => (
    Math.abs(candidate - normalized) < Math.abs(best - normalized) ? candidate : best
  ), 0);
  return Math.min(Math.abs(nearest - normalized), 360 - Math.abs(nearest - normalized)) <= 2 ? nearest : null;
}

class FfmpegReferenceGeometryNormalizer {
  constructor({ ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', run = runProcess,
    inspector = new FfprobeMediaInspector() } = {}) {
    this.ffmpegPath = ffmpegPath; this.ffprobePath = ffprobePath; this.run = run; this.inspector = inspector;
  }

  async probe(bytes, contentType = 'image/jpeg') {
    const result = await this.inspector.inspect({ bytes, contentType, kind: 'image' });
    return geometry(result.width, result.height);
  }

  async inspectSourceRotation({ bytes, contentType = 'video/mp4' } = {}) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) return Object.freeze({ rotationDegrees: null, evidence: 'NO_SOURCE_VIDEO' });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-reference-rotation-'));
    const inputPath = path.join(directory, `source${extensionFor(contentType, 'video')}`);
    try {
      await fs.writeFile(inputPath, bytes, { flag: 'wx' });
      const result = await this.run(this.ffprobePath, ['-v','error','-select_streams','v:0','-show_streams','-of','json',inputPath]);
      const payload = JSON.parse(result.stdout.toString('utf8'));
      const stream = (payload.streams || [])[0] || {};
      const candidates = [stream.tags?.rotate,
        ...(stream.side_data_list || []).map((entry) => entry?.rotation)].filter((value) => value !== undefined && value !== null);
      const rotationDegrees = candidates.map(normalizeRotationDegrees).find((value) => value !== null) ?? null;
      return Object.freeze({ rotationDegrees, width: Number(stream.width || 0), height: Number(stream.height || 0),
        evidence: rotationDegrees == null ? 'NO_QUARTER_TURN_DISPLAY_METADATA' : 'FFPROBE_DISPLAY_METADATA' });
    } catch (error) {
      return Object.freeze({ rotationDegrees: null, evidence: 'SOURCE_ROTATION_PROBE_FAILED', error: error.message });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }

  async transformImage({ bytes, contentType = 'image/jpeg', filter, prefix = 'normalized' } = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `content-factory-reference-${prefix}-`));
    const inputPath = path.join(directory, 'input.jpg'); const outputPath = path.join(directory, 'output.jpg');
    try {
      await fs.writeFile(inputPath, bytes, { flag: 'wx' });
      await this.run(this.ffmpegPath, ['-hide_banner','-loglevel','error','-y','-i',inputPath,'-frames:v','1',
        '-vf',filter,'-q:v','3',outputPath]);
      return await fs.readFile(outputPath);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }

  async normalize({ bytes, contentType = 'image/jpeg', expectedAspectRatio, resolution = '720p' } = {}) {
    const before = await this.probe(bytes, contentType);
    if (compatible(before, expectedAspectRatio)) return Object.freeze({ bytes, contentType, before, after: before,
      normalizationApplied: false, normalizationVersion: NORMALIZATION_VERSION, policy: 'NONE_ALREADY_COMPATIBLE',
      relativeAspectDelta: relativeAspectDelta(before, expectedAspectRatio), sourceRotationDegrees: null });
    const target = targetDimensions(expectedAspectRatio, resolution);
    try {
      const normalized = await this.transformImage({ bytes, contentType,
        filter: `scale=${target.width}:${target.height}:force_original_aspect_ratio=decrease,pad=${target.width}:${target.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
        prefix: 'scale-pad' });
      const after = await this.probe(normalized, 'image/jpeg');
      if (!compatible(after, expectedAspectRatio)) throw new ReferenceGeometryError('REFERENCE_GEOMETRY_MISMATCH',
        'Deterministic reference normalization did not produce canonical geometry', { before, after, expectedAspectRatio });
      return Object.freeze({ bytes: normalized, contentType: 'image/jpeg', before, after,
        normalizationApplied: true, normalizationVersion: NORMALIZATION_VERSION,
        policy: 'PROPORTIONAL_SCALE_TO_FIT_THEN_PAD', target,
        relativeAspectDelta: relativeAspectDelta(before, expectedAspectRatio), sourceRotationDegrees: null });
    } catch (error) {
      if (error instanceof ReferenceGeometryError) throw error;
      throw new ReferenceGeometryError('REFERENCE_GEOMETRY_MISMATCH',
        `Reference normalization failed before provider execution: ${error.message}`, { before, expectedAspectRatio, resolution });
    }
  }

  async normalizePreviousShot({ bytes, contentType = 'image/jpeg', expectedAspectRatio, resolution = '720p',
    sourceVideoBytes = null, sourceVideoContentType = 'video/mp4' } = {}) {
    const before = await this.probe(bytes, contentType);
    const delta = relativeAspectDelta(before, expectedAspectRatio);
    if (compatible(before, expectedAspectRatio)) return Object.freeze({ bytes, contentType, before, after: before,
      normalizationApplied: false, normalizationVersion: NORMALIZATION_VERSION, policy: 'NONE_ALREADY_COMPATIBLE',
      relativeAspectDelta: delta, sourceRotationDegrees: null });

    const expected = expectedOrientation(expectedAspectRatio);
    if (before.orientation !== expected) {
      const rotation = await this.inspectSourceRotation({ bytes: sourceVideoBytes, contentType: sourceVideoContentType });
      if ([90, 270].includes(rotation.rotationDegrees)) {
        const filter = rotation.rotationDegrees === 90 ? 'transpose=clock,setsar=1' : 'transpose=cclock,setsar=1';
        const rotated = await this.transformImage({ bytes, contentType, filter, prefix: 'rotate' });
        const after = await this.probe(rotated, 'image/jpeg');
        if (compatible(after, expectedAspectRatio)) return Object.freeze({ bytes: rotated, contentType: 'image/jpeg',
          before, after, normalizationApplied: true, normalizationVersion: NORMALIZATION_VERSION,
          policy: 'ROTATE_FROM_SOURCE_DISPLAY_METADATA', relativeAspectDelta: delta,
          sourceRotationDegrees: rotation.rotationDegrees, rotationEvidence: rotation.evidence });
      }
      throw new ReferenceGeometryError('REFERENCE_GEOMETRY_ORIENTATION_INVERSION',
        `Extracted previous-shot frame is ${before.orientation} but canonical production requires ${expected}; refusing letterboxed orientation inversion before provider execution`,
        { before, expectedAspectRatio, expectedOrientation: expected, relativeAspectDelta: delta,
          sourceRotationDegrees: rotation.rotationDegrees, rotationEvidence: rotation.evidence });
    }

    if (delta > MAX_SAFE_RELATIVE_ASPECT_DELTA) throw new ReferenceGeometryError('REFERENCE_GEOMETRY_MISMATCH',
      'Previous-shot frame differs too far from canonical aspect ratio for non-destructive padding normalization',
      { before, expectedAspectRatio, relativeAspectDelta: delta, maximumSafeRelativeAspectDelta: MAX_SAFE_RELATIVE_ASPECT_DELTA });

    return this.normalize({ bytes, contentType, expectedAspectRatio, resolution });
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
    originalReferenceHeight: result.before.height, originalReferenceAspectRatio: result.before.aspectRatio,
    relativeAspectDelta: result.relativeAspectDelta ?? null,
    sourceRotationDegrees: result.sourceRotationDegrees ?? null,
    rotationEvidence: result.rotationEvidence || null });
}

function validateLocationReferenceGeometry(location = {}) {
  const reference = location.referenceGeometry || location.reference_geometry || {};
  const checks = [];
  let decoded = null;
  try { decoded = geometry(reference.width, reference.height); checks.push(Object.freeze({ code: 'LOCATION_REFERENCE_GEOMETRY', status: 'PASS' })); }
  catch (error) { checks.push(Object.freeze({ code: 'LOCATION_REFERENCE_GEOMETRY', status: 'FAIL', reason: error.message })); }
  for (const [code, value] of [
    ['LOCATION_PERSPECTIVE', location.perspective], ['LOCATION_LIGHT_DIRECTION', location.lightingDirection || location.lighting_direction],
    ['LOCATION_LIGHT_TEMPERATURE', location.lightingTemperature || location.lighting_temperature],
  ]) checks.push(Object.freeze({ code, status: value && (typeof value !== 'object' || Object.keys(value).length) ? 'PASS' : 'FAIL' }));
  return Object.freeze({ status: checks.every((check) => check.status === 'PASS') ? 'PASS' : 'FAIL',
    geometry: decoded, checks: Object.freeze(checks), contract: 'V2.10.2_REFERENCE_GEOMETRY' });
}

function validateAvatarL2ReferenceGeometry({ width,height,referenceType }={}) {
  let decoded=null;const checks=[];
  try { decoded=geometry(width,height);checks.push(Object.freeze({code:'DECODED_DIMENSIONS',status:'PASS'})); }
  catch(error){checks.push(Object.freeze({code:'DECODED_DIMENSIONS',status:'FAIL',reason:error.message}));}
  const portraitRequired=['FULL_BODY_STANDING_NEUTRAL','SEATED_NEUTRAL'].includes(referenceType);
  if(decoded) checks.push(Object.freeze({code:'REFERENCE_FRAMING_GEOMETRY',status:portraitRequired&&decoded.orientation==='LANDSCAPE'?'WARN':'PASS',
    evidence:{orientation:decoded.orientation,referenceType}}));
  return Object.freeze({status:checks.some((item)=>item.status==='FAIL')?'FAIL':checks.some((item)=>item.status==='WARN')?'WARN':'PASS',
    geometry:decoded,checks:Object.freeze(checks),contract:'V2.10.2_REFERENCE_GEOMETRY'});
}

module.exports = { ASPECT_TOLERANCE, MAX_SAFE_RELATIVE_ASPECT_DELTA, FfmpegReferenceGeometryNormalizer,
  NORMALIZATION_VERSION, ReferenceGeometryError, compatible, expectedOrientation, geometry,
  normalizeRotationDegrees, parseAspectRatio, referenceEvidence, relativeAspectDelta, targetDimensions,
  validateAvatarL2ReferenceGeometry, validateLocationReferenceGeometry };
