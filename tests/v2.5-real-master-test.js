'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FfmpegMasterRenderer, runProcess } = require('../src/v2.1/ffmpeg-master-renderer');
const { FfprobeMediaInspector, validateMasterProbe } = require('../src/v2.5/media-validator');
const { buildProductionInput } = require('../src/v2.5/production-input');
const { MasterProductionOrchestrator } = require('../worker/v2.1-master-production');

async function main() {
  const input = buildProductionInput(JSON.parse(await fs.readFile(path.resolve('config/productions/attune-dont-guess-tune-in.json'), 'utf8')));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-v25-master-'));
  try {
    const durations = [3, 4, 3];
    const colors = ['#493c53', '#6e5144', '#805f4a'];
    const videoBytes = [];
    for (let index = 0; index < durations.length; index += 1) {
      const target = path.join(directory, `shot-${index}.mp4`);
      await runProcess('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',
        `color=c=${colors[index]}:s=320x568:d=${durations[index]}`,'-r','24','-pix_fmt','yuv420p','-c:v','libx264',target]);
      videoBytes.push(await fs.readFile(target));
    }
    const voicePath = path.join(directory, 'voice.wav');
    await runProcess('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=330:duration=10','-c:a','pcm_s16le',voicePath]);
    const voiceBytes = await fs.readFile(voicePath);

    const inspector = new FfprobeMediaInspector();
    const resolvedMedia = [];
    const videoAssets = input.assetPlan.assets.filter((asset) => asset.kind === 'video');
    for (let index = 0; index < videoAssets.length; index += 1) {
      const asset = videoAssets[index];
      const probe = await inspector.inspect({ bytes: videoBytes[index], contentType: 'video/mp4', kind: 'video', expectedDurationMs: durations[index] * 1000 });
      assert.equal(probe.status, 'PASS');
      resolvedMedia.push({ assetId: asset.asset_id, kind: 'video', contentType: 'video/mp4', bytes: videoBytes[index],
        temporal: { startMs: 0, endMs: durations[index] * 1000, durationMs: durations[index] * 1000 },
        provider: 'local-fixture', model: 'ffmpeg-color', brandId: input.brandId,
        provenance: { source: 'local-certification-fixture' },
        artifact: { artifactId: `fixture:${asset.asset_id}`, version: 1, storageKey: `fixtures/${asset.asset_id}.mp4`, contentHash: `video-${index}` } });
    }
    const voiceAsset = input.assetPlan.assets.find((asset) => asset.kind === 'voice');
    const voiceProbe = await inspector.inspect({ bytes: voiceBytes, contentType: 'audio/wav', kind: 'voice' });
    assert.equal(voiceProbe.hasAudio, true);
    resolvedMedia.push({ assetId: voiceAsset.asset_id, kind: 'voice', contentType: 'audio/wav', bytes: voiceBytes,
      temporal: { startMs: 0, endMs: 10000, durationMs: 10000 }, provider: 'local-fixture', model: 'sine-wave',
      brandId: input.brandId, provenance: { source: 'local-certification-fixture' },
      artifact: { artifactId: 'fixture:voice', version: 1, storageKey: 'fixtures/voice.wav', contentHash: 'voice' } });

    let providerCalls = 0; let reviewed = null; let masterBytes = null;
    const orchestrator = new MasterProductionOrchestrator({
      providerGateway: { async generate() { providerCalls += 1; throw new Error('provider must not be called'); } },
      renderer: new FfmpegMasterRenderer(), masterProbeValidator: validateMasterProbe,
      artifactService: { async createVersion(args) {
        masterBytes = args.content;
        return { artifactId: args.artifactId, version: 1, storageKey: 'masters/v25-master.bin',
          contentHash: crypto.createHash('sha256').update(args.content).digest('hex'), provenance: { provider: args.provider, model: args.model } };
      } },
      reviewService: { async registerMasterForReview(args) { reviewed = args; } },
    });
    const result = await orchestrator.build({ productionId: '44444444-4444-4444-8444-444444444444',
      workspaceId: '55555555-5555-4555-8555-555555555555', brandId: input.brandId, workerId: 'v25-local-certification',
      script: input.script, shotPlan: input.shotPlan, assetPlan: input.assetPlan, resolvedMedia,
      qualityPolicy: { width: 320, height: 568, fps: 24, durationToleranceMs: 300, requireVoiceForSpokenCopy: true } });

    assert.equal(providerCalls, 0);
    assert.equal(result.timeline.durationMs, 10000);
    assert.deepEqual(result.timeline.clips.filter((clip) => clip.track === 'video-main').map((clip) => clip.durationMs), [3000, 4000, 3000]);
    assert.ok(masterBytes.length > 1000);
    assert.equal(result.master.probe.width, 320); assert.equal(result.master.probe.height, 568);
    assert.ok(Math.abs(result.master.probe.durationMs - 10000) < 300);
    assert.equal(result.master.probe.videoCodec, 'h264'); assert.equal(result.master.probe.hasAudio, true);
    assert.equal(result.mediaValidation.status, 'PASS'); assert.equal(result.quality.status, 'PASS');
    assert.equal(result.quality.publicationAllowed, false); assert.equal(result.nextAction, 'HUMAN_REVIEW');
    assert.ok(reviewed); assert.equal(reviewed.quality.readyForHumanReview, true);
    console.log('V2.5 real FFmpeg 3-shot + audible audio master and media validation passed.');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
