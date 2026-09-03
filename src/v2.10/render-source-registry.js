'use strict';
const { canonicalRenderSource, validateRenderRequest } = require('./render-source-contract');
class RenderSourceError extends Error { constructor(code, message) { super(message); this.code = code; this.status = 409; } }
class RenderSourceRegistry {
  constructor({ adapters = [] } = {}) { this.adapters = new Map(); adapters.forEach((adapter) => this.register(adapter)); }
  register(adapter) { const manifest = canonicalRenderSource(adapter?.describe?.()); if (!manifest.rendererId) throw new Error('Registered renderer adapter must describe a rendererId'); if (!['function','function','function'].every((_, i) => typeof [adapter.describe, adapter.validateRequest, adapter.preflight][i] === 'function')) throw new Error('Registered renderer adapter contract is incomplete'); this.adapters.set(manifest.rendererId, adapter); return manifest; }
  describe(rendererId) { const adapter = this.adapters.get(rendererId); return adapter ? canonicalRenderSource(adapter.describe()) : null; }
  async preflight({ rendererId, request }) { const adapter = this.adapters.get(rendererId); if (!adapter) throw new RenderSourceError('RENDERER_ADAPTER_NOT_REGISTERED', `Renderer '${rendererId}' is not server-side registered`); const validation = validateRenderRequest(adapter.describe(), request); if (validation.status !== 'PASS') throw new RenderSourceError(validation.code, 'Renderer request is not supported'); await adapter.validateRequest(request); return adapter.preflight(request); }
  async render({ rendererId, request }) { const adapter = this.adapters.get(rendererId); if (!adapter) throw new RenderSourceError('RENDERER_ADAPTER_NOT_REGISTERED', `Renderer '${rendererId}' is not server-side registered`); const validation = validateRenderRequest(adapter.describe(), request); if (validation.status !== 'PASS') throw new RenderSourceError(validation.code, 'Renderer request is not supported'); await adapter.validateRequest(request); return adapter.render(request); }
}
module.exports = { RenderSourceRegistry, RenderSourceError };
