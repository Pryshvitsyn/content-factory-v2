'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const WIDTH = 720;
const HEIGHT = 1280;
const SPHERE_SIZE = 720;
const SPHERE_TOP = 280;
const SOURCE_CROP_TOP = 280;

const FAR_STARS = [
  [0.06,0.09,1.0,0.18],[0.15,0.23,0.8,0.16],[0.26,0.13,1.1,0.12],[0.38,0.31,0.7,0.15],
  [0.48,0.07,0.9,0.12],[0.57,0.19,0.8,0.14],[0.69,0.11,1.0,0.16],[0.82,0.28,0.7,0.13],
  [0.93,0.15,1.0,0.17],[0.08,0.47,0.8,0.12],[0.22,0.58,0.7,0.14],[0.35,0.72,0.9,0.12],
  [0.51,0.51,0.7,0.14],[0.64,0.66,1.0,0.11],[0.78,0.53,0.8,0.13],[0.91,0.74,0.9,0.14],
  [0.12,0.88,0.8,0.12],[0.29,0.94,1.0,0.11],[0.47,0.83,0.7,0.13],[0.61,0.92,0.8,0.11],
  [0.74,0.86,0.9,0.14],[0.88,0.95,0.7,0.12],
];
const NEAR_STARS = [
  [0.10,0.16,1.6,0.28],[0.31,0.21,1.4,0.22],[0.52,0.14,1.8,0.24],[0.73,0.24,1.5,0.20],
  [0.89,0.10,1.4,0.24],[0.18,0.41,1.5,0.20],[0.79,0.45,1.7,0.18],[0.07,0.70,1.6,0.18],
  [0.27,0.82,1.4,0.20],[0.58,0.76,1.7,0.18],[0.84,0.88,1.5,0.20],[0.68,0.60,1.4,0.18],
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    out[key.slice(2)] = next && !next.startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function hex(hexValue) {
  const clean = hexValue.replace('#', '');
  return [parseInt(clean.slice(0,2),16), parseInt(clean.slice(2,4),16), parseInt(clean.slice(4,6),16)];
}
function blendPixel(buf, width, x, y, rgb, alpha) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= width || y >= HEIGHT || alpha <= 0) return;
  const idx = (y * width + x) * 3;
  const a = clamp01(alpha);
  buf[idx] = Math.round(buf[idx] * (1-a) + rgb[0] * a);
  buf[idx+1] = Math.round(buf[idx+1] * (1-a) + rgb[1] * a);
  buf[idx+2] = Math.round(buf[idx+2] * (1-a) + rgb[2] * a);
}
function fillRect(buf, x0, y0, x1, y1, rgb, alpha=1) {
  const sx = Math.max(0, Math.floor(x0)); const ex = Math.min(WIDTH, Math.ceil(x1));
  const sy = Math.max(0, Math.floor(y0)); const ey = Math.min(HEIGHT, Math.ceil(y1));
  for (let y = sy; y < ey; y += 1) for (let x = sx; x < ex; x += 1) blendPixel(buf, WIDTH, x, y, rgb, alpha);
}
function drawEllipse(buf, cx, cy, rx, ry, rotationDeg, rgb, alpha) {
  const rad = rotationDeg * Math.PI / 180;
  const cos = Math.cos(rad); const sin = Math.sin(rad);
  const reach = Math.hypot(rx, ry);
  const x0 = Math.max(0, Math.floor(cx-reach-2)); const x1 = Math.min(WIDTH-1, Math.ceil(cx+reach+2));
  const y0 = Math.max(0, Math.floor(cy-reach-2)); const y1 = Math.min(HEIGHT-1, Math.ceil(cy+reach+2));
  const aa = 1.4 / Math.max(1, Math.min(rx, ry));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx; const dy = y + 0.5 - cy;
      const ux = cos*dx + sin*dy; const uy = -sin*dx + cos*dy;
      const q = Math.sqrt((ux*ux)/(rx*rx) + (uy*uy)/(ry*ry));
      if (q > 1 + aa) continue;
      const coverage = clamp01((1 + aa - q) / (2 * aa));
      blendPixel(buf, WIDTH, x, y, rgb, alpha * coverage);
    }
  }
}
function drawStar(buf, cx, cy, size, rgb, alpha, glow=false) {
  if (glow) {
    const radius = 5.5;
    const x0 = Math.floor(cx-radius); const x1 = Math.ceil(cx+radius);
    const y0 = Math.floor(cy-radius); const y1 = Math.ceil(cy+radius);
    for (let y=y0; y<=y1; y+=1) for (let x=x0; x<=x1; x+=1) {
      const d = Math.hypot(x+0.5-cx, y+0.5-cy);
      if (d > radius) continue;
      const g = Math.exp(-(d*d)/(2*2.2*2.2));
      blendPixel(buf, WIDTH, x, y, [182,224,236], alpha*0.42*g);
    }
  }
  const half = Math.max(0.5, size/2);
  fillRect(buf, cx-half, cy-half, cx+half, cy+half, rgb, alpha);
}
function drawRoundedCapsule(buf, x, y, w, h, rgb, alpha) {
  const r = Math.min(w,h)/2;
  const cx0 = x+r; const cx1 = x+w-r; const cy = y+h/2;
  fillRect(buf, cx0, y, cx1, y+h, rgb, alpha);
  drawEllipse(buf, cx0, cy, r, r, 0, rgb, alpha);
  drawEllipse(buf, cx1, cy, r, r, 0, rgb, alpha);
}

