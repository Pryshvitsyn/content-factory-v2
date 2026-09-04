'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { validateManifest } = require('./sphere-motion-master');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr}`));
    });
  });
}
function inspectOutput(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v','error','-of','json','-show_entries','format=duration:stream=codec_name,codec_type,width,height,r_frame_rate',source]);
    const chunks = []; let stderr = ''; child.stdout.on('data', (chunk) => chunks.push(chunk)); child.stderr.on('data', (chunk) => { stderr += chunk; }); child.on('error', reject);
    child.on('close', (code) => { if (code !== 0) return reject(new Error(`Unable to inspect media: ${stderr}`)); try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); const video = value.streams.find((stream) => stream.codec_type === 'video') || {}; const [numerator, denominator = 1] = String(video.r_frame_rate || '0/1').split('/').map(Number); resolve(Object.freeze({ codec: video.codec_name || null, width: Number(video.width), height: Number(video.height), fps: numerator / denominator, durationMs: Math.round(Number(value.format?.duration || 0) * 1000) })); } catch (error) { reject(error); } });
  });
}
function seconds(ms) { return (Number(ms) / 1000).toFixed(3); }
function buildTrimArgs({ source, startMs, endMs, output, fps, width, height } = {}) { if (!source || !output) throw new Error('source and output are required'); if (!(Number(endMs) > Number(startMs) && Number(startMs) >= 0)) throw new Error('Valid trim time range is required'); return ['-hide_banner','-loglevel','error','-y','-ss',seconds(startMs),'-i',source,'-t',seconds(endMs - startMs),'-vf',`fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`, '-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-an',output]; }
function buildFrameArgs({ source, timeMs, output }) { if (!source || !output || Number(timeMs) < 0) throw new Error('source, non-negative timeMs and output are required'); return ['-hide_banner','-loglevel','error','-y','-ss',seconds(timeMs),'-i',source,'-frames:v','1',output]; }
function buildLoopPreviewArgs({ source, output, repetitions = 3 }) { if (!source || !output || !Number.isInteger(repetitions) || repetitions < 2) throw new Error('source, output and repetitions >= 2 are required'); return ['-hide_banner','-loglevel','error','-y','-stream_loop',String(repetitions - 1),'-i',source,'-c','copy',output]; }
function buildFrameDifferenceArgs({ firstFrame, lastFrame, output }) { return ['-hide_banner','-loglevel','error','-y','-i',firstFrame,'-i',lastFrame,'-filter_complex','[0:v][1:v]blend=all_mode=difference,signalstats','-frames:v','1',output]; }
async function extractSegment({ manifest, segmentId, output }) { const checked = validateManifest(manifest); const segment = checked.segments[segmentId]; if (!segment) throw new Error(`Unknown segment '${segmentId}'`); await run('ffmpeg', buildTrimArgs({ source: checked.source, startMs: segment.startMs, endMs: segment.endMs, output, fps: checked.fps, width: checked.width, height: checked.height })); return output; }
function segmentFramePaths(base, segmentId) { return { first: path.join(base, `${segmentId}-first.png`), middle: path.join(base, `${segmentId}-middle.png`), last: path.join(base, `${segmentId}-last.png`) }; }

module.exports = { buildFrameArgs, buildFrameDifferenceArgs, buildLoopPreviewArgs, buildTrimArgs, extractSegment, inspectOutput, run, segmentFramePaths };
