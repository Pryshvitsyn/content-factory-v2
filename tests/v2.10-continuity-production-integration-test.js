"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { ProviderCatalog } = require("../src/v2.8/provider-catalog");
const {
  resolveAuthoritativeVideo,
  buildCanonicalV210Input,
} = require("../src/v2.10/runtime-integration");
const {
  V210ReferenceAwareMediaExecutor,
} = require("../src/v2.10/reference-aware-media");
const { fromAsset } = require("../src/v2.8/canonical-media-request");
const {
  ReplicateUniversalVideoAdapter,
} = require("../src/providers/replicate-universal-video-adapter");
const {
  AvatarStudioContinuityAuthorityResolver,
} = require("../src/workflow/continuity-authority-repository");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const WORKSPACE = "51000000-0000-4000-8000-000000000001",
  BRAND = "51000000-0000-4000-8000-000000000011";
function shot(id) {
  return {
    shotId: id,
    assetId: `asset-${id}`,
    durationSeconds: 5,
    roles:
      id === "one"
        ? ["HOOK", "TENSION", "INSIGHT"]
        : ["ACTION", "RESOLUTION", "CTA"],
    purpose: "Advance an exact campaign beat",
    subject: "Synthetic Hero A in a precise studio",
    action: "Hero performs one restrained visible motion",
    environment: "Warm controlled studio",
    emotionalIntent: "Calm confidence",
    framing: "Vertical medium shot",
    camera: "Slow stable camera",
    lensComposition: "Natural centered composition",
    lighting: "Warm soft key",
    continuity: "Same synthetic hero and design",
    negativeGuidance: ["text"],
    referencePolicy: "NONE",
    voiceoverSegment: "",
  };
}
function brief() {
  return {
    title: "Synthetic hero reuse",
    objective: "Demonstrate durable continuity",
    targetPlatform: "Reels",
    targetDurationSeconds: 10,
    hook: "A precise opening",
    coreMessage: "The same hero persists",
    cta: "Continue",
    audienceIntent: "Product audience",
    creativeConcept: "Two connected visual beats",
    visualStyle: "Clean cinematic realism",
    storyboard: [shot("one"), shot("two")],
    continuity: {
      identity: "Synthetic Hero A",
      appearance: "Exact approved design",
      wardrobe: "Exact neutral suit",
      environment: "Warm studio",
      props: "One approved prop",
      lightingColorLanguage: "Warm neutral",
      cameraLanguage: "Stable vertical",
      referencePolicy: "NONE",
    },
    voice: { sourceType: null, approved: false },
    postProduction: { endTitle: { enabled: false } },
    publicationPolicy: { humanApprovalRequired: true, autoPublish: false },
  };
}
function response(value, type = "application/json") {
  return new Response(
    type === "application/json" ? JSON.stringify(value) : value,
    { status: 200, headers: { "content-type": type } },
  );
}
async function main() {
  let avatarLookup;
  const avatarAuthority = new AvatarStudioContinuityAuthorityResolver({
    repository: {
      async getCharacter(args) {
        avatarLookup = args;
        return {
          workspaceId: WORKSPACE,
          vertical: "beauty",
          identityVersionId: "identity-v3",
          identityLocks: [{ id: "lock-v3" }],
          consent: {
            modality: "FACE",
            status: "APPROVED",
            allowedBrandIds: [BRAND],
            allowedVerticals: ["beauty"],
            allowedUseTypes: ["VIDEO_PRODUCTION"],
          },
        };
      },
    },
  });
  assert.deepEqual(
    await avatarAuthority.verify({
      workspaceId: WORKSPACE,
      ownerBrandId: "owner-brand",
      brandId: BRAND,
      authorityBinding: {
        avatarId: "avatar-v3",
        identityVersionId: "identity-v3",
        identityLockId: "lock-v3",
        vertical: "beauty",
        useType: "VIDEO_PRODUCTION",
      },
    }),
    { identityCurrent: true, identityLockCurrent: true, consentValid: true },
  );
  assert.deepEqual(avatarLookup, {
    id: "avatar-v3",
    brandId: "owner-brand",
  });
  assert.equal(
    (
      await avatarAuthority.verify({
        workspaceId: WORKSPACE,
        ownerBrandId: "owner-brand",
        brandId: "unapproved-consumer",
        authorityBinding: {
          avatarId: "avatar-v3",
          identityVersionId: "identity-v3",
          identityLockId: "lock-v3",
          vertical: "beauty",
          useType: "VIDEO_PRODUCTION",
        },
      })
    ).consentValid,
    false,
  );
  const image = Buffer.from("image"),
    video = Buffer.from("video"),
    audio = Buffer.from("audio");
  const references = [
    {
      role: "REFERENCE_IMAGE",
      artifactId: "hero-image",
      artifactVersion: 3,
      sha256: sha(image),
      mimeType: "image/png",
      storageKey: "hero/image",
    },
    {
      role: "REFERENCE_VIDEO",
      artifactId: "hero-video",
      artifactVersion: 3,
      sha256: sha(video),
      mimeType: "video/mp4",
      storageKey: "hero/video",
    },
    {
      role: "REFERENCE_AUDIO",
      artifactId: "hero-audio",
      artifactVersion: 3,
      sha256: sha(audio),
      mimeType: "audio/wav",
      storageKey: "hero/audio",
    },
  ];
  let resolutions = 0;
  const authority = {
    async resolve() {
      resolutions++;
      return {
        row: { owner_brand_id: BRAND },
        pack: {
          entityId: "hero-a",
          revision: 3,
          entityType: "SYNTHETIC_CHARACTER",
          authorityBinding: null,
        },
        references,
      };
    },
  };
  const selection = {
    provider: "replicate",
    model: "bytedance/seedance-2.5",
    profile: "STANDARD",
    modelRequest: {
      resolvedInputMode: "MULTIMODAL_REFERENCE",
      durationSeconds: 5,
      resolution: "720p",
      aspectRatio: "9:16",
      generateAudio: false,
      watermark: false,
      outputFormat: "mp4",
    },
    continuityBindings: [
      {
        shotId: "one",
        entityId: "hero-a",
        packId: "pack-3",
        packFingerprint: "pack-fingerprint",
      },
      {
        shotId: "two",
        entityId: "hero-a",
        packId: "pack-3",
        packFingerprint: "pack-fingerprint",
      },
    ],
  };
  const catalog = new ProviderCatalog({
    env: { REPLICATE_API_TOKEN: "fixture" },
  });
  const authoritative = await resolveAuthoritativeVideo({
    catalog,
    workspaceId: WORKSPACE,
    brandId: BRAND,
    request: selection,
    brief: brief(),
    continuityAuthority: authority,
  });
  assert.equal(authoritative.continuityAuthorityStatus, "READY");
  assert.equal(resolutions, 2);
  for (const [index, productionId] of [
    "production-1",
    "production-2",
  ].entries()) {
    const canonical = buildCanonicalV210Input({
      draft: {
        id: `51000000-0000-4000-8000-00000000002${index}`,
        workspace_id: WORKSPACE,
        brand_id: BRAND,
        creative_brief: brief(),
      },
      preflight: { authoritativeVideo: authoritative, quality: {} },
    });
    for (const asset of canonical.input.assetPlan.assets.filter(
      (x) => x.kind === "video",
    )) {
      assert.equal(
        asset.generation_requirements.v210_continuity_binding.packRevision,
        3,
      );
      assert.deepEqual(
        asset.generation_requirements.v210_continuity_binding.references.map(
          (x) => x.sha256,
        ),
        references.map((x) => x.sha256),
      );
    }
    if (productionId === "production-1") {
      let materialized;
      const delegate = {
        mediaInspector: {},
        repository: { async latestSucceededReplacement() { return null; } },
        async execute(args) {
          materialized = args.asset;
          return { provider: "fixture", model: "fixture" };
        },
      };
      const executor = new V210ReferenceAwareMediaExecutor({
        delegate,
        continuityAuthority: authority,
        storage: {
          async get({ key }) {
            return {
              "hero/image": image,
              "hero/video": video,
              "hero/audio": audio,
            }[key];
          },
        },
      });
      await executor.execute({
        workspaceId: WORKSPACE,
        brandId: BRAND,
        productionId,
        asset: canonical.input.assetPlan.assets[0],
      });
      const request = fromAsset(materialized);
      assert.equal(request.resolvedInputMode, "MULTIMODAL_REFERENCE");
      assert.deepEqual(
        request.modelContractRequest.providerInput.reference_images.length,
        1,
      );
      assert.deepEqual(
        request.modelContractRequest.providerInput.reference_videos.length,
        1,
      );
      assert.deepEqual(
        request.modelContractRequest.providerInput.reference_audios.length,
        1,
      );
      let payload;
      const adapter = new ReplicateUniversalVideoAdapter({
        family: "MODEL_CONTRACT",
        model: "bytedance/seedance-2.5",
        modelContract: require("../src/v2.8/video-model-contracts").SEEDANCE_25,
        apiToken: "fixture",
        pollIntervalMs: 1,
        sleep: async () => {},
        fetchImpl: async (url, options = {}) => {
          if (url.includes("/predictions")) {
            payload = JSON.parse(options.body);
            return response({
              id: "prediction",
              status: "succeeded",
              output: "https://replicate.delivery/output.mp4",
            });
          }
          return response(Buffer.from("mp4"), "video/mp4");
        },
      });
      await adapter.generate({
        capability: "video-generation",
        model: "bytedance/seedance-2.5",
        canonicalRequest: request,
      });
      assert.deepEqual(
        Object.keys(payload.input).filter((k) => k.startsWith("reference_")),
        ["reference_images", "reference_videos", "reference_audios"],
      );
    }
  }
  console.log(
    "V2.10 durable continuity pack reuse, ordered multimodal materialization, canonical request and mocked provider payload passed; provider calls = 0 real.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
