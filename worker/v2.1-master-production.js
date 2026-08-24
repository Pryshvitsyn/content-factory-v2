'use strict';

const crypto = require('node:crypto');
const { validateShape } = require('./v2.1-structured-production');
const { generateMediaAsset } = require('./v2.1-media-generation');
const { buildTimeline, assembleMedia } = require('./v2.1-timeline-assembly');

const DEFAULT_QUALITY_POLICY = Object.freeze({
  width: 1080,
  height: 1920,
  fps: 30,
  durationToleranceMs: 1000,
  requireHook: true,
  requireCta: true,
  requireVoiceForSpokenCopy: true,
});

function requireValue(name, value) {
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
}

function assertBrandScope(brandId, values) {
  requireValue('brandId', brandId);
  for (const [name, value] of Object.entries(values)) {
    const declared = value?.brand_id || value?.brandId;
    if (declared && declared !== brandId) {
      const error = new Error(`${name} belongs to a different brand`);
      error.code = 'BRAND_SCOPE_MISMATCH';
      throw error;
    }
  }
}

function canonicalFingerprint(value) {
  const sort = (input) => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])]));
    }
    return input;
  };
  return crypto.createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

function contentTypeForKind(kind) {
  return { image: 'image/png', video: 'video/mp4', voice: 'audio/mpeg', audio: 'audio/mpeg' }[kind] || 'application/octet-stream';
}

function buildMasterTimeline({ productionId, script, shotPlan, assetPlan, fps = 30 } = {}) {
  requireValue('productionId', productionId);
  validateShape('SCRIPT', script);
  validateShape('SHOT_PLAN', shotPlan);
  validateShape('ASSET_PLAN', assetPlan);

  const shotIds = shotPlan.shots.map((shot) => String(shot.shot_id));
  const assetIds = assetPlan.assets.map((asset) => String(asset.asset_id));
  if (new Set(shotIds).size !== shotIds.length) throw new Error('SHOT_PLAN contains duplicate shot_id values');
  if (new Set(assetIds).size !== assetIds.length) throw new Error('ASSET_PLAN contains duplicate asset_id values');
  const unsupported = assetPlan.assets.find((asset) => !['image', 'video', 'voice', 'audio'].includes(asset.kind));
  if (unsupported) throw new Error(`Unsupported master asset kind: ${unsupported.kind}`);

  const scenes = new Set(script.scenes.map((scene) => String(scene.scene_number)));
  const assets = new Map(assetPlan.assets.map((asset) => [String(asset.asset_id), asset]));
  const shotWindows = new Map();
  const clips = [];
  let cursorMs = 0;

  for (const shot of shotPlan.shots) {
    if (!scenes.has(String(shot.scene_id))) throw new Error(`Shot ${shot.shot_id} references an unknown scene`);
    const durationMs = Math.round(Number(shot.duration_seconds) * 1000);
    if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error(`Shot ${shot.shot_id} has invalid duration`);
    const required = shot.required_assets.map((assetId) => {
      const asset = assets.get(String(assetId));
      if (!asset) throw new Error(`Shot ${shot.shot_id} references missing asset ${assetId}`);
      return asset;
    });
    const visuals = required.filter((asset) => asset.kind === 'image' || asset.kind === 'video');
    const explicitPrimary = visuals.filter((asset) => asset.generation_requirements?.role === 'primary_visual');
    const primary = explicitPrimary.length === 1 ? explicitPrimary[0] : visuals.length === 1 ? visuals[0] : null;
    if (!primary) throw new Error(`Shot ${shot.shot_id} must have exactly one primary image or video asset`);

    clips.push({
      id: `${shot.shot_id}:visual`,
      assetId: primary.asset_id,
      kind: primary.kind,
      track: 'video-main',
      startMs: cursorMs,
      durationMs,
      sourceOffsetMs: Number(primary.generation_requirements?.source_offset_ms || 0),
      shotId: shot.shot_id,
      sceneId: shot.scene_id,
    });
    shotWindows.set(String(shot.shot_id), { startMs: cursorMs, endMs: cursorMs + durationMs });
    cursorMs += durationMs;
  }

  for (const asset of assetPlan.assets.filter((item) => item.kind === 'voice' || item.kind === 'audio')) {
    const windows = asset.required_for_shots.map((shotId) => {
      const window = shotWindows.get(String(shotId));
      if (!window) throw new Error(`Asset ${asset.asset_id} references unknown shot ${shotId}`);
      return window;
    });
    const startMs = Math.min(...windows.map((window) => window.startMs));
    const endMs = Math.max(...windows.map((window) => window.endMs));
    clips.push({
      id: `${asset.asset_id}:${asset.kind}`,
      assetId: asset.asset_id,
      kind: asset.kind,
      track: asset.kind === 'voice' ? `voice:${asset.asset_id}` : `audio:${asset.asset_id}`,
      startMs,
      durationMs: endMs - startMs,
      sourceOffsetMs: Number(asset.generation_requirements?.source_offset_ms || 0),
    });
  }

  return buildTimeline({ productionId, clips, fps });
}

