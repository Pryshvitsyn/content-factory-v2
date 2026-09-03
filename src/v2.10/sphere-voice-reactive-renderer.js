'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runProcess } = require('../v2.1/ffmpeg-master-renderer');

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }

function pcm16leToSamples(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('PCM input must be a Buffer');
  const length = Math.floor(bytes.length / 2);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) samples[index] = bytes.readInt16LE(index * 2) / 32768;
  return samples;
}

function buildVoiceEnvelope(samples, {
  sampleRate = 1000,
  windowMs = 40,
  hopMs = 40,
  silenceThreshold = 0.025,
  attack = 0.55,
  release = 0.18,
} = {}) {
  if (!samples?.length) return Object.freeze([]);
  const windowSize = Math.max(1, Math.round(sampleRate * windowMs / 1000));
  const hopSize = Math.max(1, Math.round(sampleRate * hopMs / 1000));
  const raw = [];
  let peak = 0;
  for (let start = 0; start < samples.length; start += hopSize) {
    const end = Math.min(samples.length, start + windowSize);
    let energy = 0;
    for (let index = start; index < end; index += 1) energy += samples[index] * samples[index];
    const rms = Math.sqrt(energy / Math.max(1, end - start));
    peak = Math.max(peak, rms);
    raw.push({ startSeconds: start / sampleRate, endSeconds: end / sampleRate, rms });
  }
  const usablePeak = Math.max(peak, silenceThreshold * 1.25);
  let smoothed = 0;
  return Object.freeze(raw.map((point) => {
    const normalized = point.rms <= silenceThreshold ? 0
      : clamp((point.rms - silenceThreshold) / Math.max(0.000001, usablePeak - silenceThreshold));
    const coefficient = normalized > smoothed ? attack : release;
    smoothed += (normalized - smoothed) * coefficient;
    return Object.freeze({
      startSeconds: Number(point.startSeconds.toFixed(3)),
      endSeconds: Number(point.endSeconds.toFixed(3)),
      rms: Number(point.rms.toFixed(6)),
      intensity: Number(clamp(smoothed).toFixed(4)),
    });
  }));
}

function escapeFilterNumber(value) { return Number(value).toFixed(3); }

function buildEnvelopeExpression(envelope) {
  const active = (envelope || []).filter((point) => point.intensity > 0.001);
  if (!active.length) return '0';
  let expression = '0';
  for (let index = active.length - 1; index >= 0; index -= 1) {
    const point = active[index];
    expression = `if(between(t\\,${escapeFilterNumber(point.startSeconds)}\\,${escapeFilterNumber(point.endSeconds)})\\,${point.intensity.toFixed(4)}\\,${expression})`;
  }
  return expression;
}

function buildVoiceReactiveFilter({ envelope, sphereDiameterRatio = 0.62, maxScalePulse = 0.018,
  maxTravelPixels = 2.5, vibrationHzX = 17, vibrationHzY = 19 } = {}) {
  const intensity = buildEnvelopeExpression(envelope);
  const ratio = clamp(Number(sphereDiameterRatio), 0.2, 0.95);
  const scalePulse = clamp(Number(maxScalePulse), 0, 0.06);
  const travel = clamp(Number(maxTravelPixels), 0, 12);
  const scaleX = `1+${scalePulse.toFixed(4)}*(${intensity})*(0.5+0.5*sin(2*PI*${Number(vibrationHzX).toFixed(2)}*t))`;
  const scaleY = `1+${scalePulse.toFixed(4)}*(${intensity})*(0.5+0.5*sin(2*PI*${Number(vibrationHzY).toFixed(2)}*t))`;
  return [
    '[0:v]split=2[base][sphere_src]',
    `[sphere_src]crop=w='iw*${ratio.toFixed(4)}':h='iw*${ratio.toFixed(4)}':x='(iw-ow)/2':y='(ih-oh)/2',` +
      `scale=w='iw*(${scaleX})':h='ih*(${scaleY})':eval=frame,format=yuv420p[reactive]`,
    `[base][reactive]overlay=x='(main_w-overlay_w)/2+${travel.toFixed(3)}*(${intensity})*sin(2*PI*${Number(vibrationHzX).toFixed(2)}*t)':` +
      `y='(main_h-overlay_h)/2+${travel.toFixed(3)}*(${intensity})*sin(2*PI*${Number(vibrationHzY).toFixed(2)}*t)':eval=frame[vout]`,
    '[1:a]aresample=48000[aout]',
  ].join(';');
}

function buildVoiceReactiveFfmpegArgs({ videoPath, audioPath, outputPath, envelope, settings = {} } = {}) {
  if (!videoPath || !audioPath || !outputPath) throw new Error('videoPath, audioPath and outputPath are required');
  const filter = buildVoiceReactiveFilter({ envelope, ...settings });
  return [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath, '-i', audioPath,
    '-filter_complex', filter,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outputPath,
  ];
}

class SphereVoiceReactiveRenderer {
  constructor({ ffmpegPath = 'ffmpeg', run = runProcess } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.run = run;
  }

  async extractEnvelope(audioPath, options = {}) {
    if (!audioPath) throw new Error('audioPath is required');
    const sampleRate = Number(options.sampleRate || 1000);
    const result = await this.run(this.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-i', audioPath, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', 'pipe:1',
    ]);
    return buildVoiceEnvelope(pcm16leToSamples(result.stdout), { ...options, sampleRate });
  }

  async render({ videoPath, audioPath, outputPath = null, envelopeOptions = {}, renderSettings = {} } = {}) {
    if (!videoPath || !audioPath) throw new Error('videoPath and audioPath are required');
    const temporaryDirectory = outputPath ? null : await fs.mkdtemp(path.join(os.tmpdir(), 'sphere-voice-response-'));
    const resolvedOutputPath = outputPath || path.join(temporaryDirectory, 'sphere-voice-response.mp4');
    try {
      const envelope = await this.extractEnvelope(audioPath, envelopeOptions);
      const args = buildVoiceReactiveFfmpegArgs({ videoPath, audioPath, outputPath: resolvedOutputPath, envelope, settings: renderSettings });
      await this.run(this.ffmpegPath, args);
      const bytes = await fs.readFile(resolvedOutputPath);
      if (!bytes.length) throw new Error('Voice-reactive sphere renderer produced an empty file');
      return Object.freeze({
        outputPath: resolvedOutputPath,
        bytes,
        contentType: 'video/mp4',
        envelope,
        provenance: Object.freeze({
          renderer: 'ffmpeg-sphere-voice-reactive-v1',
          deterministic: true,
          backgroundMotion: 'UNCHANGED_BASE_VIDEO',
          response: 'CENTER_SPHERE_ROI_FULL_BODY_RESONANCE',
          noHalo: true,
          settings: Object.freeze({ ...renderSettings }),
        }),
      });
    } finally {
      if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

module.exports = {
  SphereVoiceReactiveRenderer,
  buildEnvelopeExpression,
  buildVoiceEnvelope,
  buildVoiceReactiveFfmpegArgs,
  buildVoiceReactiveFilter,
  pcm16leToSamples,
};
