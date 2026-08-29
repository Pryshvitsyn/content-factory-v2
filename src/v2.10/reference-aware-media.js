'use strict';

const crypto = require('node:crypto');
const { FfmpegMasterRenderer } = require('../v2.1/ffmpeg-master-renderer');
const { FfmpegFrameSampler } = require('../v2.9/frame-sampler');

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function dataUri(contentType, bytes) { return `data:${contentType};base64,${bytes.toString('base64')}`; }

class V210PostProductionRenderer {
  constructor({ postProduction = null, delegate = null } = {}) {
    this.postProduction = postProduction;
    this.delegate = delegate || new FfmpegMasterRenderer();
  }
  async render({ assembly, ...rest }) {
    const resolved = this.postProduction ? Object.freeze({ ...assembly, postProduction: this.postProduction }) : assembly;
    return this.delegate.render({ assembly: resolved, ...rest });
  }
}

class V210ReferenceAwareMediaExecutor {
  constructor({ delegate, storage, frameSampler = null } = {}) {
    if (!delegate || !storage) throw new Error('delegate and storage are required');
    this.delegate = delegate; this.storage = storage; this.frameSampler = frameSampler || new FfmpegFrameSampler();
    this.repository = delegate.repository; this.artifactService = delegate.artifactService;
    this.mediaInspector = delegate.mediaInspector; this.assetRepository = delegate.assetRepository;
  }
  selection(asset) { return this.delegate.selection(asset); }
  identities(args) { return this.delegate.identities(args); }
  async readVerified(storageKey, contentHash, code = 'REFERENCE_EVIDENCE_MISSING') {
    if (!storageKey || !contentHash) fail(code, 'Immutable reference storage key and content hash are required');
    const bytes = await this.storage.get({ key: storageKey });
    if (hash(bytes) !== contentHash) fail('REFERENCE_EVIDENCE_HASH_MISMATCH', 'Immutable reference bytes do not match recorded content hash');
    return bytes;
  }
  async materializePrevious({ workspaceId, brandId, productionId, asset, reference }) {
    const row = await this.repository.get({ workspaceId, brandId, productionId, assetId: reference.previousAssetId });
    if (!row || row.status !== 'SUCCEEDED' || !row.artifact_storage_key || !row.artifact_content_hash) {
      fail('REFERENCE_EVIDENCE_MISSING', `Previous shot asset ${reference.previousAssetId || 'unknown'} is not a succeeded immutable video`);
    }
    const bytes = await this.readVerified(row.artifact_storage_key, row.artifact_content_hash);
    const probe = row.media_probe || {};
    const frames = await this.frameSampler.sample({ bytes, contentType: row.content_type || 'video/mp4', kind: 'video',
      durationMs: probe.durationMs || row.duration_ms, width: probe.width, height: probe.height,
      qualityTier: asset.generation_requirements?.profile || 'STANDARD' });
    const frame = frames[frames.length - 1];
    if (!frame?.jpeg?.length) fail('REFERENCE_EVIDENCE_MISSING', 'Could not extract immutable previous-shot reference frame');
    return { bytes: frame.jpeg, contentType: 'image/jpeg', evidence: {
      policy: 'PREVIOUS_SHOT_FRAME', previousAssetId: reference.previousAssetId,
      sourceArtifactStorageKey: row.artifact_storage_key, sourceArtifactContentHash: row.artifact_content_hash,
      timestampMs: frame.timestampMs, analysisHash: frame.analysisHash, referenceHash: hash(frame.jpeg),
    } };
  }
  async materializeUploaded(reference) {
    const artifact = reference.artifact || {};
    const storageKey = artifact.storageKey || artifact.storage_key;
    const contentHash = artifact.contentHash || artifact.content_hash;
    const bytes = await this.readVerified(storageKey, contentHash);
    return { bytes, contentType: artifact.contentType || artifact.content_type || 'image/jpeg', evidence: {
      policy: 'UPLOADED_REFERENCE', artifactId: artifact.artifactId || artifact.id,
      version: artifact.version || 1, storageKey, contentHash, referenceHash: hash(bytes),
    } };
  }
  async materializeAsset(args) {
    const asset = args.asset;
    const reference = asset?.generation_requirements?.v210_reference;
    if (!reference) return asset;
    let materialized;
    if (reference.policy === 'PREVIOUS_SHOT_FRAME') {
      materialized = await this.materializePrevious({ ...args, reference });
    } else if (reference.policy === 'UPLOADED_REFERENCE') {
      materialized = await this.materializeUploaded(reference);
    } else fail('REFERENCE_POLICY_UNSUPPORTED', `Unsupported V2.10 reference policy '${reference.policy}'`);
    const capability = reference.capability || asset.generation_requirements?.capability || 'IMAGE_TO_VIDEO';
    const uri = dataUri(materialized.contentType, materialized.bytes);
    const references = capability === 'REFERENCE_TO_VIDEO'
      ? { character_images: [uri] }
      : { first_frame: uri };
    return Object.freeze({ ...asset, generation_requirements: Object.freeze({
      ...asset.generation_requirements, capability, references: Object.freeze(references),
      v210_reference_evidence: Object.freeze(materialized.evidence),
    }) });
  }
  async execute(args) {
    const asset = await this.materializeAsset(args);
    return this.delegate.execute({ ...args, asset });
  }
  async loadExisting(args) {
    const asset = await this.materializeAsset(args);
    return this.delegate.loadExisting({ ...args, asset });
  }
}

module.exports = { V210PostProductionRenderer, V210ReferenceAwareMediaExecutor, dataUri };
