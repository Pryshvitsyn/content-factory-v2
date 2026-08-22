'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FfmpegMasterRenderer, buildFfmpegArgs, runProcess } = require('../src/v2.1/ffmpeg-master-renderer');

async function main() {
  const assemblyContract = {
    durationMs: 2000,
    clips: [
      { id: 'visual', kind: 'image', startMs: 0, durationMs: 2000, sourceOffsetMs: 0, media: {} },
      { id: 'voice', kind: 'voice', startMs: 0, durationMs: 2000, sourceOffsetMs: 0, media: {} },
    ],
  };
  const args = buildFfmpegArgs({ assembly: assemblyContract, inputPaths: ['/tmp/visual.png', '/tmp/voice.wav'], outputPath: '/tmp/master.mp4', profile: { width: 320, height: 568, fps: 24 } });
  assert.ok(args.includes('-filter_complex'));
  assert.ok(args.some((arg) => arg.includes('scale=320:568')));
  assert.ok(args.some((arg) => arg.includes('amix=inputs=1')));
  assert.ok(args.includes('+faststart'));

  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'content-factory-fixture-'));
  try {
    const imagePath = path.join(fixtureDirectory, 'image.png');
    const audioPath = path.join(fixtureDirectory, 'voice.wav');
    await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x568:d=1', '-frames:v', '1', imagePath]);
    await runProcess('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audioPath]);
    const assembly = {
      durationMs: 2000,
      clips: [
        { ...assemblyContract.clips[0], media: { bytes: await fs.readFile(imagePath), contentType: 'image/png' } },
        { ...assemblyContract.clips[1], media: { bytes: await fs.readFile(audioPath), contentType: 'audio/wav' } },
      ],
    };
    const rendered = await new FfmpegMasterRenderer().render({ assembly, profile: { width: 320, height: 568, fps: 24 } });
    assert.equal(rendered.contentType, 'video/mp4');
    assert.ok(rendered.output.length > 1000);
    assert.equal(rendered.probe.width, 320);
    assert.equal(rendered.probe.height, 568);
    assert.ok(Math.abs(rendered.probe.fps - 24) < 0.1);
    assert.ok(Math.abs(rendered.probe.durationMs - 2000) < 150);
    assert.equal(rendered.probe.hasAudio, true);
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  }
  console.log('v2.1 real FFmpeg master renderer certification passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
