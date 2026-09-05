import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreativeProduction } from "../src/CreativeProduction";

const brandId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";

function response(payload, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 400,
    json: async () => payload,
  });
}

function shot(id, roles) {
  return {
    shotId: id,
    assetId: `video-${id}`,
    durationSeconds: 5,
    roles,
    purpose: "Advance a concrete relationship story beat",
    subject: "The same adult couple sitting together on a sofa",
    action: "They make a small visible restrained emotional movement",
    environment: "A warm lived-in apartment living room in the evening",
    emotionalIntent: "Quiet believable emotional attention and connection",
    framing: "Vertical eye-level medium shot of the couple",
    camera: "Restrained slow observational camera movement",
    lensComposition: "Natural perspective balanced two-person composition",
    lighting: "Warm practical lamps with soft evening contrast",
    continuity:
      "Preserve the same faces wardrobe apartment props lighting and camera language",
    negativeGuidance:
      "No generated text, melodrama, extra people or watermarks",
    referencePolicy: "NONE",
    voiceoverSegment: "",
  };
}

function savedBrief() {
  return {
    title: "Notice the Moment",
    objective: "Help couples notice before assuming",
    targetPlatform: "Instagram Reels",
    targetDurationSeconds: 10,
    hook: "Sometimes distance is not rejection",
    coreMessage: "Notice before reacting",
    cta: "Don't guess. Tune in.",
    audienceIntent: "Thoughtful couples who want calmer communication",
    creativeConcept:
      "A subtle apartment moment moves from tension to attention",
    visualStyle:
      "Warm restrained cinematic realism with authentic micro-expressions",
    storyboard: [
      shot("s1", ["HOOK", "TENSION"]),
      shot("s2", ["INSIGHT", "ACTION", "RESOLUTION", "CTA"]),
    ],
    continuity: {
      identity: "One consistent adult couple throughout all shots",
      appearance: "Natural everyday appearance with consistent faces",
      wardrobe: "Simple neutral home clothing remains unchanged",
      environment: "Warm apartment living room with the same sofa",
      props: "Sofa side table and practical lamp remain fixed",
      lightingColorLanguage: "Warm soft evening practical lighting",
      cameraLanguage: "Restrained eye-level observational vertical camera",
      referencePolicy: "NONE",
    },
    voice: {
      sourceType: null,
      provider: "",
      model: "",
      voiceId: "",
      language: "en",
      instructions: "",
      approved: false,
    },
    postProduction: {
      endTitle: {
        enabled: true,
        text: "Don't guess. Tune in.",
        startTime: 8,
        duration: 2,
      },
      brandName: "Attune",
    },
    publicationPolicy: { humanApprovalRequired: true, autoPublish: false },
  };
}

