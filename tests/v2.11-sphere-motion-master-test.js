'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { APPROVAL_GATES, NEGATIVE_PROMPT, SphereMotionError, SphereMotionMasterService, createGenerationPlan, createMotionSpec, exportPaths, validateManifest } = require('../src/v2.11/sphere-motion-master');
const { buildFrameArgs, buildLoopPreviewArgs, buildTrimArgs, extractSegment, inspectOutput, run } = require('../src/v2.11/sphere-motion-media');
const { analyze, validateLoop } = require('../src/v2.11/loop-validator');

const reference = 'artifact://brand-impulseoff/approved-sphere-reference-v1.png';
const unit = { id: 'calm_a', kind: 'calm_loop', startState: 'calm', endState: 'calm', targetDurationRange: [4, 8], loopable: true, notes: 'Natural seam required.' };
const selection = { provider: 'alibaba', model: 'wan3.0-video', profile: 'STANDARD' };
const approvals = ['visual_spec', 'generation_prompt'].map((gate) => ({ gate, status: 'APPROVED', actor: 'human' }));

async function main() {
  const spec = createMotionSpec({ reference, units: [unit] });
  assert.equal(spec.units[0].kind, 'calm_loop');
  assert.throws(() => createMotionSpec({ reference, units: [{ ...unit, id: 'bad', targetDurationRange: [8, 4] }] }), (error) => error.code === 'MOTION_DURATION_INVALID');
  assert.throws(() => createMotionSpec({ reference, units: [{ ...unit, id: 'bad', loopable: false }] }), (error) => error.code === 'LOOPABLE_REQUIRED');
  const providerReference = 'data:image/jpeg;base64,ZmFrZQ==';
  const plan = createGenerationPlan({ reference, providerReference, motionSpec: { reference, units: [unit] }, providerSelection: selection, durationSeconds: 5, seed: 101 });
  assert.equal(plan.request.capability, 'IMAGE_TO_VIDEO');
  assert.equal(plan.referenceIdentity, reference);
  assert.equal(plan.request.references.firstFrame, providerReference);
  assert.equal(plan.request.resolvedSettings.enablePromptExpansion, false);
  assert.equal(plan.request.resolvedSettings.watermark, false);
  assert.ok(plan.prompt.includes('Hard exclusions:'));
  assert.ok(plan.prompt.includes('no white ring'));
  assert.ok(plan.negativePrompt.includes('no white ring'));
  assert.equal(plan.expectedPaidCalls, 1);
  assert.equal(NEGATIVE_PROMPT.includes('no red'), true);
  assert.ok(NEGATIVE_PROMPT.length <= 500, `NEGATIVE_PROMPT must stay <= 500 chars, got ${NEGATIVE_PROMPT.length}`);
  const manifest = { assetId: plan.assetId, source: '/safe/master.mp4', width: 720, height: 1280, fps: 30, segments: { calm_a: { startMs: 0, endMs: 1000, loop: true, kind: 'calm_loop' }, settle_a: { startMs: 1000, endMs: 1600, loop: false, kind: 'settle' } } };
  assert.equal(validateManifest(manifest).segments.calm_a.loop, true);
  assert.throws(() => validateManifest({ ...manifest, segments: { a: manifest.segments.calm_a, b: { startMs: 900, endMs: 1500, loop: false, kind: 'settle' } } }), (error) => error.code === 'SEGMENT_OVERLAP');
  assert.throws(() => validateManifest({ ...manifest, segments: { bad: { startMs: 4, endMs: 4, loop: false, kind: 'settle' } } }), (error) => error.code === 'SEGMENT_RANGE_INVALID');
  assert.throws(() => validateManifest({ ...manifest, segments: { bad: { startMs: 0, endMs: 4, loop: true, kind: 'settle' } } }), (error) => error.code === 'SEGMENT_LOOP_INVALID');
  assert.match(buildTrimArgs({ source: 'in.mp4', startMs: 100, endMs: 1200, output: 'out.mp4', fps: 30, width: 720, height: 1280 }).join(' '), /-ss 0.100/);
  assert.match(buildFrameArgs({ source: 'in.mp4', timeMs: 1, output: 'out.png' }).join(' '), /-frames:v 1/);
  assert.match(buildLoopPreviewArgs({ source: 'in.mp4', output: 'out.mp4' }).join(' '), /-stream_loop 2/);
  assert.deepEqual(Object.keys(exportPaths('/tmp/output')), ['base','master','frames','segments','segmentFrames','manifest','qa']);
  let calls = 0; const service = new SphereMotionMasterService({ env: { LIVE_PAID_GENERATION: 'false' }, providerGateway: { generate: async () => { calls += 1; } } });
  await assert.rejects(() => service.generate({ plan, approvals }), (error) => error.code === 'PAID_GENERATION_DISABLED'); assert.equal(calls, 0);
  await assert.rejects(() => service.generate({ plan, approvals: [] }), (error) => error.code === 'APPROVAL_REQUIRED');
  assert.equal(APPROVAL_GATES.length, 6);
  const measured = analyze(Buffer.from([0,0,0,0]), Buffer.from([10,10,10,10]), 2, 2); assert.equal(measured.averageDifference, 10); assert.ok('sphereCenterDisplacementPx' in measured);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sphere-motion-'));
  try {
    const source = path.join(directory, 'source.mp4'); const output = path.join(directory, 'segment.mp4');
    await run('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=black:s=720x1280:d=2:r=30','-c:v','libx264','-pix_fmt','yuv420p',source]);
    await extractSegment({ manifest: { ...manifest, source }, segmentId: 'calm_a', output });
    const stats = await fs.stat(output); assert.ok(stats.size > 1000);
    const media = await inspectOutput(output); assert.deepEqual({ codec: media.codec, width: media.width, height: media.height, fps: Math.round(media.fps) }, { codec: 'h264', width: 720, height: 1280, fps: 30 });
    const loop = await validateLoop({ source, startMs: 0, endMs: 1000, width: 72, height: 128 }); assert.ok(loop.averageDifference < 1);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
  console.log('v2.11 ImpulseOff sphere motion master tests passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
