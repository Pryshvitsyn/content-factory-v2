'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { IMPULSEOFF_SPHERE_ASSETS } = require('../src/v2.10/impulseoff-sphere-motion-pack');

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
      : reject(Object.assign(new Error(`${command} failed (${code}): ${Buffer.concat(stderr).toString('utf8')}`), { code: 'SPHERE_PREPARE_MEDIA_FAILED' })));
  });
}

async function verifyAsset(root, key) {
  const spec = IMPULSEOFF_SPHERE_ASSETS[key];
  const filePath = path.resolve(root, spec.file);
  let bytes;
  try { bytes = await fs.readFile(filePath); }
  catch (error) {
    const missing = new Error(`Required ImpulseOff sphere asset is missing: ${filePath}`);
    missing.code = 'SPHERE_SOURCE_ASSET_MISSING'; missing.cause = error; throw missing;
  }
  const actual = sha256(bytes);
  if (actual !== spec.sha256) {
    const mismatch = new Error(`Sphere asset hash mismatch for ${spec.file}`);
    mismatch.code = 'SPHERE_SOURCE_HASH_MISMATCH';
    mismatch.details = { filePath, expected: spec.sha256, actual };
    throw mismatch;
  }
  return Object.freeze({ key, file: spec.file, filePath, sha256: actual, bytes: bytes.length, status: 'VERIFIED' });
}

async function preparePilotReference({ assetRoot, outputDir, ffmpegPath = 'ffmpeg', ffprobePath = 'ffprobe' } = {}) {
  if (!assetRoot) throw Object.assign(new Error('assetRoot is required'), { code: 'SPHERE_ASSET_ROOT_REQUIRED' });
  const resolvedOutputDir = path.resolve(outputDir || path.join(process.cwd(), '.content-factory', 'impulseoff-sphere-pilot'));
  await fs.mkdir(resolvedOutputDir, { recursive: true });

  const verified = [];
  for (const key of ['idle', 'idleToTrigger', 'trigger', 'triggerToHold', 'hold']) verified.push(await verifyAsset(assetRoot, key));
  const idle = verified.find((item) => item.key === 'idle');
  const referencePath = path.join(resolvedOutputDir, 'idle-master-reference-9x16.jpg');

  await run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.080', '-i', idle.filePath, '-frames:v', '1',
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1',
    '-q:v', '2', referencePath,
  ]);

  const referenceBytes = await fs.readFile(referencePath);
  const probeResult = await run(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', referencePath]);
  const probe = JSON.parse(probeResult.stdout.toString('utf8'))?.streams?.[0] || {};
  if (Number(probe.width) !== 1080 || Number(probe.height) !== 1920) {
    throw Object.assign(new Error(`Prepared reference has invalid geometry ${probe.width}x${probe.height}`), { code: 'SPHERE_REFERENCE_GEOMETRY_INVALID' });
  }

  const manifest = Object.freeze({
    schemaVersion: 1,
    brand: 'ImpulseOff',
    purpose: 'IDLE_TO_TRIGGER_REAL_QUALITY_PILOT',
    preparedAt: new Date().toISOString(),
    source: Object.freeze({ file: idle.file, sha256: idle.sha256, canonicalRole: 'IDLE_LOOP' }),
    comparisonReferences: Object.freeze(verified.filter((item) => ['idleToTrigger','trigger','triggerToHold','hold'].includes(item.key))
      .map((item) => ({ key: item.key, file: item.file, sha256: item.sha256 }))),
    reference: Object.freeze({
      file: path.basename(referencePath), path: referencePath, contentType: 'image/jpeg', width: 1080, height: 1920,
      aspectRatio: '9:16', sha256: sha256(referenceBytes), sourceTimestampSeconds: 0.080,
      transform: 'PRESERVE_ASPECT_RATIO_AND_PAD_BLACK_TO_9_16',
    }),
    paidGenerationAuthorized: false,
    nextBoundary: 'UPLOAD_REFERENCE_AS_IMMUTABLE_ARTIFACT_AND_BUILD_EXACT_PREFLIGHT',
  });
  const manifestPath = path.join(resolvedOutputDir, 'pilot-reference-manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return Object.freeze({ manifest, manifestPath, referencePath, verified });
}

async function main() {
  const assetRoot = process.argv[2] || process.env.IMPULSEOFF_SPHERE_ASSET_ROOT;
  const outputDir = process.argv[3] || process.env.IMPULSEOFF_SPHERE_PILOT_DIR;
  const result = await preparePilotReference({ assetRoot, outputDir });
  console.log('IMPULSEOFF SPHERE PILOT REFERENCE READY');
  console.log(JSON.stringify({ referencePath: result.referencePath, manifestPath: result.manifestPath,
    referenceSha256: result.manifest.reference.sha256, verifiedAssets: result.verified.map(({ key, file, sha256: hash }) => ({ key, file, sha256: hash })),
    paidGenerationAuthorized: false }, null, 2));
}

if (require.main === module) main().catch((error) => {
  console.error(`[${error.code || 'SPHERE_PREPARE_FAILED'}] ${error.message}`);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
});

module.exports = { preparePilotReference, verifyAsset };
