"use strict";

const crypto = require("node:crypto");
const {
  resolveVideoModelRequest,
  getVideoModelContract,
  INPUT_MODES,
} = require("../v2.8/video-model-contracts");
const {
  ProviderCompatibleMediaResolver,
} = require("./provider-media-resolver");
const {
  compileReferenceInputPlan,
  providerNeutralReferences,
} = require("./reference-input-plan");

class WorkflowEngineError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "WorkflowEngineError";
    this.code = code;
    this.status = 409;
    this.details = details;
  }
}
function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function geometryFor(workflowRevision, contract, mode, settings) {
  if (
    [
      INPUT_MODES.FIRST_LAST_FRAME,
      INPUT_MODES.VIDEO_EDITING,
      INPUT_MODES.VIDEO_EXTENSION,
    ].includes(mode)
  )
    return "adaptive";
  const fallback =
    workflowRevision.workflowType === "SOCIAL_VERTICAL" ? "9:16" : "16:9";
  const target =
    settings.aspectRatio ||
    workflowRevision.configuration?.targetAspectRatio ||
    workflowRevision.outputExpectations?.find((item) => item.aspectRatio)
      ?.aspectRatio ||
    fallback;
  return contract.parameters.aspectRatio.values.includes(target)
    ? target
    : contract.parameters.aspectRatio.contentFactoryDefault;
}
function compileRoleReferences(mode, references, limits = {}) {
  return providerNeutralReferences(
    compileReferenceInputPlan({ resolvedInputMode: mode, references, limits }),
  );
}

class DurableProductionWorkflowEngine {
  constructor({
    operationRegistry,
    artifactResolver,
    providerMediaResolver = null,
    durableMediaExecutor = null,
    continuityAuthority = null,
    executionAuthority = null,
    env = process.env,
  } = {}) {
    if (!operationRegistry || !artifactResolver?.resolve)
      throw new Error("operationRegistry and artifactResolver are required");
    this.operations = operationRegistry;
    this.artifacts = artifactResolver;
    this.providerMedia =
      providerMediaResolver || new ProviderCompatibleMediaResolver();
    this.mediaExecutor = durableMediaExecutor;
    this.continuityAuthority = continuityAuthority;
    this.executionAuthority = executionAuthority;
    this.env = env;
  }

  async resolveReferences({
    workspaceId,
    brandId,
    continuityBindings,
    provider,
    model,
  }) {
    const requested = continuityBindings?.bindings || continuityBindings || [];
    if (requested.length && !this.continuityAuthority?.resolve) {
      throw new WorkflowEngineError(
        "CONTINUITY_AUTHORITY_REQUIRED",
        "Injected durable ContinuityAuthority is required",
      );
    }
    const output = [];
    for (const binding of requested) {
      const resolved = await this.continuityAuthority.resolve({
        workspaceId,
        consumerBrandId: brandId,
        packId: binding.packId,
        fingerprint: binding.packFingerprint,
      });
      if (resolved.pack.entityId !== binding.entityId)
        throw new WorkflowEngineError(
          "CONTINUITY_ENTITY_MISMATCH",
          "Resolved continuity entity does not match the requested binding",
        );
      for (const reference of resolved.references) {
        const artifact = await this.artifacts.resolve({
          workspaceId,
          brandId: resolved.row.owner_brand_id,
          consumerBrandId: brandId,
          artifactId: reference.artifactId,
          version: reference.artifactVersion,
        });
        if (
          !artifact ||
          artifact.contentHash !== reference.sha256 ||
          !Buffer.isBuffer(artifact.bytes) ||
          hash(artifact.bytes) !== reference.sha256
        ) {
          throw new WorkflowEngineError(
            "REFERENCE_ARTIFACT_HASH_MISMATCH",
            `Immutable reference ${reference.artifactId} does not match its approved version/hash`,
          );
        }
        const media = await this.providerMedia.resolve({
          artifact,
          reference,
          provider,
          model,
          purpose: "GENERATE_VIDEO_REFERENCE",
        });
        output.push(
          Object.freeze({
            ...reference,
            ...media.evidence,
            providerValue: media.providerValue,
            sourceType: "CONTINUITY_ENTITY",
            ownerBrandId: resolved.row.owner_brand_id,
            entityId: resolved.pack.entityId,
            entityRevision: resolved.pack.revision,
            packId: resolved.row.id,
            packFingerprint: resolved.pack.revisionFingerprint,
            durationSeconds:
              reference.durationSeconds || artifact.durationSeconds || 0,
          }),
        );
      }
    }
    return Object.freeze(output);
  }

