'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { extensionFor } = require('../v2.1/ffmpeg-master-renderer');
const { TIER_POLICIES, normalizeTier } = require('./quality-contract');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve(Buffer.concat(stdout))
      : reject(Object.assign(new Error(`Frame extraction failed: ${Buffer.concat(stderr).toString('utf8')}`), { code: 'FRAME_CORRUPTION' })));
  });
}

function stats(gray, width, height) {
  let sum = 0; let sumSquares = 0; let dark = 0;
  for (const value of gray) { sum += value; sumSquares += value * value; if (value < 24) dark += 1; }
  const mean = gray.length ? sum / gray.length : 0;
  const variance = gray.length ? Math.max(0, (sumSquares / gray.length) - (mean * mean)) : 0;
  const rowDarkRatios = [];
  for (let y = 0; y < height; y += 1) {
    let count = 0; for (let x = 0; x < width; x += 1) if (gray[(y * width) + x] < 24) count += 1;
    rowDarkRatios.push(count / width);
  }
  const columnDarkRatios = [];
  for (let x = 0; x < width; x += 1) {
    let count = 0; for (let y = 0; y < height; y += 1) if (gray[(y * width) + x] < 24) count += 1;
    columnDarkRatios.push(count / height);
  }
  return Object.freeze({ mean: Number(mean.toFixed(3)), standardDeviation: Number(Math.sqrt(variance).toFixed(3)),
    darkRatio: Number((dark / Math.max(1, gray.length)).toFixed(4)), rowDarkRatios, columnDarkRatios });
}

function difference(first, second) {
  if (!first || !second || first.length !== second.length) return null;
  let sum = 0; for (let index = 0; index < first.length; index += 1) sum += Math.abs(first[index] - second[index]);
  return Number((sum / first.length).toFixed(3));
}

class FfmpegFrameSampler {
  constructor({ ffmpegPath = 'ffmpeg', analysisWidth = 160, runProcess = run } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.analysisWidth = analysisWidth;
    this.run = runProcess;
  }

  async sample({ bytes, contentType = 'video/mp4', kind = 'video', durationMs, width, height, qualityTier = 'STANDARD' } = {}) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw Object.assign(new Error('Video bytes are required'), { code: 'FRAME_CORRUPTION' });
    const tier = normalizeTier(qualityTier);
    const ratios = TIER_POLICIES[tier].sampleRatios;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-v29-frames-'));
    const inputPath = path.join(directory, `source${extensionFor(contentType, kind)}`);
    const analysisHeight = Math.max(2, Math.round((this.analysisWidth * Number(height || 1)) / Number(width || 1) / 2) * 2);
    try {
      await fs.writeFile(inputPath, bytes, { flag: 'wx' });
      const frames = [];
      for (const ratio of ratios) {
        const safeEndMs = Math.max(0, Number(durationMs || 1) - 100);
        const timestampMs = Math.max(0, Math.min(safeEndMs, Math.round(Number(durationMs || 1) * ratio)));
        const common = ['-hide_banner', '-loglevel', 'error', '-ss', (timestampMs / 1000).toFixed(3), '-i', inputPath, '-frames:v', '1'];
        const gray = await this.run(this.ffmpegPath, [...common, '-vf', `scale=${this.analysisWidth}:${analysisHeight},format=gray`,
          '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1']);
        if (gray.length !== this.analysisWidth * analysisHeight) throw Object.assign(new Error('Decoded frame has unexpected dimensions'), { code: 'FRAME_CORRUPTION' });
        const jpeg = await this.run(this.ffmpegPath, [...common, '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']);
        frames.push({ ratio, timestampMs, analysisWidth: this.analysisWidth, analysisHeight,
          analysisHash: crypto.createHash('sha256').update(gray).digest('hex'),
          metrics: stats(gray, this.analysisWidth, analysisHeight), jpeg, gray });
      }
      return Object.freeze(frames.map((frame, index) => Object.freeze({
        ...frame,
        differenceFromPrevious: index ? difference(frames[index - 1].gray, frame.gray) : null,
      })));
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}

module.exports = { FfmpegFrameSampler, difference, stats };
