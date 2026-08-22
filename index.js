'use strict';

const { ArtifactService } = require('./src/artifacts/artifact-service');
const { createDefaultProviderGateway } = require('./src/providers/default-provider-gateway');
const { ReplicateWanVideoAdapter } = require('./src/providers/replicate-wan-video-adapter');
const { ControlReviewService } = require('./src/v2.3/control-review-service');
const { FfmpegMasterRenderer } = require('./src/v2.1/ffmpeg-master-renderer');
const { FilesystemStorageAdapter } = require('./src/storage/storage-adapter');
const { MasterProductionOrchestrator } = require('./worker/v2.1-master-production');
const { ProductionOrchestrator } = require('./worker/v2.1-production-orchestrator');

function createMasterProductionFactory({
  storageRoot,
  providerGateway,
  artifactService,
  renderer,
  providers,
  reviewService,
} = {}) {
  const effectiveArtifactService = artifactService || new ArtifactService({
    storage: new FilesystemStorageAdapter({ root: storageRoot }),
  });
  return new MasterProductionOrchestrator({
    providerGateway: providerGateway || createDefaultProviderGateway(providers),
    artifactService: effectiveArtifactService,
    renderer: renderer || new FfmpegMasterRenderer(),
    reviewService,
  });
}

module.exports = {
  ArtifactService,
  FfmpegMasterRenderer,
  FilesystemStorageAdapter,
  MasterProductionOrchestrator,
  ProductionOrchestrator,
  ReplicateWanVideoAdapter,
  ControlReviewService,
  createDefaultProviderGateway,
  createMasterProductionFactory,
};