  async preflightGenerateVideo({
    workflowRevision,
    nodeId,
    continuityBindings,
    provider,
    model,
    resolvedInputMode,
    prompt,
    promptRevision,
    promptHash,
    settings = {},
    maximumCostUsd = null,
  } = {}) {
    const node = workflowRevision.nodes.find((item) => item.id === nodeId);
    if (!node || node.operationType !== "GENERATE_VIDEO")
      throw new WorkflowEngineError(
        "GENERATE_VIDEO_NODE_REQUIRED",
        "A GENERATE_VIDEO workflow node is required",
      );
    const operation = this.operations.validate(node),
      contract = getVideoModelContract(provider, model);
    if (!contract)
      throw new WorkflowEngineError(
        "VIDEO_MODEL_CONTRACT_NOT_FOUND",
        `No reviewed model contract for ${provider}/${model}`,
      );
    if (
      !promptRevision ||
      !promptHash ||
      hash(Buffer.from(String(prompt || ""))) !== promptHash
    ) {
      throw new WorkflowEngineError(
        "PROMPT_FINGERPRINT_MISMATCH",
        "Prompt revision and exact prompt hash are required",
      );
    }
    const exactReferences = await this.resolveReferences({
      workspaceId: workflowRevision.workspaceId,
      brandId: workflowRevision.brandId,
      continuityBindings,
      provider,
      model,
    });
    const referencePlan = compileReferenceInputPlan({
      resolvedInputMode,
      references: exactReferences,
      limits: contract.limits,
    });
    const aspectRatio = geometryFor(
      workflowRevision,
      contract,
      resolvedInputMode,
      settings,
    );
    const request = resolveVideoModelRequest({
      provider,
      model,
      request: {
        resolvedInputMode,
        prompt,
        ...settings,
        aspectRatio,
        ...providerNeutralReferences(referencePlan),
      },
    });
    const authority = this.executionAuthority?.inspect
      ? await this.executionAuthority.inspect({
          workflowRevision,
          nodeId,
          requestFingerprint: request.requestFingerprint,
          modelContractVersion: request.modelContractVersion,
          maximumCostUsd,
          referencePlan,
        })
      : { approved: false };
    const blockers = [];
    if (request.pricing?.status === "UNKNOWN_CURRENT_PRICE")
      blockers.push("PRICE_NOT_VERIFIABLE");
    if (maximumCostUsd == null) blockers.push("MAXIMUM_COST_REQUIRED");
    if (!authority?.approved)
      blockers.push("DURABLE_EXECUTION_APPROVAL_REQUIRED");
    const orderedInputs = exactReferences.map((value, index) => ({
      ...value,
      providerValue: undefined,
      providerAlias: `[${value.role}${index + 1}]`,
    }));
    const identity = {
      workflowFingerprint: workflowRevision.workflowFingerprint,
      workflowRevision: workflowRevision.revision,
      operationNodeId: nodeId,
      operationContractVersion: operation.contractVersion,
      provider,
      model,
      modelContractVersion: request.modelContractVersion,
      resolvedInputMode,
      promptRevision,
      promptHash,
      referencePlanFingerprint: referencePlan.fingerprint,
      orderedInputs,
      requestFingerprint: request.requestFingerprint,
      settings: {
        duration: request.resolvedRequest.duration,
        resolution: request.resolvedRequest.resolution,
        aspectRatio: request.resolvedRequest.aspectRatio,
        generateAudio: request.resolvedRequest.generateAudio,
        watermark: request.resolvedRequest.watermark,
        outputFormat: request.resolvedRequest.outputFormat,
        seed: request.resolvedRequest.seed ?? null,
      },
    };
    const summary = {
      schemaVersion: "generate-video-preflight@3",
      ...identity,
      providerPayloadFields: Object.keys(request.providerInput),
      expectedProviderCalls: 1,
      pricing: request.pricing,
      maximumCostUsd,
      approvalCurrent: authority?.approved === true,
      blockers,
      startable: blockers.length === 0,
    };
    return Object.freeze({
      ...summary,
      preflightFingerprint: hash(Buffer.from(JSON.stringify(summary))),
      providerCalls: 0,
      externalGenerationCalls: 0,
    });
  }

