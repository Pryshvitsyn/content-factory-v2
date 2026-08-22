'use strict';

function requireValue(name, value) {
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
}

function finiteNonNegative(name, value) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
}

function normalizeClip(clip) {
  requireValue('clip', clip);
  requireValue('clip.id', clip.id);
  requireValue('clip.assetId', clip.assetId);
  requireValue('clip.kind', clip.kind);
  requireValue('clip.track', clip.track);
  finiteNonNegative('clip.startMs', clip.startMs);
  finiteNonNegative('clip.durationMs', clip.durationMs);
  if (clip.durationMs <= 0) throw new Error(`clip.durationMs must be greater than zero for ${clip.id}`);
  const endMs = clip.endMs ?? clip.startMs + clip.durationMs;
  finiteNonNegative('clip.endMs', endMs);
  if (endMs - clip.startMs !== clip.durationMs) throw new Error(`Clip duration mismatch for ${clip.id}`);
  const sourceOffsetMs = clip.sourceOffsetMs ?? 0;
  finiteNonNegative('clip.sourceOffsetMs', sourceOffsetMs);
  return Object.freeze({ ...clip, endMs, sourceOffsetMs });
}

function assertNoOverlap(clips, track) {
  const ordered = clips.filter((clip) => clip.track === track).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].startMs < ordered[i - 1].endMs) {
      throw new Error(`Overlapping clips on track ${track}: ${ordered[i - 1].id} and ${ordered[i].id}`);
    }
  }
}

function buildTimeline({ productionId, clips, fps = 30 } = {}) {
  requireValue('productionId', productionId);
  if (!Array.isArray(clips) || clips.length === 0) throw new Error('clips are required');
  if (!Number.isInteger(fps) || fps <= 0) throw new Error('fps must be a positive integer');

  const normalizedInput = clips.map(normalizeClip);
  // Track order is part of the declared production layout. Keep first-declared order
  // rather than deriving it from a lexical clip sort, so timeline serialization is stable.
  const tracks = [...new Set(normalizedInput.map((clip) => clip.track))];
  const normalized = normalizedInput.slice().sort((a, b) => a.startMs - b.startMs || a.track.localeCompare(b.track) || a.id.localeCompare(b.id));
  for (const track of tracks) assertNoOverlap(normalized, track);

  const durationMs = Math.max(...normalized.map((clip) => clip.endMs));
  return Object.freeze({
    productionId,
    fps,
    durationMs,
    tracks: Object.freeze(tracks),
    clips: Object.freeze(normalized),
  });
}

function assembleMedia({ timeline, mediaResults } = {}) {
  requireValue('timeline', timeline);
  if (!Array.isArray(mediaResults)) throw new Error('mediaResults are required');

  const byAssetId = new Map(mediaResults.map((result) => [result.assetId, result]));
  const resolved = timeline.clips.map((clip) => {
    const media = byAssetId.get(clip.assetId);
    if (!media) throw new Error(`Missing media result for asset ${clip.assetId}`);
    if (media.temporal?.startMs !== null && media.temporal?.startMs !== undefined && media.temporal.startMs > clip.startMs) {
      throw new Error(`Media starts after timeline clip for ${clip.id}`);
    }
    if (media.temporal?.durationMs !== null && media.temporal?.durationMs !== undefined && media.temporal.durationMs < clip.durationMs + clip.sourceOffsetMs) {
      throw new Error(`Media duration is shorter than requested clip for ${clip.id}`);
    }
    return Object.freeze({ ...clip, media });
  });

  return Object.freeze({
    productionId: timeline.productionId,
    fps: timeline.fps,
    durationMs: timeline.durationMs,
    clips: Object.freeze(resolved),
    audioTracks: Object.freeze(resolved.filter((clip) => clip.kind === 'voice' || clip.kind === 'audio')),
    videoTracks: Object.freeze(resolved.filter((clip) => clip.kind === 'video' || clip.kind === 'image')),
    status: 'assembled',
  });
}

module.exports = { normalizeClip, buildTimeline, assembleMedia };
