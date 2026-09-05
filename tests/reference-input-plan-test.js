"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compileReferenceInputPlan,
  ReferenceInputPlanError,
} = require("../src/workflow/reference-input-plan");

const image = (name, role = "REFERENCE_IMAGE", patch = {}) => ({
  role,
  sourceType: "CONTINUITY_ENTITY",
  entityId: name,
  entityRevision: 1,
  packId: `pack-${name}`,
  packFingerprint: `fp-${name}`,
  artifactId: `artifact-${name}`,
  artifactVersion: 1,
  sha256: `sha-${name}`,
  mimeType: "image/png",
  ...patch,
});

test("multiple entities preserve approved order and fingerprint every immutable input", () => {
  const a = image("hero"),
    b = image("product"),
    base = compileReferenceInputPlan({
      resolvedInputMode: "MULTIMODAL_REFERENCE",
      references: [a, b],
    });
  assert.deepEqual(
    base.orderedReferences.map((item) => item.entityId),
    ["hero", "product"],
  );
  assert.equal(
    base.fingerprint,
    compileReferenceInputPlan({
      resolvedInputMode: "MULTIMODAL_REFERENCE",
      references: [a, b],
    }).fingerprint,
  );
  for (const changed of [
    [b, a],
    [a, { ...b, entityRevision: 2 }],
    [a, { ...b, packFingerprint: "other" }],
    [a, { ...b, artifactId: "other" }],
    [a, { ...b, artifactVersion: 2 }],
    [a, { ...b, sha256: "other" }],
    [a, { ...b, role: "REFERENCE_VIDEO", mimeType: "video/mp4" }],
  ])
    assert.notEqual(
      base.fingerprint,
      compileReferenceInputPlan({
        resolvedInputMode: "MULTIMODAL_REFERENCE",
        references: changed,
      }).fingerprint,
    );
});

test("continuity, previous-shot and locked-keyframe sources compose before model compatibility validation", () => {
  const hero = image("hero"),
    previous = image("previous", "FIRST_FRAME", {
      sourceType: "PREVIOUS_SHOT",
    }),
    locked = image("locked", "FIRST_FRAME", { sourceType: "LOCKED_KEYFRAME" });
  assert.throws(
    () =>
      compileReferenceInputPlan({
        resolvedInputMode: "MULTIMODAL_REFERENCE",
        references: [hero, previous],
      }),
    (error) =>
      error instanceof ReferenceInputPlanError &&
      error.code === "REFERENCE_ROLE_UNSUPPORTED",
  );
  assert.throws(
    () =>
      compileReferenceInputPlan({
        resolvedInputMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
        references: [locked, hero],
      }),
    (error) => error.code === "REFERENCE_ROLE_UNSUPPORTED",
  );
  const legal = compileReferenceInputPlan({
    resolvedInputMode: "MULTIMODAL_REFERENCE",
    references: [
      hero,
      image("uploaded", "REFERENCE_IMAGE", {
        sourceType: "UPLOADED_REFERENCE",
      }),
    ],
  });
  assert.deepEqual(
    legal.orderedReferences.map((item) => item.sourceType),
    ["CONTINUITY_ENTITY", "UPLOADED_REFERENCE"],
  );
});

test("input-mode cardinality and MIME rules fail before provider execution", () => {
  assert.throws(
    () =>
      compileReferenceInputPlan({
        resolvedInputMode: "TEXT_TO_VIDEO",
        references: [image("hero")],
      }),
    (error) => error.code === "REFERENCE_ROLE_UNSUPPORTED",
  );
  assert.throws(
    () =>
      compileReferenceInputPlan({
        resolvedInputMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
        references: [image("hero")],
      }),
    (error) => error.code === "REFERENCE_ROLE_REQUIRED",
  );
  assert.throws(
    () =>
      compileReferenceInputPlan({
        resolvedInputMode: "VIDEO_EXTENSION",
        references: [image("hero")],
      }),
    (error) => error.code === "REFERENCE_ROLE_REQUIRED",
  );
});
