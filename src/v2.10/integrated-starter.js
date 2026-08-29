'use strict';

const { createProductionRuntime } = require('../v2.7/production-runtime');
const { V210CanonicalProductionStarter } = require('./runtime-integration');
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
}

module.exports = { V210IntegratedProductionStarter, integratedEnvironment };