  async executeGenerateVideo({ approvedPreflight, request, execution } = {}) {
    if (!approvedPreflight?.preflightFingerprint)
      throw new WorkflowEngineError(
        "GENERATION_PREFLIGHT_BLOCKED",
        "An approved exact preflight is required",
      );
    if (!this.executionAuthority?.verify)
      throw new WorkflowEngineError(
        "EXECUTION_AUTHORITY_REQUIRED",
        "Injected durable ExecutionAuthority is required",
      );
    await this.executionAuthority.verify({
      approvedPreflight,
      request,
      execution,
    });
    const rebuilt = await this.preflightGenerateVideo(request);
    if (
      rebuilt.preflightFingerprint !== approvedPreflight.preflightFingerprint ||
      rebuilt.requestFingerprint !== approvedPreflight.requestFingerprint
    ) {
      throw new WorkflowEngineError(
        "EXECUTION_REQUEST_FINGERPRINT_MISMATCH",
        "Execution input differs from the approved exact preflight",
      );
    }
    if (!rebuilt.startable)
      throw new WorkflowEngineError(
        "GENERATION_PREFLIGHT_BLOCKED",
        "Exact GENERATE_VIDEO preflight is not startable",
        { blockers: rebuilt.blockers },
      );
    if (this.env.LIVE_PAID_GENERATION !== "true")
      throw new WorkflowEngineError(
        "LIVE_PAID_GENERATION_DISABLED",
        "Paid generation is disabled",
      );
    if (!this.mediaExecutor?.execute)
      throw new WorkflowEngineError(
        "DURABLE_MEDIA_EXECUTOR_REQUIRED",
        "V2.5 durable media executor is required",
      );
    const exact = await this.resolveReferences({
      workspaceId: request.workflowRevision.workspaceId,
      brandId: request.workflowRevision.brandId,
      continuityBindings: request.continuityBindings,
      provider: request.provider,
      model: request.model,
    });
    const contract = getVideoModelContract(request.provider, request.model);
    const referencePlan = compileReferenceInputPlan({
      resolvedInputMode: request.resolvedInputMode,
      references: exact,
      limits: contract.limits,
    });
    const compiled = providerNeutralReferences(referencePlan);
    const references = {
      first_frame: compiled.image?.providerValue || null,
      last_frame: compiled.lastFrameImage?.providerValue || null,
      character_images: compiled.referenceImages.map(
        (item) => item.providerValue,
      ),
      reference_videos: compiled.referenceVideos.map(
        (item) => item.providerValue,
      ),
      reference_audios: compiled.referenceAudios.map(
        (item) => item.providerValue,
      ),
    };
    const asset = {
      asset_id: execution.assetId,
      kind: "video",
      description: request.prompt,
      generation_requirements: {
        provider: request.provider,
        model: request.model,
        profile: request.settings?.profile || "STANDARD",
        capability: "video-generation",
        prompt: request.prompt,
        resolved_input_mode: rebuilt.resolvedInputMode,
        generation_duration_seconds: rebuilt.settings.duration,
        target_clip_duration_ms:
          rebuilt.settings.duration > 0
            ? rebuilt.settings.duration * 1000
            : null,
        resolution: rebuilt.settings.resolution,
        aspect_ratio: rebuilt.settings.aspectRatio,
        generate_audio: rebuilt.settings.generateAudio,
        output_format: rebuilt.settings.outputFormat,
        seed: rebuilt.settings.seed,
        references,
        reference_input_plan_fingerprint: referencePlan.fingerprint,
        workflow_preflight_fingerprint: rebuilt.preflightFingerprint,
        request_fingerprint: rebuilt.requestFingerprint,
      },
    };
    return this.mediaExecutor.execute({
      workspaceId: request.workflowRevision.workspaceId,
      brandId: request.workflowRevision.brandId,
      productionId: execution.productionId,
      workerId: execution.workerId,
      asset,
    });
  }
}

module.exports = {
  WorkflowEngineError,
  DurableProductionWorkflowEngine,
  compileRoleReferences,
  geometryFor,
};
