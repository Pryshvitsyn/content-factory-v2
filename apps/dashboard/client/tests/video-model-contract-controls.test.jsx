import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  VideoModelContractControls,
  modelContractDefaults,
} from "../src/VideoModelContractControls";
import {
  canonicalProviderSelection,
  normalizePersistedVideo,
} from "../src/CreativeProduction";
const contract = {
  contractVersion: "seedance@1",
  providerSchemaVersion: "schema-1",
  pricing: { status: "UNKNOWN_CURRENT_PRICE" },
  inputModes: [
    "TEXT_TO_VIDEO",
    "FIRST_FRAME_IMAGE_TO_VIDEO",
    "FIRST_LAST_FRAME",
    "MULTIMODAL_REFERENCE",
  ],
  capabilities: [
    "TEXT_TO_VIDEO",
    "MULTIMODAL_REFERENCE",
    "NATIVE_AUDIO_GENERATION",
  ],
  parameters: {
    duration: {
      values: { intelligent: -1, minimum: 4, maximum: 6 },
      contentFactoryDefault: 5,
    },
    resolution: { values: ["720p", "1080p"], contentFactoryDefault: "720p" },
    aspectRatio: {
      values: ["adaptive", "16:9", "9:16"],
      contentFactoryDefault: "16:9",
    },
    generateAudio: { contentFactoryDefault: false },
    watermark: { contentFactoryDefault: false },
    outputFormat: { values: ["mp4"], contentFactoryDefault: "mp4" },
    seed: { type: "integer", optional: true },
  },
};
describe("model-contract operator controls", () => {
  it("derives vertical workflow geometry and exposes model-required adaptive mode", () => {
    const defaults = modelContractDefaults(contract),
      change = vi.fn();
    expect(defaults.aspectRatio).toBe("9:16");
    render(
      <VideoModelContractControls
        contract={contract}
        value={defaults}
        onChange={change}
      />,
    );
    expect(screen.getByText(/seedance@1/)).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "MULTIMODAL_REFERENCE" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "INTELLIGENT (-1)" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("MODEL INPUT MODE"), {
      target: { value: "FIRST_LAST_FRAME" },
    });
    expect(change).toHaveBeenCalledWith({
      ...defaults,
      resolvedInputMode: "FIRST_LAST_FRAME",
      aspectRatio: "adaptive",
    });
    fireEvent.change(screen.getByLabelText("MODEL SEED"), {
      target: { value: "42" },
    });
    expect(change).toHaveBeenCalledWith({ ...defaults, seed: 42 });
    fireEvent.click(screen.getByLabelText("MODEL GENERATE AUDIO"));
    expect(change).toHaveBeenCalledWith({ ...defaults, generateAudio: true });
  });
});
describe("model-contract draft normalization", () => {
  it.each(["TEXT_TO_VIDEO", "MULTIMODAL_REFERENCE", "VIDEO_EXTENSION"])(
    "preserves exact nested Seedance %s request across resume/save",
    (resolvedInputMode) => {
      const modelRequest = {
        resolvedInputMode,
        durationSeconds: resolvedInputMode === "VIDEO_EXTENSION" ? -1 : 5,
        resolution: "720p",
        aspectRatio:
          resolvedInputMode === "VIDEO_EXTENSION" ? "adaptive" : "9:16",
        generateAudio: false,
        watermark: false,
        outputFormat: "mp4",
        seed: 42,
      };
      const persisted = {
        provider: "replicate",
        model: "bytedance/seedance-2.5",
        modelFamily: "SEEDANCE_2_5",
        profile: "STANDARD",
        resolution: "720p",
        modelRequest,
        continuityBindings: [],
      };
      const normalized = normalizePersistedVideo(persisted);
      expect(normalized.modelRequest).toEqual(modelRequest);
      expect(
        canonicalProviderSelection(
          normalized,
          { modelFamily: "SEEDANCE_2_5" },
          "720p",
        ),
      ).toEqual(persisted);
    },
  );
  it("normalizes legacy top-level selection without dropping valid false values", () => {
    const normalized = normalizePersistedVideo({
      provider: "replicate",
      model: "legacy",
      profile: "QUALITY",
      resolvedInputMode: "TEXT_TO_VIDEO",
      durationSeconds: 6,
      resolution: "1080p",
      aspectRatio: "16:9",
      generateAudio: false,
      watermark: false,
      outputFormat: "mp4",
      seed: 0,
    });
    expect(normalized.profile).toBe("STANDARD");
    expect(normalized.modelRequest).toMatchObject({
      durationSeconds: 6,
      generateAudio: false,
      watermark: false,
      seed: 0,
    });
  });
});
