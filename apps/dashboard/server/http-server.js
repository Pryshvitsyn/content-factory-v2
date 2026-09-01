'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { ControlError } = require('./control-service');
const { continuationPreflight, continueRecoveredV210 } = require('./v210-quality-resume');

const BODY_LIMIT = 16 * 1024;

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  response.end(body);
}

function safeErrorDetails(error) {
  const validation = error?.details?.validation || error?.details?.quality;
  if (!validation) return undefined;
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

function createControlServer({ service, creativeService = null, lockedKeyframeService = null, logger = console } = {}) {
  if (!service) throw new Error('service is required');
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (creativeService && request.method === 'GET' && url.pathname === '/api/v2.10/creative-drafts') {
        return json(response, 200, await creativeService.listDrafts({ brandId: url.searchParams.get('brandId'),
          limit: url.searchParams.get('limit') || 20 }));
      }
      if (creativeService && request.method === 'GET' && segments[0] === 'api' && segments[1] === 'v2.10'
        && segments[2] === 'creative-drafts' && segments.length === 4) {
        return json(response, 200, await creativeService.getDraft({ id: segments[3], brandId: url.searchParams.get('brandId') }));
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

module.exports = { createControlServer, readJson, safeErrorDetails, BODY_LIMIT };
