"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  V210ReferenceAwareMediaExecutor,
} = require("../src/v2.10/reference-aware-media");

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async exists({ key }) {
      return values.has(key);
    },
    async get({ key }) {
      if (!values.has(key))
        throw Object.assign(new Error(`missing ${key}`), { code: "ENOENT" });
      return values.get(key);
    },
    async put({ key, bytes }) {
      if (values.has(key))
        throw Object.assign(new Error("exists"), { code: "EEXIST" });
      values.set(key, Buffer.from(bytes));
      return { key, size: bytes.length };
    },
  };
}

function asset() {
  return {
    asset_id: "shot-b",
    kind: "video",
    generation_requirements: {
      provider: "replicate",
      model: "alibaba/wan-3",
      capability: "IMAGE_TO_VIDEO",
      resolved_input_mode: "FIRST_FRAME_IMAGE_TO_VIDEO",
      profile: "STANDARD",
      aspect_ratio: "9:16",
      resolution: "720p",
      v210_reference: {
        policy: "PREVIOUS_SHOT_FRAME",
        previousAssetId: "shot-a",
      },
    },
  };
}

function row(revision) {
  const bytes = Buffer.from(`upstream-${revision}`);
  return {
    id: `execution-${revision}`,
    status: "SUCCEEDED",
    source_asset_id: "shot-a",
    replacement_asset_id: `shot-a-${revision}`,
    revision_no: Number(revision.slice(1)),
    recovery_kind: "SOURCE_CONTINUITY",
    artifact_id: `artifact-${revision}`,
    artifact_version: Number(revision.slice(1)),
    artifact_storage_key: `media/${revision}.mp4`,
    artifact_content_hash: sha(bytes),
    content_type: "video/mp4",
    duration_ms: 5000,
    media_probe: { durationMs: 5000, width: 720, height: 1280 },
    bytes,
  };
}

async function main() {
  const a2 = row("a2"),
    a3 = row("a3");
  const store = storage({
    [a2.artifact_storage_key]: a2.bytes,
    [a3.artifact_storage_key]: a3.bytes,
  });
  let current = a2,
    samples = 0,
    providerCalls = 0,
    materializedAsset = null;
  const delegate = {
    repository: {
      async latestSucceededReplacement({ assetId }) {
        return assetId === "shot-a" ? current : null;
      },
      async get() {
        throw new Error("replacement should resolve");
      },
    },
    artifactService: null,
    mediaInspector: {},
    assetRepository: {},
    selection() {
      return { provider: "replicate", model: "alibaba/wan-3" };
    },
    identities() {
      return {};
    },
    async execute({ asset: input }) {
      providerCalls += 1;
      materializedAsset = input;
      return { requestId: "mock-existing-boundary" };
    },
  };
  const executor = new V210ReferenceAwareMediaExecutor({
    delegate,
    storage: store,
    frameSampler: {
      async sample({ bytes }) {
        samples += 1;
        return [
          {
            jpeg: Buffer.from(`frame:${sha(bytes)}`),
            timestampMs: 4900,
            analysisHash: `analysis-${sha(bytes)}`,
          },
        ];
      },
    },
    geometryNormalizer: {
      async normalize({ bytes }) {
        return {
          bytes,
          contentType: "image/jpeg",
          before: {
            width: 720,
            height: 1280,
            aspectRatio: 0.5625,
            orientation: "PORTRAIT",
          },
          after: {
            width: 720,
            height: 1280,
            aspectRatio: 0.5625,
            orientation: "PORTRAIT",
          },
          normalizationApplied: false,
          normalizationVersion: "test-normalizer@1",
          policy: "NONE_ALREADY_COMPATIBLE",
        };
      },
    },
  });
  const args = {
    workspaceId: "workspace",
    brandId: "brand",
    productionId: "production",
    workerId: "worker",
    asset: asset(),
  };

  const first = await executor.materializeAsset(args);
  assert.equal(
    providerCalls,
    0,
    "dependency persistence occurs before any provider boundary",
  );
  const snapshot = first.generation_requirements.v210_reference_evidence;
  assert.equal(snapshot.schemaVersion, "previous-shot-runtime-dependency@1");
  assert.equal(snapshot.resolvedUpstreamAssetId, "shot-a-a2");
  assert.equal(snapshot.sourceArtifactSHA, a2.artifact_content_hash);
  assert.equal(
    snapshot.extractionContractVersion,
    "previous-shot-reference-extractor@1",
  );
  assert.equal(snapshot.timestampMs, 4900);
  assert.ok(snapshot.derivedFrameArtifactId);
  assert.equal(
    snapshot.derivedFrameSHA,
    sha(Buffer.from(`frame:${a2.artifact_content_hash}`)),
  );
  assert.ok(snapshot.runtimeDependencyFingerprint);

  current = a3;
  const restarted = await executor.materializeAsset(args);
  assert.equal(samples, 1, "restart reuses the exact frozen frame");
  assert.equal(
    restarted.generation_requirements.v210_reference_evidence
      .runtimeDependencyFingerprint,
    snapshot.runtimeDependencyFingerprint,
  );
  assert.equal(
    restarted.generation_requirements.v210_reference_evidence.sourceArtifactSHA,
    a2.artifact_content_hash,
    "a later accepted replacement cannot mutate a frozen dependency",
  );

  await executor.execute(args);
  assert.equal(providerCalls, 1);
  assert.equal(
    materializedAsset.generation_requirements.runtime_dependency_snapshot
      .runtimeDependencyFingerprint,
    snapshot.runtimeDependencyFingerprint,
    "V2.5 request identity receives frozen runtime dependency evidence",
  );

  const derivedKey = snapshot.derivedFrameArtifactStorageKey;
  store.values.set(derivedKey, Buffer.from("corrupt"));
  providerCalls = 0;
  await assert.rejects(
    () => executor.execute(args),
    (error) => error.code === "REFERENCE_EVIDENCE_HASH_MISMATCH",
  );
  assert.equal(providerCalls, 0, "corruption blocks before provider boundary");

  const crashStore = storage({ [a2.artifact_storage_key]: a2.bytes });
  let crashOnce = true,
    crashSamples = 0;
  const crashExecutor = new V210ReferenceAwareMediaExecutor({
    delegate: {
      ...delegate,
      repository: {
        async latestSucceededReplacement({ assetId }) {
          return assetId === "shot-a" ? a2 : null;
        },
      },
    },
    storage: crashStore,
    frameSampler: {
      async sample() {
        crashSamples += 1;
        if (crashOnce) {
          crashOnce = false;
          throw new Error("injected before persistence");
        }
        return [
          {
            jpeg: Buffer.from("retry-frame"),
            timestampMs: 4900,
            analysisHash: "retry-analysis",
          },
        ];
      },
    },
    geometryNormalizer: {
      async normalize({ bytes }) {
        return {
          bytes,
          contentType: "image/jpeg",
          before: {},
          after: {},
          normalizationApplied: false,
          normalizationVersion: "test-normalizer@1",
          policy: "NONE_ALREADY_COMPATIBLE",
        };
      },
    },
  });
  await assert.rejects(
    () => crashExecutor.materializeAsset(args),
    /injected before persistence/,
  );
  await crashExecutor.materializeAsset(args);
  assert.equal(
    crashSamples,
    2,
    "failure before snapshot permits safe deterministic re-resolution",
  );

  console.log(
    "V2.10 previous-shot runtime dependency durability tests passed; provider calls = 0",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
