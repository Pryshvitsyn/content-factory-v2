'use strict';

const { spawn } = require('node:child_process');

function rawFrame({ source, timeMs, width, height }) {
  if (!source || !Number.isFinite(timeMs) || !Number.isInteger(width) || !Number.isInteger(height)) throw new Error('source, timeMs, width and height are required');
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner','-loglevel','error','-ss',(timeMs / 1000).toFixed(3),'-i',source,'-frames:v','1','-vf',`scale=${width}:${height}`, '-f','rawvideo','-pix_fmt','gray','pipe:1']);
    const chunks = []; let stderr = ''; child.stdout.on('data', (chunk) => chunks.push(chunk)); child.stderr.on('data', (chunk) => { stderr += chunk; }); child.on('error', reject);
    child.on('close', (code) => { const frame = Buffer.concat(chunks); if (code !== 0 || frame.length !== width * height) reject(new Error(`Unable to extract frame: ${stderr || `expected ${width * height} bytes, received ${frame.length}`}`)); else resolve(frame); });
  });
}
function mean(values) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function analyze(first, last, width, height) {
  const cx = (width - 1) / 2; const cy = (height - 1) / 2; const maxRadius = Math.min(width, height) * 0.48;
  const diffs = []; const rim = []; const background = []; let firstLum = 0; let lastLum = 0;
  const weighted = (frame) => { let mass = 0; let x = 0; let y = 0; let radius = 0; for (let iy = 0; iy < height; iy += 1) for (let ix = 0; ix < width; ix += 1) { const value = frame[iy * width + ix]; const dx = ix - cx; const dy = iy - cy; const distance = Math.hypot(dx, dy); const weight = value * Math.max(0, 1 - distance / maxRadius); mass += weight; x += ix * weight; y += iy * weight; radius += distance * weight; } return mass ? { x: x / mass, y: y / mass, radius: radius / mass } : { x: cx, y: cy, radius: 0 }; };
  for (let index = 0; index < first.length; index += 1) { const value = Math.abs(first[index] - last[index]); diffs.push(value); firstLum += first[index]; lastLum += last[index]; const ix = index % width; const iy = Math.floor(index / width); const distance = Math.hypot(ix - cx, iy - cy); if (distance > maxRadius * 0.76 && distance <= maxRadius) rim.push(value); if (distance > maxRadius * 1.15) background.push(value); }
  const a = weighted(first); const b = weighted(last);
  return Object.freeze({ firstLastFrameDifference: mean(diffs), averageDifference: mean(diffs), edgeRimDifference: mean(rim), backgroundDifference: mean(background), sphereCenterDisplacementPx: Math.hypot(a.x - b.x, a.y - b.y), sphereApparentRadiusDifferencePx: Math.abs(a.radius - b.radius), suddenLuminanceJump: Math.abs(firstLum / first.length - lastLum / last.length), firstFrameLuminance: firstLum / first.length, lastFrameLuminance: lastLum / last.length });
}
async function validateLoop({ source, startMs, endMs, width, height }) { if (!(Number(endMs) > Number(startMs))) throw new Error('endMs must be greater than startMs'); const [first, last] = await Promise.all([rawFrame({ source, timeMs: startMs, width, height }), rawFrame({ source, timeMs: Math.max(startMs, endMs - 1), width, height })]); return analyze(first, last, width, height); }

module.exports = { analyze, rawFrame, validateLoop };
