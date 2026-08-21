'use strict';

const assert = require('node:assert/strict');
const { AssetOrchestrator } = require('../worker/v2.1-asset-orchestrator');

async function main() {
  const generated = [];
  const registered = [];
  const repository = {
    async findReusable({ asset }) {
      return asset.asset_id === 'brand-logo'
        ? { storageKey: 'assets/brand-logo/v3', version: 3 }
        : null;
    },
    async registerResolved(args) {
      registered.push(args);
      return { storageKey: args.artifact.storageKey, version: args.artifact.version };
    },
  };
  const gateway = {
    async generate(request) {
      generated.push(request);
      return {
        output: `generated:${request.capability}:${JSON.parse(request.prompt).asset_id}`,
        provenance: { provider: 'test-provider', model: 'test-model' },
      };
    },
  };
  const artifactService = {
    async createVersion(args) {
      assert.ok(args.idempotencyKey);
      return { storageKey: `assets/${args.artifactId}/v1`, version: 1, ...args };
    },
  };

  const orchestrator = new AssetOrchestrator({ assetRepository: repository, providerGateway: gateway, artifactService });
  const result = await orchestrator.resolve({
    client: {}, productionId: 'production-1', workerId: 'worker-1',
    assetPlan: {
      assets: [
        { asset_id: 'brand-logo', kind: 'image', description: 'approved logo', required_for_shots: ['shot-1'] },
        { asset_id: 'hero-product', kind: 'image', description: 'hero product render', required_for_shots: ['shot-1', 'shot-2'] },
        { asset_id: 'narration', kind: 'voice', description: 'Italian voiceover', required_for_shots: ['shot-1'] },
      ],
    },
  });

  assert.equal(result.resolvedAssets.length, 3);
  assert.equal(result.resolvedAssets[0].reused, true);
  assert.equal(result.resolvedAssets[1].reused, false);
  assert.equal(result.resolvedAssets[2].reused, false);
  assert.deepEqual(generated.map((x) => x.capability), ['image-generation', 'speech-generation']);
  assert.equal(registered.length, 2);
  assert.ok(generated.every((x) => x.idempotencyKey.includes('production-1:asset:')));
  console.log('v2.1 asset orchestrator certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
