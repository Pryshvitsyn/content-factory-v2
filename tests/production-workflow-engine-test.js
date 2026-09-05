"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const {
  OperationRegistry,
  createCoreOperationRegistry,
} = require("../src/workflow/operation-registry");
const {
  workflowRevision,
  compileV21ExecutionPlan,
  ArtifactWorkflowRevisionStore,
} = require("../src/workflow/workflow-definition");
const {
  referencePackRevision,
  bindContinuityEntities,
} = require("../src/workflow/continuity-entities");
const {
  DurableProductionWorkflowEngine,
} = require("../src/workflow/production-workflow-engine");
const {
  ProviderCompatibleMediaResolver,
} = require("../src/workflow/provider-media-resolver");
const {
  registerVideoModelContract,
} = require("../src/v2.8/video-model-contracts");
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex"),
  registry = createCoreOperationRegistry(),
  workspaceId = "workspace-1",
  brandId = "brand-a",
  PACKS = new Map();
const artifactBytes = (entity, name) =>
  entity === "large"
    ? Buffer.alloc(2 * 1024 * 1024, 7)
    : Buffer.from(`${entity}-${name}`);
function revision(
  workflowType = "GENERIC_BRAND_VIDEO",
  targetAspectRatio = "9:16",
) {
  return workflowRevision(
    {
      workspaceId,
      brandId,
      workflowType,
      revision: 1,
      nodes: [
        {
          id: "generate",
          operationType: "GENERATE_VIDEO",
          contractVersion: "1",
        },
        {
          id: "technical",
          operationType: "TECHNICAL_MEDIA_QA",
          contractVersion: "1",
        },
        { id: "domain", operationType: "DOMAIN_QA", contractVersion: "1" },
        { id: "review", operationType: "APPROVAL_GATE", contractVersion: "1" },
        { id: "compose", operationType: "COMPOSE_VIDEO", contractVersion: "1" },
        { id: "export", operationType: "EXPORT", contractVersion: "1" },
      ],
      edges: [
        { from: "generate", to: "technical" },
        { from: "technical", to: "domain" },
        { from: "domain", to: "review" },
        { from: "review", to: "compose" },
        { from: "compose", to: "export" },
      ],
      configuration: { targetAspectRatio },
      policyVersions: { technicalQa: "BASE_VIDEO_QA@1" },
    },
    registry,
  );
}
function pack({
  entityId,
  type = "SYNTHETIC_CHARACTER",
  owner = brandId,
  visibility = "BRAND_PRIVATE",
  grants = [],
  authorityBinding = null,
  refs = ["REFERENCE_IMAGE"],
  packWorkspace = workspaceId,
} = {}) {
  const value = referencePackRevision({
    workspaceId: packWorkspace,
    ownerBrandId: owner,
    entityId,
    entityType: type,
    revision: 1,
    visibility,
    grantedBrandIds: grants,
    authorityBinding,
    approval: { approved: true },
    references: refs.map((item, index) => {
      const value = typeof item === "string" ? { role: item } : item,
        name = `${value.role.toLowerCase()}-${index}`;
      return {
        role: value.role,
        artifactId: `artifact-${entityId}-${name}`,
        artifactVersion: 1,
        sha256: sha(artifactBytes(entityId, name)),
        mimeType: value.mimeType || "image/png",
        durationSeconds: value.durationSeconds || 0,
      };
    }),
  });
  PACKS.set(value.revisionFingerprint, value);
  return value;
}
function harness({
  live = false,
  materialize = null,
  executionAuthority = null,
  continuityAuthority = null,
} = {}) {
  let calls = 0;
  const value = new DurableProductionWorkflowEngine({
    operationRegistry: registry,
    env: { LIVE_PAID_GENERATION: String(live) },
    executionAuthority: executionAuthority || {
      inspect: async () => ({ approved: true }),
      verify: async () => true,
    },
    continuityAuthority: continuityAuthority || {
      resolve: async ({
        workspaceId: scope,
        consumerBrandId,
        packId,
        fingerprint,
      }) => {
        const p = PACKS.get(fingerprint);
        if (!p || packId !== fingerprint || p.workspaceId !== scope)
          throw Object.assign(new Error("not found"), {
            code: "CONTINUITY_REVISION_NOT_FOUND",
          });
        if (
          p.ownerBrandId !== consumerBrandId &&
          !(
            p.visibility === "WORKSPACE_SHARED_WITH_GRANTS" &&
            p.grantedBrandIds.includes(consumerBrandId)
          )
        )
          throw Object.assign(new Error("denied"), {
            code: "CONTINUITY_BRAND_ACCESS_DENIED",
          });
        return {
          row: { id: fingerprint, owner_brand_id: p.ownerBrandId },
          pack: p,
          references: p.references,
        };
      },
    },
    providerMediaResolver: new ProviderCompatibleMediaResolver({ materialize }),
    artifactResolver: {
      resolve: async ({ brandId: owner, artifactId }) => {
        const match =
            /^artifact-(.+)-(first_frame|last_frame|reference_image|reference_video|reference_audio)-(\d+)$/.exec(
              artifactId,
            ),
          entity = match?.[1] || "unknown",
          name = `${match?.[2] || "reference_image"}-${match?.[3] || 0}`,
          bytes = artifactBytes(entity, name);
        return {
          brandId: owner,
          contentHash: sha(bytes),
          bytes,
          contentType: artifactId.includes("video")
            ? "video/mp4"
            : artifactId.includes("audio")
              ? "audio/wav"
              : "image/png",
        };
      },
    },
    durableMediaExecutor: {
      execute: async (args) => {
        calls++;
        return {
          args,
          artifact: {
            artifactId: "output",
            version: 1,
            contentHash: sha("output"),
          },
          qa: { status: "PASS" },
        };
      },
    },
  });
  return { value, calls: () => calls };
}
function args(rev, bindings, mode = "MULTIMODAL_REFERENCE", patch = {}) {
  const prompt = patch.prompt || "References remain visually consistent",
    requested = (bindings?.bindings || []).map((binding) => ({
      entityId: binding.entityId,
      packId: binding.referencePackFingerprint,
      packFingerprint: binding.referencePackFingerprint,
    }));
  return {
    workflowRevision: rev,
    nodeId: "generate",
    continuityBindings: requested,
    provider: "replicate",
    model: "bytedance/seedance-2.5",
    resolvedInputMode: mode,
    prompt,
    promptRevision: "prompt@1",
    promptHash: sha(prompt),
    settings: {
      duration: 5,
      resolution: "720p",
      generateAudio: false,
      watermark: false,
      outputFormat: "mp4",
      ...(patch.settings || {}),
    },
    maximumCostUsd: 1,
  };
}
async function approved(value, request) {
  const first = await value.preflightGenerateVideo(request),
    approval = {
      workflowFingerprint: request.workflowRevision.workflowFingerprint,
      operationNodeId: request.nodeId,
      requestFingerprint: first.requestFingerprint,
      modelContractVersion: first.modelContractVersion,
      unknownPriceAcknowledged: true,
    };
  const complete = { ...request, approval };
  return {
    preflight: await value.preflightGenerateVideo(complete),
    request: complete,
  };
}
test("caller approval cannot replace injected durable execution authority", async () => {
  const bindings = bindContinuityEntities({
      workspaceId,
      brandId,
      bindings: [{ nodeId: "generate", pack: pack({ entityId: "forged" }) }],
    }),
    h = harness({
      live: true,
      executionAuthority: { inspect: async () => ({ approved: false }) },
    }),
    request = { ...args(revision(), bindings), approval: { approved: true } };
  const preflight = await h.value.preflightGenerateVideo(request);
  assert(preflight.blockers.includes("DURABLE_EXECUTION_APPROVAL_REQUIRED"));
  await assert.rejects(
    h.value.executeGenerateVideo({
      approvedPreflight: { ...preflight, startable: true, blockers: [] },
      request,
      execution: { assetId: "video", productionId: "p", workerId: "w" },
    }),
    (e) => e.code === "EXECUTION_AUTHORITY_REQUIRED",
  );
  assert.equal(h.calls(), 0);
});
test("workflow revision is deeply immutable and compiles only to existing V2.1/V2.5 executors", async () => {
  const rev = revision(),
    compiled = compileV21ExecutionPlan(rev);
  assert(Object.isFrozen(rev.nodes[0]));
  assert.equal(compiled.compatibilityBoundary, "V2.1");
  assert.equal(compiled.stages[0].executorId, "V25_DURABLE_MEDIA");
  let writes = 0;
  const store = new ArtifactWorkflowRevisionStore({
    artifactService: { createVersion: async (x) => (writes++, x) },
  });
  assert.equal(
    (await store.save(rev)).idempotencyKey,
    (await store.save(rev)).idempotencyKey,
  );
  assert.equal(writes, 2);
});
test("approval-critical workflow and ordered reference changes alter fingerprints", () => {
  const original = revision(),
    changed = revision("LANDSCAPE", "16:9");
  assert.notEqual(original.workflowFingerprint, changed.workflowFingerprint);
  const one = pack({
      entityId: "hero",
      refs: ["REFERENCE_IMAGE", "REFERENCE_IMAGE"],
    }),
    two = referencePackRevision({
      workspaceId,
      ownerBrandId: brandId,
      entityId: "hero",
      entityType: "SYNTHETIC_CHARACTER",
      revision: 1,
      approval: { approved: true },
      references: [...one.references].reverse().map(({ order, ...ref }) => ref),
    });
  assert.notEqual(one.revisionFingerprint, two.revisionFingerprint);
  assert.throws(() => {
    one.references[0].sha256 = "bad";
  }, TypeError);
});
test("domain operation registration does not change the generic executor", () => {
  const custom = new OperationRegistry();
  custom.register({
    operationType: "SPHERE_GEOMETRY_QA",
    contractVersion: "1",
    executorId: "SPHERE_DOMAIN_PACK",
    sideEffectClass: "PURE",
    costClass: "NONE",
    retryPolicy: "SAFE",
    idempotencyPolicy: "INPUT_FINGERPRINT",
  });
  assert.equal(
    compileV21ExecutionPlan(
      workflowRevision(
        {
          workspaceId,
          brandId,
          workflowType: "SPHERE",
          revision: 1,
          nodes: [
            {
              id: "qa",
              operationType: "SPHERE_GEOMETRY_QA",
              contractVersion: "1",
            },
          ],
          edges: [],
        },
        custom,
      ),
    ).stages[0].executorId,
    "SPHERE_DOMAIN_PACK",
  );
});
test("all six Seedance modes compile roles end-to-end without provider calls", async () => {
  const cases = [
    ["TEXT_TO_VIDEO", []],
    ["FIRST_FRAME_IMAGE_TO_VIDEO", ["FIRST_FRAME"]],
    ["FIRST_LAST_FRAME", ["FIRST_FRAME", "LAST_FRAME"]],
    [
      "MULTIMODAL_REFERENCE",
      [
        "REFERENCE_IMAGE",
        { role: "REFERENCE_VIDEO", mimeType: "video/mp4", durationSeconds: 5 },
        { role: "REFERENCE_AUDIO", mimeType: "audio/wav", durationSeconds: 5 },
      ],
    ],
    [
      "VIDEO_EDITING",
      [{ role: "REFERENCE_VIDEO", mimeType: "video/mp4", durationSeconds: 5 }],
    ],
    [
      "VIDEO_EXTENSION",
      [{ role: "REFERENCE_VIDEO", mimeType: "video/mp4", durationSeconds: 5 }],
    ],
  ];
  for (const [mode, refs] of cases) {
    const h = harness(),
      bindings = bindContinuityEntities({
        workspaceId,
        brandId,
        bindings: refs.length
          ? [
              {
                nodeId: "generate",
                pack: pack({ entityId: mode.toLowerCase(), refs }),
              },
            ]
          : [],
      }),
      request = args(revision(), bindings, mode, {
        settings: [
          "FIRST_LAST_FRAME",
          "VIDEO_EDITING",
          "VIDEO_EXTENSION",
        ].includes(mode)
          ? { duration: mode === "FIRST_LAST_FRAME" ? 5 : -1 }
          : {},
      }),
      result = await approved(h.value, request);
    assert(result.preflight.providerPayloadFields.length > 0);
    assert.equal(
      result.preflight.settings.aspectRatio,
      ["FIRST_LAST_FRAME", "VIDEO_EDITING", "VIDEO_EXTENSION"].includes(mode)
        ? "adaptive"
        : "9:16",
    );
    assert.equal(h.calls(), 0);
  }
});
test("invalid, duplicate, extra, and media-mismatched special roles fail closed", async () => {
  const h = harness(),
    missing = bindContinuityEntities({ workspaceId, brandId, bindings: [] }),
    duplicate = bindContinuityEntities({
      workspaceId,
      brandId,
      bindings: [
        {
          nodeId: "generate",
          pack: pack({ entityId: "dup", refs: ["FIRST_FRAME", "FIRST_FRAME"] }),
        },
      ],
    }),
    extra = bindContinuityEntities({
      workspaceId,
      brandId,
      bindings: [
        {
          nodeId: "generate",
          pack: pack({
            entityId: "extra",
            refs: ["FIRST_FRAME", "REFERENCE_IMAGE"],
          }),
        },
      ],
    }),
    wrongMedia = bindContinuityEntities({
      workspaceId,
      brandId,
      bindings: [
        {
          nodeId: "generate",
          pack: pack({
            entityId: "wrong",
            refs: [{ role: "FIRST_FRAME", mimeType: "audio/wav" }],
          }),
        },
      ],
    });
  await assert.rejects(
    h.value.preflightGenerateVideo(
      args(revision(), missing, "FIRST_FRAME_IMAGE_TO_VIDEO"),
    ),
    (e) => e.code === "REFERENCE_ROLE_REQUIRED",
  );
  await assert.rejects(
    h.value.preflightGenerateVideo(
      args(revision(), duplicate, "FIRST_FRAME_IMAGE_TO_VIDEO"),
    ),
    (e) => e.code === "DUPLICATE_REFERENCE_ROLE",
  );
  await assert.rejects(
    h.value.preflightGenerateVideo(
      args(revision(), extra, "FIRST_FRAME_IMAGE_TO_VIDEO"),
    ),
    (e) => e.code === "REFERENCE_ROLE_UNSUPPORTED",
  );
  await assert.rejects(
    h.value.preflightGenerateVideo(
      args(revision(), wrongMedia, "FIRST_FRAME_IMAGE_TO_VIDEO"),
    ),
    (e) => e.code === "REFERENCE_ROLE_MEDIA_TYPE_MISMATCH",
  );
});
test("large references use provider materialization and retain exact lineage evidence", async () => {
  let materialized = 0;
  const h = harness({
      materialize: async (input) => (
        materialized++,
        {
          providerValue: { localBuffer: input.bytes },
          evidence: { method: "SDK_LOCAL_BUFFER" },
        }
      ),
    }),
    bindings = bindContinuityEntities({
      workspaceId,
      brandId,
      bindings: [
        {
          nodeId: "generate",
          pack: pack({ entityId: "large", refs: ["REFERENCE_IMAGE"] }),
        },
      ],
    });
  const result = await h.value.preflightGenerateVideo(
    args(revision(), bindings),
  );
  assert.equal(materialized, 1);
  assert.equal(result.orderedInputs[0].byteSize, 2 * 1024 * 1024);
  assert.equal(result.orderedInputs[0].resolution.method, "SDK_LOCAL_BUFFER");
  assert.equal(
    result.orderedInputs[0].sha256,
    bindings.bindings[0].references[0].sha256,
  );
});
test("cross-brand access is resolved by injected authority and forged grant evidence is ignored", async () => {
  const privatePack = pack({ entityId: "private" }),
    h = harness();
  await assert.rejects(
    h.value.resolveReferences({
      workspaceId,
      brandId: "brand-b",
      continuityBindings: [
        {
          entityId: "private",
          packId: privatePack.revisionFingerprint,
          packFingerprint: privatePack.revisionFingerprint,
          grantEvidence: { approved: true },
        },
      ],
      provider: "replicate",
      model: "bytedance/seedance-2.5",
    }),
    (e) => e.code === "CONTINUITY_BRAND_ACCESS_DENIED",
  );
  const shared = pack({
    entityId: "shared",
    visibility: "WORKSPACE_SHARED_WITH_GRANTS",
    grants: ["brand-b"],
  });
  assert.equal(
    (
      await h.value.resolveReferences({
        workspaceId,
        brandId: "brand-b",
        continuityBindings: [
          {
            entityId: "shared",
            packId: shared.revisionFingerprint,
            packFingerprint: shared.revisionFingerprint,
          },
        ],
        provider: "replicate",
        model: "bytedance/seedance-2.5",
      })
    ).length,
    1,
  );
});
test("REAL_PERSON requires immutable Avatar Studio authority while synthetic entities do not", () => {
  assert.throws(
    () =>
      pack({
        entityId: "person",
        type: "REAL_PERSON",
        authorityBinding: { authority: "AVATAR_STUDIO", avatarId: "a" },
      }),
    (e) => e.code === "AVATAR_AUTHORITY_BINDING_REQUIRED",
  );
  const person = pack({
    entityId: "person",
    type: "REAL_PERSON",
    authorityBinding: {
      authority: "AVATAR_STUDIO",
      avatarId: "a",
      identityVersionId: "v",
      identityLockId: "l",
      certifiedReferenceFingerprint: "f",
    },
  });
  assert.equal(person.authorityBinding.identityLockId, "l");
  assert.equal(pack({ entityId: "synthetic" }).authorityBinding, null);
});
test("unknown Seedance price permits zero-call review but never becomes startable", async () => {
  const h = harness(),
    bindings = bindContinuityEntities({
      workspaceId,
      brandId,
      bindings: [{ nodeId: "generate", pack: pack({ entityId: "hero" }) }],
    }),
    result = await approved(h.value, args(revision(), bindings));
  assert(result.preflight.blockers.includes("PRICE_NOT_VERIFIABLE"));
  assert.equal(result.preflight.startable, false);
  await assert.rejects(
    h.value.executeGenerateVideo({
      approvedPreflight: { ...result.preflight, startable: true },
      request: result.request,
      execution: { assetId: "video", productionId: "p", workerId: "w" },
    }),
    (e) => e.code === "GENERATION_PREFLIGHT_BLOCKED",
  );
  assert.equal(h.calls(), 0);
});
test("approved request A cannot execute request B or a fabricated preflight", async () => {
  const h = harness({ live: true }),
    bindings = bindContinuityEntities({
      workspaceId,
      brandId,
      bindings: [{ nodeId: "generate", pack: pack({ entityId: "hero" }) }],
    }),
    result = await approved(h.value, args(revision(), bindings));
  const changed = {
    ...result.request,
    prompt: "different",
    promptHash: sha("different"),
  };
  await assert.rejects(
    h.value.executeGenerateVideo({
      approvedPreflight: { ...result.preflight, startable: true, blockers: [] },
      request: changed,
      execution: { assetId: "video", productionId: "p", workerId: "w" },
    }),
    (e) =>
      [
        "EXECUTION_REQUEST_FINGERPRINT_MISMATCH",
        "REQUEST_APPROVAL_STALE",
      ].includes(e.code),
  );
  await assert.rejects(
    h.value.executeGenerateVideo({
      approvedPreflight: {
        preflightFingerprint: "fake",
        requestFingerprint: "fake",
        startable: true,
      },
      request: result.request,
      execution: { assetId: "video", productionId: "p", workerId: "w" },
    }),
    (e) => e.code === "EXECUTION_REQUEST_FINGERPRINT_MISMATCH",
  );
  assert.equal(h.calls(), 0);
});
test("approved workflow compiles through the V2.5 boundary to immutable output and QA", async () => {
  const model = `test/runtime-${Date.now()}`;
  registerVideoModelContract({
    provider: "replicate",
    model,
    contractVersion: "runtime@1",
    providerFields: [
      "prompt",
      "reference_images",
      "duration",
      "resolution",
      "aspect_ratio",
      "generate_audio",
      "watermark",
      "output_format",
    ],
    inputModes: ["MULTIMODAL_REFERENCE"],
    capabilities: ["MULTIMODAL_REFERENCE"],
    parameters: {
      duration: { contentFactoryDefault: 5 },
      resolution: { contentFactoryDefault: "720p" },
      aspectRatio: { values: ["9:16"], contentFactoryDefault: "9:16" },
      generateAudio: { contentFactoryDefault: false },
      watermark: { contentFactoryDefault: false },
      outputFormat: { contentFactoryDefault: "mp4" },
    },
    limits: {},
    provenance: { providerSchemaVersion: "test-schema" },
    output: {},
    pricing: { status: "VERIFIED", amountUsd: 0.01 },
    technicalQa: {},
    workflowCompatibility: {},
    validate() {},
    mapRequest(request) {
      return {
        prompt: request.prompt,
        reference_images: request.referenceImages.map((x) => x.providerValue),
        duration: request.duration,
        resolution: request.resolution,
        aspect_ratio: request.aspectRatio,
        generate_audio: request.generateAudio,
        watermark: request.watermark,
        output_format: request.outputFormat,
      };
    },
  });
  const h = harness({ live: true }),
    bindings = bindContinuityEntities({
      workspaceId,
      brandId,
      bindings: [{ nodeId: "generate", pack: pack({ entityId: "runtime" }) }],
    }),
    prompt = "Runtime proof",
    base = {
      ...args(revision(), bindings),
      model,
      prompt,
      promptHash: sha(prompt),
    },
    result = await approved(h.value, base),
    output = await h.value.executeGenerateVideo({
      approvedPreflight: result.preflight,
      request: result.request,
      execution: {
        assetId: "video-1",
        productionId: "production-1",
        workerId: "worker-1",
      },
    });
  assert.equal(result.preflight.startable, true);
  assert.equal(
    output.args.asset.generation_requirements.request_fingerprint,
    result.preflight.requestFingerprint,
  );
  assert.equal(output.artifact.version, 1);
  assert.equal(output.qa.status, "PASS");
  assert.equal(
    h.calls(),
    1,
    "the only boundary is the injected V2.5 durable executor",
  );
});
