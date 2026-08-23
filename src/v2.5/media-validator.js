'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { extensionFor, normalizeProbe, runProcess } = require('../v2.1/ffmpeg-master-renderer');

class MediaValidationError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'MediaValidationError';
    this.code = code;
    this.details = details;
  }
}

function validateMediaProbe({ kind, probe, expectedDurationMs = null, durationToleranceMs = 1500 } = {}) {
  if (!probe || probe.size <= 0) throw new MediaValidationError('MEDIA_EMPTY', 'Media file is empty or unreadable', probe);
  if ((kind === 'video' || kind === 'image') && !probe.videoCodec) {
    throw new MediaValidationError('MEDIA_VIDEO_STREAM_MISSING', `${kind} asset has no readable video/image stream`, probe);
  }
  if ((kind === 'voice' || kind === 'audio') && !probe.hasAudio) {
    throw new MediaValidationError('MEDIA_AUDIO_STREAM_MISSING', `${kind} asset has no readable audio stream`, probe);
  }
  if (kind !== 'image' && probe.durationMs <= 0) {
    throw new MediaValidationError('MEDIA_DURATION_INVALID', `${kind} asset has no positive duration`, probe);
  }
  if (expectedDurationMs && kind === 'video' && probe.durationMs + durationToleranceMs < expectedDurationMs) {
    throw new MediaValidationError('MEDIA_DURATION_TOO_SHORT', 'Video asset is shorter than its required clip', {
      actualMs: probe.durationMs, expectedMs: expectedDurationMs, durationToleranceMs,
    });
  }
  return Object.freeze({ status: 'PASS', kind, ...probe });
}

function validateMasterProbe({ probe, width = 1080, height = 1920, durationMs, durationToleranceMs = 1000, requireAudio = true } = {}) {
  const checks = {
    nonEmpty: Boolean(probe && probe.size > 0),
    videoStream: Boolean(probe?.videoCodec),
    audioStream: !requireAudio || Boolean(probe?.hasAudio),
    dimensions: probe?.width === width && probe?.height === height,
    duration: Number.isFinite(durationMs) && Math.abs(Number(probe?.durationMs || 0) - durationMs) <= durationToleranceMs,
  };
  if (Object.values(checks).some((value) => !value)) {
    throw new MediaValidationError('MASTER_MEDIA_VALIDATION_FAILED', 'Master failed media-level validation', { checks, probe });
  }
  return Object.freeze({ status: 'PASS', checks: Object.freeze(checks), probe });
}

class FfprobeMediaInspector {
  constructor({ ffprobePath = 'ffprobe', run = runProcess } = {}) {
    this.ffprobePath = ffprobePath;
    this.run = run;
  }

  async inspect({ bytes, contentType, kind, expectedDurationMs = null } = {}) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new MediaValidationError('MEDIA_EMPTY', 'Immutable media bytes are required');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-probe-'));
    const inputPath = path.join(directory, `media${extensionFor(contentType, kind)}`);
    try {
      await fs.writeFile(inputPath, bytes, { flag: 'wx' });
      const result = await this.run(this.ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', inputPath]);
      const probe = normalizeProbe(JSON.parse(result.stdout.toString('utf8')));
      return validateMediaProbe({ kind, probe, expectedDurationMs });
    } catch (error) {
      if (error instanceof MediaValidationError) throw error;
      throw new MediaValidationError('MEDIA_UNREADABLE', `Media inspection failed: ${error.message}`);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}

module.exports = {
  FfprobeMediaInspector,
  MediaValidationError,
  validateMasterProbe,
  validateMediaProbe,
};
