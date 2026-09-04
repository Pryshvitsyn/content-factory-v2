'use strict';

const path = require('node:path');
const { createCanonicalMediaRequest } = require('../v2.8/canonical-media-request');
const { CAPABILITIES } = require('../v2.8/capabilities');

const SPHERE_MOTION_KINDS = Object.freeze(['calm_loop', 'micro_pulse', 'small_pulse', 'medium_pulse', 'active_internal', 'pressure_hold', 'settle', 'strong_response']);
const APPROVAL_GATES = Object.freeze(['visual_spec', 'generation_prompt', 'generated_master', 'motion_segmentation', 'loop', 'final_export']);
const MASTER_ID = 'impulseoff-sphere-motion-master-v1';
const NEGATIVE_PROMPT = 'no white ring, no circular stroke, no outline, no neon rim, no halo ring, no glowing border, no hard shell edge, no poles, no polar caps, no visible axis, no red, no pink, no magenta contamination, no inverted colors, no negative-photo appearance, no flashing, no camera movement, no sphere relocation, no background jump, no particle explosion, no sparks, no electric lightning, no audio spectrum, no waveform visualization, no equalizer, no obvious breathing animation, no cartoon squash and stretch, no abrupt morphing, no cuts, no text, no logo, no watermark';
const BASE_PROMPT = 'A single premium living organic sphere suspended centrally in a nearly black cinematic environment. Soft translucent glass-like organic membrane with subtle depth. Slow liquid-like internal masses, smooth volumetric flow, coherent organic material, no discrete particles. Completely locked camera: no zoom, pan, tilt, orbit, dolly, or lens breathing. Stable near-black atmospheric background with no distracting moving stars. Motion happens primarily inside the sphere; any expansion is organic internal pressure, never a 2D scale transform. Premium product-film quality, minimal, elegant, calm, physically coherent, never a synthetic UI visualizer.';

class SphereMotionError extends Error { constructor(code, message, details) { super(message); this.name = 'SphereMotionError'; this.code = code; this.details = details || null; } }
function required(value, code, message) { if (value === undefined || value === null || value === '') throw new SphereMotionError(code, message); return value; }
function finite(value, code, message) { const result = Number(value); if (!Number.isFinite(result)) throw new SphereMotionError(code, message); return result; }
function clone(value) { return structuredClone(value); }

function validateMotionUnit(raw = {}) {
  const kind = String(required(raw.kind, 'MOTION_KIND_REQUIRED', 'Motion kind is required')).toLowerCase();
  if (!SPHERE_MOTION_KINDS.includes(kind)) throw new SphereMotionError('MOTION_KIND_INVALID', `Unsupported sphere motion kind '${kind}'`);
  const target = raw.targetDurationRange || raw.target_duration_range;
  if (!Array.isArray(target) || target.length !== 2) throw new SphereMotionError('MOTION_DURATION_RANGE_REQUIRED', 'targetDurationRange must contain [minimumSeconds, maximumSeconds]');
  const minimum = finite(target[0], 'MOTION_DURATION_INVALID', 'Motion duration minimum must be numeric');
  const maximum = finite(target[1], 'MOTION_DURATION_INVALID', 'Motion duration maximum must be numeric');
  if (minimum <= 0 || maximum < minimum) throw new SphereMotionError('MOTION_DURATION_INVALID', 'Motion duration range must be positive and ordered');
  const loopable = raw.loopable === true;
  if ((kind === 'calm_loop' || kind === 'active_internal') && !loopable) {
    throw new SphereMotionError('LOOPABLE_REQUIRED', `${kind} must be declared loopable`);
  }
  return Object.freeze({ id: String(required(raw.id, 'MOTION_ID_REQUIRED', 'Motion unit id is required')), kind,
    startState: required(raw.startState || raw.start_state, 'MOTION_START_STATE_REQUIRED', 'Motion start state is required'),
    endState: required(raw.endState || raw.end_state, 'MOTION_END_STATE_REQUIRED', 'Motion end state is required'),
    targetDurationRange: Object.freeze([minimum, maximum]), loopable, intensity: raw.intensity || 'subtle',
    sphereScaleChange: clone(raw.sphereScaleChange || raw.sphere_scale_change || { min: 0, max: 0 }),
    internalMotionIntensity: raw.internalMotionIntensity || raw.internal_motion_intensity || 'low',
    shellDeformationAllowance: raw.shellDeformationAllowance || raw.shell_deformation_allowance || 'minimal',
    backgroundInvariant: raw.backgroundInvariant !== false, cameraInvariant: raw.cameraInvariant !== false,
    continuityRequirements: Object.freeze([...(raw.continuityRequirements || raw.continuity_requirements || [])]),
    visualNegativeConstraints: Object.freeze([...(raw.visualNegativeConstraints || raw.visual_negative_constraints || [])]), notes: raw.notes || null });
}

