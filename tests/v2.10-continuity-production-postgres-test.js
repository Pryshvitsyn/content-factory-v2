"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const { Pool } = require("pg");
const {
  ContinuityAuthorityRepository,
} = require("../src/workflow/continuity-authority-repository");
const { ProviderCatalog } = require("../src/v2.8/provider-catalog");
const {
  buildCanonicalV210Input,
  resolveAuthoritativeVideo,
} = require("../src/v2.10/runtime-integration");

const WORKSPACE_ID = "52000000-0000-4000-8000-000000000001";
const OWNER_BRAND_ID = "52000000-0000-4000-8000-000000000011";
const CONSUMER_BRAND_ID = "52000000-0000-4000-8000-000000000012";
const OTHER_CONSUMER_BRAND_ID = "52000000-0000-4000-8000-000000000013";
const OTHER_WORKSPACE_ID = "52000000-0000-4000-8000-000000000002";
const OTHER_OWNER_BRAND_ID = "52000000-0000-4000-8000-000000000014";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  async exists({ key }) {
    return this.values.has(key);
  }

  async put({ key, bytes }) {
    if (this.values.has(key)) {
      const error = new Error("exists");
      error.code = "EEXIST";
      throw error;
    }
    this.values.set(key, Buffer.from(bytes));
    return { key, size: bytes.length };
  }

  async get({ key }) {
    return this.values.get(key);
  }
}

function requireDisposableDatabase() {
  if (
    process.env.CONTENT_FACTORY_TEST_DATABASE !== "1" ||
    new URL(process.env.DATABASE_URL).pathname.slice(1) === "content_os"
  ) {
    throw new Error("disposable DB required");
  }
}

function brief() {
  const shot = (id, roles) => ({
    shotId: id,
    assetId: `asset-${id}`,
    durationSeconds: 5,
    roles,
    purpose: "Advance exact beat",
    subject: "Synthetic Hero A",
    action: "Performs a restrained motion",
    environment: "Warm studio",
    emotionalIntent: "Calm",
    framing: "Vertical medium",
    camera: "Stable slow move",
    lensComposition: "Centered natural",
    lighting: "Warm soft light",
    continuity: "Same hero",
    negativeGuidance: ["text"],
    referencePolicy: "NONE",
    voiceoverSegment: "",
  });
  return {
    title: "Hero campaign",
    objective: "Reuse exact hero",
    targetPlatform: "Reels",
    targetDurationSeconds: 10,
    hook: "Exact hook",
    coreMessage: "Exact continuity",
    cta: "Continue",
    audienceIntent: "Campaign audience",
    creativeConcept: "Two connected beats",
    visualStyle: "Clean realism",
    storyboard: [
      shot("one", ["HOOK", "TENSION", "INSIGHT"]),
      shot("two", ["ACTION", "RESOLUTION", "CTA"]),
    ],
    continuity: {
      identity: "Hero A",
      appearance: "Exact design",
      wardrobe: "Neutral suit",
      environment: "Studio",
      props: "One prop",
      lightingColorLanguage: "Warm",
      cameraLanguage: "Stable",
      referencePolicy: "NONE",
    },
    voice: { sourceType: null, approved: false },
    postProduction: { endTitle: { enabled: false } },
    publicationPolicy: { humanApprovalRequired: true, autoPublish: false },
  };
}

