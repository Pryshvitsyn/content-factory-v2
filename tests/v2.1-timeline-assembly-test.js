'use strict';

const assert = require('node:assert/strict');
const { buildTimeline, assembleMedia } = require('../worker/v2.1-timeline-assembly');

function media(assetId, kind, durationMs, provider = 'test-provider') {
  return {
    assetId,
    kind,
    contentType: kind === 'video' ? 'video/mp4' : 'audio/mpeg',
    bytes: Buffer.from(assetId),
    mediaUrl: null,
    temporal: { startMs: 0, endMs: durationMs, durationMs, offsetMs: 0 },
    provider,
    model: 'test-model',
    provenance: { provider, model: 'test-model' },
  };
}

function main() {
  const timeline = buildTimeline({
    productionId: 'prod-assembly-1',
    fps: 30,
    clips: [
      { id: 'shot-1-video', assetId: 'video-1', kind: 'video', track: 'video-main', startMs: 0, durationMs: 3000 },
      { id: 'shot-2-video', assetId: 'video-2', kind: 'video', track: 'video-main', startMs: 3000, durationMs: 2000 },
      { id: 'voice-1', assetId: 'voice-1', kind: 'voice', track: 'voice-main', startMs: 500, durationMs: 3500 },
      { id: 'music-1', assetId: 'audio-1', kind: 'audio', track: 'music-main', startMs: 0, durationMs: 5000 },
    ],
  });

  assert.equal(timeline.durationMs, 5000);
  assert.deepEqual(timeline.tracks, ['video-main', 'voice-main', 'music-main']);
  assert.equal(timeline.clips.find((clip) => clip.id === 'shot-1-video').endMs, 3000);

  const assembled = assembleMedia({
    timeline,
    mediaResults: [
      media('video-1', 'video', 3000, 'nvidia-video'),
      media('video-2', 'video', 2000, 'openai-video'),
      media('voice-1', 'voice', 3500, 'voice-provider'),
      media('audio-1', 'audio', 5000, 'audio-provider'),
    ],
  });

  assert.equal(assembled.status, 'assembled');
  assert.equal(assembled.durationMs, 5000);
  assert.equal(assembled.videoTracks.length, 2);
  assert.equal(assembled.audioTracks.length, 2);
  assert.equal(assembled.clips.find((clip) => clip.id === 'voice-1').startMs, 500);
  assert.equal(assembled.clips.find((clip) => clip.id === 'voice-1').endMs, 4000);
  assert.equal(assembled.clips.find((clip) => clip.id === 'voice-1').media.provider, 'voice-provider');

  assert.throws(() => buildTimeline({
    productionId: 'prod-overlap',
    clips: [
      { id: 'a', assetId: 'a', kind: 'video', track: 'video-main', startMs: 0, durationMs: 2000 },
      { id: 'b', assetId: 'b', kind: 'video', track: 'video-main', startMs: 1500, durationMs: 1000 },
    ],
  }), /Overlapping clips/);

  assert.throws(() => assembleMedia({
    timeline,
    mediaResults: [media('video-1', 'video', 3000)],
  }), /Missing media result/);

  assert.throws(() => assembleMedia({
    timeline: buildTimeline({
      productionId: 'prod-short',
      clips: [{ id: 'voice-short', assetId: 'voice-short', kind: 'voice', track: 'voice-main', startMs: 0, durationMs: 3000, sourceOffsetMs: 500 }],
    }),
    mediaResults: [media('voice-short', 'voice', 3000)],
  }), /shorter than requested/);

  console.log('v2.1 timeline and media assembly certification passed');
}

main();
