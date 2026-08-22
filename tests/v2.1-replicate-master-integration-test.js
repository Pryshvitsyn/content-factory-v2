'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { createDefaultProviderGateway } = require('../src/providers/default-provider-gateway');
const { ProviderGateway } = require('../src/providers/provider-gateway');
const { ReplicateWanVideoAdapter } = require('../src/providers/replicate-wan-video-adapter');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { MasterProductionOrchestrator } = require('../worker/v2.1-master-production');

function json(payload) {
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-replicate-master-'));
  try {
    let predictionCreates = 0;
    const replicate = new ReplicateWanVideoAdapter({
      apiToken: 'test-token', maxHttpRetries: 0,
      fetchImpl: async (_url, options) => {
        if (options.method === 'POST') {
          predictionCreates += 1;
          return json({ id: 'master-prediction-1', status: 'succeeded', output: 'https://files.replicate.test/master.mp4', metrics: { predict_time: 3 } });
        }
        return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(Buffer.from('replicate-video-bytes')).buffer };
      },
    });
    const gateway = new ProviderGateway({ providers: { replicate }, priorities: { replicate: 1 } });
    const storage = new FilesystemStorageAdapter({ root });
    const artifactService = new ArtifactService({ storage });
    const renderer = {
      async render() {
        return {
          output: Buffer.from('stable-master-mp4'), contentType: 'video/mp4',
          probe: { width: 1080, height: 1920, fps: 30, durationMs: 5000, videoCodec: 'h264', hasAudio: true },
          provenance: { renderer: 'ffmpeg', profile: { width: 1080, height: 1920, fps: 30 } },
        };
      },
    };
    const orchestrator = new MasterProductionOrchestrator({ providerGateway: gateway, artifactService, renderer });
    const script = {
      brand_id: 'brand-a', title: 'Replicate master', hook: 'Hook', cta: 'CTA',
      scenes: [{ scene_number: 1, visual: 'Vertical product reveal', duration_seconds: 5, dialogue_or_voiceover: 'Hook CTA' }],
    };
    const shotPlan = {
      brand_id: 'brand-a',
      shots: [{ shot_id: 'shot-1', scene_id: '1', duration_seconds: 5, framing: 'vertical', camera: 'push-in', subject: 'product', action: 'reveal', required_assets: ['wan-video-1'] }],
      continuity: { characters: [], locations: ['studio'], products: ['product'], wardrobe: [], props: [], visual_style: 'premium vertical commercial' },
    };
    const assetPlan = {
      brand_id: 'brand-a',
      assets: [{
        asset_id: 'wan-video-1', kind: 'video', description: 'Cinematic vertical product reveal', source_preference: 'generate',
        generation_requirements: {
          prompt: 'Cinematic vertical product reveal', resolution: '720p', aspect_ratio: '9:16',
          num_frames: 81, frames_per_second: 16, go_fast: true,
          temporal: { startMs: 0, endMs: 5000, durationMs: 5000 },
        },
        required_for_shots: ['shot-1'],
      }],
    };
    const input = {
      productionId: 'production-1', brandId: 'brand-a', workerId: 'worker-1',
      script, shotPlan, assetPlan, qualityPolicy: { requireVoiceForSpokenCopy: false },
    };

    const first = await orchestrator.build(input);
    const second = await orchestrator.build(input);
    assert.equal(predictionCreates, 1, 'completed immutable media must prevent a second paid prediction');
    assert.equal(first.assembly.clips[0].media.provider, 'replicate');
    assert.equal(first.assembly.clips[0].media.provenance.predictionId, 'master-prediction-1');
    assert.equal(first.quality.status, 'PASS');
    assert.equal(first.quality.publicationAllowed, false);
    assert.equal(first.quality.approvalStatus, 'AWAITING_HUMAN_APPROVAL');
    assert.equal(second.assembly.clips[0].media.provider, 'replicate');
    assert.equal(second.assembly.clips[0].media.provenance.predictionId, 'master-prediction-1');
    assert.equal(second.assembly.clips[0].media.provenance.source, 'immutable-artifact-cache');
    assert.equal(second.master.artifact.idempotent, true);
    assert.equal(await storage.exists({ key: first.assembly.clips[0].media.artifact.storageKey }), true);

    await assert.rejects(
      () => orchestrator.build({ ...input, brandId: 'brand-b' }),
      (error) => error.code === 'BRAND_SCOPE_MISMATCH',
    );
    assert.equal(predictionCreates, 1);

    const fakeText = { model: 'text-test', async generate() { return { provider: 'nvidia', model: 'text-test', output: 'text' }; } };
    const fakeCosmos = {
      model: 'cosmos-test', supports: ({ capability }) => capability === 'video-generation',
      modelFor: () => 'cosmos-test', async generate() { return { provider: 'nvidia', model: 'cosmos-test', output: Buffer.from('video'), contentType: 'video/mp4', capability: 'video-generation' }; },
    };
    const configured = createDefaultProviderGateway({
      nvidia: { textAdapter: fakeText, videoAdapter: fakeCosmos },
      replicate: { apiToken: 'test-token', fetchImpl: async () => { throw new Error('must not call'); } },
      openai: { enabled: false }, videoProvider: 'replicate',
    });
    assert.ok(configured.get('nvidia'));
    assert.ok(configured.get('replicate'));
    assert.equal(configured.select({ capability: 'video-generation', routeKey: 'media:video' }).provider, 'replicate');
    assert.equal(configured.select({ capability: 'video-generation', routeKey: 'media:video' }).provider, 'replicate');
    console.log('v2.1 Replicate immutable master integration certification passed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
