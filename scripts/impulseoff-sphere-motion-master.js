'use strict';

// This command is deliberately plan-first. It never contacts a provider unless --execute is present.
const fs = require('node:fs/promises');
const path = require('node:path');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { createVideoAdapter } = require('../src/v2.8/provider-adapter-factory');
const { SphereMotionMasterService, createGenerationPlan } = require('../src/v2.11/sphere-motion-master');

function options(argv) { const values = {}; for (let i = 0; i < argv.length; i += 1) { const key = argv[i]; if (!key.startsWith('--')) continue; values[key.slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] == null ? true : argv[++i]; } return values; }
async function main() {
  const args = options(process.argv.slice(2));
  if (!args.reference || !args['brand-id']) throw new Error('Usage: --brand-id <id> --reference <approved-artifact-url> [--execute --approvals <file>]');
  const providerSelection = { provider: 'alibaba', model: 'wan3.0-video', profile: 'STANDARD', vendor: 'alibaba', modelFamily: 'WAN_3' };
  const plan = createGenerationPlan({ reference: args.reference, providerSelection, durationSeconds: 5, resolution: '720p', aspectRatio: '9:16', seed: 101,
    motionSpec: { assetId: `impulseoff-sphere-motion-master-${args['brand-id']}-v1`, reference: args.reference, units: [{ id: 'calm_anchor_a', kind: 'calm_loop', startState: 'calm', endState: 'calm', targetDurationRange: [4, 8], loopable: true, intensity: 'minimal', internalMotionIntensity: 'low', shellDeformationAllowance: 'minimal', notes: 'Natural loop seam required.' }] } });
  if (!args.execute) return console.log(JSON.stringify({ mode: 'PLAN_ONLY', plan }, null, 2));
  if (!args.approvals) throw new Error('--approvals <JSON file> is required for execution');
  const approvals = JSON.parse(await fs.readFile(path.resolve(args.approvals), 'utf8'));
  const adapter = createVideoAdapter({ ...providerSelection, adapterFamily: 'dashscope-video' });
  const gateway = { generate: ({ canonicalRequest }) => adapter.generate({ canonicalRequest }) };
  const result = await new SphereMotionMasterService({ providerGateway: gateway }).generate({ plan, approvals });
  const storage = new FilesystemStorageAdapter({ root: process.env.CONTENT_FACTORY_STORAGE_ROOT || path.resolve(process.cwd(), '.artifacts') });
  const artifact = await new ArtifactService({ storage }).createVersion({ artifactId: plan.assetId, type: 'video', content: result.output,
    provider: result.provider, model: result.model, validationStatus: 'pending', idempotencyKey: result.requestId });
  console.log(JSON.stringify({ mode: 'GENERATED_PENDING_HUMAN_REVIEW', artifact, provenance: result.provenance, mediaUrl: result.mediaUrl }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
