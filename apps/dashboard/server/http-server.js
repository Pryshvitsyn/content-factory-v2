'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { ControlError } = require('./control-service');
const { continuationPreflight, continueRecoveredV210 } = require('./v210-quality-resume');

const BODY_LIMIT = 16 * 1024;
const ASSET_BODY_LIMIT = 36 * 1024 * 1024;

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  response.end(body);
}

function safeErrorDetails(error) {
  const validation = error?.details?.validation || error?.details?.quality;
  if (!validation) return error?.details || undefined;
  return { validation, providerExecutions: Number(error.details?.providerExecutions || 0) };
}

async function readJson(request, limit = BODY_LIMIT) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new ControlError(413, 'BODY_TOO_LARGE', 'Request body is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ControlError(400, 'INVALID_JSON', 'Request body must be valid JSON'); }
}

function createControlServer({ service, creativeService = null, lockedKeyframeService = null,
  qualityDirectorService = null, avatarService = null, logger = console } = {}) {
  if (!service) throw new Error('service is required');
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (avatarService && request.method === 'GET' && url.pathname === '/api/avatar-studio/verticals') {
        return json(response, 200, await avatarService.verticals());
      }
      if (avatarService && request.method === 'GET' && url.pathname === '/api/avatar-studio/avatars') {
        return json(response, 200, await avatarService.list({ brandId: url.searchParams.get('brandId'),
          vertical: url.searchParams.get('vertical') }));
      }
      if (avatarService && request.method === 'GET' && url.pathname === '/api/avatar-studio/gate0-reviews') {
        return json(response, 200, await avatarService.reviewQueue({ brandId: url.searchParams.get('brandId') }));
      }
      if (avatarService && request.method === 'POST' && url.pathname === '/api/avatar-studio/avatars') {
        return json(response, 201, await avatarService.create(await readJson(request)));
      }
      if (avatarService && request.method === 'GET' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments.length === 4) {
        return json(response, 200, await avatarService.avatar({ id: segments[3], brandId: url.searchParams.get('brandId') }));
      }
      if (avatarService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'smoke-readiness' && segments.length === 5) {
        return json(response,200,await avatarService.smokeReadiness({avatarId:segments[3],...await readJson(request)}));
      }
      if (avatarService && request.method === 'GET' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'passport-lab' && segments.length === 5) {
        return json(response, 200, await avatarService.passportLab({ avatarId: segments[3], brandId: url.searchParams.get('brandId') }));
      }
      if (avatarService && request.method === 'GET' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'body-expressions-lab' && segments.length === 5) {
        return json(response,200,await avatarService.bodyExpressionsLab({avatarId:segments[3],workspaceId:url.searchParams.get('workspaceId'),
          brandId:url.searchParams.get('brandId'),vertical:url.searchParams.get('vertical'),identityVersionId:url.searchParams.get('identityVersionId')}));
      }
      if (avatarService && request.method === 'GET' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'intakes' && segments.length === 5) {
        return json(response, 200, await avatarService.listIntakes({ avatarId: segments[3], brandId: url.searchParams.get('brandId') }));
      }
      if (avatarService && request.method === 'GET' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'existing-assets' && segments.length === 5) {
        return json(response, 200, await avatarService.existingAssets({ avatarId: segments[3], brandId: url.searchParams.get('brandId') }));
      }
      if (avatarService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'intakes' && segments.length === 5) {
        return json(response, 201, await avatarService.intakeAsset({ avatarId: segments[3], ...await readJson(request, ASSET_BODY_LIMIT) }));
      }
      if (avatarService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'intakes' && segments.length === 7) {
        const args = { avatarId: segments[3], intakeId: segments[5], ...await readJson(request) };
        if (segments[6] === 'review') return json(response, 201, await avatarService.reviewIntake(args));
        if (segments[6] === 'consent-requests') return json(response, 201, await avatarService.requestConsent(args));
        if (segments[6] === 'consents') return json(response, 201, await avatarService.grantConsent(args));
        if (segments[6] === 'revoke-consent') return json(response, 201, await avatarService.revokeConsent(args));
        if (segments[6] === 'use') return json(response, 201, await avatarService.useIntake(args));
      }
      if (avatarService && request.method === 'GET' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'intakes' && segments[4] === 'content' && segments.length === 5) {
        const content = await avatarService.intakeContent({ intakeId: segments[3], brandId: url.searchParams.get('brandId'),
          avatarId: url.searchParams.get('avatarId') });
        response.writeHead(200, { 'Content-Type': content.contentType, 'Content-Length': content.bytes.length,
          'Content-Disposition': `inline; filename="${String(content.filename).replace(/["\\\r\n]/g, '_')}"`,
          'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        return response.end(content.bytes);
      }
      if (avatarService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments.length === 5) {
        const body = await readJson(request);
        const args = { avatarId: segments[3], ...body };
        if (segments[4] === 'identity') return json(response, 201, await avatarService.updateIdentity(args));
        if (segments[4] === 'sources') return json(response, 201, await avatarService.importSource(args));
        if (segments[4] === 'passports') return json(response, 201, await avatarService.registerPassport(args));
        if (segments[4] === 'identity-locks') return json(response, 201, await avatarService.createIdentityLock(args));
        if (segments[4] === 'source-viewpoints') return json(response, 201, await avatarService.recordSourceViewpoint(args));
        if (segments[4] === 'passport-generation-plans') return json(response, 201, await avatarService.planPassportGeneration(args));
        if (segments[4] === 'passport-candidates') return json(response, 201, await avatarService.uploadPassportCandidate(args));
        if (segments[4] === 'body-builds') return json(response,201,await avatarService.createBodyBuild(args));
        if (segments[4] === 'l2-generation-plans') return json(response,201,await avatarService.planL2Reference(args));
        if (segments[4] === 'l2-candidates') return json(response,201,await avatarService.uploadL2Candidate(args));
        if (segments[4] === 'l2-certification') return json(response,201,await avatarService.certifyL2Pack(args));
        if (segments[4] === 'level-assets') return json(response, 201, await avatarService.addLevelAsset(args));
      }
      if (avatarService && request.method === 'GET' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'l2-readiness' && segments.length === 5) {
        return json(response,200,await avatarService.l2Readiness({avatarId:segments[3],workspaceId:url.searchParams.get('workspaceId'),
          brandId:url.searchParams.get('brandId'),vertical:url.searchParams.get('vertical'),identityVersionId:url.searchParams.get('identityVersionId')}));
      }
      if (avatarService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'l2-candidates' && segments.length === 7) {
        const args={avatarId:segments[3],candidateId:segments[5],...await readJson(request)};
        if(segments[6]==='qa')return json(response,201,await avatarService.runL2Qa(args));
        if(segments[6]==='review')return json(response,201,await avatarService.reviewL2Candidate(args));
        if(segments[6]==='certify')return json(response,201,await avatarService.certifyL2Reference(args));
      }
      if (avatarService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'l2-generation-plans' && segments[6] === 'preflight' && segments.length === 7) {
        return json(response,201,await avatarService.preflightL2Generation({avatarId:segments[3],generationSpecId:segments[5],...await readJson(request)}));
      }
      if (avatarService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'l2-executions' && segments.length === 7) {
        const args={avatarId:segments[3],executionId:segments[5],...await readJson(request)};
        if(segments[6]==='approve')return json(response,201,await avatarService.approveL2Generation(args));
        if(segments[6]==='generate')return json(response,202,await avatarService.generateL2Candidates(args));
      }
      if (avatarService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'passport-candidates' && segments.length === 7) {
        const args = { avatarId: segments[3], candidateId: segments[5], ...await readJson(request) };
        if (segments[6] === 'qa') return json(response, 201, await avatarService.runPassportQa(args));
        if (segments[6] === 'review') return json(response, 201, await avatarService.reviewPassportCandidate(args));
        if (segments[6] === 'certify') return json(response, 201, await avatarService.certifyPassportCandidate(args));
      }
      if (avatarService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'passport-generation-plans' && segments[6] === 'preflight'
        && segments.length === 7) {
        return json(response, 201, await avatarService.preflightPassportGeneration({ avatarId: segments[3],
          generationSpecId: segments[5], ...await readJson(request) }));
      }
      if (avatarService && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'passport-executions' && segments.length === 6
        && request.method === 'GET') {
        return json(response, 200, await avatarService.passportExecution({ id: segments[5], avatarId: segments[3],
          workspaceId: url.searchParams.get('workspaceId'), brandId: url.searchParams.get('brandId'),
          vertical: url.searchParams.get('vertical'), identityVersionId: url.searchParams.get('identityVersionId') }));
      }
      if (avatarService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'passport-executions' && segments.length === 7) {
        const args = { avatarId: segments[3], executionId: segments[5], ...await readJson(request) };
        if (segments[6] === 'approve') return json(response, 201, await avatarService.approvePassportGeneration(args));
        if (segments[6] === 'generate') return json(response, 202, await avatarService.generatePassportCandidates(args));
        if (segments[6] === 'cancel') return json(response, 201, await avatarService.cancelPassportExecution(args));
      }
      if (avatarService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'avatar-studio'
        && segments[2] === 'avatars' && segments[4] === 'passports' && segments[6] === 'certify' && segments.length === 7) {
        return json(response, 201, await avatarService.certifyPassport({ avatarId: segments[3], passportId: segments[5],
          ...await readJson(request) }));
      }
      if (avatarService && request.method === 'POST' && url.pathname === '/api/avatar-studio/test-content/plan') {
        return json(response, 201, await avatarService.compileTestPlan(await readJson(request)));
      }
      if (creativeService && request.method === 'GET' && url.pathname === '/api/v2.10/creative-drafts') {
        return json(response, 200, await creativeService.listDrafts({ brandId: url.searchParams.get('brandId'),
          limit: url.searchParams.get('limit') || 20 }));
      }
      if (creativeService && request.method === 'GET' && segments[0] === 'api' && segments[1] === 'v2.10'
        && segments[2] === 'creative-drafts' && segments.length === 4) {
        return json(response, 200, await creativeService.getDraft({ id: segments[3], brandId: url.searchParams.get('brandId') }));
      }
      if (qualityDirectorService && request.method === 'GET' && segments[0] === 'api' && segments[1] === 'v2.10'
        && segments[2] === 'creative-drafts' && segments[4] === 'quality-director' && segments.length === 5) {
        return json(response, 200, await qualityDirectorService.state({ id: segments[3], brandId: url.searchParams.get('brandId') }));
      }
      if (creativeService && request.method === 'POST' && url.pathname === '/api/v2.10/creative-drafts') {
        return json(response, 201, await creativeService.createDraft(await readJson(request)));
      }
      if (creativeService && request.method === 'PATCH' && segments[0] === 'api' && segments[1] === 'v2.10'
        && segments[2] === 'creative-drafts' && segments.length === 4) {
        return json(response, 200, await creativeService.updateDraft({ id: segments[3], ...await readJson(request) }));
      }
      if (creativeService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'v2.10'
        && segments[2] === 'creative-drafts' && segments.length === 5) {
        const args = { id: segments[3], ...await readJson(request, segments[4] === 'voice-upload' ? 70 * 1024 * 1024 : BODY_LIMIT) };
        if (segments[4] === 'preflight') return json(response, 200, await creativeService.preflight(args));
        if (segments[4] === 'voice-preview') return json(response, 200, await creativeService.generateVoicePreview(args));
        if (segments[4] === 'voice-approve') return json(response, 200, await creativeService.approveVoice(args));
        if (segments[4] === 'voice-upload') return json(response, 201, await creativeService.uploadVoice(args));
        if (segments[4] === 'start') return json(response, 202, await creativeService.start(args));
      }
      if (qualityDirectorService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'v2.10'
        && segments[2] === 'creative-drafts' && segments[4] === 'quality-director' && segments.length === 6) {
        const action = segments[5];
        const args = { id: segments[3], ...await readJson(request) };
        if (action === 'script-generate') return json(response, 200, await qualityDirectorService.generateScript(args));
        if (action === 'script-save') return json(response, 201, await qualityDirectorService.saveScript(args));
        if (action === 'script-approve') return json(response, 200, await qualityDirectorService.approveScript(args));
        if (action === 'storyboard-generate') return json(response, 200, await qualityDirectorService.generateStoryboard(args));
        if (action === 'storyboard-save') return json(response, 201, await qualityDirectorService.saveStoryboard(args));
        if (action === 'storyboard-approve') return json(response, 200, await qualityDirectorService.approveStoryboard(args));
        if (action === 'pilot-approve') return json(response, 200, await qualityDirectorService.approvePilot(args));
        if (action === 'pilot-reject') return json(response, 200, await qualityDirectorService.rejectPilot(args));
      }
      if (lockedKeyframeService && request.method === 'POST' && segments[0] === 'api' && segments[1] === 'v2.10'
        && segments[2] === 'creative-drafts' && segments[4] === 'locked-keyframe' && segments.length === 6) {
        const action = segments[5];
        const large = action === 'execute';
        const args = { id: segments[3], ...await readJson(request, large ? 36 * 1024 * 1024 : BODY_LIMIT) };
        if (action === 'preflight') return json(response, 200, await lockedKeyframeService.preflightKeyframe(args));
        if (action === 'execute') return json(response, 202, await lockedKeyframeService.executeKeyframe(args));
        if (action === 'approve') return json(response, 200, await lockedKeyframeService.approveKeyframe(args));
        if (action === 'video-preflight') return json(response, 200, await lockedKeyframeService.preflightFirstVideo(args));
        if (action === 'video-start') return json(response, 202, await lockedKeyframeService.startFirstVideo(args));
      }
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, await service.health());
      if (request.method === 'GET' && url.pathname === '/api/overview') return json(response, 200, await service.overview());
      if (request.method === 'GET' && url.pathname === '/api/brands') return json(response, 200, await service.listBrands());
      if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'brands' && segments.length === 3) {
        return json(response, 200, await service.getBrand(segments[2]));
      }
      if (request.method === 'GET' && url.pathname === '/api/productions') {
        return json(response, 200, await service.listProductions({ brandId: url.searchParams.get('brandId'),
          status: url.searchParams.get('status'), renderMode: url.searchParams.get('renderMode'),
          needsReview: url.searchParams.get('needsReview') === 'true', failed: url.searchParams.get('failed') === 'true' }));
      }
      if (request.method === 'POST' && url.pathname === '/api/productions/preflight') {
        return json(response, 200, await service.preflightProduction(await readJson(request)));
      }
      if (request.method === 'POST' && url.pathname === '/api/productions') {
        return json(response, 201, await service.createProduction(await readJson(request)));
      }
      if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'productions'
        && segments[3] === 'shots' && segments.length === 6 && ['preflight','regenerate'].includes(segments[5])) {
        const body = await readJson(request);
        const args = { productionId: segments[2], shotId: segments[4], ...body };
        if (segments[5] === 'preflight') return json(response, 200, await service.preflightShotRegeneration(args));
        return json(response, 202, await service.regenerateShot(args));
      }
      if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'productions'
        && segments[3] === 'quality-recovery' && segments.length === 6 && segments[4] === 'continue'
        && segments[5] === 'preflight') {
        if (!creativeService) throw new ControlError(503, 'V210_RESUME_UNAVAILABLE', 'V2.10 production service is unavailable');
        const body = await readJson(request);
        return json(response, 200, await continuationPreflight({ service, creativeService,
          productionId: segments[2], brandId: body.brandId }));
      }
      if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'productions'
        && segments[3] === 'quality-recovery' && segments.length === 5 && segments[4] === 'continue') {
        if (!creativeService) throw new ControlError(503, 'V210_RESUME_UNAVAILABLE', 'V2.10 production service is unavailable');
        const body = await readJson(request);
        return json(response, 202, await continueRecoveredV210({ service, creativeService,
          productionId: segments[2], brandId: body.brandId, confirmation: body.confirmation }));
      }
      if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'productions'
        && segments[3] === 'quality-recovery' && segments.length === 5 && segments[4] === 'preflight') {
        const body = await readJson(request);
        return json(response, 200, await service.preflightQualityRecovery({ productionId: segments[2], ...body }));
      }
      if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'productions'
        && segments[3] === 'quality-recovery' && segments.length === 4) {
        const body = await readJson(request);
        return json(response, 200, await service.recoverQualityEvidence({ productionId: segments[2], ...body }));
      }
      if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'productions'
        && segments[3] === 'semantic-retry' && segments.length === 5 && segments[4] === 'preflight') {
        const body = await readJson(request);
        return json(response, 200, await service.preflightSemanticRetry({ productionId: segments[2], ...body }));
      }
      if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'productions'
        && segments[3] === 'semantic-retry' && segments.length === 4) {
        const body = await readJson(request);
        return json(response, 202, await service.retrySemanticEvaluation({ productionId: segments[2], ...body }));
      }
      if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'productions'
        && segments.length === 4 && ['start','retry','regenerate'].includes(segments[3])) {
        const body = await readJson(request);
        if (segments[3] === 'start') return json(response, 202, await service.startProduction({ productionId: segments[2], ...body }));
        if (segments[3] === 'retry') return json(response, 202, await service.retryProduction({ productionId: segments[2], ...body }));
        return json(response, 201, await service.regenerateProduction({ productionId: segments[2], ...body }));
      }
      if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'productions' && segments.length === 3) {
        return json(response, 200, await service.production(segments[2], url.searchParams.get('brandId')));
      }
      if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'productions' && segments[3] === 'stages' && segments.length === 4) {
        return json(response, 200, await service.stages(segments[2], url.searchParams.get('brandId')));
      }
      if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'productions' && segments[3] === 'artifacts' && segments.length === 4) {
        return json(response, 200, await service.artifacts(segments[2], url.searchParams.get('brandId')));
      }
      if (request.method === 'GET' && url.pathname === '/api/reviews') {
        return json(response, 200, await service.reviews({ brandId: url.searchParams.get('brandId'), includeDecided: url.searchParams.get('history') === 'true' }));
      }
      if (request.method === 'POST' && segments[0] === 'api' && segments[1] === 'reviews' && segments.length === 4 && ['approve','reject'].includes(segments[3])) {
        const body = await readJson(request);
        return json(response, 200, await service.decide({ reviewItemId: segments[2], brandId: body.brandId, decision: segments[3], reason: body.reason }));
      }
      if (request.method === 'GET' && url.pathname === '/api/providers') {
        return json(response, 200, typeof service.listProviders === 'function' ? await service.listProviders() : service.providers);
      }
      if (request.method === 'GET' && url.pathname === '/api/media-stack') {
        return json(response, 200, await service.mediaStackCatalog());
      }
      if (request.method === 'POST' && url.pathname === '/api/provider-models') {
        return json(response, 201, await service.addProviderModel(await readJson(request)));
      }
      if (request.method === 'GET' && segments[0] === 'api' && segments[1] === 'artifacts' && segments[3] === 'versions' && segments[5] === 'content' && segments.length === 6) {
        const content = await service.artifactContent({ sourceId: url.searchParams.get('sourceId'), artifactId: segments[2], version: segments[4], brandId: url.searchParams.get('brandId') });
        response.writeHead(200, { 'Content-Type': content.contentType, 'Content-Length': content.bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        return response.end(content.bytes);
      }
      return json(response, 404, { error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' } });
    } catch (error) {
      const status = error instanceof ControlError || Number.isInteger(error.status) ? error.status : 500;
      if (status === 500) logger.error?.('Control API error', { code: error.code || 'INTERNAL_ERROR', message: error.message });
      const details = safeErrorDetails(error);
      return json(response, status, { error: { code: error.code || 'INTERNAL_ERROR',
        message: status === 500 ? 'Internal server error' : error.message,
        ...(details ? { details } : {}) } });
    }
  });
}

module.exports = { createControlServer, readJson, safeErrorDetails, ASSET_BODY_LIMIT, BODY_LIMIT };