function renderCosmosPpm() {
  const buf = Buffer.alloc(WIDTH*HEIGHT*3);
  const base = hex('#010409');
  for (let i=0; i<buf.length; i+=3) { buf[i]=base[0]; buf[i+1]=base[1]; buf[i+2]=base[2]; }
  fillRect(buf,0,0,WIDTH,HEIGHT*0.42,hex('#06101B'),1);
  fillRect(buf,0,HEIGHT*0.27,WIDTH,HEIGHT*0.75,hex('#02070E'),0.95);
  fillRect(buf,0,HEIGHT*0.69,WIDTH,HEIGHT,hex('#070611'),0.9);

  // Mirrors the stable palette and phase-zero visual structure of ImpulseOff CosmosLayer.
  // Product parallax runs over tens of seconds; provider conditioning intentionally freezes it.
  drawEllipse(buf, 90, 165, 720, 360, -18.7, [27,74,108], 0.28);
  drawEllipse(buf, 620, 1080, 560, 255, 13.3, [15,42,71], 0.24);
  for (const [x,y,size,opacity] of FAR_STARS) drawStar(buf, x*WIDTH-27, y*HEIGHT-22, size, [147,169,183], opacity, false);
  drawEllipse(buf, 150, 760, 490, 205, -8, [24,53,78], 0.18);
  for (const [x,y,size,opacity] of NEAR_STARS) drawStar(buf, x*WIDTH-10, y*HEIGHT-35, size, [215,230,235], opacity, true);
  drawRoundedCapsule(buf, WIDTH*0.09, HEIGHT*0.25, WIDTH*0.82, HEIGHT*0.52, [0,3,8], 0.12);
  fillRect(buf,0,0,WIDTH,18,[0,1,4],0.14);
  fillRect(buf,0,HEIGHT-18,WIDTH,HEIGHT,[0,1,4],0.14);
  fillRect(buf,0,0,18,HEIGHT,[0,1,4],0.14);
  fillRect(buf,WIDTH-18,0,WIDTH,HEIGHT,[0,1,4],0.14);
  return Buffer.concat([Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`), buf]);
}

function renderRecordedMaskPgm() {
  const pixels = Buffer.alloc(SPHERE_SIZE*SPHERE_SIZE);
  const cx = (SPHERE_SIZE-1)/2; const cy = (SPHERE_SIZE-1)/2;
  for (let y=0; y<SPHERE_SIZE; y+=1) {
    for (let x=0; x<SPHERE_SIZE; x+=1) {
      const r = Math.hypot(x-cx,y-cy);
      let a = 0;
      for (let i=0; i<33; i+=1) {
        const radius = (SPHERE_SIZE * (1 - i*0.12/32))/2;
        const coverage = clamp01(radius + 0.5 - r);
        if (coverage <= 0) continue;
        const layerA = (1/(33-i))*coverage;
        a = layerA + a*(1-layerA);
      }
      pixels[y*SPHERE_SIZE+x] = Math.round(clamp01(a)*255);
    }
  }
  return Buffer.concat([Buffer.from(`P5\n${SPHERE_SIZE} ${SPHERE_SIZE}\n255\n`), pixels]);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore','pipe','pipe'] });
    const out=[]; const err=[];
    child.stdout.on('data', d=>out.push(d)); child.stderr.on('data', d=>err.push(d));
    child.on('error', reject);
    child.on('close', code => {
      if (code===0) return resolve(Buffer.concat(out).toString('utf8'));
      reject(new Error(`${command} exited ${code}: ${Buffer.concat(err).toString('utf8')}`));
    });
  });
}

async function probeImage(file) {
  const raw = await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',file]);
  const stream = JSON.parse(raw).streams?.[0] || {};
  return { width:Number(stream.width||0), height:Number(stream.height||0) };
}
async function probeVideo(file) {
  const raw = await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate','-of','json',file]);
  const stream = JSON.parse(raw).streams?.[0] || {};
  return { width:Number(stream.width||0), height:Number(stream.height||0), fps:stream.r_frame_rate||null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['source-video'] || !args.output) {
    throw new Error('Usage: node scripts/impulseoff-build-canonical-reference.js --source-video <IMPULSEOFF_LIVING_SPHERE_SEQUENCE_V1.mp4> --output <reference.png> [--time 1.0]');
  }
  const sourceVideo = path.resolve(args['source-video']);
  const output = path.resolve(args.output);
  const time = Number(args.time ?? 1.0);
  if (!Number.isFinite(time) || time < 0) throw new Error('--time must be a non-negative number');

  const video = await probeVideo(sourceVideo);
  if (video.width !== 720 || video.height !== 1280) {
    throw new Error(`Canonical Sequence V1 must be 720x1280; got ${video.width}x${video.height}`);
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(),'impulseoff-canonical-reference-'));
  try {
    const cosmos = path.join(tmp,'cosmos.ppm');
    const mask = path.join(tmp,'recorded-mask.pgm');
    await fs.writeFile(cosmos,renderCosmosPpm());
    await fs.writeFile(mask,renderRecordedMaskPgm());
    await fs.mkdir(path.dirname(output),{recursive:true});

    const filter = [
      `[0:v]crop=${SPHERE_SIZE}:${SPHERE_SIZE}:0:${SOURCE_CROP_TOP},format=rgba[sphere]`,
      `[2:v]format=gray[mask]`,
      `[sphere][mask]alphamerge[spherea]`,
      `[1:v]format=rgba[bg]`,
      `[bg][spherea]overlay=0:${SPHERE_TOP}:format=auto,format=rgb24[out]`,
    ].join(';');

    await run('ffmpeg',[
      '-hide_banner','-loglevel','error','-y',
      '-ss',String(time),'-i',sourceVideo,
      '-i',cosmos,'-i',mask,
      '-filter_complex',filter,'-map','[out]','-frames:v','1','-update','1',output,
    ]);

    const image = await probeImage(output);
    if (image.width !== WIDTH || image.height !== HEIGHT) throw new Error(`Output must be 720x1280; got ${image.width}x${image.height}`);
    const bytes = await fs.readFile(output);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    console.log(JSON.stringify({
      mode:'LOCAL_CANONICAL_REFERENCE', providerCalls:0, sourceVideo, sourceGeometry:video,
      frameTimeSeconds:time, composition:'ExactSequence02Scene: CosmosLayer phase-zero + LivingSphereSequence 720-square center crop + 33-layer soft mask',
      output, outputGeometry:image, sha256:hash,
    },null,2));
  } finally {
    await fs.rm(tmp,{recursive:true,force:true});
  }
}

if (require.main === module) main().catch(error=>{ console.error(error); process.exitCode=1; });

module.exports = { HEIGHT, SPHERE_SIZE, SPHERE_TOP, WIDTH, renderCosmosPpm, renderRecordedMaskPgm };
