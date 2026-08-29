'use strict';

const { stableFingerprint } = require('../v2.5/production-input');
const { createProductionRuntime } = require('../v2.7/production-runtime');
const { V210CanonicalProductionStarter, V210RuntimeError, buildCanonicalV210Input } = require('./runtime-integration');
const { V210PostProductionRenderer, V210ReferenceAwareMediaExecutor } = require('./reference-aware-media');

function integratedEnvironment(env, input, live) {
  const audioProvider = input.mediaStack?.audio?.voice?.provider === 'operator-upload' ? 'operator-upload'
    : input.mediaStack?.audio?.voice?.provider === 'elevenlabs' ? 'elevenlabs'
      : input.voiceover?.enabled ? 'openai-media' : 'none';
  return { ...env, LIVE_PAID_GENERATION: live ? 'true' : 'false', REAL_PRODUCTION_INPUT: 'dashboard://v2.10',
    RENDER_MODE: 'QUALITY', VIDEO_PROVIDER: input.qualityVideoProfile.provider, AUDIO_PROVIDER: audioProvider,
    QUALITY_VIDEO_PROVIDER: input.qualityVideoProfile.provider, QUALITY_VIDEO_MODEL: input.qualityVideoProfile.model,
    QUALITY_VIDEO_PROFILE: input.qualityVideoProfile.name,
    LIVE_PRODUCTION_WORKER_ID: env.LIVE_PRODUCTION_WORKER_ID || `v2.10:${process.pid}` };
}

function revisionSafeCanonical({ draft, preflight }) {
  const canonical = buildCanonicalV210Input({ draft, preflight });
  const identitySource = { ...canonical.input };
  delete identitySource.fingerprint;
  delete identitySource.productionKey;
  delete identitySource.liveTestKey;
  const executionIdentityFingerprint = stableFingerprint(identitySource);
  const productionKey = `v210-${draft.id}-${executionIdentityFingerprint.slice(0, 16)}`;
  const normalized = { ...canonical.input, productionKey, liveTestKey: productionKey };
  delete normalized.fingerprint;
  const input = Object.freeze({ ...normalized, fingerprint: stableFingerprint(normalized) });
  const raw = Object.freeze({ ...canonical.raw, production_key: productionKey });
  return Object.freeze({ ...canonical, raw, input, productionKey, executionIdentityFingerprint });
}

class V210IntegratedProductionStarter extends V210CanonicalProductionStarter {
  runtime(input, live) {
    const env = integratedEnvironment(this.env, input, live);
    const config = this.configResolver(env, input);
    const runtime = createProductionRuntime({ db: this.db, storage: this.storage, config, env, logger: this.logger,
      mediaInspector: this.mediaInspector,
      mediaExecutorDecorator: (delegate) => new V210ReferenceAwareMediaExecutor({ delegate, storage: this.storage }),
      masterRenderer: new V210PostProductionRenderer({ postProduction: input.postProduction || null }),
    });
    return { ...runtime, config, env };
  }

  async preflight({ draft, preflight }) {
    const canonical = revisionSafeCanonical({ draft, preflight });
    const runtime = this.runtime(canonical.input, false);
    const prepared = await runtime.service.prepare({ input: canonical.input, config: runtime.config });
    return Object.freeze({ canonicalInputFingerprint: canonical.input.fingerprint, plan: prepared.plan,
      providerExecutions: 0, canonical });
  }

  async start({ draft, preflight, actor }) {
    if (this.env.LIVE_PAID_GENERATION !== 'true') {
      throw new V210RuntimeError('V210_EXECUTION_DISABLED',
        'LIVE_PAID_GENERATION=true is required after reviewing the final V2.10 preflight');
    }
    const canonical = revisionSafeCanonical({ draft, preflight });
    const runtime = this.runtime(canonical.input, true);
    try { this.credentialCheck({ config: runtime.config, input: canonical.input, env: runtime.env }); }
    catch (error) {
      throw new V210RuntimeError(error.code || 'V210_CREDENTIALS_MISSING', error.message,
        { boundaryState: 'NOT_CROSSED' });
    }
    let productionId = null;
    try {
      const rows = await runtime.service.createDraft({ input: canonical.input, config: runtime.config,
        command: { source: 'v2.7-operator-console', requestId: draft.id, actor,
          canonicalRawInput: canonical.raw, canonicalRequest: canonical.canonicalRequest } });
      productionId = rows.production.id;
      await this.seedUploadedVoice({ draft, productionId, canonical, runtime });
      this.scheduler(() => runtime.service.run({ input: canonical.input, config: runtime.config }));
      return Object.freeze({ productionId, jobId: rows.job.id, accepted: true, boundaryState: 'CANONICAL_CREATED',
        canonicalInputFingerprint: canonical.input.fingerprint, publicationTriggered: false });
    } catch (error) {
      if (error instanceof V210RuntimeError) {
        if (productionId && error.boundaryState === 'NOT_CROSSED') error.boundaryState = 'CANONICAL_CREATED';
        if (!error.productionId && productionId) error.productionId = productionId;
        throw error;
      }
      throw new V210RuntimeError(error.code || 'V210_CANONICAL_START_FAILED', error.message,
        { boundaryState: productionId ? 'CANONICAL_CREATED' : 'NOT_CROSSED', details: error.details || null, productionId });
    }
  }
}

module.exports = { V210IntegratedProductionStarter, integratedEnvironment, revisionSafeCanonical };
