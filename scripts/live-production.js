'use strict';

require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { ProviderGateway } = require('../src/providers/provider-gateway');
const { ReplicateWanVideoAdapter } = require('../src/providers/replicate-wan-video-adapter');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');
const { ControlReviewService } = require('../src/v2.3/control-review-service');
const { FfmpegMasterRenderer } = require('../src/v2.1/ffmpeg-master-renderer');
const { LiveProductionService, buildStructuredLiveInput, resolveLiveConfiguration } = require('../src/v2.4/live-production-service');
const { MasterProductionOrchestrator } = require('../worker/v2.1-master-production');

function numberOverride(name, value) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

async function main() {
  const config = resolveLiveConfiguration(process.env);
  const raw = JSON.parse(await fs.readFile(path.resolve(config.inputFile), 'utf8'));
  const input = buildStructuredLiveInput(raw, {
    resolution: process.env.LIVE_VIDEO_RESOLUTION,
    aspectRatio: process.env.LIVE_VIDEO_ASPECT_RATIO,
    numFrames: numberOverride('LIVE_VIDEO_NUM_FRAMES', process.env.LIVE_VIDEO_NUM_FRAMES),
    framesPerSecond: numberOverride('LIVE_VIDEO_FPS', process.env.LIVE_VIDEO_FPS),
  });
  const db = new Pool({ connectionString: config.databaseUrl, max: 4 });
  try {
    const storage = new FilesystemStorageAdapter({ root: config.storageRoot });
    const artifactService = new ArtifactService({ storage });
    const replicate = new ReplicateWanVideoAdapter({ apiToken: process.env.REPLICATE_API_TOKEN, model: config.model });
    const providerGateway = new ProviderGateway({
      providers: { replicate },
      priorities: { replicate: 1, 'video-generation': ['replicate'], 'media:video': ['replicate'] },
      routing: { strategy: 'priority', fallbackOnError: false },
    });
    const reviewService = new ControlReviewService({ db });
    const masterOrchestrator = new MasterProductionOrchestrator({
      providerGateway, artifactService, renderer: new FfmpegMasterRenderer(), reviewService,
    });
    const service = new LiveProductionService({ db, masterOrchestrator, artifactService, storageRoot: config.storageRoot });
    const result = await service.run({ input, config });
    if (result.dryRun) {
      console.log('DRY RUN PASSED — no provider call was made.');
      console.log(JSON.stringify(result.plan, null, 2));
      return;
    }
    console.log('CONTROLLED LIVE PRODUCTION COMPLETED');
    console.log(JSON.stringify(result, null, 2));
    console.log('Open Dashboard: http://localhost:3000');
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`[${error.code || 'LIVE_PRODUCTION_ERROR'}] ${error.message}`);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
});
