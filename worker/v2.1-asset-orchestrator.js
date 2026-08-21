'use strict';

function requireValue(name, value) {
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
}

function stableAssetKey(asset) {
  return `${asset.asset_id}:${asset.kind}:${asset.description || ''}`;
}

class AssetOrchestrator {
  constructor({ assetRepository, providerGateway, artifactService } = {}) {
    requireValue('assetRepository', assetRepository);
    requireValue('providerGateway', providerGateway);
    requireValue('artifactService', artifactService);
    this.assetRepository = assetRepository;
    this.providerGateway = providerGateway;
    this.artifactService = artifactService;
  }

  async resolve({ client, productionId, assetPlan, workerId } = {}) {
    requireValue('client', client);
    requireValue('productionId', productionId);
    requireValue('assetPlan', assetPlan);
    requireValue('workerId', workerId);
    if (!Array.isArray(assetPlan.assets) || assetPlan.assets.length === 0) {
      throw new Error('ASSET_PLAN.assets must be a non-empty array');
    }

    const resolved = [];
    for (const asset of assetPlan.assets) {
      const key = stableAssetKey(asset);
      const reusable = await this.assetRepository.findReusable({ client, productionId, asset, key });
      if (reusable) {
        resolved.push({ ...reusable, assetId: asset.asset_id, reused: true, source: 'registry' });
        continue;
      }

      const capability = asset.kind === 'image' ? 'image-generation'
        : asset.kind === 'video' ? 'video-generation'
          : asset.kind === 'voice' ? 'speech-generation'
            : asset.kind === 'audio' || asset.kind === 'music' ? 'audio-generation'
              : 'text-generation';

      const response = await this.providerGateway.generate({
        capability,
        routeKey: `asset:${asset.kind}`,
        idempotencyKey: `${productionId}:asset:${asset.asset_id}:${workerId}`,
        prompt: JSON.stringify({
          asset_id: asset.asset_id,
          kind: asset.kind,
          description: asset.description,
          source_preference: asset.source_preference,
          generation_requirements: asset.generation_requirements,
          required_for_shots: asset.required_for_shots,
        }),
      });

      const content = response.output;
      if (content === undefined || content === null || content === '') {
        throw new Error(`Provider returned empty output for asset ${asset.asset_id}`);
      }

      const artifact = await this.artifactService.createVersion({
        artifactId: `asset:${asset.asset_id}`,
        type: asset.kind === 'text' ? 'text' : 'binary',
        content,
        idempotencyKey: `${productionId}:asset:${asset.asset_id}`,
        provider: response.provenance?.provider || response.provider,
        model: response.provenance?.model || response.model,
      });

      const record = await this.assetRepository.registerResolved({
        client,
        productionId,
        asset,
        artifact,
        workerId,
        key,
      });
      resolved.push({ ...record, artifact, assetId: asset.asset_id, reused: false, source: 'provider' });
    }

    return { productionId, resolvedAssets: resolved };
  }
}

module.exports = { AssetOrchestrator, stableAssetKey };
