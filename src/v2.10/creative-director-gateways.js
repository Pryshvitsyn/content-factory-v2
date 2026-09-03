'use strict';
// Provider-neutral roles. Runtime wiring must provide an explicit route; absence never falls back.
class DirectorGatewayError extends Error { constructor(code, message) { super(message); this.code = code; this.status = 409; } }
class ConfiguredDirectorGateway {
  constructor({ route = null, invoke = null } = {}) { this.route = route; this.invoke = invoke; }
  configured() { return Boolean(this.route?.provider && this.route?.model && this.invoke); }
  async call(role, input) { if (!this.configured()) throw new DirectorGatewayError('AI_DIRECTOR_NOT_CONFIGURED', `${role} has no explicitly configured provider/model route`); return this.invoke({ role, route: this.route, input }); }
}
function provenance({ role, route, inputFingerprint, brandId, workspaceId, actor, candidateId = null, evaluation = null }) { return Object.freeze({ provider: route.provider, model: route.model, role, requestFingerprint: inputFingerprint, inputCreativeFingerprint: inputFingerprint, brandId, workspaceId, actor, candidateId, criticEvaluation: evaluation, createdAt: new Date().toISOString() }); }
module.exports = { ConfiguredDirectorGateway, DirectorGatewayError, provenance };
