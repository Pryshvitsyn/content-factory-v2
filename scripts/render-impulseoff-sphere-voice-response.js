'use strict';

const path = require('node:path');
const { SphereVoiceReactiveRenderer } = require('../src/v2.10/sphere-voice-reactive-renderer');

async function main() {
  const videoPath = process.argv[2];
  const audioPath = process.argv[3];
  const outputPath = process.argv[4] || path.resolve(process.cwd(), 'impulseoff-sphere-voice-response.mp4');
  if (!videoPath || !audioPath) {
    throw Object.assign(new Error('Usage: node scripts/render-impulseoff-sphere-voice-response.js <sphere-video> <voice-audio> [output.mp4]'), { code: 'SPHERE_VOICE_INPUT_REQUIRED' });
  }
  const renderer = new SphereVoiceReactiveRenderer();
  const result = await renderer.render({
    videoPath: path.resolve(videoPath),
    audioPath: path.resolve(audioPath),
    outputPath: path.resolve(outputPath),
    envelopeOptions: { sampleRate: 1000, windowMs: 40, hopMs: 40, silenceThreshold: 0.025, attack: 0.55, release: 0.18 },
    renderSettings: { sphereDiameterRatio: 0.62, maxScalePulse: 0.018, maxTravelPixels: 2.5, vibrationHzX: 17, vibrationHzY: 19 },
  });
  const active = result.envelope.filter((point) => point.intensity > 0.02);
  console.log('IMPULSEOFF SPHERE VOICE RESPONSE RENDERED');
  console.log(JSON.stringify({
    outputPath: path.resolve(outputPath),
    envelopeWindows: result.envelope.length,
    activeVoiceWindows: active.length,
    maxIntensity: result.envelope.reduce((max, point) => Math.max(max, point.intensity), 0),
    response: result.provenance.response,
    backgroundMotion: result.provenance.backgroundMotion,
    noHalo: result.provenance.noHalo,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[${error.code || 'SPHERE_VOICE_RENDER_FAILED'}] ${error.message}`);
  process.exitCode = 1;
});
