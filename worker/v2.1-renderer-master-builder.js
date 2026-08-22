'use strict';

function requireValue(name, value) {
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
}

function buildRenderManifest({ assembly, output = {} } = {}) {
  requireValue('assembly', assembly);
  if (!Array.isArray(assembly.clips) || assembly.clips.length === 0) throw new Error('assembly.clips are required');
  if (!Number.isFinite(assembly.durationMs) || assembly.durationMs <= 0) throw new Error('assembly.durationMs must be positive');
  const format = output.format || 'mp4';
  const videoCodec = output.videoCodec || 'h264';
  const audioCodec = output.audioCodec || 'aac';
  return Object.freeze({
    productionId: assembly.productionId,
    fps: assembly.fps,
    durationMs: assembly.durationMs,
    format,
    videoCodec,
    audioCodec,
    tracks: Object.freeze({
      video: Object.freeze(assembly.videoTracks.map((clip) => Object.freeze({ id: clip.id, assetId: clip.assetId, startMs: clip.startMs, endMs: clip.endMs, sourceOffsetMs: clip.sourceOffsetMs, mediaUrl: clip.media.mediaUrl, contentType: clip.media.contentType }))),
      audio: Object.freeze(assembly.audioTracks.map((clip) => Object.freeze({ id: clip.id, assetId: clip.assetId, startMs: clip.startMs, endMs: clip.endMs, sourceOffsetMs: clip.sourceOffsetMs, mediaUrl: clip.media.mediaUrl, contentType: clip.media.contentType }))),
    }),
  });
}

function buildMasterArtifactDescriptor({ manifest, artifactId, version = 1 } = {}) {
  requireValue('manifest', manifest);
  requireValue('artifactId', artifactId);
  if (!Number.isInteger(version) || version < 1) throw new Error('version must be a positive integer');
  return Object.freeze({
    artifactId,
    version,
    productionId: manifest.productionId,
    kind: 'media-master',
    immutable: true,
    contentType: manifest.format === 'mp4' ? 'video/mp4' : `video/${manifest.format}`,
    renderSpec: manifest,
  });
}

async function renderMaster({ renderer, manifest, artifactId, version = 1, idempotencyKey } = {}) {
  requireValue('renderer', renderer);
  requireValue('manifest', manifest);
  requireValue('artifactId', artifactId);
  requireValue('idempotencyKey', idempotencyKey);
  if (typeof renderer.render !== 'function') throw new Error('renderer.render is required');

  const result = await renderer.render({
    manifest,
    idempotencyKey,
  });

  if (!result || (!Buffer.isBuffer(result.output) && !result.url)) throw new Error('Renderer returned neither bytes nor URL');
  if (!result.contentType) throw new Error('Renderer must return contentType');

  return Object.freeze({
    artifact: buildMasterArtifactDescriptor({ manifest, artifactId, version }),
    output: result.output || null,
    url: result.url || null,
    contentType: result.contentType,
    renderer: result.renderer || null,
    rendererVersion: result.rendererVersion || null,
    requestId: result.requestId || null,
  });
}

module.exports = { buildRenderManifest, buildMasterArtifactDescriptor, renderMaster };