function createMotionSpec(raw = {}) {
  const units = (raw.units || []).map(validateMotionUnit);
  if (!units.length) throw new SphereMotionError('MOTION_UNITS_REQUIRED', 'At least one motion unit is required');
  const ids = new Set(); for (const unit of units) { if (ids.has(unit.id)) throw new SphereMotionError('MOTION_ID_DUPLICATE', `Duplicate motion unit '${unit.id}'`); ids.add(unit.id); }
  return Object.freeze({ schemaVersion: '1.0', assetId: raw.assetId || MASTER_ID, reference: required(raw.reference, 'REFERENCE_REQUIRED', 'An approved visual identity reference is required'), units: Object.freeze(units), negativePrompt: raw.negativePrompt || NEGATIVE_PROMPT });
}

function createGenerationPlan({ reference, motionSpec, providerSelection, durationSeconds = 5, resolution = '720p', aspectRatio = '9:16', seed = null } = {}) {
  const spec = createMotionSpec(motionSpec);
  if (spec.reference !== reference) throw new SphereMotionError('REFERENCE_MISMATCH', 'The plan reference must exactly match the approved motion-spec reference');
  const primary = spec.units[0];
  const prompt = `${BASE_PROMPT} Requested motion unit: ${primary.kind.replaceAll('_', ' ')}. Start state: ${primary.startState}. End state: ${primary.endState}. ${primary.notes || ''}`.trim();
  return Object.freeze({ schemaVersion: '1.0', assetId: spec.assetId, strategy: 'REFERENCE_CONDITIONED_ANCHOR_CLIPS',
    rationale: 'The catalog supports image-to-video and reference-to-video, while exact continuation support is provider-dependent. Generate a locked reference-conditioned anchor first; only use a terminal frame as the next first-frame after visual approval.',
    motionSpec: spec, prompt, negativePrompt: spec.negativePrompt,
    request: createCanonicalMediaRequest({ capability: CAPABILITIES.IMAGE_TO_VIDEO, prompt, negativePrompt: spec.negativePrompt,
      durationSeconds, resolution, aspectRatio, seed, references: { firstFrame: reference }, audio: { requested: false, strategy: 'EXTERNAL_VOICE' },
      camera: { locked: true }, continuity: { lockedCamera: true, stableBackground: true, sphereCenterInvariant: true }, providerSelection }),
    expectedPaidCalls: 1, approvalRequirements: Object.freeze(['visual_spec', 'generation_prompt']) });
}

function validateApprovals(approvals = [], requiredGates = APPROVAL_GATES) {
  const approved = new Set(approvals.filter((item) => item && item.status === 'APPROVED').map((item) => item.gate));
  const missing = requiredGates.filter((gate) => !approved.has(gate));
  if (missing.length) throw new SphereMotionError('APPROVAL_REQUIRED', `Human approval required for: ${missing.join(', ')}`, { missing });
  return true;
}

