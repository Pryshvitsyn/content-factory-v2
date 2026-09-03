'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('../src/v2.1/ffmpeg-master-renderer');
const { SphereVoiceReactiveRenderer } = require('../src/v2.10/sphere-voice-reactive-renderer');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sphere-voice-ci-'));
  const video = path.join(root, 'sphere.mp4');
  const audio = path.join(root, 'voice.wav');
  const output = path.join(root, 'response.mp4');
  try {
    await runProcess('ffmpeg', [
      '-hide_banner','-loglevel','error','-y',
      '-f','lavfi','-i','color=c=black:s=360x640:r=24:d=2',
      '-vf','drawbox=x=90:y=230:w=180:h=180:color=blue:t=fill',
      '-c:v','libx264','-pix_fmt','yuv420p',video,
    ]);
    await runProcess('ffmpeg', [
      '-hide_banner','-loglevel','error','-y',
      '-f','lavfi','-i','sine=frequency=220:sample_rate=48000:duration=2',
      '-af','volume=0.5','-c:a','pcm_s16le',audio,
    ]);
    const renderer = new SphereVoiceReactiveRenderer();
    const result = await renderer.render({ videoPath: video, audioPath: audio, outputPath: output,
      renderSettings: { sphereDiameterRatio: 0.5, maxScalePulse: 0.012, maxTravelPixels: 1.5 } });
    assert.ok(result.bytes.length > 1000);
    assert.ok(result.envelope.some((point) => point.intensity > 0.2));
    assert.equal(result.provenance.backgroundMotion, 'UNCHANGED_BASE_VIDEO');
    assert.equal(result.provenance.noHalo, true);
    const probeResult = await runProcess('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',output]);
    const payload = JSON.parse(probeResult.stdout.toString('utf8'));
    const videoStream = payload.streams.find((stream) => stream.codec_type === 'video');
    const audioStream = payload.streams.find((stream) => stream.codec_type === 'audio');
    assert.equal(videoStream.width, 360);
    assert.equal(videoStream.height, 640);
    assert.ok(audioStream);
    console.log('ImpulseOff sphere voice-reactive FFmpeg certification: PASS');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
