'use strict';

const assert = require('node:assert/strict');
const { MasterProductionOrchestrator, buildMasterTimeline, validateMasterQuality } = require('../worker/v2.1-master-production');

const script = {
  brand_id: 'brand-1',
  title: 'Launch',
  hook: 'Still wasting time every morning?',
  cta: 'Start today.',
  scenes: [
    { scene_number: 1, visual: 'Problem and reveal', duration_seconds: 3, dialogue_or_voiceover: 'Still wasting time every morning?' },
    { scene_number: 2, visual: 'Product result', duration_seconds: 2, dialogue_or_voiceover: 'Start today.' },
  ],
};
const shotPlan = {
  brand_id: 'brand-1',
  shots: [
    { shot_id: 'shot-1', scene_id: '1', duration_seconds: 3, framing: 'close', camera: 'push-in', subject: 'problem', action: 'reveal', required_assets: ['visual-1', 'voice-1'] },
    { shot_id: 'shot-2', scene_id: '2', duration_seconds: 2, framing: 'medium', camera: 'locked', subject: 'product', action: 'result', required_assets: ['visual-2', 'voice-1'] },
  ],
  continuity: { characters: [], locations: ['studio'], products: ['product'], wardrobe: [], props: [], visual_style: 'premium vertical commercial' },
};
const assetPlan = {
  brand_id: 'brand-1',
  assets: [
    { asset_id: 'visual-1', kind: 'video', description: 'problem reveal', source_preference: 'generate', generation_requirements: {}, required_for_shots: ['shot-1'] },
    { asset_id: 'visual-2', kind: 'image', description: 'product result', source_preference: 'generate', generation_requirements: {}, required_for_shots: ['shot-2'] },
    { asset_id: 'voice-1', kind: 'voice', description: 'narration', source_preference: 'generate', generation_requirements: { text: 'Still wasting time every morning? Start today.' }, required_for_shots: ['shot-1', 'shot-2'] },
  ],
};

async function main() {
  const timeline = buildMasterTimeline({ productionId: 'production-1', script, shotPlan, assetPlan, fps: 30 });
  assert.equal(timeline.durationMs, 5000);
  assert.deepEqual(timeline.clips.filter((clip) => clip.track === 'video-main').map((clip) => clip.startMs), [0, 3000]);
  assert.equal(timeline.clips.find((clip) => clip.kind === 'voice').durationMs, 5000);

  const generated = [];
  const artifactCalls = [];
  const orchestrator = new MasterProductionOrchestrator({
    providerGateway: {
      async generate(request) {
        generated.push(request);
        const payload = JSON.parse(request.prompt);
        const kind = payload.kind;
        return {
          output: Buffer.from(payload.asset_id),
          contentType: kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/mpeg',
          temporal: kind === 'voice' ? { startMs: 0, endMs: 5000, durationMs: 5000 } : kind === 'video' ? { startMs: 0, endMs: 3000, durationMs: 3000 } : null,
          provenance: { provider: 'certification-provider', model: 'quality-model' },
        };
      },
    },
    renderer: {
      async render({ assembly, profile }) {
        assert.equal(assembly.durationMs, 5000);
        assert.deepEqual(profile, { width: 1080, height: 1920, fps: 30 });
        return {
          output: Buffer.from('master-mp4'),
          contentType: 'video/mp4',
          probe: { width: 1080, height: 1920, fps: 30, durationMs: 5000, videoCodec: 'h264', hasAudio: true },
          provenance: { renderer: 'ffmpeg', profile },
        };
      },
    },
    artifactService: {
      async createVersion(args) {
        artifactCalls.push(args);
        return { artifactId: args.artifactId, version: 1, storageKey: 'masters/production-1/v1.bin' };
      },
    },
  });

  const result = await orchestrator.build({
    productionId: 'production-1', brandId: 'brand-1', workerId: 'worker-1', script, shotPlan, assetPlan,
  });
  assert.equal(result.quality.status, 'PASS');
  assert.equal(result.quality.readyForHumanReview, true);
  assert.equal(result.quality.publicationAllowed, false);
  assert.equal(result.quality.approvalStatus, 'AWAITING_HUMAN_APPROVAL');
  assert.equal(result.nextAction, 'HUMAN_REVIEW');
  assert.equal(generated.length, 3);
  assert.ok(generated.every((request) => request.metadata.brandId === 'brand-1'));
  assert.equal(artifactCalls.filter((call) => call.validationStatus === 'pending_master_validation').length, 3);
  assert.equal(artifactCalls.filter((call) => call.validationStatus === 'recorded').length, 3);
  assert.equal(artifactCalls.filter((call) => call.artifactId.startsWith('brand:brand-1:asset:')).length, 6);
  const masterArtifact = artifactCalls.find((call) => call.artifactId === 'production:production-1:master');
  assert.equal(masterArtifact.validationStatus, 'awaiting_human_approval');
  assert.match(masterArtifact.idempotencyKey, /^brand-1:production-1:master:/);

  await assert.rejects(
    () => orchestrator.build({ productionId: 'production-1', brandId: 'brand-2', workerId: 'worker-1', script, shotPlan, assetPlan }),
    (error) => error.code === 'BRAND_SCOPE_MISMATCH',
  );

  const failed = validateMasterQuality({
    script: { ...script, hook: '', cta: '' }, shotPlan, assetPlan, timeline,
    probe: { width: 720, height: 1280, fps: 25, durationMs: 3000, videoCodec: 'h264', hasAudio: false },
  });
  assert.equal(failed.status, 'FAIL');
  assert.equal(failed.publicationAllowed, false);
  console.log('v2.1 master production vertical slice certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