function validateManifest(raw = {}) {
  required(raw.assetId, 'MANIFEST_ASSET_ID_REQUIRED', 'Manifest assetId is required');
  required(raw.source, 'MANIFEST_SOURCE_REQUIRED', 'Manifest source is required');
  for (const field of ['width', 'height', 'fps']) if (!Number.isFinite(Number(raw[field])) || Number(raw[field]) <= 0) throw new SphereMotionError('MANIFEST_MEDIA_INVALID', `${field} must be positive`);
  const segments = raw.segments || {}; const values = Object.entries(segments).map(([id, segment]) => ({ id, ...segment }));
  if (!values.length) throw new SphereMotionError('MANIFEST_SEGMENTS_REQUIRED', 'At least one annotated segment is required');
  const ordered = values.map((segment) => {
    if (!SPHERE_MOTION_KINDS.includes(segment.kind)) throw new SphereMotionError('SEGMENT_KIND_INVALID', `Invalid segment kind for ${segment.id}`);
    const startMs = finite(segment.startMs, 'SEGMENT_TIME_INVALID', `${segment.id} startMs must be numeric`); const endMs = finite(segment.endMs, 'SEGMENT_TIME_INVALID', `${segment.id} endMs must be numeric`);
    if (startMs < 0 || endMs <= startMs) throw new SphereMotionError('SEGMENT_RANGE_INVALID', `${segment.id} must have a non-empty positive range`);
    if (segment.loop === true && !['calm_loop','active_internal','pressure_hold'].includes(segment.kind)) throw new SphereMotionError('SEGMENT_LOOP_INVALID', `${segment.id} cannot be loopable for kind ${segment.kind}`);
    return { ...segment, startMs, endMs };
  }).sort((a,b) => a.startMs - b.startMs);
  for (let index = 1; index < ordered.length; index += 1) if (ordered[index].startMs < ordered[index - 1].endMs) throw new SphereMotionError('SEGMENT_OVERLAP', `${ordered[index].id} overlaps ${ordered[index - 1].id}`);
  return Object.freeze({ schemaVersion: '1.0', assetId: raw.assetId, source: raw.source, width: Number(raw.width), height: Number(raw.height), fps: Number(raw.fps), segments: Object.freeze(Object.fromEntries(ordered.map(({ id, ...segment }) => [id, Object.freeze(segment)]))) });
}

function exportPaths(root, version = 'v1') { const base = path.join(root, 'impulseoff', 'sphere-motion', version); return Object.freeze({ base, master: path.join(base, 'master', 'IMPULSEOFF_SPHERE_MOTION_MASTER_V1.mp4'), frames: path.join(base, 'frames'), segments: path.join(base, 'segments'), segmentFrames: path.join(base, 'segment-frames'), manifest: path.join(base, 'manifest', 'sphere-motion-manifest.json'), qa: path.join(base, 'qa') }); }

class SphereMotionMasterService {
  constructor({ providerGateway, env = process.env } = {}) { this.providerGateway = providerGateway; this.env = env; }
  async generate({ plan, approvals }) {
    validateApprovals(approvals, plan.approvalRequirements);
    if (this.env.LIVE_PAID_GENERATION !== 'true') throw new SphereMotionError('PAID_GENERATION_DISABLED', 'LIVE_PAID_GENERATION=true and a separate explicit human action are required');
    if (!this.providerGateway?.generate) throw new SphereMotionError('PROVIDER_GATEWAY_REQUIRED', 'A configured provider gateway is required for generation');
    return this.providerGateway.generate({ capability: plan.request.capability, provider: plan.request.providerSelection.provider,
      model: plan.request.providerSelection.model, canonicalRequest: plan.request, idempotencyKey: `${plan.assetId}:${plan.request.seed ?? 'unseeded'}` });
  }
}

module.exports = { APPROVAL_GATES, BASE_PROMPT, MASTER_ID, NEGATIVE_PROMPT, SPHERE_MOTION_KINDS, SphereMotionError, SphereMotionMasterService, createGenerationPlan, createMotionSpec, exportPaths, validateApprovals, validateManifest, validateMotionUnit };