function validateMasterQuality({ script, shotPlan, assetPlan, timeline, probe, policy = {} } = {}) {
  const settings = { ...DEFAULT_QUALITY_POLICY, ...policy };
  const checks = [];
  const add = (code, ok, message, details = {}) => checks.push({ code, status: ok ? 'PASS' : 'FAIL', message, details });
  const dialogue = script.scenes.map((scene) => String(scene.dialogue_or_voiceover || '')).join(' ').trim();
  const normalizeCopy = (value) => String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const normalizedDialogue = normalizeCopy(dialogue);
  const firstSceneCopy = normalizeCopy(script.scenes[0]?.dialogue_or_voiceover);
  const normalizedHook = normalizeCopy(script.hook);
  const normalizedCta = normalizeCopy(script.cta);
  const voiceCopy = normalizeCopy(assetPlan.assets.filter((asset) => asset.kind === 'voice')
    .map((asset) => asset.generation_requirements?.text || '').join(' '));
  const hasVoiceAsset = assetPlan.assets.some((asset) => asset.kind === 'voice');
  const visualClips = timeline.clips.filter((clip) => clip.track === 'video-main').sort((a, b) => a.startMs - b.startMs);
  const visualCoverage = visualClips.length === shotPlan.shots.length && visualClips.every((clip, index) => (
    clip.startMs === (index === 0 ? 0 : visualClips[index - 1].endMs)
  ));

  const sceneTiming = script.scenes.every((scene) => {
    const planned = shotPlan.shots.filter((shot) => String(shot.scene_id) === String(scene.scene_number))
      .reduce((sum, shot) => sum + Number(shot.duration_seconds) * 1000, 0);
    return Math.abs(planned - Number(scene.duration_seconds) * 1000) <= 250;
  });

  add('editorial_hook', !settings.requireHook || Boolean(normalizedHook), 'Сценарий содержит явный хук.');
  add('hook_delivery', !settings.requireHook || (normalizedHook && firstSceneCopy.includes(normalizedHook)), 'Хук присутствует в первой сцене.');
  add('editorial_cta', !settings.requireCta || Boolean(normalizedCta), 'Сценарий содержит явный CTA.');
  add('cta_delivery', !settings.requireCta || (normalizedCta && normalizedDialogue.includes(normalizedCta)), 'CTA присутствует в озвучиваемом тексте.');
  add('spoken_copy_voice', !settings.requireVoiceForSpokenCopy || !dialogue || hasVoiceAsset, 'Для озвучиваемого текста предусмотрен voice-asset.');
  add('voice_copy_integrity', !settings.requireVoiceForSpokenCopy || !dialogue || voiceCopy.includes(normalizedDialogue), 'Voice-asset содержит утверждённый текст сценария.');
  add('scene_timing', sceneTiming, 'Тайминг шотов соответствует сценарию.');
  add('visual_coverage', visualCoverage && visualClips.at(-1)?.endMs === timeline.durationMs, 'Каждый шот имеет непрерывное визуальное покрытие.');
  add('continuity', Boolean(String(shotPlan.continuity?.visual_style || '').trim()), 'Зафиксирован визуальный стиль и continuity.');
  add('resolution', probe.width === settings.width && probe.height === settings.height, 'Мастер соответствует целевому разрешению.', { actual: `${probe.width}x${probe.height}`, expected: `${settings.width}x${settings.height}` });
  add('frame_rate', Math.abs(probe.fps - settings.fps) < 0.1, 'Мастер соответствует целевой частоте кадров.', { actual: probe.fps, expected: settings.fps });
  add('duration', Math.abs(probe.durationMs - timeline.durationMs) <= settings.durationToleranceMs, 'Длительность мастера соответствует таймлайну.', { actualMs: probe.durationMs, expectedMs: timeline.durationMs });
  add('video_codec', Boolean(probe.videoCodec), 'Мастер содержит видеопоток.');
  add('audio_track', probe.hasAudio, 'Мастер содержит аудиодорожку.');

  const status = checks.some((check) => check.status === 'FAIL') ? 'FAIL' : 'PASS';
  return Object.freeze({
    status,
    score: Number((checks.filter((check) => check.status === 'PASS').length / checks.length).toFixed(3)),
    checks: Object.freeze(checks),
    readyForHumanReview: status === 'PASS',
    publicationAllowed: false,
    approvalStatus: 'AWAITING_HUMAN_APPROVAL',
  });
}

