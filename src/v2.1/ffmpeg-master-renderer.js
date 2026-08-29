'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { renderEndTitlePng } = require('../v2.10/post-production-text');

const DEFAULT_PROFILE = Object.freeze({
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: 'libx264',
  audioCodec: 'aac',
  crf: 18,
  audioBitrate: '192k',
});

function requireValue(name, value) {
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
}

function seconds(milliseconds) {
  return (milliseconds / 1000).toFixed(3);
}

function extensionFor(contentType, kind) {
  const extensions = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
  };
  return extensions[contentType] || ({ image: '.img', video: '.video', voice: '.audio', audio: '.audio' }[kind] || '.bin');
}

function buildFfmpegArgs({ assembly, inputPaths, outputPath, profile = {}, postProduction = assembly?.postProduction, endTitlePath = null } = {}) {
  requireValue('assembly', assembly);
  requireValue('outputPath', outputPath);
  if (!Array.isArray(inputPaths) || inputPaths.length !== assembly.clips.length) {
    throw new Error('inputPaths must match assembly clips');
  }

  const settings = { ...DEFAULT_PROFILE, ...profile };
  for (const field of ['width', 'height', 'fps']) {
    if (!Number.isInteger(settings[field]) || settings[field] <= 0) throw new Error(`${field} must be a positive integer`);
  }

  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  assembly.clips.forEach((clip, index) => {
    if (clip.kind === 'image') args.push('-loop', '1', '-t', seconds(clip.durationMs));
    args.push('-i', inputPaths[index]);
  });
  const endTitle = postProduction?.endTitle;
  if (endTitle?.enabled) {
    if (!endTitlePath) throw new Error('Rendered end-title image is required');
    args.push('-loop','1','-t',seconds(assembly.durationMs),'-i',endTitlePath);
  }

  const filters = [];
  const visualLabels = [];
  const audioLabels = [];

  assembly.clips.forEach((clip, index) => {
    const offset = seconds(clip.sourceOffsetMs || 0);
    const duration = seconds(clip.durationMs);
    if (clip.kind === 'image' || clip.kind === 'video') {
      const label = `v${visualLabels.length}`;
      filters.push(
        `[${index}:v]trim=start=${offset}:duration=${duration},setpts=PTS-STARTPTS,` +
        `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,` +
        `pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `setsar=1,fps=${settings.fps},format=yuv420p[${label}]`,
      );
      visualLabels.push(label);
    }
    if (clip.kind === 'voice' || clip.kind === 'audio') {
      const label = `a${audioLabels.length}`;
      const delay = Math.round(clip.startMs);
      const volume = clip.kind === 'voice' ? '1.0' : '0.22';
      filters.push(
        `[${index}:a]atrim=start=${offset}:duration=${duration},asetpts=PTS-STARTPTS,` +
        `adelay=${delay}|${delay},volume=${volume}[${label}]`,
      );
      audioLabels.push(label);
    }
  });

  if (visualLabels.length === 0) throw new Error('At least one visual clip is required');
  const visualOutput = endTitle?.enabled ? 'vbase' : 'vout';
  filters.push(visualLabels.length === 1
    ? `[${visualLabels[0]}]null[${visualOutput}]`
    : `${visualLabels.map((label) => `[${label}]`).join('')}concat=n=${visualLabels.length}:v=1:a=0[${visualOutput}]`);
  if (endTitle?.enabled) {
    const start = Number(endTitle.startTime); const duration = Number(endTitle.duration);
    if (!String(endTitle.text || '').trim() || !Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0
      || start + duration > assembly.durationMs / 1000 + 0.001) throw new Error('Valid post-production end title text and timing are required');
    const titleInput = assembly.clips.length;
    filters.push(`[${titleInput}:v]scale=${settings.width}:${settings.height},format=rgba[titlecard]`);
    filters.push(`[vbase][titlecard]overlay=0:0:enable='between(t,${start},${start + duration})'[vout]`);
  }

  if (audioLabels.length > 0) {
    filters.push(
      `${audioLabels.map((label) => `[${label}]`).join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,` +
      `atrim=duration=${seconds(assembly.durationMs)}[aout]`,
    );
  } else {
    filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${seconds(assembly.durationMs)}[aout]`);
  }

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', settings.videoCodec, '-preset', 'medium', '-crf', String(settings.crf),
    '-c:a', settings.audioCodec, '-b:a', settings.audioBitrate,
    '-r', String(settings.fps), '-t', seconds(assembly.durationMs),
    '-movflags', '+faststart', outputPath,
  );
  return args;
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        const error = new Error(`${command} failed with exit code ${code}: ${Buffer.concat(stderr).toString('utf8')}`);
        error.code = 'MEDIA_RENDER_FAILED';
        reject(error);
        return;
      }
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

function normalizeProbe(payload) {
  const video = (payload.streams || []).find((stream) => stream.codec_type === 'video');
  const audio = (payload.streams || []).find((stream) => stream.codec_type === 'audio');
  const rate = String(video?.avg_frame_rate || video?.r_frame_rate || '0/1').split('/').map(Number);
  const fps = rate[1] ? rate[0] / rate[1] : 0;
  return Object.freeze({
    durationMs: Math.round(Number(payload.format?.duration || video?.duration || 0) * 1000),
    size: Number(payload.format?.size || 0),
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    fps,
    videoCodec: video?.codec_name || null,
    pixelFormat: video?.pix_fmt || null,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name || null,
    audioSampleRate: Number(audio?.sample_rate || 0),
    audioChannels: Number(audio?.channels || 0),
  });
}

class FfmpegMasterRenderer {
  constructor({ ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe', run = runProcess } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.run = run;
  }

  async render({ assembly, profile = {} } = {}) {
    requireValue('assembly', assembly);
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-render-'));
    const outputPath = path.join(temporaryDirectory, 'master.mp4');
    try {
      const inputPaths = [];
      for (let index = 0; index < assembly.clips.length; index += 1) {
        const clip = assembly.clips[index];
        const media = clip.media;
        if (media.bytes) {
          const inputPath = path.join(temporaryDirectory, `input-${index}${extensionFor(media.contentType, clip.kind)}`);
          await fs.writeFile(inputPath, media.bytes, { flag: 'wx' });
          inputPaths.push(inputPath);
        } else if (media.mediaUrl) {
          inputPaths.push(media.mediaUrl);
        } else {
          throw new Error(`Clip ${clip.id} has no renderable media`);
        }
      }

      let endTitlePath = null;
      if (assembly.postProduction?.endTitle?.enabled) {
        const settings = { ...DEFAULT_PROFILE, ...profile }; endTitlePath = path.join(temporaryDirectory,'end-title.png');
        await fs.writeFile(endTitlePath,renderEndTitlePng({ width:settings.width,height:settings.height,
          text:assembly.postProduction.endTitle.text,brandName:assembly.postProduction.brandName }),{flag:'wx'});
      }
      const args = buildFfmpegArgs({ assembly, inputPaths, outputPath, profile, endTitlePath });
      await this.run(this.ffmpegPath, args);
      const probeResult = await this.run(this.ffprobePath, [
        '-v', 'error', '-show_streams', '-show_format', '-of', 'json', outputPath,
      ]);
      const probe = normalizeProbe(JSON.parse(probeResult.stdout.toString('utf8')));
      const bytes = await fs.readFile(outputPath);
      if (bytes.length === 0) throw new Error('FFmpeg produced an empty master');
      return Object.freeze({
        output: bytes,
        contentType: 'video/mp4',
        probe,
        provenance: Object.freeze({ renderer: 'ffmpeg', profile: Object.freeze({ ...DEFAULT_PROFILE, ...profile }) }),
      });
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

module.exports = {
  DEFAULT_PROFILE,
  FfmpegMasterRenderer,
  buildFfmpegArgs,
  extensionFor,
  normalizeProbe,
  runProcess,
};
