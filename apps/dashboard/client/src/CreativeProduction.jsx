import React, { useMemo, useState } from "react";
import {
  VideoModelContractControls,
  modelContractDefaults,
} from "./VideoModelContractControls";
import { api } from "./api";
import "./CreativeProduction.css";

const ROLES = ["HOOK", "TENSION", "INSIGHT", "ACTION", "RESOLUTION", "CTA"];
const CONTINUITY_FIELDS = [
  "identity",
  "appearance",
  "wardrobe",
  "environment",
  "props",
  "lightingColorLanguage",
  "cameraLanguage",
];
const VIDEO_CAPABILITIES = [
  "TEXT_TO_VIDEO",
  "IMAGE_TO_VIDEO",
  "REFERENCE_TO_VIDEO",
  "VIDEO_TO_VIDEO",
  "VIDEO_EXTENSION",
];
const SPEECH_CAPABILITY = "SPEECH";
const LEGACY_CANVAS = new Set(["480x854", "720x1280", "1080x1920"]);
const OPENAI_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
];

const makeShot = (index) => ({
  shotId: `shot-${index + 1}`,
  assetId: `video-${index + 1}`,
  durationSeconds: 5,
  roles:
    index === 0
      ? ["HOOK", "TENSION"]
      : ["INSIGHT", "ACTION", "RESOLUTION", "CTA"],
  purpose: "",
  subject: "",
  action: "",
  environment: "",
  emotionalIntent: "",
  framing: "",
  camera: "",
  lensComposition: "",
  lighting: "",
  continuity: "",
  negativeGuidance: "",
  referencePolicy: "NONE",
  voiceoverSegment: "",
});

const initialBrief = () => ({
  title: "",
  objective: "",
  targetPlatform: "Instagram Reels",
  targetDurationSeconds: 10,
  hook: "",
  coreMessage: "",
  cta: "",
  audienceIntent: "",
  creativeConcept: "",
  visualStyle: "",
  storyboard: [makeShot(0), makeShot(1)],
  continuity: {
    ...Object.fromEntries(CONTINUITY_FIELDS.map((field) => [field, ""])),
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
    endTitle: { enabled: false, text: "", startTime: 8, duration: 2 },
    brandName: "",
  },
  publicationPolicy: { humanApprovalRequired: true, autoPublish: false },
});

