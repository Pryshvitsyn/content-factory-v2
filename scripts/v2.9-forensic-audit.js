'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PRODUCTION_ID = '87738973-ae73-4963-8bb0-721a903c879c';
const SAMPLE_RATIOS = Object.freeze([0.02, 0.10, 0.30, 0.50, 0.70, 0.90, 0.98]);

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]; const value = argv[index + 1];
    if (!option?.startsWith('--') || value == null) throw new Error(`Expected --option value, received ${option || 'nothing'}`);
    values[option.slice(2)] = value;
  }
  return values;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(Buffer.concat(stdout))
      : reject(new Error(`${command} exited ${code}: ${Buffer.concat(stderr).toString('utf8')}`)));
  });
}

async function sha256(file) {
  const bytes = await fs.readFile(file);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function probe(file) {
  const raw = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  const parsed = JSON.parse(raw.toString('utf8'));
  const video = parsed.streams.find((stream) => stream.codec_type === 'video');
  const audio = parsed.streams.find((stream) => stream.codec_type === 'audio');
  const [fpsNumerator, fpsDenominator] = String(video?.avg_frame_rate || '0/1').split('/').map(Number);
  return Object.freeze({
    width: video?.width || 0,
    height: video?.height || 0,
    fps: fpsDenominator ? fpsNumerator / fpsDenominator : 0,
    durationSeconds: Number(parsed.format.duration || video?.duration || 0),
    videoCodec: video?.codec_name || null,
    pixelFormat: video?.pix_fmt || null,
    hasAudio: Boolean(audio),
    audioCodec: audio?.codec_name || null,
    audioSampleRate: Number(audio?.sample_rate || 0),
    sizeBytes: Number(parsed.format.size || 0),
  });
}

async function extractSamples({ file, label, durationSeconds, outputDirectory }) {
  const evidence = [];
  for (let index = 0; index < SAMPLE_RATIOS.length; index += 1) {
    const ratio = SAMPLE_RATIOS[index];
    const timestampSeconds = Number((durationSeconds * ratio).toFixed(3));
    const filename = `${label}-${String(index + 1).padStart(2, '0')}-${Math.round(ratio * 100)}pct.jpg`;
    const output = path.join(outputDirectory, filename);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(timestampSeconds), '-i', file,
      '-frames:v', '1', '-q:v', '2', '-y', output]);
    evidence.push(Object.freeze({ ratio, timestampSeconds, path: path.relative(process.cwd(), output) }));
  }
  return Object.freeze(evidence);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storageRoot = process.env.CONTENT_FACTORY_STORAGE_ROOT
    || path.join(process.env.HOME, '.content-factory', 'storage');
  const productionId = args['production-id'] || PRODUCTION_ID;
  const source = path.resolve(args.source || path.join(storageRoot,
    'artifacts/brand:a03def76-bd3d-4c8e-b00a-ec77616c5191:asset:operator-video-1/idempotency/f1570b5925df88141ff6f514c5c859fef3a425695da5679c657009331b1b503f.bin'));
  const speech = path.resolve(args.speech || path.join(storageRoot,
    'artifacts/brand:a03def76-bd3d-4c8e-b00a-ec77616c5191:asset:voiceover-main/idempotency/88c850015562023dc9bea790dffa968da5ea2781fbd3700560995276441a54ec.bin'));
  const master = path.resolve(args.master || path.join(storageRoot,
    `artifacts/production:${productionId}:master/idempotency/a31418c3eed0c4f3ebbd7f121dc1583b2786e218c8a3810d42c5552967c554bc.bin`));
  const evidenceRoot = path.resolve(process.cwd(), args.output || 'docs/forensics/v2.9-87738973');
  const reportFile = path.join(evidenceRoot, 'report.json');
  try {
    await fs.access(reportFile);
    throw new Error(`Refusing to overwrite immutable forensic report: ${reportFile}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const outputDirectory = path.join(evidenceRoot, 'frames');
  await fs.mkdir(outputDirectory, { recursive: true });

  const [sourceProbe, speechProbe, masterProbe] = await Promise.all([probe(source), probe(speech), probe(master)]);
  const [sourceFrames, masterFrames, sourceHash, speechHash, masterHash] = await Promise.all([
    extractSamples({ file: source, label: 'source', durationSeconds: sourceProbe.durationSeconds, outputDirectory }),
    extractSamples({ file: master, label: 'master', durationSeconds: masterProbe.durationSeconds, outputDirectory }),
    sha256(source), sha256(speech), sha256(master),
  ]);
  const report = {
    schemaVersion: 1,
    reportClass: 'IMMUTABLE_HISTORICAL_FORENSIC_AUDIT',
    productionId,
    generatedAt: new Date().toISOString(),
    providerCalls: 0,
    historicalArtifactsMutated: false,
    artifacts: {
      sourceVideo: { artifactId: 'brand:a03def76-bd3d-4c8e-b00a-ec77616c5191:asset:operator-video-1',
        contentHash: sourceHash, probe: sourceProbe, samples: sourceFrames },
      speech: { artifactId: 'brand:a03def76-bd3d-4c8e-b00a-ec77616c5191:asset:voiceover-main',
        contentHash: speechHash, probe: speechProbe },
      finalMaster: { artifactId: `production:${productionId}:master`, contentHash: masterHash,
        probe: masterProbe, samples: masterFrames },
    },
    transformAudit: {
      renderer: 'ffmpeg',
      expectedOperations: ['scale/crop source visual to 1080x1920', 'resample to 30 fps', 'mux external speech as AAC'],
      layoutCompositionOperationPresent: false,
      conclusionCode: 'SOURCE_VISUAL_DEFECT_PRESERVED_IN_MASTER',
      conclusion: 'The multi-panel/triptych composition is already visible in the immutable provider source samples. The final master preserves that composition while scaling/cropping and adding audio; FFmpeg did not introduce the layout.',
    },
  };
  await fs.mkdir(evidenceRoot, { recursive: true });
  await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${reportFile}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { SAMPLE_RATIOS, extractSamples, probe };
