'use strict';

// This command is deliberately plan-first. It never contacts a provider unless --execute is present.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { createVideoAdapter } = require('../src/v2.8/provider-adapter-factory');
const { SphereMotionMasterService, createGenerationPlan } = require('../src/v2.11/sphere-motion-master');

function options(argv) { const values = {}; for (let i = 0; i < argv.length; i += 1) { const key = argv[i]; if (!key.startsWith('--')) continue; values[key.slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? true : argv[++i]; } return values; }

async function resolveReference(args) {
  if (args.reference && args['reference-file']) throw new Error('Use either --reference or --reference-file, not both');
  if (args['reference-file']) {
    const absolute = path.resolve(args['reference-file']);
    const content = await fs.readFile(absolute);
    if (content.length > 20 * 1024 * 1024) throw new Error('Reference image exceeds Wan 3.0 20 MB image limit');
    const extension = path.extname(absolute).toLowerCase();
    const mime = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp' })[extension];
    if (!mime) throw new Error('Reference image must be JPEG, PNG, WEBP, or BMP');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return { identity: `sha256:${hash}`, providerReference: `data:${mime};base64,${content.toString('base64')}`, source: absolute, mime, sizeBytes: content.length };
  }
  if (!args.reference) throw new Error('Usage: --brand-id <id> (--reference <approved-url-or-data-url> | --reference-file <approved-image>) [--execute --approvals <file>]');
  return { identity: args.reference, providerReference: args.reference, source: args.reference, mime: null, sizeBytes: null };
}

function printablePlan(plan, referenceInfo) {
  const safe = structuredClone(plan);
  if (String(safe.request.references.firstFrame || '').startsWith('data:')) {
    safe.request.references.firstFrame = `${referenceInfo.mime};base64,[REDACTED ${referenceInfo.sizeBytes} bytes]`;
  }
  return safe;
}

async function main() {
  const args = options(process.argv.slice(2));
  if (!args['brand-id']) throw new Error('Usage: --brand-id <id> (--reference <approved-url-or-data-url> | --reference-file <approved-image>) [--execute --approvals <file>]');
  const referenceInfo = await resolveReference(args);
  if (args.execute && !/^https?:\/\//i.test(referenceInfo.providerReference) && !/^data:image\//i.test(referenceInfo.providerReference)) {
    throw new Error('Execution reference must be an HTTP(S) image URL or --reference-file image');
  }
  const providerSelection = { provider: 'alibaba', model: 'wan3.0-video', profile: 'STANDARD', vendor: 'alibaba', modelFamily: 'WAN_3' };
  const plan = createGenerationPlan({ reference: referenceInfo.identity, providerReference: referenceInfo.providerReference, providerSelection, durationSeconds: 5, resolution: '720p', aspectRatio: '9:16', seed: 101,
    motionSpec: { assetId: `impulseoff-sphere-motion-master-${args['brand-id']}-v1`, reference: referenceInfo.identity, units: [{ id: 'calm_anchor_a', kind: 'calm_loop', startState: 'calm', endState: 'calm', targetDurationRange: [4, 8], loopable: true, intensity: 'minimal', internalMotionIntensity: 'low', shellDeformationAllowance: 'minimal', notes: 'Natural loop seam required.' }] } });
  if (!args.execute) return console.log(JSON.stringify({ mode: 'PLAN_ONLY', reference: { identity: referenceInfo.identity, source: referenceInfo.source, mime: referenceInfo.mime, sizeBytes: referenceInfo.sizeBytes }, plan: printablePlan(plan, referenceInfo) }, null, 2));
  if (!args.approvals) throw new Error('--approvals <JSON file> is required for execution');
  const approvals = JSON.parse(await fs.readFile(path.resolve(args.approvals), 'utf8'));
  const adapter = createVideoAdapter({ ...providerSelection, adapterFamily: 'dashscope-video' });
  const gateway = { generate: ({ canonicalRequest }) => adapter.generate({ canonicalRequest }) };
  const result = await new SphereMotionMasterService({ providerGateway: gateway }).generate({ plan, approvals });
  const storage = new FilesystemStorageAdapter({ root: process.env.CONTENT_FACTORY_STORAGE_ROOT || path.resolve(process.cwd(), '.artifacts') });
  const artifact = await new ArtifactService({ storage }).createVersion({ artifactId: plan.assetId, type: 'video', content: result.output,
    provider: result.provider, model: result.model, validationStatus: 'pending', idempotencyKey: result.requestId });
  console.log(JSON.stringify({ mode: 'GENERATED_PENDING_HUMAN_REVIEW', referenceIdentity: plan.referenceIdentity, artifact, provenance: result.provenance, mediaUrl: result.mediaUrl }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