const emptyVideo = () => ({
  provider: "",
  model: "",
  modelFamily: "",
  profile: "",
  resolution: null,
  modelRequest: {},
  continuityBindings: [],
});
const vague =
  /exactly as specified|operator(?:'s)? (?:creative )?brief|(?:awaits?|requires?) (?:the )?operator input|creative input required|\b(?:tbd|todo|placeholder)\b/i;
const specific = (value, words = 2) => {
  const text = String(value || "").trim();
  return !vague.test(text) && text.split(/\s+/).filter(Boolean).length >= words;
};

function validate(brief) {
  const roles = new Set(brief.storyboard.flatMap((shot) => shot.roles));
  const checks = [
    [
      "SUBJECT SPECIFICITY",
      brief.storyboard.every((shot) => specific(shot.subject, 3)),
    ],
    [
      "ACTION SPECIFICITY",
      brief.storyboard.every((shot) => specific(shot.action, 3)),
    ],
    [
      "ENVIRONMENT SPECIFICITY",
      brief.storyboard.every((shot) => specific(shot.environment, 3)),
    ],
    [
      "EMOTIONAL BEAT",
      brief.storyboard.every((shot) => specific(shot.emotionalIntent)),
    ],
    [
      "CAMERA INTENT",
      brief.storyboard.every((shot) =>
        specific(`${shot.framing} ${shot.camera} ${shot.lensComposition}`, 5),
      ),
    ],
    [
      "LIGHTING INTENT",
      brief.storyboard.every((shot) => specific(shot.lighting)),
    ],
    [
      "SHOT PURPOSE",
      brief.storyboard.length >= 2 &&
        brief.storyboard.length <= 5 &&
        brief.storyboard.every((shot) => specific(shot.purpose, 3)),
    ],
    [
      "STORY ARC",
      roles.has("HOOK") &&
        (roles.has("TENSION") || roles.has("INSIGHT")) &&
        (roles.has("ACTION") || roles.has("INSIGHT")) &&
        roles.has("RESOLUTION") &&
        (roles.has("CTA") || specific(brief.cta)),
    ],
    [
      "CTA RESOLUTION",
      specific(brief.cta) && (roles.has("CTA") || roles.has("RESOLUTION")),
    ],
    [
      "DURATION ALIGNMENT",
      brief.storyboard.reduce(
        (total, shot) => total + Number(shot.durationSeconds || 0),
        0,
      ) === Number(brief.targetDurationSeconds),
    ],
    [
      "CONTINUITY PLAN",
      CONTINUITY_FIELDS.every((field) => specific(brief.continuity[field])),
    ],
  ];
  return {
    status: checks.every(([, pass]) => pass) ? "PASS" : "FAIL",
    checks: checks.map(([name, pass]) => ({
      name,
      status: pass ? "PASS" : "FAIL",
    })),
  };
}

function Field({
  label,
  value,
  onChange,
  number = false,
  area = true,
  placeholder = "",
}) {
  const Tag = area ? "textarea" : "input";
  return (
    <label>
      {label}
      <Tag
        aria-label={label}
        type={number ? "number" : undefined}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(event) =>
          onChange(number ? Number(event.target.value) : event.target.value)
        }
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
  disabled = false,
  ariaLabel = null,
}) {
  return (
    <label>
      {label}
      <select
        aria-label={ariaLabel || label}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function rowBrief(row) {
  return row?.creative_brief || row?.creativeBrief || null;
}
function rowProvider(row) {
  return row?.provider_selection || row?.providerSelection || {};
}
function statusText(row) {
  return row?.status || row?.start_state || "DRAFT";
}
function editableDraft(row) {
  return (
    row &&
    row.status !== "STARTED" &&
    !["RUNNING", "NEEDS_RECONCILIATION"].includes(row.start_state)
  );
}
function defaultProfile(model) {
  const names = Object.keys(model?.profiles || {});
  return names.includes("STANDARD") ? "STANDARD" : names[0] || "";
}
function resolvedResolution(model, profile) {
  return model?.profiles?.[profile]?.resolution || null;
}
export function normalizePersistedVideo(value = {}) {
  const profile =
    String(value.profile || "").toUpperCase() === "QUALITY"
      ? "STANDARD"
      : String(value.profile || "").toUpperCase();
  const rawResolution = String(value.resolution || "");
  const nested = value.modelRequest || value.model_request || {};
  return {
    provider: value.provider || "",
    model: value.model || "",
    modelFamily: value.modelFamily || "",
    profile,
    resolution: LEGACY_CANVAS.has(rawResolution)
      ? null
      : value.resolution || null,
    continuityBindings: [
      ...(value.continuityBindings || value.continuity_bindings || []),
    ],
    modelRequest: {
      resolvedInputMode:
        nested.resolvedInputMode || value.resolvedInputMode || "TEXT_TO_VIDEO",
      durationSeconds: nested.durationSeconds ?? value.durationSeconds ?? 5,
      resolution: nested.resolution || value.resolution || "720p",
      aspectRatio: nested.aspectRatio || value.aspectRatio || "9:16",
      generateAudio: nested.generateAudio ?? value.generateAudio === true,
      watermark: nested.watermark ?? value.watermark === true,
      outputFormat: nested.outputFormat || value.outputFormat || "mp4",
      seed: nested.seed ?? value.seed ?? null,
    },
  };
}
export function canonicalProviderSelection(
  video,
  selectedModel,
  effectiveResolution,
  routeReady = true,
) {
  return routeReady
    ? {
        provider: video.provider,
        model: video.model,
        modelFamily: selectedModel?.modelFamily || null,
        profile: video.profile,
        resolution: effectiveResolution || null,
        modelRequest: { ...(video.modelRequest || {}) },
        continuityBindings: [...(video.continuityBindings || [])],
      }
    : {};
}
function humanProviderState(provider) {
  return provider?.configured ? "CONFIGURED" : "NOT CONFIGURED";
}

export function CreativeProduction() {
  const [brief, setBrief] = useState(initialBrief);
  const [brands, setBrands] = useState([]);
  const [providers, setProviders] = useState([]);
  const [brandId, setBrandId] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [draft, setDraft] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [keyframeFile, setKeyframeFile] = useState(null);
  const [keyframeSource, setKeyframeSource] = useState("OPERATOR_UPLOAD");
  const [keyframeRoute, setKeyframeRoute] = useState({
    provider: "",
    model: "",
    profile: "STANDARD",
  });
  const [keyframePreflight, setKeyframePreflight] = useState(null);
  const [keyframeResult, setKeyframeResult] = useState(null);
  const [firstVideoPreflight, setFirstVideoPreflight] = useState(null);
  const [attested, setAttested] = useState(false);
  const [video, setVideo] = useState(emptyVideo);
  const [continuityOptions, setContinuityOptions] = useState([]);
  const [busy, setBusy] = useState(null);

  React.useEffect(() => {
    api("/api/brands")
      .then(setBrands)
      .catch((error) => setMessage(error.message));
  }, []);

  const completeness = useMemo(() => validate(brief), [brief]);
  const videoProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          Array.isArray(provider.models) &&
          provider.models.some((model) =>
            model.capabilities?.includes("TEXT_TO_VIDEO"),
          ),
      ),
    [providers],
  );
  const selectedProvider =
    videoProviders.find((provider) => provider.id === video.provider) || null;
  const videoModels = (selectedProvider?.models || []).filter(
    (model) =>
      model.capabilities?.includes("TEXT_TO_VIDEO") &&
      model.selectable !== false,
  );
  const selectedModel =
    videoModels.find((model) => model.modelId === video.model) || null;
  const modelContract = selectedModel?.modelContract || null;
  const profiles = Object.keys(selectedModel?.profiles || {});
  const effectiveResolution = resolvedResolution(selectedModel, video.profile);
  const continuityRequested =
    brief.storyboard.some((shot) => shot.referencePolicy !== "NONE") ||
    Boolean(video.continuityBindings?.length);
  const continuitySupported =
    !continuityRequested ||
    Boolean(
      selectedModel?.capabilities?.some((capability) =>
        ["IMAGE_TO_VIDEO", "REFERENCE_TO_VIDEO"].includes(capability),
      ),
    );
  const routeReady = Boolean(
    selectedProvider?.configured &&
    selectedModel &&
    video.profile &&
    profiles.includes(video.profile),
  );
  const voiceProviders = providers.filter(
    (provider) =>
      Array.isArray(provider.models) &&
      provider.models.some((model) =>
        model.capabilities?.includes(SPEECH_CAPABILITY),
      ),
  );
  const selectedVoiceProvider =
    voiceProviders.find((provider) => provider.id === brief.voice.provider) ||
    null;
  const voiceModels = (selectedVoiceProvider?.models || []).filter(
    (model) =>
      model.capabilities?.includes(SPEECH_CAPABILITY) &&
      model.selectable !== false,
  );
  const voiceNeedsApproval = Boolean(brief.voice.sourceType);
  const voiceReady = !voiceNeedsApproval || brief.voice.approved === true;
  const imageProviders = providers.filter((provider) =>
    provider.models?.some((model) =>
      model.capabilities?.includes("TEXT_TO_IMAGE"),
    ),
  );

  const invalidate = () => setPreflight(null);
  const edit = (fn, voiceChange = false) => {
    setBrief((current) => {
      const next = fn(current);
      return voiceChange
        ? { ...next, voice: { ...next.voice, approved: false } }
        : next;
    });
    invalidate();
  };
  const setTop = (name, value) =>
    edit((current) => ({ ...current, [name]: value }));
  const setShot = (index, name, value) =>
    edit((current) => ({
      ...current,
      storyboard: current.storyboard.map((shot, shotIndex) =>
        shotIndex === index ? { ...shot, [name]: value } : shot,
      ),
    }));

  function resetEditor() {
    setDraft(null);
    setBrief(initialBrief());
    setVideo(emptyVideo());
    setPreflight(null);
    setPreview(null);
    setUploadedFile(null);
    setKeyframeFile(null);
    setKeyframePreflight(null);
    setKeyframeResult(null);
    setFirstVideoPreflight(null);
    setAttested(false);
    setMessage("New draft. External calls: 0.");
  }

  function loadDraft(row, providerRows = providers) {
    const loaded = rowBrief(row);
    if (!loaded) return;
    const persisted = normalizePersistedVideo(rowProvider(row));
    const eligibleProviders = providerRows.filter(
      (item) =>
        Array.isArray(item.models) &&
        item.models.some((model) =>
          model.capabilities?.includes("TEXT_TO_VIDEO"),
        ),
    );
    const provider = eligibleProviders.find(
      (item) => item.id === persisted.provider,
    );
    const model = provider?.models?.find(
      (item) => item.modelId === persisted.model,
    );
    const profile =
      persisted.profile && model?.profiles?.[persisted.profile]
        ? persisted.profile
        : defaultProfile(model);
    setDraft(row);
    setBrief(loaded);
    setVideo({
      provider: persisted.provider,
      model: persisted.model,
      modelFamily: model?.modelFamily || persisted.modelFamily || "",
      profile,
      resolution:
        resolvedResolution(model, profile) || persisted.resolution || null,
      modelRequest: persisted.modelRequest,
      continuityBindings: persisted.continuityBindings,
    });
    setPreflight(row.final_preflight || row.finalPreflight || null);
    setPreview(loaded.voice?.previewArtifact || null);
    setUploadedFile(null);
    setAttested(false);
    setMessage(
      `Resumed ${statusText(row)} draft · revision ${row.revision || 1}. External calls: 0.`,
    );
  }

  async function refreshDrafts(
    nextBrandId,
    preferredId = null,
    providerRows = providers,
  ) {
    if (!nextBrandId) {
      setDrafts([]);
      return;
    }
    try {
      const rows = await api(
        `/api/v2.10/creative-drafts?brandId=${encodeURIComponent(nextBrandId)}`,
      );
      setDrafts(rows);
      const preferred = preferredId
        ? rows.find((row) => row.id === preferredId)
        : null;
      const candidate = preferred || rows.find(editableDraft);
      if (candidate) loadDraft(candidate, providerRows);
      else resetEditor();
    } catch (error) {
      setDrafts([]);
      resetEditor();
      setMessage(`Could not resume drafts: ${error.message}`);
    }
  }

  async function chooseBrand(nextBrandId) {
    setBrandId(nextBrandId);
    setDraft(null);
    setPreflight(null);
    setPreview(null);
    if (!nextBrandId) {
      setDrafts([]);
      setBrief(initialBrief());
      setVideo(emptyVideo());
      return;
    }
    try {
      let catalog = providers;
      if (!catalog.length) {
        catalog = await api("/api/providers");
        setProviders(catalog);
      }
      const options = await api(
        `/api/v2.10/continuity-entities?brandId=${encodeURIComponent(nextBrandId)}`,
      ).catch((error) => {
        setMessage(`Continuity authority unavailable: ${error.message}`);
        return [];
      });
      setContinuityOptions(options);
      await refreshDrafts(nextBrandId, null, catalog);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function chooseProvider(providerId) {
    const provider = videoProviders.find((item) => item.id === providerId);
    const model = provider?.models?.find(
      (item) =>
        item.capabilities?.includes("TEXT_TO_VIDEO") &&
        item.selectable !== false,
    );
    const profile = defaultProfile(model);
    setVideo((current) => ({
      provider: providerId,
      model: model?.modelId || "",
      modelFamily: model?.modelFamily || "",
      profile,
      resolution: resolvedResolution(model, profile),
      modelRequest: modelContractDefaults(model?.modelContract),
      continuityBindings: [...(current.continuityBindings || [])],
    }));
    invalidate();
  }

  function chooseModel(modelId) {
    const model = videoModels.find((item) => item.modelId === modelId);
    const profile = defaultProfile(model);
    setVideo((current) => ({
      ...current,
      model: modelId,
      modelFamily: model?.modelFamily || "",
      profile,
      resolution: resolvedResolution(model, profile),
      modelRequest: modelContractDefaults(model?.modelContract),
    }));
    invalidate();
  }

  function chooseProfile(profile) {
    setVideo((current) => ({
      ...current,
      profile,
      resolution: resolvedResolution(selectedModel, profile),
    }));
    invalidate();
  }
  function addContinuityBinding(shotId, packId) {
    const option = continuityOptions.find((item) => item.packId === packId);
    if (!option || option.authorityStatus !== "READY") return;
    setVideo((current) => ({
      ...current,
      continuityBindings: [
        ...(current.continuityBindings || []),
        {
          shotId,
          entityId: option.entityId,
          packId: option.packId,
          packFingerprint: option.packFingerprint,
        },
      ],
    }));
    invalidate();
  }
  function moveContinuityBinding(shotId, index, delta) {
    setVideo((current) => {
      const all = [...(current.continuityBindings || [])];
      const positions = all
          .map((item, i) => (item.shotId === shotId ? i : -1))
          .filter((i) => i >= 0),
        target = index + delta;
      if (target < 0 || target >= positions.length) return current;
      [all[positions[index]], all[positions[target]]] = [
        all[positions[target]],
        all[positions[index]],
      ];
      return { ...current, continuityBindings: all };
    });
    invalidate();
  }
  function removeContinuityBinding(shotId, index) {
    setVideo((current) => {
      let seen = -1;
      return {
        ...current,
        continuityBindings: (current.continuityBindings || []).filter(
          (item) => item.shotId !== shotId || ++seen !== index,
        ),
      };
    });
    invalidate();
  }

  function setVoiceSource(sourceType) {
    const configuredSpeech =
      voiceProviders.find((provider) => provider.configured) ||
      voiceProviders[0];
    const firstModel = configuredSpeech?.models?.find(
      (model) =>
        model.capabilities?.includes(SPEECH_CAPABILITY) &&
        model.selectable !== false,
    );
    edit(
      (current) => ({
        ...current,
        voice: sourceType
          ? {
              ...current.voice,
              sourceType,
              ...(sourceType === "UPLOADED_AUDIO"
                ? { provider: "", model: "", voiceId: "" }
                : {
                    provider:
                      current.voice.provider || configuredSpeech?.id || "",
                    model: current.voice.model || firstModel?.modelId || "",
                    voiceId:
                      current.voice.voiceId ||
                      (configuredSpeech?.id === "openai" ? "alloy" : ""),
                  }),
            }
          : {
              sourceType: null,
              provider: "",
              model: "",
              voiceId: "",
              language: "en",
              instructions: "",
              approved: false,
            },
      }),
      true,
    );
    setPreview(null);
    setUploadedFile(null);
    setAttested(false);
  }

  function chooseVoiceProvider(providerId) {
    const provider = voiceProviders.find((item) => item.id === providerId);
    const model = provider?.models?.find(
      (item) =>
        item.capabilities?.includes(SPEECH_CAPABILITY) &&
        item.selectable !== false,
    );
    edit(
      (current) => ({
        ...current,
        voice: {
          ...current.voice,
          provider: providerId,
          model: model?.modelId || "",
          voiceId:
            providerId === "openai" ? current.voice.voiceId || "alloy" : "",
        },
      }),
      true,
    );
    setPreview(null);
  }

  function move(index, delta) {
    edit((current) => {
      const storyboard = [...current.storyboard];
      const target = index + delta;
      if (target < 0 || target >= storyboard.length) return current;
      [storyboard[index], storyboard[target]] = [
        storyboard[target],
        storyboard[index],
      ];
      return { ...current, storyboard };
    });
  }
  const add = () =>
    brief.storyboard.length < 5 &&
    edit((current) => ({
      ...current,
      storyboard: [...current.storyboard, makeShot(current.storyboard.length)],
    }));
  const remove = (index) =>
    brief.storyboard.length > 2 &&
    edit((current) => ({
      ...current,
      storyboard: current.storyboard.filter(
        (_, shotIndex) => shotIndex !== index,
      ),
    }));
  const duplicate = (index) =>
    brief.storyboard.length < 5 &&
    edit((current) => {
      const storyboard = [...current.storyboard];
      const stamp = Date.now();
      storyboard.splice(index + 1, 0, {
        ...storyboard[index],
        shotId: `shot-${stamp}`,
        assetId: `video-${stamp}`,
      });
      return { ...current, storyboard };
    });

  function copyContinuityToShots() {
    const summary = [
      brief.continuity.identity,
      brief.continuity.appearance,
      brief.continuity.wardrobe,
      brief.continuity.environment,
      brief.continuity.props,
      brief.continuity.lightingColorLanguage,
      brief.continuity.cameraLanguage,
    ]
      .filter(Boolean)
      .join(" ");
    if (!summary) {
      setMessage("Complete the Continuity section first.");
      return;
    }
    edit((current) => ({
      ...current,
      storyboard: current.storyboard.map((shot) => ({
        ...shot,
        continuity: shot.continuity || summary,
        lighting: shot.lighting || current.continuity.lightingColorLanguage,
        camera: shot.camera || current.continuity.cameraLanguage,
      })),
    }));
    setMessage("Continuity copied into empty shot fields. External calls: 0.");
  }

  function currentProviderSelection() {
    return canonicalProviderSelection(
      video,
      selectedModel,
      effectiveResolution,
      routeReady,
    );
  }

  async function persistDraft({ announce = true } = {}) {
    if (!brandId) throw new Error("Choose a brand first");
    const body = {
      brandId,
      brief,
      providerSelection: currentProviderSelection(),
      voiceSelection: brief.voice,
    };
    const value = draft
      ? await api(`/api/v2.10/creative-drafts/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      : await api("/api/v2.10/creative-drafts", {
          method: "POST",
          body: JSON.stringify(body),
        });
    setDraft(value);
    if (announce) setMessage("Draft saved. External calls: 0.");
    return value;
  }

  async function save() {
    setBusy("save");
    try {
      const value = await persistDraft();
      await refreshDrafts(brandId, value.id);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function runPreflight() {
    if (completeness.status !== "PASS") {
      setMessage("Creative Validation must be PASS before final preflight.");
      return;
    }
    if (!routeReady) {
      setMessage("Choose a configured video provider, model and profile.");
      return;
    }
    if (!continuitySupported) {
      setMessage(
        "Selected model does not support the reference policy used by the storyboard.",
      );
      return;
    }
    setBusy("preflight");
    setPreflight(null);
    try {
      const saved = await persistDraft({ announce: false });
      const value = await api(
        `/api/v2.10/creative-drafts/${saved.id}/preflight`,
        {
          method: "POST",
          body: JSON.stringify({ brandId, video: currentProviderSelection() }),
        },
      );
      setPreflight(value);
      setMessage(
        value.status === "READY"
          ? "Final preflight READY. No production has started."
          : `Preflight BLOCKED: ${(value.blockers || []).join(", ")}`,
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function generatePreview() {
    const previewText = brief.storyboard
      .map((shot) => shot.voiceoverSegment)
      .filter(Boolean)
      .join(" ");
    if (!draft) {
      setMessage("Save the draft before generating a voice preview.");
      return;
    }
    if (
      !window.confirm(
        `GENERATE VOICE PREVIEW\nProvider: ${brief.voice.provider}\nModel: ${brief.voice.model}\nVoice: ${brief.voice.voiceId}\nPreview text: ${previewText}\nKnown cost: UNKNOWN\nExternal calls: 1`,
      )
    )
      return;
    setBusy("preview");
    try {
      const value = await api(
        `/api/v2.10/creative-drafts/${draft.id}/voice-preview`,
        {
          method: "POST",
          body: JSON.stringify({
            brandId,
            voice: brief.voice,
            previewText,
            confirmation: true,
          }),
        },
      );
      setPreview(value.artifact);
      setMessage(
        value.reused
          ? "Cached preview reused. External calls: 0."
          : "Voice preview generated. External calls: 1.",
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function useVoice() {
    setBusy("voice-approve");
    try {
      const value = await api(
        `/api/v2.10/creative-drafts/${draft.id}/voice-approve`,
        {
          method: "POST",
          body: JSON.stringify({
            brandId,
            voice: brief.voice,
            previewArtifact: preview,
          }),
        },
      );
      setDraft(value);
      setBrief(rowBrief(value));
      setMessage("Exact voice configuration approved.");
      setPreflight(null);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function uploadVoice() {
    if (!uploadedFile || !attested || !draft) return;
    setBusy("upload");
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(uploadedFile);
    });
    try {
      const artifact = await api(
        `/api/v2.10/creative-drafts/${draft.id}/voice-upload`,
        {
          method: "POST",
          body: JSON.stringify({
            brandId,
            contentBase64: data,
            contentType: uploadedFile.type,
            operatorAttestation: {
              confirmed: true,
              text: "The uploaded narration matches the approved spoken copy.",
              actor: "dashboard-operator",
              confirmedAt: new Date().toISOString(),
            },
          }),
        },
      );
      const exact = {
        artifactId: artifact.id,
        durationSeconds: Number(artifact.duration_seconds),
        contentHash: artifact.content_hash,
        localUrl: preview?.localUrl,
      };
      setPreview(exact);
      edit(
        (current) => ({
          ...current,
          voice: {
            ...current.voice,
            sourceType: "UPLOADED_AUDIO",
            uploadedArtifactId: artifact.id,
            previewArtifact: exact,
          },
        }),
        true,
      );
      setMessage(
        "Immutable uploaded narration stored. External calls: 0. Click USE THIS VOICE to approve it.",
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    if (!preflight || preflight.status !== "READY") return;
    if (
      !window.confirm(
        `START PRODUCTION?\nProvider: ${preflight.video?.providerDisplayName || preflight.video?.provider}\nModel: ${preflight.video?.model}\nProfile: ${preflight.video?.profile}\nMaximum external calls: ${preflight.externalCalls.maximum}\nKnown cost: ${preflight.costStatus}\nHuman approval: REQUIRED\nAuto publish: NO`,
      )
    )
      return;
    setBusy("start");
    try {
      const value = await api(`/api/v2.10/creative-drafts/${draft.id}/start`, {
        method: "POST",
        body: JSON.stringify({ brandId, confirmation: true }),
      });
      setMessage(
        `Production ${value.productionId} accepted. Human review remains required.`,
      );
      await refreshDrafts(brandId, draft.id);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  function chooseKeyframeProvider(providerId) {
    const provider = imageProviders.find((item) => item.id === providerId);
    const model = provider?.models?.find(
      (item) =>
        item.capabilities?.includes("TEXT_TO_IMAGE") &&
        item.selectable !== false,
    );
    setKeyframeRoute({
      provider: providerId,
      model: model?.modelId || "",
      profile: defaultProfile(model),
    });
    setKeyframePreflight(null);
  }

  async function preflightKeyframeStage() {
    setBusy("keyframe-preflight");
    try {
      const saved = await persistDraft({ announce: false });
      const value = await api(
        `/api/v2.10/creative-drafts/${saved.id}/locked-keyframe/preflight`,
        {
          method: "POST",
          body: JSON.stringify({
            brandId,
            shotId: brief.storyboard[0].shotId,
            keyframe: {
              sourceType: keyframeSource,
              ...(keyframeSource === "AI_GENERATED" ? keyframeRoute : {}),
            },
          }),
        },
      );
      setKeyframePreflight(value);
      setKeyframeResult(null);
      setMessage(
        `Keyframe preflight prepared. Maximum external calls: ${value.externalCalls.maximum}. Calls made: 0.`,
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function executeKeyframeStage() {
    if (
      !keyframePreflight ||
      (keyframeSource === "OPERATOR_UPLOAD" && !keyframeFile)
    )
      return;
    if (
      !window.confirm(
        `EXECUTE KEYFRAME STAGE?\nProvider: ${keyframePreflight.provider}\nModel: ${keyframePreflight.model}\nImage calls: ${keyframePreflight.externalCalls.imageGeneration}\nSemantic calls: ${keyframePreflight.externalCalls.semanticImageEvaluation}\nMaximum calls: ${keyframePreflight.externalCalls.maximum}\nHuman approval remains required.`,
      )
    )
      return;
    setBusy("keyframe-execute");
    try {
      let contentBase64 = null;
      if (keyframeFile)
        contentBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(keyframeFile);
        });
      const value = await api(
        `/api/v2.10/creative-drafts/${draft.id}/locked-keyframe/execute`,
        {
          method: "POST",
          body: JSON.stringify({
            brandId,
            shotId: brief.storyboard[0].shotId,
            preflightId: keyframePreflight.preflightId,
            fingerprint: keyframePreflight.fingerprint,
            confirmation: true,
            contentBase64,
            contentType: keyframeFile?.type || null,
          }),
        },
      );
      setKeyframeResult(value);
      setMessage(
        `Keyframe ${value.validation.status}. Video remains blocked until human approval.`,
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function approveLockedKeyframe() {
    if (
      !keyframeResult?.keyframe?.id ||
      keyframeResult.validation?.status !== "PASS"
    )
      return;
    if (
      !window.confirm(
        "APPROVE THIS EXACT IMMUTABLE KEYFRAME VERSION?\nThis binds its artifact ID, version and hash to shot 1 and invalidates production preflight.",
      )
    )
      return;
    setBusy("keyframe-approve");
    try {
      const value = await api(
        `/api/v2.10/creative-drafts/${draft.id}/locked-keyframe/approve`,
        {
          method: "POST",
          body: JSON.stringify({
            brandId,
            keyframeId: keyframeResult.keyframe.id,
            confirmation: true,
          }),
        },
      );
      const reference = value.canonicalReference;
      edit((current) => ({
        ...current,
        storyboard: current.storyboard.map((shot, index) =>
          index === 0
            ? {
                ...shot,
                referencePolicy: "UPLOADED_REFERENCE",
                referenceMedia: reference,
              }
            : shot,
        ),
      }));
      setKeyframeResult((current) => ({
        ...current,
        keyframe: { ...current.keyframe, approvalDecision: "APPROVED" },
      }));
      setPreflight(null);
      setMessage(
        "Exact keyframe approved and bound. Run FINAL PRODUCTION PREFLIGHT next.",
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function preflightLockedVideo() {
    setBusy("locked-video-preflight");
    try {
      const value = await api(
        `/api/v2.10/creative-drafts/${draft.id}/locked-keyframe/video-preflight`,
        {
          method: "POST",
          body: JSON.stringify({
            brandId,
            keyframeId: keyframeResult.keyframe.id,
          }),
        },
      );
      setFirstVideoPreflight(value);
      setMessage(
        `First-video preflight ready. Maximum external calls: ${value.externalCalls.maximum}. Calls made: 0.`,
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  async function startLockedVideo() {
    if (!firstVideoPreflight) return;
    if (
      !window.confirm(
        `START ONLY FIRST VIDEO?\nKeyframe: ${firstVideoPreflight.keyframe.artifactId} v${firstVideoPreflight.keyframe.version}\nVideo calls: 1\nSemantic calls: 1\nContinuity/voice/renderer: 0\nMaximum calls: 2\nAuto publish: NO`,
      )
    )
      return;
    setBusy("locked-video-start");
    try {
      const value = await api(
        `/api/v2.10/creative-drafts/${draft.id}/locked-keyframe/video-start`,
        {
          method: "POST",
          body: JSON.stringify({
            brandId,
            keyframeId: keyframeResult.keyframe.id,
            preflightId: firstVideoPreflight.preflightId,
            fingerprint: firstVideoPreflight.fingerprint,
            confirmation: true,
          }),
        },
      );
      setMessage(
        value.accepted
          ? "First conditioned video accepted. Remaining production is still stopped."
          : "First video failed validation. Remaining production is blocked.",
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <header className="page-header">
        <span className="eyebrow">V2.10 · OPERATOR CREATIVE</span>
        <h1>Creative Production</h1>
      </header>
      <p className="page-note">
        Write the ad, choose only valid catalog options, review voice and exact
        preflight, then explicitly start.
      </p>
      {message ? <div className="notice">{message}</div> : null}

      <div className="production-form creative-v210">
        <section className="panel operator-strip">
          <div className="form-grid">
            <SelectField label="BRAND" value={brandId} onChange={chooseBrand}>
              <option value="">Choose brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="DRAFT"
              value={draft?.id || ""}
              disabled={!brandId}
              onChange={(id) =>
                id
                  ? loadDraft(drafts.find((row) => row.id === id))
                  : resetEditor()
              }
            >
              <option value="">New draft</option>
              {drafts.map((row) => (
                <option key={row.id} value={row.id}>
                  {rowBrief(row)?.title || "Untitled"} · {statusText(row)} · r
                  {row.revision || 1}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="operator-summary">
            <span>
              {draft
                ? `Draft ${draft.id.slice(0, 8)} · ${statusText(draft)} · revision ${draft.revision || 1}`
                : "Unsaved draft"}
            </span>
            <button
              type="button"
              className="secondary"
              onClick={resetEditor}
              disabled={!brandId}
            >
              NEW DRAFT
            </button>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title">CREATIVE BRIEF</h2>
          <div className="form-grid">
            <Field
              label="TITLE"
              value={brief.title}
              area={false}
              onChange={(value) => setTop("title", value)}
            />
            <Field
              label="TARGET PLATFORM"
              value={brief.targetPlatform}
              area={false}
              onChange={(value) => setTop("targetPlatform", value)}
            />
            <Field
              label="TARGET DURATION SECONDS"
              value={brief.targetDurationSeconds}
              number
              area={false}
              onChange={(value) => setTop("targetDurationSeconds", value)}
            />
            <Field
              label="OBJECTIVE"
              value={brief.objective}
              onChange={(value) => setTop("objective", value)}
            />
            <Field
              label="HOOK"
              value={brief.hook}
              onChange={(value) => setTop("hook", value)}
            />
            <Field
              label="CORE MESSAGE"
              value={brief.coreMessage}
              onChange={(value) => setTop("coreMessage", value)}
            />
            <Field
              label="CTA"
              value={brief.cta}
              onChange={(value) => setTop("cta", value)}
            />
            <Field
              label="AUDIENCE INTENT"
              value={brief.audienceIntent}
              onChange={(value) => setTop("audienceIntent", value)}
            />
            <Field
              label="CREATIVE CONCEPT"
              value={brief.creativeConcept}
              onChange={(value) => setTop("creativeConcept", value)}
            />
            <Field
              label="VISUAL STYLE"
              value={brief.visualStyle}
              onChange={(value) => setTop("visualStyle", value)}
            />
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <h2 className="panel-title">
              STORYBOARD · {brief.storyboard.length} SHOTS
            </h2>
            <div>
              <button
                className="secondary"
                type="button"
                onClick={copyContinuityToShots}
              >
                COPY CONTINUITY TO SHOTS
              </button>
              <button
                className="secondary"
                type="button"
                disabled={brief.storyboard.length >= 5}
                onClick={add}
              >
                ADD SHOT
              </button>
            </div>
          </div>
          {brief.storyboard.map((shot, index) => {
            const advancedMissing =
              !specific(
                `${shot.framing} ${shot.camera} ${shot.lensComposition}`,
                5,
              ) ||
              !specific(shot.lighting) ||
              !specific(shot.continuity);
            return (
              <article className="shot-card" key={shot.shotId}>
                <div className="shot-head">
                  <strong>
                    SHOT {index + 1} · {shot.durationSeconds} sec
                  </strong>
                  <div>
                    <button
                      type="button"
                      aria-label="MOVE SHOT UP"
                      disabled={!index}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="MOVE SHOT DOWN"
                      disabled={index === brief.storyboard.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label="DUPLICATE SHOT"
                      disabled={brief.storyboard.length >= 5}
                      onClick={() => duplicate(index)}
                    >
                      DUPLICATE
                    </button>
                    <button
                      type="button"
                      aria-label="REMOVE SHOT"
                      disabled={brief.storyboard.length <= 2}
                      onClick={() => remove(index)}
                    >
                      REMOVE
                    </button>
                  </div>
                </div>
                <div className="role-row">
                  <span>ROLE</span>
                  {ROLES.map((role) => (
                    <label key={role}>
                      <input
                        type="checkbox"
                        checked={shot.roles.includes(role)}
                        onChange={(event) =>
                          setShot(
                            index,
                            "roles",
                            event.target.checked
                              ? [...shot.roles, role]
                              : shot.roles.filter((value) => value !== role),
                          )
                        }
                      />
                      {role}
                    </label>
                  ))}
                </div>
                <div className="form-grid">
                  <Field
                    label="DURATION SECONDS"
                    value={shot.durationSeconds}
                    number
                    area={false}
                    onChange={(value) =>
                      setShot(index, "durationSeconds", value)
                    }
                  />
                  <Field
                    label="PURPOSE"
                    value={shot.purpose}
                    onChange={(value) => setShot(index, "purpose", value)}
                  />
                  <Field
                    label="SUBJECT"
                    value={shot.subject}
                    onChange={(value) => setShot(index, "subject", value)}
                  />
                  <Field
                    label="ACTION"
                    value={shot.action}
                    onChange={(value) => setShot(index, "action", value)}
                  />
                  <Field
                    label="ENVIRONMENT"
                    value={shot.environment}
                    onChange={(value) => setShot(index, "environment", value)}
                  />
                  <Field
                    label="EMOTIONAL INTENT"
                    value={shot.emotionalIntent}
                    onChange={(value) =>
                      setShot(index, "emotionalIntent", value)
                    }
                  />
                  <Field
                    label="VOICEOVER SEGMENT"
                    value={shot.voiceoverSegment}
                    onChange={(value) =>
                      setShot(index, "voiceoverSegment", value)
                    }
                  />
                </div>
                <div className="continuity-bindings">
                  <strong>APPROVED CONTINUITY ENTITIES</strong>
                  <select
                    aria-label={`ADD CONTINUITY ENTITY SHOT ${index + 1}`}
                    value=""
                    onChange={(event) =>
                      addContinuityBinding(shot.shotId, event.target.value)
                    }
                  >
                    <option value="">Add approved entity…</option>
                    {continuityOptions.map((option) => (
                      <option
                        key={option.packId}
                        value={option.packId}
                        disabled={
                          option.authorityStatus !== "READY" ||
                          (video.continuityBindings || []).some(
                            (item) =>
                              item.shotId === shot.shotId &&
                              item.packId === option.packId,
                          )
                        }
                      >
                        {option.displayName} · {option.entityType} · r
                        {option.revision} · {option.referenceCount} refs ·{" "}
                        {option.authorityStatus}
                      </option>
                    ))}
                  </select>
                  {(video.continuityBindings || [])
                    .filter((item) => item.shotId === shot.shotId)
                    .map((binding, bindingIndex) => {
                      const option = continuityOptions.find(
                        (item) => item.packId === binding.packId,
                      );
                      return (
                        <div
                          className="key-value"
                          key={`${binding.packId}:${bindingIndex}`}
                        >
                          <span>{option?.displayName || binding.entityId}</span>
                          <p>
                            {option?.entityType || "CONTINUITY ENTITY"} ·
                            revision {option?.revision || "persisted"} ·{" "}
                            {option?.referenceCount ?? "exact"} references ·{" "}
                            {option?.authorityStatus || "PERSISTED"}
                          </p>
                          <button
                            type="button"
                            aria-label={`MOVE CONTINUITY UP ${binding.entityId}`}
                            disabled={!bindingIndex}
                            onClick={() =>
                              moveContinuityBinding(
                                shot.shotId,
                                bindingIndex,
                                -1,
                              )
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`MOVE CONTINUITY DOWN ${binding.entityId}`}
                            disabled={
                              bindingIndex ===
                              (video.continuityBindings || []).filter(
                                (item) => item.shotId === shot.shotId,
                              ).length -
                                1
                            }
                            onClick={() =>
                              moveContinuityBinding(
                                shot.shotId,
                                bindingIndex,
                                1,
                              )
                            }
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            aria-label={`REMOVE CONTINUITY ${binding.entityId}`}
                            onClick={() =>
                              removeContinuityBinding(shot.shotId, bindingIndex)
                            }
                          >
                            REMOVE
                          </button>
                        </div>
                      );
                    })}
                </div>
                <details className="shot-advanced" open={advancedMissing}>
                  <summary>
                    Visual direction{" "}
                    {advancedMissing
                      ? "· REQUIRED FIELDS MISSING"
                      : "· COMPLETE"}
                  </summary>
                  <div className="form-grid">
                    <Field
                      label="FRAMING"
                      value={shot.framing}
                      onChange={(value) => setShot(index, "framing", value)}
                    />
                    <Field
                      label="CAMERA"
                      value={shot.camera}
                      onChange={(value) => setShot(index, "camera", value)}
                    />
                    <Field
                      label="LENS COMPOSITION"
                      value={shot.lensComposition}
                      onChange={(value) =>
                        setShot(index, "lensComposition", value)
                      }
                    />
                    <Field
                      label="LIGHTING"
                      value={shot.lighting}
                      onChange={(value) => setShot(index, "lighting", value)}
                    />
                    <Field
                      label="CONTINUITY"
                      value={shot.continuity}
                      onChange={(value) => setShot(index, "continuity", value)}
                    />
                    <Field
                      label="NEGATIVE GUIDANCE"
                      value={shot.negativeGuidance}
                      onChange={(value) =>
                        setShot(index, "negativeGuidance", value)
                      }
                    />
                    <SelectField
                      label="REFERENCE"
                      value={shot.referencePolicy}
                      onChange={(value) =>
                        setShot(index, "referencePolicy", value)
                      }
                    >
                      <option>NONE</option>
                      <option>PREVIOUS_SHOT_FRAME</option>
                      <option>UPLOADED_REFERENCE</option>
                    </SelectField>
                  </div>
                </details>
              </article>
            );
          })}
        </section>

        <section className="panel">
          <h2 className="panel-title">LOCKED OPENING KEYFRAME</h2>
          <p className="boundary">
            This bounded workflow creates or stores only the opening still,
            validates it, and then waits for explicit approval. It cannot
            generate video, voice, continuity, a master, or publication
            implicitly.
          </p>
          <div className="form-grid">
            <SelectField
              label="KEYFRAME SOURCE"
              value={keyframeSource}
              onChange={(value) => {
                setKeyframeSource(value);
                setKeyframePreflight(null);
              }}
            >
              <option value="OPERATOR_UPLOAD">
                Operator upload · 0 image calls
              </option>
              <option value="AI_GENERATED">AI generated · 1 image call</option>
            </SelectField>
            {keyframeSource === "AI_GENERATED" ? (
              <>
                <SelectField
                  label="IMAGE PROVIDER"
                  value={keyframeRoute.provider}
                  onChange={chooseKeyframeProvider}
                >
                  <option value="">Choose configured provider</option>
                  {imageProviders.map((provider) => (
                    <option
                      key={provider.id}
                      value={provider.id}
                      disabled={!provider.configured}
                    >
                      {provider.displayName} · {humanProviderState(provider)}
                    </option>
                  ))}
                </SelectField>
                <Field
                  label="IMAGE MODEL"
                  value={keyframeRoute.model}
                  area={false}
                  onChange={(model) => {
                    setKeyframeRoute((current) => ({ ...current, model }));
                    setKeyframePreflight(null);
                  }}
                />
              </>
            ) : (
              <label>
                UPLOAD 9:16 KEYFRAME
                <input
                  aria-label="Upload keyframe"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    setKeyframeFile(event.target.files?.[0] || null);
                    setKeyframePreflight(null);
                  }}
                />
              </label>
            )}
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={
                !draft ||
                busy ||
                (keyframeSource === "AI_GENERATED" && !keyframeRoute.model)
              }
              onClick={preflightKeyframeStage}
            >
              KEYFRAME PREFLIGHT · 0 CALLS
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                !keyframePreflight ||
                busy ||
                (keyframeSource === "OPERATOR_UPLOAD" && !keyframeFile)
              }
              onClick={executeKeyframeStage}
            >
              EXECUTE KEYFRAME STAGE
            </button>
            <button
              type="button"
              className="secondary"
              disabled={
                keyframeResult?.validation?.status !== "PASS" ||
                busy ||
                keyframeResult?.keyframe?.approvalDecision === "APPROVED"
              }
              onClick={approveLockedKeyframe}
            >
              APPROVE EXACT KEYFRAME
            </button>
          </div>
          {keyframePreflight ? (
            <div className="plan-grid">
              <div className="key-value">
                <span>KEYFRAME CALLS</span>
                <p>
                  Image {keyframePreflight.externalCalls.imageGeneration} ·
                  Semantic{" "}
                  {keyframePreflight.externalCalls.semanticImageEvaluation} ·
                  Retries 0 · Maximum {keyframePreflight.externalCalls.maximum}
                </p>
              </div>
              <div className="key-value">
                <span>POLICY</span>
                <p>
                  HUMAN APPROVAL REQUIRED · AUTO PUBLISH NO · COST{" "}
                  {keyframePreflight.cost.status}
                </p>
              </div>
            </div>
          ) : null}
          {keyframeResult ? (
            <div className="voice-status-line">
              <span>KEYFRAME VALIDATION / APPROVAL</span>
              <strong
                className={
                  keyframeResult.validation.status === "PASS" ? "pass" : "fail"
                }
              >
                {keyframeResult.validation.status} ·{" "}
                {keyframeResult.keyframe.approvalDecision ||
                  "APPROVAL REQUIRED"}
              </strong>
            </div>
          ) : null}
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={
                !preflight ||
                preflight.status !== "READY" ||
                keyframeResult?.keyframe?.approvalDecision !== "APPROVED" ||
                busy
              }
              onClick={preflightLockedVideo}
            >
              FIRST VIDEO PREFLIGHT · 0 CALLS
            </button>
            <button
              type="button"
              className="primary"
              disabled={!firstVideoPreflight || busy}
              onClick={startLockedVideo}
            >
              START FIRST VIDEO ONLY
            </button>
          </div>
          {firstVideoPreflight ? (
            <div className="plan-grid">
              <div className="key-value">
                <span>EXACT REFERENCE</span>
                <p>
                  {firstVideoPreflight.keyframe.artifactId} · v
                  {firstVideoPreflight.keyframe.version} ·{" "}
                  {firstVideoPreflight.keyframe.contentHash}
                </p>
              </div>
              <div className="key-value">
                <span>BOUNDED EXECUTION</span>
                <p>
                  Video 1 · Semantic 1 · Voice 0 · Continuity 0 · Renderer 0 ·
                  Maximum 2
                </p>
              </div>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <h2 className="panel-title">CONTINUITY</h2>
          <div className="form-grid">
            {CONTINUITY_FIELDS.map((field) => (
              <Field
                key={field}
                label={field.replaceAll(/([A-Z])/g, " $1").toUpperCase()}
                value={brief.continuity[field]}
                onChange={(value) =>
                  edit((current) => ({
                    ...current,
                    continuity: { ...current.continuity, [field]: value },
                  }))
                }
              />
            ))}
            <SelectField
              label="REFERENCE POLICY"
              value={brief.continuity.referencePolicy}
              onChange={(value) =>
                edit((current) => ({
                  ...current,
                  continuity: { ...current.continuity, referencePolicy: value },
                }))
              }
            >
              <option>NONE</option>
              <option>PREVIOUS_SHOT_FRAME</option>
              <option>UPLOADED_REFERENCE</option>
            </SelectField>
          </div>
        </section>

        <section className="panel route-panel">
          <h2 className="panel-title">VIDEO ROUTE</h2>
          <p className="route-note">
            Only provider/model/profile combinations registered by the server
            are selectable. Capabilities and resolution are read-only catalog
            truth.
          </p>
          <div className="form-grid">
            <SelectField
              label="VIDEO PROVIDER"
              value={video.provider}
              onChange={chooseProvider}
            >
              <option value="">Choose configured provider</option>
              {videoProviders.map((provider) => (
                <option
                  key={provider.id}
                  value={provider.id}
                  disabled={!provider.configured}
                >
                  {provider.displayName} · {humanProviderState(provider)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="VIDEO MODEL"
              value={video.model}
              disabled={!video.provider}
              onChange={chooseModel}
            >
              <option value="">Choose model</option>
              {videoModels.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.displayName} · {model.modelFamily || model.vendor}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="VIDEO PROFILE"
              value={video.profile}
              disabled={!selectedModel}
              onChange={chooseProfile}
            >
              <option value="">Choose profile</option>
              {profiles.map((profile) => (
                <option key={profile}>{profile}</option>
              ))}
            </SelectField>
            <label>
              RESOLVED OUTPUT
              <input
                aria-label="RESOLVED OUTPUT"
                readOnly
                value={
                  effectiveResolution
                    ? `${effectiveResolution} source · 9:16 · final master 1080×1920`
                    : ""
                }
              />
            </label>
          </div>
          <VideoModelContractControls
            contract={modelContract}
            value={video.modelRequest}
            onChange={(modelRequest) => {
              setVideo((current) => ({ ...current, modelRequest }));
              invalidate();
            }}
          />
          <div className="route-truth-grid">
            <div>
              <span>MODEL FAMILY</span>
              <strong>{selectedModel?.modelFamily || "—"}</strong>
            </div>
            <div>
              <span>CAPABILITIES</span>
              <strong>
                {selectedModel?.capabilities
                  ?.filter((capability) =>
                    VIDEO_CAPABILITIES.includes(capability),
                  )
                  .join(" · ") || "—"}
              </strong>
            </div>
            <div>
              <span>CONTINUITY</span>
              <strong className={continuitySupported ? "pass" : "fail"}>
                {continuityRequested
                  ? continuitySupported
                    ? "SUPPORTED"
                    : "BLOCKED"
                  : "NOT REQUESTED"}
              </strong>
            </div>
            <div>
              <span>CONFIGURATION</span>
              <strong
                className={selectedProvider?.configured ? "pass" : "fail"}
              >
                {selectedProvider ? humanProviderState(selectedProvider) : "—"}
              </strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-title">VOICE STUDIO</h2>
          <SelectField
            label="VOICE"
            ariaLabel="Voice source type"
            value={brief.voice.sourceType || ""}
            onChange={setVoiceSource}
          >
            <option value="">No generated/uploaded voice</option>
            <option value="AI_PRESET">AI preset voice</option>
            <option value="PROVIDER_CUSTOM">
              Custom / cloned provider voice
            </option>
            <option value="UPLOADED_AUDIO">Uploaded human narration</option>
          </SelectField>
          {brief.voice.sourceType &&
          brief.voice.sourceType !== "UPLOADED_AUDIO" ? (
            <div className="form-grid voice-route">
              <SelectField
                label="VOICE PROVIDER"
                value={brief.voice.provider}
                onChange={chooseVoiceProvider}
              >
                <option value="">Choose configured speech provider</option>
                {voiceProviders.map((provider) => (
                  <option
                    key={provider.id}
                    value={provider.id}
                    disabled={!provider.configured}
                  >
                    {provider.displayName} · {humanProviderState(provider)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="VOICE MODEL"
                value={brief.voice.model}
                disabled={!brief.voice.provider}
                onChange={(value) =>
                  edit(
                    (current) => ({
                      ...current,
                      voice: { ...current.voice, model: value },
                    }),
                    true,
                  )
                }
              >
                <option value="">Choose model</option>
                {voiceModels.map((model) => (
                  <option key={model.modelId} value={model.modelId}>
                    {model.displayName}
                  </option>
                ))}
              </SelectField>
              {brief.voice.provider === "openai" ? (
                <SelectField
                  label="VOICE ID"
                  value={brief.voice.voiceId}
                  onChange={(value) =>
                    edit(
                      (current) => ({
                        ...current,
                        voice: { ...current.voice, voiceId: value },
                      }),
                      true,
                    )
                  }
                >
                  <option value="">Choose voice</option>
                  {OPENAI_VOICES.map((voice) => (
                    <option key={voice}>{voice}</option>
                  ))}
                </SelectField>
              ) : (
                <Field
                  label="VOICE ID"
                  value={brief.voice.voiceId}
                  area={false}
                  onChange={(value) =>
                    edit(
                      (current) => ({
                        ...current,
                        voice: { ...current.voice, voiceId: value },
                      }),
                      true,
                    )
                  }
                />
              )}
              <Field
                label="LANGUAGE"
                value={brief.voice.language}
                area={false}
                onChange={(value) =>
                  edit(
                    (current) => ({
                      ...current,
                      voice: { ...current.voice, language: value },
                    }),
                    true,
                  )
                }
              />
              <Field
                label="INSTRUCTIONS"
                value={brief.voice.instructions}
                onChange={(value) =>
                  edit(
                    (current) => ({
                      ...current,
                      voice: { ...current.voice, instructions: value },
                    }),
                    true,
                  )
                }
              />
              {brief.voice.sourceType === "PROVIDER_CUSTOM" ? (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={brief.voice.consent?.confirmed || false}
                    onChange={(event) =>
                      edit(
                        (current) => ({
                          ...current,
                          voice: {
                            ...current.voice,
                            consent: {
                              required: true,
                              confirmed: event.target.checked,
                              ownerRelationship:
                                current.voice.consent?.ownerRelationship ||
                                "SELF",
                              confirmedAt: new Date().toISOString(),
                              actor: "dashboard-operator",
                            },
                          },
                        }),
                        true,
                      )
                    }
                  />{" "}
                  I confirm explicit custom/cloned voice consent
                </label>
              ) : null}
            </div>
          ) : null}
          {brief.voice.sourceType === "UPLOADED_AUDIO" ? (
            <div className="voice-upload-box">
              <label>
                UPLOAD AUDIO
                <input
                  aria-label="Upload audio"
                  type="file"
                  accept="audio/wav,audio/mpeg,audio/mp4"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setUploadedFile(file);
                      setPreview({ localUrl: URL.createObjectURL(file) });
                      setMessage(
                        "Local audio preview ready. External calls: 0.",
                      );
                    }
                  }}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={attested}
                  onChange={(event) => setAttested(event.target.checked)}
                />{" "}
                The uploaded narration matches the approved spoken copy.
              </label>
            </div>
          ) : null}
          {preview?.localUrl ? <audio controls src={preview.localUrl} /> : null}
          {brief.voice.sourceType ? (
            <div className="voice-status-line">
              <span>VOICE APPROVAL</span>
              <strong className={brief.voice.approved ? "pass" : "fail"}>
                {brief.voice.approved ? "APPROVED" : "REQUIRED"}
              </strong>
            </div>
          ) : null}
          <div className="actions">
            {brief.voice.sourceType &&
            brief.voice.sourceType !== "UPLOADED_AUDIO" ? (
              <button
                type="button"
                aria-label="GENERATE VOICE PREVIEW"
                className="secondary"
                disabled={
                  !draft ||
                  busy ||
                  !brief.voice.provider ||
                  !brief.voice.model ||
                  !brief.voice.voiceId
                }
                onClick={generatePreview}
              >
                GENERATE VOICE PREVIEW · 1 CALL
              </button>
            ) : null}
            {brief.voice.sourceType === "UPLOADED_AUDIO" ? (
              <button
                type="button"
                className="secondary"
                disabled={!draft || busy || !uploadedFile || !attested}
                onClick={uploadVoice}
              >
                STORE UPLOAD · 0 CALLS
              </button>
            ) : null}
            {brief.voice.sourceType ? (
              <button
                type="button"
                className="secondary"
                disabled={
                  !preview ||
                  !draft ||
                  busy ||
                  Boolean(uploadedFile && !brief.voice.uploadedArtifactId)
                }
                onClick={useVoice}
              >
                USE THIS VOICE
              </button>
            ) : null}
          </div>
          <p className="boundary">
            Editing provider, model, voice, language or instructions invalidates
            voice approval. Nothing in this section calls a provider until
            GENERATE VOICE PREVIEW is explicitly confirmed.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title">POST PRODUCTION</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={brief.postProduction.endTitle.enabled}
              onChange={(event) =>
                edit((current) => ({
                  ...current,
                  postProduction: {
                    ...current.postProduction,
                    endTitle: {
                      ...current.postProduction.endTitle,
                      enabled: event.target.checked,
                    },
                  },
                }))
              }
            />{" "}
            End title enabled
          </label>
          {brief.postProduction.endTitle.enabled ? (
            <div className="form-grid">
              <Field
                label="END TITLE TEXT"
                area={false}
                value={brief.postProduction.endTitle.text}
                onChange={(value) =>
                  edit((current) => ({
                    ...current,
                    postProduction: {
                      ...current.postProduction,
                      endTitle: {
                        ...current.postProduction.endTitle,
                        text: value,
                      },
                    },
                  }))
                }
              />
              <Field
                label="END TITLE START"
                area={false}
                number
                value={brief.postProduction.endTitle.startTime}
                onChange={(value) =>
                  edit((current) => ({
                    ...current,
                    postProduction: {
                      ...current.postProduction,
                      endTitle: {
                        ...current.postProduction.endTitle,
                        startTime: value,
                      },
                    },
                  }))
                }
              />
              <Field
                label="END TITLE DURATION"
                area={false}
                number
                value={brief.postProduction.endTitle.duration}
                onChange={(value) =>
                  edit((current) => ({
                    ...current,
                    postProduction: {
                      ...current.postProduction,
                      endTitle: {
                        ...current.postProduction.endTitle,
                        duration: value,
                      },
                    },
                  }))
                }
              />
              <Field
                label="BRAND NAME"
                area={false}
                value={brief.postProduction.brandName}
                onChange={(value) =>
                  edit((current) => ({
                    ...current,
                    postProduction: {
                      ...current.postProduction,
                      brandName: value,
                    },
                  }))
                }
              />
            </div>
          ) : null}
          <p>
            Approved end-title text is rendered locally by FFmpeg and is never
            inserted into paid video prompts.
          </p>
        </section>

        <section className="panel">
          <h2 className="panel-title">CREATIVE VALIDATION</h2>
          <div className="validation-grid">
            {completeness.checks.map((check) => (
              <div key={check.name}>
                <span>{check.name}</span>
                <strong className={check.status.toLowerCase()}>
                  {check.status}
                </strong>
              </div>
            ))}
          </div>
          <div className="ready-summary">
            <div>
              <span>CREATIVE</span>
              <strong className={completeness.status.toLowerCase()}>
                {completeness.status}
              </strong>
            </div>
            <div>
              <span>VIDEO ROUTE</span>
              <strong className={routeReady ? "pass" : "fail"}>
                {routeReady ? "READY" : "SELECT ROUTE"}
              </strong>
            </div>
            <div>
              <span>REFERENCE SUPPORT</span>
              <strong className={continuitySupported ? "pass" : "fail"}>
                {continuitySupported ? "READY" : "BLOCKED"}
              </strong>
            </div>
            <div>
              <span>VOICE</span>
              <strong className={voiceReady ? "pass" : "fail"}>
                {voiceReady ? "READY" : "APPROVAL REQUIRED"}
              </strong>
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={!brandId || busy}
              onClick={save}
            >
              {busy === "save" ? "SAVING…" : "SAVE DRAFT · 0 CALLS"}
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                !brandId ||
                busy ||
                completeness.status !== "PASS" ||
                !routeReady ||
                !continuitySupported
              }
              onClick={runPreflight}
            >
              {busy === "preflight"
                ? "CHECKING…"
                : "FINAL PRODUCTION PREFLIGHT · 0 CALLS"}
            </button>
          </div>
        </section>

        <section
          className={`panel preflight ${preflight?.status === "READY" ? "preflight-ready" : ""}`}
        >
          <h2 className="panel-title">PRODUCTION PREFLIGHT</h2>
          {preflight ? (
            <>
              <div className="preflight-status">
                <span>STATUS</span>
                <strong
                  className={preflight.status === "READY" ? "pass" : "fail"}
                >
                  {preflight.status}
                </strong>
                {preflight.blockers?.length ? (
                  <code>{preflight.blockers.join(" · ")}</code>
                ) : null}
              </div>
              <div className="plan-grid">
                <div className="key-value">
                  <span>VIDEO</span>
                  <p>
                    {preflight.video?.providerDisplayName ||
                      preflight.video?.provider}{" "}
                    · {preflight.video?.model} · {preflight.video?.profile} ·{" "}
                    {preflight.video?.resolvedSettings?.resolution ||
                      "provider default"}
                  </p>
                </div>
                <div className="key-value">
                  <span>CREATIVE</span>
                  <p>
                    {preflight.creative.storyboardShots} shots ·{" "}
                    {preflight.creative.completeness} · continuity{" "}
                    {preflight.creative.continuity}
                  </p>
                </div>
                <div className="key-value">
                  <span>VOICE</span>
                  <p>
                    {preflight.voice?.sourceType || "NO VOICE"} ·{" "}
                    {preflight.voice?.previewApproved
                      ? "APPROVED"
                      : "NO APPROVAL REQUIRED / PENDING"}
                  </p>
                </div>
                <div className="key-value">
                  <span>EXTERNAL CALLS</span>
                  <p>
                    Video {preflight.externalCalls.video} · Speech{" "}
                    {preflight.externalCalls.speech} · Semantic{" "}
                    {preflight.externalCalls.semantic} · Maximum{" "}
                    {preflight.externalCalls.maximum}
                  </p>
                </div>
                <div className="key-value">
                  <span>MASTER</span>
                  <p>
                    {preflight.master?.profile} · {preflight.master?.resolution}{" "}
                    · {preflight.master?.fps} fps
                  </p>
                </div>
                <div className="key-value">
                  <span>POLICY</span>
                  <p>
                    HUMAN APPROVAL REQUIRED · AUTO PUBLISH NO · COST{" "}
                    {preflight.costStatus}
                  </p>
                </div>
              </div>
              {preflight.operationPlans?.length ? (
                <div className="collection">
                  <h3>EXACT VIDEO OPERATIONS</h3>
                  {preflight.operationPlans.map((operation) => (
                    <div className="key-value" key={operation.operationNodeId}>
                      <span>{operation.shotId}</span>
                      <p>
                        {operation.provider} · {operation.model} ·{" "}
                        {operation.modelContractVersion || "legacy contract"} ·{" "}
                        {operation.resolvedInputMode} ·{" "}
                        {operation.resolvedModelParameters?.durationSeconds ??
                          operation.resolvedModelParameters?.duration ??
                          "shot duration"}
                        s ·{" "}
                        {operation.resolvedModelParameters?.resolution ||
                          "provider resolution"}{" "}
                        ·{" "}
                        {operation.resolvedModelParameters?.aspectRatio ||
                          "provider aspect"}{" "}
                        · audio{" "}
                        {operation.resolvedModelParameters?.generateAudio
                          ? "ON"
                          : "OFF"}{" "}
                        · calls {operation.expectedProviderCalls} ·{" "}
                        {(operation.continuityPacks || [])
                          .map(
                            (pack) =>
                              `${pack.displayName || pack.entityId} · ${pack.entityType || "CONTINUITY ENTITY"} · r${pack.packRevision} · ${pack.referenceCount ?? "exact"} refs`,
                          )
                          .join(" · ") || "no continuity entities"}{" "}
                        · {operation.orderedReferences?.length || 0} ordered
                        refs · request {operation.requestFingerprint}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              <button
                className="start"
                onClick={start}
                disabled={
                  preflight.status !== "READY" ||
                  completeness.status === "FAIL" ||
                  !voiceReady ||
                  busy
                }
              >
                {busy === "start" ? "STARTING…" : "START PRODUCTION"}
              </button>
            </>
          ) : (
            <p>
              No final preflight yet. Editing creative, route or voice
              invalidates the previous fingerprint.
            </p>
          )}
        </section>

        <button
          type="button"
          className="advanced-toggle"
          onClick={() => setAdvanced(!advanced)}
        >
          Advanced / Technical {advanced ? "−" : "+"}
        </button>
        {advanced ? (
          <pre className="canonical">
            {JSON.stringify(
              {
                draftId: draft?.id || null,
                brief,
                requestedVideo: currentProviderSelection(),
                selectedModel: selectedModel
                  ? {
                      provider: video.provider,
                      modelId: selectedModel.modelId,
                      modelFamily: selectedModel.modelFamily,
                      profiles: selectedModel.profiles,
                      capabilities: selectedModel.capabilities,
                      configured: selectedProvider?.configured,
                    }
                  : null,
                preflight,
              },
              null,
              2,
            )}
          </pre>
        ) : null}
      </div>
    </main>
  );
}