async function main() {
  requireDisposableDatabase();
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const storage = new MemoryStorage();
  try {
    await db.query(
      "DROP SCHEMA IF EXISTS workflow_authority CASCADE; DROP SCHEMA IF EXISTS v2_2 CASCADE; DROP TABLE IF EXISTS workspaces CASCADE",
    );
    await db.query(
      "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE TABLE workspaces(id uuid PRIMARY KEY, name text); CREATE SCHEMA v2_2; CREATE TABLE v2_2.brands(id uuid PRIMARY KEY, workspace_id uuid REFERENCES workspaces(id), name text)",
    );
    await db.query("INSERT INTO workspaces VALUES($1, $2), ($3, $4)", [
      WORKSPACE_ID,
      "w",
      OTHER_WORKSPACE_ID,
      "other-w",
    ]);
    await db.query(
      "INSERT INTO v2_2.brands VALUES($1, $2, $3), ($4, $2, $5), ($6, $2, $7), ($8, $9, $10)",
      [
        OWNER_BRAND_ID,
        WORKSPACE_ID,
        "a",
        CONSUMER_BRAND_ID,
        "b",
        OTHER_CONSUMER_BRAND_ID,
        "c",
        OTHER_OWNER_BRAND_ID,
        OTHER_WORKSPACE_ID,
        "other-owner",
      ],
    );
    const sql = await fs.readFile(
      "migrations/20260905_production_continuity_authority.sql",
      "utf8",
    );
    await db.query(sql);

    const bytes = Buffer.from("hero-reference");
    await storage.put({ key: "refs/hero.png", bytes });
    let avatarValid = false;
    let avatarChecks = 0;
    const repo = new ContinuityAuthorityRepository({
      db,
      storage,
      avatarAuthorityResolver: {
        async verify() {
          avatarChecks += 1;
          return {
            identityCurrent: avatarValid,
            identityLockCurrent: avatarValid,
            consentValid: avatarValid,
          };
        },
      },
    });
    const base = {
      workspaceId: WORKSPACE_ID,
      ownerBrandId: OWNER_BRAND_ID,
      entityId: "hero-a",
      entityType: "SYNTHETIC_CHARACTER",
      revision: 3,
      visibility: "WORKSPACE_SHARED_WITH_GRANTS",
      approval: { approved: true },
      references: [
        {
          role: "REFERENCE_IMAGE",
          artifactId: "hero-image",
          artifactVersion: 7,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          mimeType: "image/png",
          storageKey: "refs/hero.png",
        },
      ],
    };
    const saved = await repo.savePack(base, "owner");
    await repo.savePack(
      {
        ...base,
        entityId: "private-hero-a",
        revision: 1,
        visibility: "BRAND_PRIVATE",
      },
      "owner",
    );
    await repo.savePack(
      {
        ...base,
        entityId: "product-x",
        entityType: "OBJECT_PRODUCT",
        revision: 1,
      },
      "owner",
    );
    await repo.savePack({ ...base, revision: 2 }, "owner");
    await repo.savePack(
      {
        ...base,
        workspaceId: OTHER_WORKSPACE_ID,
        ownerBrandId: OTHER_OWNER_BRAND_ID,
        entityId: "other-workspace",
        revision: 1,
      },
      "other-owner",
    );
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
          packId: saved.row.id,
          packFingerprint: saved.pack.revisionFingerprint,
        },
      ],
    };
    const catalog = new ProviderCatalog({
      env: { REPLICATE_API_TOKEN: "fixture" },
    });
    const resolve = () =>
      resolveAuthoritativeVideo({
        catalog,
        workspaceId: WORKSPACE_ID,
        brandId: CONSUMER_BRAND_ID,
        request: selection,
        brief: brief(),
        continuityAuthority: repo,
      });

    assert.equal((await resolve()).continuityAuthorityStatus, "BLOCKED");
    assert.deepEqual(
      await repo.listAccessible({
        workspaceId: WORKSPACE_ID,
        consumerBrandId: CONSUMER_BRAND_ID,
      }),
      [],
      "foreign ungranted packs are absent rather than disclosed as blocked metadata",
    );
    assert.deepEqual(
      await repo.listAccessible({
        workspaceId: WORKSPACE_ID,
        consumerBrandId: OTHER_CONSUMER_BRAND_ID,
      }),
      [],
      "another consumer cannot inherit Brand B authority",
    );
    await repo.grant({
      workspaceId: WORKSPACE_ID,
      ownerBrandId: OWNER_BRAND_ID,
      consumerBrandId: CONSUMER_BRAND_ID,
      packId: saved.row.id,
      packFingerprint: saved.pack.revisionFingerprint,
      decision: "GRANTED",
      actor: "owner",
      reason: "campaign",
    });
    const allowed = await resolve();
    assert.equal(allowed.continuityAuthorityStatus, "READY");
    assert.equal(
      (
        await repo.listAccessible({
          workspaceId: WORKSPACE_ID,
          consumerBrandId: CONSUMER_BRAND_ID,
        })
      )[0].authorityStatus,
      "READY",
    );
    assert.deepEqual(
      (
        await repo.listAccessible({
          workspaceId: WORKSPACE_ID,
          consumerBrandId: CONSUMER_BRAND_ID,
        })
      ).map((item) => [item.entityId, item.revision]),
      [["hero-a", 3]],
      "an exact-pack grant reveals only the granted revision",
    );
    const historical = buildCanonicalV210Input({
      draft: {
        id: "52000000-0000-4000-8000-000000000021",
        workspace_id: WORKSPACE_ID,
        brand_id: CONSUMER_BRAND_ID,
        creative_brief: brief(),
      },
      preflight: { authoritativeVideo: allowed, quality: {} },
    });
    assert.equal(
      historical.input.assetPlan.assets[0].generation_requirements
        .v210_continuity_bindings[0].packRevision,
      3,
    );
    await repo.grant({
      workspaceId: WORKSPACE_ID,
      ownerBrandId: OWNER_BRAND_ID,
      consumerBrandId: CONSUMER_BRAND_ID,
      packId: saved.row.id,
      packFingerprint: saved.pack.revisionFingerprint,
      decision: "REVOKED",
      actor: "owner",
      reason: "ended",
    });
    assert.equal((await resolve()).continuityAuthorityStatus, "BLOCKED");
    assert.deepEqual(
      await repo.listAccessible({
        workspaceId: WORKSPACE_ID,
        consumerBrandId: CONSUMER_BRAND_ID,
      }),
      [],
      "revoked packs disappear from the consumer namespace",
    );
    assert.equal(
      (
        await repo.listAccessible({
          workspaceId: WORKSPACE_ID,
          consumerBrandId: OWNER_BRAND_ID,
        })
      ).length,
      4,
      "owners retain visibility of their own packs",
    );
    assert.equal(
      historical.input.assetPlan.assets[0].generation_requirements
        .v210_continuity_bindings[0].packRevision,
      3,
    );

    const real = await repo.savePack(
      {
        ...base,
        entityId: "person",
        entityType: "REAL_PERSON",
        revision: 1,
        authorityBinding: {
          authority: "AVATAR_STUDIO",
          avatarId: "avatar",
          identityVersionId: "identity",
          identityLockId: "lock",
        },
      },
      "owner",
    );
    await assert.rejects(
      () =>
        repo.load({
          workspaceId: WORKSPACE_ID,
          consumerBrandId: OWNER_BRAND_ID,
          packId: real.row.id,
          fingerprint: real.pack.revisionFingerprint,
        }),
      (error) => error.code === "AVATAR_AUTHORITY_INVALID",
    );
    avatarValid = true;
    assert.equal(
      (
        await repo.load({
          workspaceId: WORKSPACE_ID,
          consumerBrandId: OWNER_BRAND_ID,
          packId: real.row.id,
          fingerprint: real.pack.revisionFingerprint,
        })
      ).pack.entityType,
      "REAL_PERSON",
    );
    assert.equal(avatarChecks, 2);
    console.log(
      "V2.10 PostgreSQL continuity production: deny/grant/revoke, immutable historical evidence, exact pack, and REAL_PERSON resolver passed.",
    );
  } finally {
    await db
      .query("DROP SCHEMA IF EXISTS workflow_authority CASCADE")
      .catch(() => {});
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
