"use strict";

const crypto = require("node:crypto");

const EXTRACTION_CONTRACT_VERSION = "previous-shot-reference-extractor@1";
const DEPENDENCY_SCHEMA_VERSION = "previous-shot-dependency-spec@1";
const SNAPSHOT_SCHEMA_VERSION = "previous-shot-runtime-dependency@1";

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function previousShotDependencySpec({ asset, reference, requirements = {} }) {
  const spec = {
    schemaVersion: DEPENDENCY_SCHEMA_VERSION,
    dependencyType: "PREVIOUS_SHOT_FRAME",
    requestedUpstreamShotId: reference.previousShotId || null,
    requestedUpstreamAssetId: reference.previousAssetId,
    downstreamShotId: asset.required_for_shots?.[0] || null,
    downstreamAssetId: asset.asset_id,
    selectionPolicy: "LATEST_ACCEPTED_IMMUTABLE_OUTPUT_BEFORE_SNAPSHOT",
    expectedSourceKind: "video",
    extractionContractVersion: EXTRACTION_CONTRACT_VERSION,
    extractorImplementation: "FfmpegFrameSampler",
    frameSelection: "LAST_QUALITY_PROFILE_SAMPLE",
    samplingProfile: requirements.profile || "STANDARD",
    samplingPolicyVersion: "v2.9-quality-tier-sample-ratios@1",
    geometryNormalizationPolicy: "v2.10.2-reference-geometry",
    targetAspectRatio: requirements.aspect_ratio || "9:16",
    targetResolution: requirements.resolution || "720p",
    outputMimeType: "image/jpeg",
    frameEncoding: "FFMPEG_MJPEG_Q5",
    acceptedReplacementAllowed: true,
  };
  return Object.freeze({
    ...spec,
    dependencySpecFingerprint: fingerprint(spec),
  });
}

module.exports = {
  DEPENDENCY_SCHEMA_VERSION,
  EXTRACTION_CONTRACT_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  fingerprint,
  previousShotDependencySpec,
};
