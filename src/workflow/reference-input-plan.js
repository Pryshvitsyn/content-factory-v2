"use strict";

const { INPUT_MODES, fingerprint } = require("../v2.8/video-model-contracts");

class ReferenceInputPlanError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ReferenceInputPlanError";
    this.code = code;
    this.status = 409;
    this.details = details;
  }
}

const ROLE_MEDIA = Object.freeze({
  FIRST_FRAME: "image",
  LAST_FRAME: "image",
  REFERENCE_IMAGE: "image",
  REFERENCE_VIDEO: "video",
  REFERENCE_AUDIO: "audio",
});

function fail(code, message, details) {
  throw new ReferenceInputPlanError(code, message, details);
}

function canonicalReference(reference, order) {
  const role = String(reference.role || "");
  if (!ROLE_MEDIA[role])
    fail(
      "REFERENCE_ROLE_UNSUPPORTED",
      `Unsupported canonical reference role '${role}'`,
    );
  const mimeType = String(reference.mimeType || reference.contentType || "");
  if (!mimeType.startsWith(`${ROLE_MEDIA[role]}/`)) {
    fail(
      "REFERENCE_ROLE_MEDIA_TYPE_MISMATCH",
      `${role} requires ${ROLE_MEDIA[role]} media`,
    );
  }
  return Object.freeze({ ...reference, role, mimeType, order });
}

function enforceLimits(references, limits = {}) {
  const count = (role) =>
    references.filter((item) => item.role === role).length;
  if (count("REFERENCE_IMAGE") > Number(limits.referenceImages ?? Infinity))
    fail("REFERENCE_IMAGE_LIMIT_EXCEEDED", "Reference image limit exceeded");
  if (count("REFERENCE_VIDEO") > Number(limits.referenceVideos ?? Infinity))
    fail("REFERENCE_VIDEO_LIMIT_EXCEEDED", "Reference video limit exceeded");
  if (count("REFERENCE_AUDIO") > Number(limits.referenceAudios ?? Infinity))
    fail("REFERENCE_AUDIO_LIMIT_EXCEEDED", "Reference audio limit exceeded");
  const duration = (role) =>
    references
      .filter((item) => item.role === role)
      .reduce((total, item) => total + Number(item.durationSeconds || 0), 0);
  if (
    duration("REFERENCE_VIDEO") >
    Number(limits.combinedReferenceVideoSeconds ?? Infinity)
  )
    fail(
      "REFERENCE_VIDEO_DURATION_LIMIT_EXCEEDED",
      "Combined reference video duration limit exceeded",
    );
  if (
    duration("REFERENCE_AUDIO") >
    Number(limits.combinedReferenceAudioSeconds ?? Infinity)
  )
    fail(
      "REFERENCE_AUDIO_DURATION_LIMIT_EXCEEDED",
      "Combined reference audio duration limit exceeded",
    );
}

function compileReferenceInputPlan({
  resolvedInputMode,
  references = [],
  limits = {},
} = {}) {
  const orderedReferences = Object.freeze(references.map(canonicalReference));
  const byRole = (role) =>
    orderedReferences.filter((item) => item.role === role);
  const first = byRole("FIRST_FRAME");
  const last = byRole("LAST_FRAME");
  const images = byRole("REFERENCE_IMAGE");
  const videos = byRole("REFERENCE_VIDEO");
  const audios = byRole("REFERENCE_AUDIO");
  const multimodal = [...images, ...videos, ...audios];
  enforceLimits(orderedReferences, limits);

  if (first.length > 1 || last.length > 1)
    fail(
      "DUPLICATE_REFERENCE_ROLE",
      "Only one FIRST_FRAME and one LAST_FRAME are allowed",
    );
  if (
    resolvedInputMode === INPUT_MODES.TEXT_TO_VIDEO &&
    orderedReferences.length
  )
    fail(
      "REFERENCE_ROLE_UNSUPPORTED",
      "TEXT_TO_VIDEO does not accept references",
    );
  if (
    resolvedInputMode === INPUT_MODES.FIRST_FRAME_IMAGE_TO_VIDEO &&
    (first.length !== 1 || orderedReferences.length !== 1)
  ) {
    fail(
      first.length ? "REFERENCE_ROLE_UNSUPPORTED" : "REFERENCE_ROLE_REQUIRED",
      "FIRST_FRAME_IMAGE_TO_VIDEO requires exactly one FIRST_FRAME",
    );
  }
  if (
    resolvedInputMode === INPUT_MODES.FIRST_LAST_FRAME &&
    (first.length !== 1 || last.length !== 1 || orderedReferences.length !== 2)
  ) {
    fail(
      first.length && last.length
        ? "REFERENCE_ROLE_UNSUPPORTED"
        : "REFERENCE_ROLE_REQUIRED",
      "FIRST_LAST_FRAME requires exactly FIRST_FRAME and LAST_FRAME",
    );
  }
  if (
    [
      INPUT_MODES.MULTIMODAL_REFERENCE,
      INPUT_MODES.VIDEO_EDITING,
      INPUT_MODES.VIDEO_EXTENSION,
    ].includes(resolvedInputMode)
  ) {
    if (first.length || last.length)
      fail(
        "REFERENCE_ROLE_UNSUPPORTED",
        `${resolvedInputMode} does not accept frame roles`,
      );
    if (!multimodal.length)
      fail(
        "REFERENCE_ROLE_REQUIRED",
        `${resolvedInputMode} requires at least one reference`,
      );
  }
  if (
    [INPUT_MODES.VIDEO_EDITING, INPUT_MODES.VIDEO_EXTENSION].includes(
      resolvedInputMode,
    ) &&
    !videos.length
  ) {
    fail(
      "REFERENCE_ROLE_REQUIRED",
      `${resolvedInputMode} requires REFERENCE_VIDEO`,
    );
  }

  const identity = orderedReferences.map((item) => ({
    role: item.role,
    sourceType: item.sourceType || null,
    ownerBrandId: item.ownerBrandId || null,
    entityId: item.entityId || null,
    entityRevision: item.entityRevision || null,
    packId: item.packId || null,
    packFingerprint: item.packFingerprint || null,
    artifactId: item.artifactId || null,
    artifactVersion: item.artifactVersion || null,
    sha256: item.sha256 || null,
    mimeType: item.mimeType,
    storageKey: item.storageKey || null,
    order: item.order,
  }));
  return Object.freeze({
    schemaVersion: "reference-input-plan@1",
    resolvedInputMode,
    firstFrame: first[0] || null,
    lastFrame: last[0] || null,
    referenceImages: Object.freeze(images),
    referenceVideos: Object.freeze(videos),
    referenceAudios: Object.freeze(audios),
    orderedReferences,
    fingerprint: fingerprint({ resolvedInputMode, references: identity }),
  });
}

function providerNeutralReferences(plan) {
  return {
    image: plan.firstFrame || undefined,
    lastFrameImage: plan.lastFrame || undefined,
    referenceImages: plan.referenceImages,
    referenceVideos: plan.referenceVideos,
    referenceAudios: plan.referenceAudios,
  };
}

module.exports = {
  ReferenceInputPlanError,
  compileReferenceInputPlan,
  providerNeutralReferences,
};
