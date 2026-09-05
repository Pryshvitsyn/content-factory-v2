"use strict";

const crypto = require("node:crypto");
const { FfmpegMasterRenderer } = require("../v2.1/ffmpeg-master-renderer");
const { FfmpegFrameSampler } = require("../v2.9/frame-sampler");
const {
  FfmpegReferenceGeometryNormalizer,
  ReferenceGeometryError,
  compatible,
  referenceEvidence,
} = require("../v2.10.2/reference-geometry");
const { DurableMediaError } = require("../v2.5/durable-media-executor");
const {
  replicateFileMaterializer,
} = require("../workflow/provider-media-resolver");
const { getVideoModelContract } = require("../v2.8/video-model-contracts");
const {
  compileReferenceInputPlan,
} = require("../workflow/reference-input-plan");
const { ArtifactService } = require("../artifacts/artifact-service");
const {
  SNAPSHOT_SCHEMA_VERSION,
  fingerprint,
  previousShotDependencySpec,
} = require("../workflow/previous-shot-dependency");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function dataUri(contentType, bytes) {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

class V210PostProductionRenderer {
  constructor({ postProduction = null, delegate = null } = {}) {
    this.postProduction = postProduction;
    this.delegate = delegate || new FfmpegMasterRenderer();
  }
  async render({ assembly, ...rest }) {
    const resolved = this.postProduction
      ? Object.freeze({ ...assembly, postProduction: this.postProduction })
      : assembly;
    return this.delegate.render({ assembly: resolved, ...rest });
  }
}

class V210ReferenceAwareMediaExecutor {
  constructor({
    delegate,
    storage,
    frameSampler = null,
    geometryNormalizer = null,
    continuityAuthority = null,
  } = {}) {
    if (!delegate || !storage)
      throw new Error("delegate and storage are required");
    this.delegate = delegate;
    this.storage = storage;
    this.frameSampler = frameSampler || new FfmpegFrameSampler();
    this.geometryNormalizer =
      geometryNormalizer ||
      new FfmpegReferenceGeometryNormalizer({
        inspector: delegate.mediaInspector,
      });
    this.continuityAuthority = continuityAuthority;
    this.repository = delegate.repository;
    this.artifactService = delegate.artifactService?.createVersion
      ? delegate.artifactService
      : new ArtifactService({ storage });
    this.mediaInspector = delegate.mediaInspector;
    this.assetRepository = delegate.assetRepository;
    const priorValidator = delegate.outputValidator;
    delegate.outputValidator = async (context) => {
      if (priorValidator) await priorValidator(context);
      return this.validateProviderOutput(context);
    };
  }
  selection(asset) {
    return this.delegate.selection(asset);
  }
  identities(args) {
    return this.delegate.identities(args);
  }
  async readVerified(
    storageKey,
    contentHash,
    code = "REFERENCE_EVIDENCE_MISSING",
  ) {
    if (!storageKey || !contentHash)
      fail(
        code,
        "Immutable reference storage key and content hash are required",
      );
    const bytes = await this.storage.get({ key: storageKey });
    if (!Buffer.isBuffer(bytes) || !bytes.length)
      fail(code, "Immutable reference bytes are unavailable");
    if (hash(bytes) !== contentHash)
      fail(
        "REFERENCE_EVIDENCE_HASH_MISMATCH",
        "Immutable reference bytes do not match recorded content hash",
      );
    return bytes;
  }
  async latestReplacement({ productionId, brandId, assetId }) {
    if (typeof this.repository.latestSucceededReplacement === "function") {
      return this.repository.latestSucceededReplacement({
        productionId,
        brandId,
        assetId,
      });
    }
    if (!this.repository.db?.query) return null;
    try {
      const result = await this.repository.db.query(
        `/* v2.10.3:latest-accepted-shot-replacement */
        SELECT me.*,sr.source_asset_id,sr.replacement_asset_id,sr.revision_no,sr.retry_reason,sr.recovery_kind,
          sr.id AS regeneration_id FROM v2_7.shot_regenerations sr
        JOIN v2_5.media_executions me ON me.production_id=sr.production_id
          AND me.asset_id=sr.replacement_asset_id AND me.status='SUCCEEDED' AND me.brand_id=sr.brand_id
        JOIN v2_1.productions p ON p.id=sr.production_id
        WHERE sr.production_id=$1 AND sr.source_asset_id=$2
          AND sr.recovery_kind IN ('SOURCE_GEOMETRY','SOURCE_CONTINUITY','SOURCE_CREATIVE')
          AND sr.status='SUCCEEDED' AND p.brand_id=$3 AND sr.brand_id=$3
          AND me.workspace_id=p.workspace_id ORDER BY sr.revision_no DESC LIMIT 1`,
        [productionId, assetId, brandId],
      );
      return result.rows[0] || null;
    } catch (error) {
      if (["42P01", "42703", "3F000"].includes(error.code)) return null;
      throw error;
    }
  }
  dependencyIdentity({ workspaceId, brandId, productionId, asset }) {
    const slot = `${workspaceId}:${brandId}:${productionId}:${asset.asset_id}`;
    return {
      snapshotArtifactId: `runtime-dependency:${slot}`,
      snapshotIdempotencyKey: `runtime-dependency:${slot}`,
      derivedArtifactId: `runtime-dependency-frame:${slot}`,
    };
  }
  async loadFrozenPrevious(args, spec) {
    const identity = this.dependencyIdentity(args);
    const artifact = await this.artifactService.getVersionByIdempotency({
      artifactId: identity.snapshotArtifactId,
      type: "text",
      idempotencyKey: identity.snapshotIdempotencyKey,
      provider: "content-factory",
      model: SNAPSHOT_SCHEMA_VERSION,
      validationStatus: "immutable_runtime_dependency",
    });
    if (!artifact) return null;
    let snapshot;
    try {
      snapshot = JSON.parse(artifact.content.toString("utf8"));
    } catch {
      fail(
        "RUNTIME_DEPENDENCY_INVALID",
        "Runtime dependency snapshot is invalid",
      );
    }
    if (snapshot.dependencySpecFingerprint !== spec.dependencySpecFingerprint)
      fail(
        "RUNTIME_DEPENDENCY_AUTHORITY_STALE",
        "Frozen runtime dependency does not match human-approved dependency specification",
      );
    const bytes = await this.readVerified(
      snapshot.derivedFrameArtifactStorageKey,
      snapshot.derivedFrameSHA,
      "RUNTIME_DEPENDENCY_ARTIFACT_MISSING",
    );
    if (
      fingerprint({ ...snapshot, runtimeDependencyFingerprint: undefined }) !==
      snapshot.runtimeDependencyFingerprint
    )
      fail(
        "RUNTIME_DEPENDENCY_FINGERPRINT_MISMATCH",
        "Frozen runtime dependency fingerprint is invalid",
      );
    return {
      bytes,
      contentType: snapshot.derivedFrameMime,
      source: {
        artifactId: snapshot.derivedFrameArtifactId,
        version: snapshot.derivedFrameArtifactVersion,
        contentHash: snapshot.derivedFrameSHA,
      },
      evidence: snapshot,
      frozen: true,
    };
  }
  async freezePrevious(args, spec, materialized) {
    const identity = this.dependencyIdentity(args);
    const source = materialized.evidence;
    const derived = await this.artifactService.createVersion({
      artifactId: identity.derivedArtifactId,
      type: "binary",
      content: materialized.bytes,
      idempotencyKey: `${spec.dependencySpecFingerprint}:${source.sourceArtifactContentHash}`,
      provider: "content-factory",
      model: spec.extractionContractVersion,
      validationStatus: "immutable_runtime_dependency_frame",
    });
    const base = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      workspaceId: args.workspaceId,
      brandId: args.brandId,
      productionId: args.productionId,
      downstreamAssetId: args.asset.asset_id,
      downstreamShotId: spec.downstreamShotId,
      requestedUpstreamShotId: spec.requestedUpstreamShotId,
      requestedUpstreamAssetId: spec.requestedUpstreamAssetId,
      previousAssetId: spec.requestedUpstreamAssetId,
      resolvedUpstreamAssetId: source.resolvedPreviousAssetId,
      resolvedPreviousAssetId: source.resolvedPreviousAssetId,
      replacementAssetId: source.supersedesAssetId
        ? source.resolvedPreviousAssetId
        : null,
      replacementRevision: source.replacementRevision || null,
      sourceArtifactId: materialized.source.artifactId,
      sourceArtifactVersion: materialized.source.version,
      sourceArtifactSHA: source.sourceArtifactContentHash,
      sourceArtifactContentHash: source.sourceArtifactContentHash,
      sourceArtifactContentType: materialized.sourceVideo.contentType,
      dependencySpecFingerprint: spec.dependencySpecFingerprint,
      extractionContractVersion: spec.extractionContractVersion,
      timestampMs: source.timestampMs,
      analysisHash: source.analysisHash,
      derivedFrameArtifactId: derived.artifactId,
      derivedFrameArtifactVersion: derived.version,
      derivedFrameArtifactStorageKey: derived.storageKey,
      derivedFrameSHA: derived.contentHash,
      referenceHash: derived.contentHash,
      derivedFrameMime: materialized.contentType,
      geometryEvidence: {
        referenceWidth: source.referenceWidth,
        referenceHeight: source.referenceHeight,
        referenceAspectRatio: source.referenceAspectRatio,
        expectedAspectRatio: source.expectedAspectRatio,
        normalizationApplied: source.normalizationApplied,
        normalizationVersion: source.normalizationVersion,
        normalizationPolicy: source.normalizationPolicy,
      },
      referenceWidth: source.referenceWidth,
      referenceHeight: source.referenceHeight,
      referenceAspectRatio: source.referenceAspectRatio,
      orientation: source.orientation,
      expectedAspectRatio: source.expectedAspectRatio,
      originalReferenceWidth: source.originalReferenceWidth,
      originalReferenceHeight: source.originalReferenceHeight,
      originalReferenceAspectRatio: source.originalReferenceAspectRatio,
      normalizationApplied: source.normalizationApplied,
      normalizationVersion: source.normalizationVersion,
      normalizationPolicy: source.normalizationPolicy,
    };
    const snapshot = {
      ...base,
      runtimeDependencyFingerprint: fingerprint(base),
    };
    try {
      await this.artifactService.createVersion({
        artifactId: identity.snapshotArtifactId,
        type: "text",
        content: JSON.stringify(snapshot),
        idempotencyKey: identity.snapshotIdempotencyKey,
        provider: "content-factory",
        model: SNAPSHOT_SCHEMA_VERSION,
        validationStatus: "immutable_runtime_dependency",
      });
    } catch (error) {
      if (error.code !== "ARTIFACT_IDEMPOTENCY_CONFLICT") throw error;
    }
    return this.loadFrozenPrevious(args, spec);
  }
  async materializePrevious({
    workspaceId,
    brandId,
    productionId,
    asset,
    reference,
  }) {
    const spec =
      reference.dependencySpec ||
      previousShotDependencySpec({
        asset,
        reference,
        requirements: asset.generation_requirements || {},
      });
    const frozen = await this.loadFrozenPrevious(
      { workspaceId, brandId, productionId, asset },
      spec,
    );
    if (frozen) return frozen;
    const replacement = await this.latestReplacement({
      productionId,
      brandId,
      assetId: reference.previousAssetId,
    });
    const row =
      replacement ||
      (await this.repository.get({
        workspaceId,
        brandId,
        productionId,
        assetId: reference.previousAssetId,
      }));
    if (
      !row ||
      row.status !== "SUCCEEDED" ||
      !row.artifact_storage_key ||
      !row.artifact_content_hash
    ) {
      fail(
        "REFERENCE_EVIDENCE_MISSING",
        `Previous shot asset ${reference.previousAssetId || "unknown"} is not a succeeded immutable video`,
      );
    }
    const bytes = await this.readVerified(
      row.artifact_storage_key,
      row.artifact_content_hash,
    );
    const probe = row.media_probe || {};
    const frames = await this.frameSampler.sample({
      bytes,
      contentType: row.content_type || "video/mp4",
      kind: "video",
      durationMs: probe.durationMs || row.duration_ms,
      width: probe.width,
      height: probe.height,
      qualityTier: asset.generation_requirements?.profile || "STANDARD",
    });
    const frame = frames[frames.length - 1];
    if (!frame?.jpeg?.length)
      fail(
        "REFERENCE_EVIDENCE_MISSING",
        "Could not extract immutable previous-shot reference frame",
      );
    return {
      bytes: frame.jpeg,
      contentType: "image/jpeg",
      source: {
        artifactId:
          row.artifact_id ||
          `brand:${brandId}:asset:${reference.previousAssetId}`,
        version: row.artifact_version || 1,
        contentHash: row.artifact_content_hash,
      },
      sourceVideo: {
        bytes,
        contentType: row.content_type || "video/mp4",
        probe,
      },
      evidence: {
        policy: "PREVIOUS_SHOT_FRAME",
        previousAssetId: reference.previousAssetId,
        resolvedPreviousAssetId:
          replacement?.replacement_asset_id || reference.previousAssetId,
        sourceArtifactVersion: row.artifact_version || 1,
        supersedesAssetId: replacement?.source_asset_id || null,
        sourceArtifactStorageKey: row.artifact_storage_key,
        sourceArtifactContentHash: row.artifact_content_hash,
        timestampMs: frame.timestampMs,
        analysisHash: frame.analysisHash,
        referenceHash: hash(frame.jpeg),
        recoveryKind: replacement?.recovery_kind || null,
        replacementRevision: replacement?.revision_no || null,
        dependencySpecFingerprint: spec.dependencySpecFingerprint,
        extractionContractVersion: spec.extractionContractVersion,
      },
      dependencySpec: spec,
    };
  }
  async materializeUploaded(reference) {
    const artifact = reference.artifact || {};
    const storageKey = artifact.storageKey || artifact.storage_key;
    const contentHash = artifact.contentHash || artifact.content_hash;
    const bytes = await this.readVerified(storageKey, contentHash);
    return {
      bytes,
      contentType:
        artifact.contentType || artifact.content_type || "image/jpeg",
      source: {
        artifactId: artifact.artifactId || artifact.id,
        version: artifact.version || 1,
        contentHash,
      },
      evidence: {
        policy: "UPLOADED_REFERENCE",
        artifactId: artifact.artifactId || artifact.id,
        version: artifact.version || 1,
        storageKey,
        contentHash,
        referenceHash: hash(bytes),
      },
    };
  }
  async materializeAsset(args) {
    const asset = args.asset;
    const requirements = asset?.generation_requirements || {};
    const legacy = requirements.v210_continuity_binding
      ? [requirements.v210_continuity_binding]
      : [];
    const continuityBindings = requirements.v210_continuity_bindings || legacy;
    const canonicalReferences = [];
    const continuityEvidence = [];
    for (const continuity of continuityBindings) {
      if (!this.continuityAuthority?.resolve)
        fail(
          "CONTINUITY_AUTHORITY_REQUIRED",
          "Durable continuity authority is unavailable at execution",
        );
      const current = await this.continuityAuthority.resolve({
        workspaceId: args.workspaceId,
        consumerBrandId: args.brandId,
        packId: continuity.packId,
        fingerprint: continuity.packFingerprint,
      });
      const approved = JSON.stringify(
        continuity.references.map(
          ({ role, artifactId, artifactVersion, sha256 }) => ({
            role,
            artifactId,
            artifactVersion,
            sha256,
          }),
        ),
      );
      const actual = JSON.stringify(
        current.references.map(
          ({ role, artifactId, artifactVersion, sha256 }) => ({
            role,
            artifactId,
            artifactVersion,
            sha256,
          }),
        ),
      );
      if (approved !== actual)
        fail(
          "CONTINUITY_AUTHORITY_STALE",
          "Durable continuity references changed after final preflight",
        );
      for (const reference of current.references) {
        const bytes = await this.readVerified(
          reference.storageKey,
          reference.sha256,
          "CONTINUITY_REFERENCE_EVIDENCE_MISSING",
        );
        const providerValue =
          asset.generation_requirements.provider === "replicate" &&
          bytes.length > 1024 * 1024
            ? replicateFileMaterializer({
                provider: "replicate",
                model: asset.generation_requirements.model,
                bytes,
                mimeType: reference.mimeType,
                sha256: reference.sha256,
                artifactId: reference.artifactId,
                artifactVersion: reference.artifactVersion,
                purpose: "V2_10_CONTINUITY_REFERENCE",
              }).providerValue
            : dataUri(reference.mimeType || "application/octet-stream", bytes);
        canonicalReferences.push(
          Object.freeze({
            ...reference,
            providerValue,
            sourceType: "CONTINUITY_ENTITY",
            ownerBrandId: current.row.owner_brand_id,
            entityId: current.pack.entityId,
            entityRevision: current.pack.revision,
            packId: continuity.packId,
            packFingerprint: continuity.packFingerprint,
          }),
        );
      }
      continuityEvidence.push(
        Object.freeze({
          packId: continuity.packId,
          packRevision: continuity.packRevision,
          packFingerprint: continuity.packFingerprint,
          references: current.references.map(
            ({ role, artifactId, artifactVersion, sha256 }) => ({
              role,
              artifactId,
              artifactVersion,
              sha256,
            }),
          ),
        }),
      );
    }
    const reference = requirements.v210_reference;
    let materialized = null;
    if (reference) {
      materialized =
        reference.policy === "PREVIOUS_SHOT_FRAME"
          ? await this.materializePrevious({ ...args, reference })
          : reference.policy === "UPLOADED_REFERENCE"
            ? await this.materializeUploaded(reference)
            : fail(
                "REFERENCE_POLICY_UNSUPPORTED",
                `Unsupported V2.10 reference policy '${reference.policy}'`,
              );
      const expectedAspectRatio = requirements.aspect_ratio || "9:16",
        resolution = requirements.resolution || "720p";
      let normalized;
      if (reference.policy === "PREVIOUS_SHOT_FRAME" && materialized.frozen) {
        normalized = {
          bytes: materialized.bytes,
          contentType: materialized.contentType,
        };
      } else if (reference.policy === "PREVIOUS_SHOT_FRAME") {
        const normalize =
          typeof this.geometryNormalizer.normalizePreviousShot === "function"
            ? this.geometryNormalizer.normalizePreviousShot.bind(
                this.geometryNormalizer,
              )
            : this.geometryNormalizer.normalize.bind(this.geometryNormalizer);
        normalized = await normalize({
          bytes: materialized.bytes,
          contentType: materialized.contentType,
          expectedAspectRatio,
          resolution,
          sourceVideoBytes: materialized.sourceVideo?.bytes || null,
          sourceVideoContentType:
            materialized.sourceVideo?.contentType || "video/mp4",
        });
      } else {
        const actual = await this.geometryNormalizer.probe(
          materialized.bytes,
          materialized.contentType,
        );
        if (!compatible(actual, expectedAspectRatio))
          throw new ReferenceGeometryError(
            "REFERENCE_GEOMETRY_MISMATCH",
            "Uploaded reference geometry does not match canonical production",
            { actual, expectedAspectRatio },
          );
        normalized = {
          bytes: materialized.bytes,
          contentType: materialized.contentType,
          before: actual,
          after: actual,
          normalizationApplied: false,
          normalizationVersion: "v2.10.2-uploaded-reference-verified-v1",
          policy: "VERIFY_ONLY",
        };
      }
      if (!materialized.frozen) {
        materialized = {
          ...materialized,
          bytes: normalized.bytes,
          contentType: normalized.contentType,
          evidence: {
            ...materialized.evidence,
            ...referenceEvidence({
              result: normalized,
              expectedAspectRatio,
              source: materialized.source,
              referenceBytes: normalized.bytes,
            }),
          },
        };
        if (reference.policy === "PREVIOUS_SHOT_FRAME") {
          materialized = await this.freezePrevious(
            args,
            materialized.dependencySpec,
            materialized,
          );
        }
      }
      const providerValue =
        requirements.provider === "replicate" &&
        requirements.model === "bytedance/seedance-2.5" &&
        materialized.bytes.length > 1024 * 1024
          ? replicateFileMaterializer({
              provider: requirements.provider,
              model: requirements.model,
              bytes: materialized.bytes,
              mimeType: materialized.contentType,
              sha256: hash(materialized.bytes),
              artifactId: materialized.source.artifactId,
              artifactVersion: materialized.source.version,
              purpose: "V2_10_VIDEO_REFERENCE",
            }).providerValue
          : dataUri(materialized.contentType, materialized.bytes);
      const mode =
        requirements.resolved_input_mode || reference.resolvedInputMode;
      const role =
        reference.role ||
        (mode === "MULTIMODAL_REFERENCE"
          ? materialized.contentType.startsWith("video/")
            ? "REFERENCE_VIDEO"
            : materialized.contentType.startsWith("audio/")
              ? "REFERENCE_AUDIO"
              : "REFERENCE_IMAGE"
          : ["VIDEO_EDITING", "VIDEO_EXTENSION"].includes(mode)
            ? "REFERENCE_VIDEO"
            : "FIRST_FRAME");
      canonicalReferences.push(
        Object.freeze({
          role,
          sourceType: reference.policy,
          providerValue,
          artifactId: materialized.source.artifactId,
          artifactVersion: materialized.source.version,
          sha256: hash(materialized.bytes),
          mimeType: materialized.contentType,
          transform: materialized.evidence,
        }),
      );
    }
    if (!canonicalReferences.length) return asset;
    const mode =
      requirements.resolved_input_mode || reference?.resolvedInputMode;
    const plan = compileReferenceInputPlan({
      resolvedInputMode: mode,
      references: canonicalReferences,
      limits:
        getVideoModelContract(requirements.provider, requirements.model)
          ?.limits || {},
    });
    if (
      requirements.reference_input_plan_fingerprint &&
      requirements.reference_input_plan_fingerprint !== plan.fingerprint
    ) {
      fail(
        "REFERENCE_INPUT_PLAN_STALE",
        `Materialized reference plan ${plan.fingerprint} differs from authoritative ${requirements.reference_input_plan_fingerprint}`,
      );
    }
    const references = {
      first_frame: plan.firstFrame?.providerValue || null,
      last_frame: plan.lastFrame?.providerValue || null,
      character_images: plan.referenceImages.map((item) => item.providerValue),
      reference_videos: plan.referenceVideos.map((item) => item.providerValue),
      reference_audios: plan.referenceAudios.map((item) => item.providerValue),
    };
    return Object.freeze({
      ...asset,
      generation_requirements: Object.freeze({
        ...requirements,
        references: Object.freeze(references),
        reference_input_plan_fingerprint: plan.fingerprint,
        v210_continuity_evidence: Object.freeze(continuityEvidence),
        ...(materialized
          ? { v210_reference_evidence: Object.freeze(materialized.evidence) }
          : {}),
        ...(materialized?.evidence?.runtimeDependencyFingerprint
          ? {
              runtime_dependency_snapshot: Object.freeze({
                runtimeDependencyFingerprint:
                  materialized.evidence.runtimeDependencyFingerprint,
                derivedFrameArtifactId:
                  materialized.evidence.derivedFrameArtifactId,
                derivedFrameArtifactVersion:
                  materialized.evidence.derivedFrameArtifactVersion,
                derivedFrameSHA: materialized.evidence.derivedFrameSHA,
              }),
            }
          : {}),
      }),
    });
  }
  async validateProviderOutput({ asset, media, probe }) {
    if (asset?.kind !== "video") return;
    const requestedAspectRatio =
      asset.generation_requirements?.aspect_ratio || null;
    if (!requestedAspectRatio || !probe?.width || !probe?.height) return;
    const actual = {
      width: Number(probe.width),
      height: Number(probe.height),
      aspectRatio: Number(
        (Number(probe.width) / Number(probe.height)).toFixed(6),
      ),
    };
    if (compatible(actual, requestedAspectRatio)) return;
    const reference =
      asset.generation_requirements?.v210_reference_evidence || {};
    throw new DurableMediaError(
      "PROVIDER_OUTPUT_GEOMETRY_MISMATCH",
      `Provider returned ${actual.width}x${actual.height} for canonical ${requestedAspectRatio}`,
      {
        provider: media.provider,
        model: media.model,
        assetId: asset.asset_id,
        requestedAspectRatio,
        actualWidth: actual.width,
        actualHeight: actual.height,
        actualAspectRatio: actual.aspectRatio,
        referenceWidth: reference.referenceWidth || null,
        referenceHeight: reference.referenceHeight || null,
        referenceHash: reference.referenceHash || null,
        providerRequestId: media.requestId || null,
      },
    );
  }
  withExecutionContext(media, args) {
    return Object.freeze({
      ...media,
      productionId: args.productionId,
      brandId: args.brandId,
      workspaceId: args.workspaceId || null,
      assetId: args.asset?.asset_id || media.assetId,
    });
  }
  async execute(args) {
    const replacement = await this.latestReplacement({
      productionId: args.productionId,
      brandId: args.brandId,
      assetId: args.asset?.asset_id,
    });
    if (replacement) {
      const bytes = await this.readVerified(
        replacement.artifact_storage_key,
        replacement.artifact_content_hash,
        "SHOT_REPLACEMENT_EVIDENCE_MISSING",
      );
      const artifact = Object.freeze({
        artifactId: replacement.artifact_id,
        version: replacement.artifact_version,
        storageKey: replacement.artifact_storage_key,
        contentHash: replacement.artifact_content_hash,
        content: bytes,
        validationStatus: "validated_media",
      });
      const media = {
        assetId: args.asset.asset_id,
        kind: args.asset.kind,
        bytes,
        contentType: replacement.content_type || "video/mp4",
        mediaProbe: replacement.media_probe,
        provider: replacement.provider,
        model: replacement.model,
        requestId: replacement.provider_request_id,
        artifact,
        provenanceArtifact: null,
        durableExecutionId: replacement.id,
      };
      return this.withExecutionContext(
        {
          ...media,
          provenance: Object.freeze({
            ...(media.provenance || {}),
            source: "v2.10.3-accepted-shot-replacement",
            supersedesAssetId: args.asset.asset_id,
            replacementAssetId: replacement.replacement_asset_id,
            artifactVersion: replacement.artifact_version,
            retryReason: replacement.retry_reason,
            recoveryKind: replacement.recovery_kind,
            regenerationId: replacement.regeneration_id,
          }),
        },
        args,
      );
    }
    const asset = await this.materializeAsset(args);
    const media = await this.delegate.execute({ ...args, asset });
    return this.withExecutionContext(media, args);
  }
  async loadExisting(args) {
    const replacement = await this.latestReplacement({
      productionId: args.productionId,
      brandId: args.brandId,
      assetId: args.asset?.asset_id,
    });
    if (replacement) return this.execute(args);
    const asset = await this.materializeAsset(args);
    const media = await this.delegate.loadExisting({ ...args, asset });
    return this.withExecutionContext(media, args);
  }
}

module.exports = {
  V210PostProductionRenderer,
  V210ReferenceAwareMediaExecutor,
  dataUri,
};