describe("V2.10 operator-first Creative Production UX", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resumes a saved draft and derives Wan 3 profile/resolution/capabilities from the server catalog", async () => {
    const methods = [];
    const providers = [
      {
        id: "replicate",
        displayName: "Replicate",
        configured: true,
        models: [
          {
            modelId: "alibaba/wan-3",
            displayName: "Wan 3",
            modelFamily: "WAN_3",
            selectable: true,
            capabilities: [
              "TEXT_TO_VIDEO",
              "IMAGE_TO_VIDEO",
              "AUDIO_DISABLE_SUPPORTED",
            ],
            profiles: {
              ECONOMY: { resolution: "480p" },
              STANDARD: { resolution: "720p" },
              PREMIUM: { resolution: "1080p" },
            },
          },
        ],
      },
    ];
    const drafts = [
      {
        id: draftId,
        brand_id: brandId,
        status: "DRAFT",
        revision: 3,
        creative_brief: savedBrief(),
        provider_selection: {
          provider: "replicate",
          model: "alibaba/wan-3",
          modelFamily: "WAN_3",
          profile: "QUALITY",
          resolution: "1080x1920",
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        methods.push([url, options.method || "GET"]);
        if (url === "/api/brands")
          return response([{ id: brandId, name: "Attune" }]);
        if (url === "/api/providers") return response(providers);
        if (String(url).startsWith("/api/v2.10/creative-drafts?"))
          return response(drafts);
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<CreativeProduction />);
    fireEvent.change(await screen.findByLabelText("BRAND"), {
      target: { value: brandId },
    });

    await waitFor(() =>
      expect(screen.getByLabelText("VIDEO PROVIDER").value).toBe("replicate"),
    );
    expect(screen.getByLabelText("VIDEO MODEL").value).toBe("alibaba/wan-3");
    expect(screen.getByLabelText("VIDEO PROFILE").value).toBe("STANDARD");
    expect(screen.getByLabelText("RESOLVED OUTPUT").value).toContain(
      "720p source",
    );
    expect(screen.getByText("WAN_3")).toBeTruthy();
    expect(screen.getByText(/TEXT_TO_VIDEO · IMAGE_TO_VIDEO/)).toBeTruthy();
    expect(screen.getByLabelText("DRAFT").value).toBe(draftId);
    expect(
      screen.queryByText("Provider/model supports image-to-video continuity"),
    ).toBeNull();
    expect(methods.every(([, method]) => method === "GET")).toBe(true);
  });
  it("resumes and saves the exact nested Seedance modelRequest", async () => {
    const modelRequest = {
      resolvedInputMode: "MULTIMODAL_REFERENCE",
      durationSeconds: 5,
      resolution: "720p",
      aspectRatio: "9:16",
      generateAudio: false,
      watermark: false,
      outputFormat: "mp4",
      seed: 73,
    };
    const providers = [
      {
        id: "replicate",
        displayName: "Replicate",
        configured: true,
        models: [
          {
            modelId: "bytedance/seedance-2.5",
            displayName: "Seedance 2.5",
            modelFamily: "SEEDANCE_2_5",
            selectable: true,
            capabilities: ["TEXT_TO_VIDEO", "REFERENCE_TO_VIDEO"],
            profiles: { STANDARD: { resolution: "720p" } },
            modelContract: {
              contractVersion: "seedance@1",
              providerSchemaVersion: "schema",
              pricing: { status: "UNKNOWN_CURRENT_PRICE" },
              inputModes: ["TEXT_TO_VIDEO", "MULTIMODAL_REFERENCE"],
              capabilities: ["TEXT_TO_VIDEO", "MULTIMODAL_REFERENCE"],
              parameters: {
                duration: {
                  values: { intelligent: -1, minimum: 4, maximum: 6 },
                  contentFactoryDefault: 5,
                },
                resolution: { values: ["720p"], contentFactoryDefault: "720p" },
                aspectRatio: {
                  values: ["adaptive", "9:16"],
                  contentFactoryDefault: "9:16",
                },
                generateAudio: { contentFactoryDefault: false },
                watermark: { contentFactoryDefault: false },
                outputFormat: { values: ["mp4"], contentFactoryDefault: "mp4" },
                seed: { type: "integer", optional: true },
              },
            },
          },
        ],
      },
    ];
    let savedBody;
    const continuityOptions = [
      {
        packId: "pack-hero",
        packFingerprint: "fp-hero",
        entityId: "hero-a",
        displayName: "Synthetic Hero A",
        entityType: "SYNTHETIC_CHARACTER",
        revision: 3,
        referenceCount: 3,
        authorityStatus: "READY",
      },
      {
        packId: "pack-product",
        packFingerprint: "fp-product",
        entityId: "product-x",
        displayName: "Product X",
        entityType: "OBJECT_PRODUCT",
        revision: 8,
        referenceCount: 2,
        authorityStatus: "READY",
      },
    ];
    const draft = {
      id: draftId,
      brand_id: brandId,
      status: "DRAFT",
      revision: 3,
      creative_brief: savedBrief(),
      provider_selection: {
        provider: "replicate",
        model: "bytedance/seedance-2.5",
        modelFamily: "SEEDANCE_2_5",
        profile: "STANDARD",
        resolution: "720p",
        modelRequest,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options = {}) => {
        if (url === "/api/brands")
          return response([{ id: brandId, name: "Attune" }]);
        if (url === "/api/providers") return response(providers);
        if (String(url).startsWith("/api/v2.10/continuity-entities?"))
          return response(continuityOptions);
        if (String(url).startsWith("/api/v2.10/creative-drafts?"))
          return response([draft]);
        if (url === `/api/v2.10/creative-drafts/${draftId}`) {
          savedBody = JSON.parse(options.body);
          return response(draft);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    render(<CreativeProduction />);
    fireEvent.change(await screen.findByLabelText("BRAND"), {
      target: { value: brandId },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("MODEL INPUT MODE").value).toBe(
        "MULTIMODAL_REFERENCE",
      ),
    );
    expect(screen.getByLabelText("MODEL SEED").value).toBe("73");
    expect(screen.getByLabelText("MODEL GENERATE AUDIO").checked).toBe(false);
    expect(screen.getByLabelText("MODEL WATERMARK").checked).toBe(false);
    const entitySelector = screen.getByLabelText(
      "ADD CONTINUITY ENTITY SHOT 1",
    );
    fireEvent.change(entitySelector, { target: { value: "pack-hero" } });
    fireEvent.change(entitySelector, { target: { value: "pack-product" } });
    expect(screen.getAllByText(/Synthetic Hero A/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Product X/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("MOVE CONTINUITY UP product-x"));
    fireEvent.click(
      screen.getByRole("button", { name: "SAVE DRAFT · 0 CALLS" }),
    );
    await waitFor(() =>
      expect(savedBody?.providerSelection?.modelRequest).toEqual(modelRequest),
    );
    expect(
      savedBody.providerSelection.continuityBindings.map(
        (item) => item.entityId,
      ),
    ).toEqual(["product-x", "hero-a"]);
  });
});