class MasterProductionOrchestrator {
  constructor({ providerGateway, artifactService, renderer, reviewService = null, mediaExecutor = null, masterProbeValidator = null } = {}) {
    requireValue('providerGateway', providerGateway);
    requireValue('artifactService', artifactService);
    requireValue('renderer', renderer);
    this.providerGateway = providerGateway;
    this.artifactService = artifactService;
    this.renderer = renderer;
    this.reviewService = reviewService;
    this.mediaExecutor = mediaExecutor;
    this.masterProbeValidator = masterProbeValidator;
  }

  async build({ productionId, workspaceId = null, brandId, workerId, script, shotPlan, assetPlan, resolvedMedia = [], qualityPolicy = {} } = {}) {
    requireValue('productionId', productionId);
    requireValue('workerId', workerId);
    assertBrandScope(brandId, { script, shotPlan, assetPlan });

    const settings = { ...DEFAULT_QUALITY_POLICY, ...qualityPolicy };
    const timeline = buildMasterTimeline({ productionId, script, shotPlan, assetPlan, fps: settings.fps });
    const reusable = new Map(resolvedMedia.map((media) => [String(media.assetId), media]));
    const mediaResults = [];
    for (const asset of assetPlan.assets) {
      if (!['image', 'video', 'voice', 'audio'].includes(asset.kind)) continue;
      let media = reusable.get(String(asset.asset_id));
      if (media) {
        if (media.brandId && media.brandId !== brandId) {
          const error = new Error(`Resolved media ${asset.asset_id} belongs to a different brand`);
          error.code = 'BRAND_SCOPE_MISMATCH';
          throw error;
        }
        if (!media.artifact) throw new Error(`Resolved media ${asset.asset_id} must reference an immutable artifact`);
      } else if (this.mediaExecutor) {
        requireValue('workspaceId', workspaceId);
        media = await this.mediaExecutor.execute({ workspaceId, productionId, brandId, workerId, asset });
        if (!media?.artifact) throw new Error(`Durable media executor did not persist asset ${asset.asset_id}`);
      } else {
        const mediaFingerprint = canonicalFingerprint({ brandId, productionId, asset });
        const artifactId = `brand:${brandId}:asset:${asset.asset_id}`;
        const mediaIdempotencyKey = `${brandId}:${productionId}:media:${asset.asset_id}:${mediaFingerprint}`;
        const provenanceArtifactId = `${artifactId}:provenance`;
        const provenanceIdempotencyKey = `${mediaIdempotencyKey}:provenance`;
        const cachedArtifact = typeof this.artifactService.getVersionByIdempotency === 'function'
          ? await this.artifactService.getVersionByIdempotency({
            artifactId, type: 'binary', idempotencyKey: mediaIdempotencyKey,
            validationStatus: 'pending_master_validation',
          })
          : null;
        if (cachedArtifact) {
          const cachedProvenanceArtifact = await this.artifactService.getVersionByIdempotency({
            artifactId: provenanceArtifactId, type: 'text', idempotencyKey: provenanceIdempotencyKey,
            validationStatus: 'recorded',
          });
          let recorded = {};
          if (cachedProvenanceArtifact) {
            try { recorded = JSON.parse(cachedProvenanceArtifact.content.toString('utf8')); } catch {}
          }
          media = Object.freeze({
            assetId: asset.asset_id,
            kind: asset.kind,
            contentType: contentTypeForKind(asset.kind),
            bytes: cachedArtifact.content,
            mediaUrl: null,
            temporal: asset.temporal || asset.generation_requirements?.temporal || null,
            provider: recorded.provider || cachedArtifact.provenance.provider || 'immutable-artifact-cache',
            model: recorded.model || cachedArtifact.provenance.model,
            requestId: recorded.requestId || null,
            usage: recorded.usage || null,
            provenance: Object.freeze({ ...(recorded.provenance || {}), source: 'immutable-artifact-cache' }),
            brandId,
            artifact: cachedArtifact,
            provenanceArtifact: cachedProvenanceArtifact,
          });
        } else {
          media = await generateMediaAsset({
            providerGateway: this.providerGateway,
            asset,
            productionId,
            brandId,
            workerId,
          });
          if (!media.bytes) {
            const error = new Error(`Generated media ${asset.asset_id} must contain durable bytes`);
            error.code = 'MASTER_MEDIA_MUST_BE_DURABLE';
            throw error;
          }
          const artifact = await this.artifactService.createVersion({
            artifactId,
            type: 'binary',
            content: media.bytes,
            idempotencyKey: mediaIdempotencyKey,
            provider: media.provider,
            model: media.model,
            validationStatus: 'pending_master_validation',
          });
          const provenanceArtifact = await this.artifactService.createVersion({
            artifactId: provenanceArtifactId,
            type: 'text',
            content: JSON.stringify({
              schemaVersion: 1,
              brandId,
              productionId,
              assetId: asset.asset_id,
              contentType: media.contentType,
              provider: media.provider,
              model: media.model,
              requestId: media.requestId,
              usage: media.usage,
              provenance: media.provenance,
              sourceMediaUrl: media.mediaUrl,
              mediaArtifactStorageKey: artifact.storageKey,
            }),
            idempotencyKey: provenanceIdempotencyKey,
            provider: media.provider,
            model: media.model,
            validationStatus: 'recorded',
          });
          media = Object.freeze({ ...media, brandId, artifact, provenanceArtifact });
        }
      }
      mediaResults.push(media);
    }

    const assembly = assembleMedia({ timeline, mediaResults });
    const rendered = await this.renderer.render({
      assembly,
      profile: { width: settings.width, height: settings.height, fps: settings.fps },
    });
    const mediaValidation = this.masterProbeValidator ? this.masterProbeValidator({
      probe: rendered.probe, width: settings.width, height: settings.height,
      durationMs: timeline.durationMs, durationToleranceMs: settings.durationToleranceMs,
      requireAudio: true,
    }) : null;
    const quality = validateMasterQuality({ script, shotPlan, assetPlan, timeline, probe: rendered.probe, policy: settings });
    const fingerprint = canonicalFingerprint({ brandId, productionId, script, shotPlan, assetPlan, settings });
    const artifact = await this.artifactService.createVersion({
      artifactId: `production:${productionId}:master`,
      type: 'binary',
      content: rendered.output,
      idempotencyKey: `${brandId}:${productionId}:master:${fingerprint}`,
      provider: rendered.provenance?.renderer || 'ffmpeg',
      model: rendered.provenance?.profile ? JSON.stringify(rendered.provenance.profile) : null,
      validationStatus: quality.status === 'PASS' ? 'awaiting_human_approval' : 'failed',
    });

    const result = Object.freeze({
      productionId,
      brandId,
      fingerprint,
      timeline,
      assembly,
      master: Object.freeze({ artifact, contentType: rendered.contentType, probe: rendered.probe }),
      mediaValidation,
      quality,
      nextAction: quality.readyForHumanReview ? 'HUMAN_REVIEW' : 'REVISE',
    });
    if (quality.readyForHumanReview && this.reviewService) {
      await this.reviewService.registerMasterForReview({
        productionId,
        brandId,
        master: result.master,
        script,
        quality,
        mediaResults,
      });
    }
    return result;
  }
}

module.exports = {
  DEFAULT_QUALITY_POLICY,
  MasterProductionOrchestrator,
  assertBrandScope,
  buildMasterTimeline,
  canonicalFingerprint,
  contentTypeForKind,
  validateMasterQuality,
};
