'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { createControlServer } = require('../apps/dashboard/server/http-server');

function request(server, method, path, body = null) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const call = http.request({ host: '127.0.0.1', port: address.port, method, path,
      headers: body ? { 'Content-Type': 'application/json' } : {} }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => resolve({
        status: response.statusCode, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    call.on('error', reject); if (body) call.write(JSON.stringify(body)); call.end();
  });
}

async function main() {
  let providerCalls = 0; const calls = [];
  const avatarService = {
    async verticals() { return [{ code: 'TRAVEL' }]; },
    async list(value) { calls.push(['list', value]); return []; },
    async create(value) { calls.push(['create', value]); return { id: 'avatar-1', currentLevel: 0 }; },
    async updateIdentity(value) { calls.push(['updateIdentity', value]); return { identityVersion: { version: 2 } }; },
    async avatar(value) { calls.push(['avatar', value]); return { id: value.id }; },
    async passportLab(value) { calls.push(['passportLab', value]); return { id: value.avatarId, currentLevel: 0 }; },
    async bodyExpressionsLab(value) { calls.push(['l2Lab',value]); return {id:value.avatarId,currentLevel:1}; },
    async smokeReadiness(value) { calls.push(['smokeReadiness',value]); return {ready:false,checks:{OPENAI_API_KEY:'NO'},externalGenerationCalls:0}; },
    async motionPilotState(value) { calls.push(['motionPilotState',value]); return { execution:{id:value.executionId||'11111111-1111-4111-8111-111111111111'} }; },
    async reviewMotionPilotIdentity(value) { calls.push(['motionPilotIdentityReview',value]); return { identity:'FAIL',motionPilotQualityStatus:'REJECTED' }; },
    async createBodyBuild(value) { calls.push(['bodyBuild',value]); return {bodyBuild:{id:'build-1'}}; },
    async planL2Reference(value) { calls.push(['l2Plan',value]); return {id:'l2-plan-1',externalGenerationCalls:0}; },
    async uploadL2Candidate(value) { calls.push(['l2Upload',value]); return {candidate:{id:'l2-candidate-1'}}; },
    async runL2Qa(value) { calls.push(['l2Qa',value]); return {qaSnapshot:{id:'l2-qa-1'},automatedCertification:false}; },
    async reviewL2Candidate(value) { calls.push(['l2Review',value]); return {reviewEvent:{action:value.action}}; },
    async certifyL2Reference(value) { calls.push(['l2ReferenceCertify',value]); return {levelUnchanged:true}; },
    async l2Readiness(value) { calls.push(['l2Readiness',value]); return {status:'READY_FOR_FINAL_CERTIFICATION'}; },
    async certifyL2Pack(value) { calls.push(['l2PackCertify',value]); return {avatar:{currentLevel:2}}; },
    async preflightL2Generation(value) { calls.push(['l2Preflight',value]); return {executionId:'l2-execution-1',externalGenerationCalls:0}; },
    async approveL2Generation(value) { calls.push(['l2Approve',value]); return {status:'APPROVED',externalGenerationCalls:0}; },
    async generateL2Candidates(value) { calls.push(['l2Generate',value]); providerCalls+=1; return {status:'GENERATED',automaticRetries:0}; },
    async createIdentityLock(value) { calls.push(['identityLock', value]); return { identityLock: { id: 'lock-1' } }; },
    async planPassportGeneration(value) { calls.push(['passportPlan', value]); return { id: 'plan-1', paidProviderCalls: 0, externalGenerationCalls: 0 }; },
    async preflightPassportGeneration(value) { calls.push(['passportPreflight',value]); return {executionId:'execution-1',providerCalls:0}; },
    async approvePassportGeneration(value) { calls.push(['passportApprove',value]); return {status:'APPROVED',providerCalls:0}; },
    async generatePassportCandidates(value) { calls.push(['passportGenerate',value]); providerCalls+=1; return {status:'GENERATED'}; },
    async passportExecution(value) { calls.push(['passportExecution',value]); return {id:value.id,status:'APPROVED'}; },
    async cancelPassportExecution(value) { calls.push(['passportCancel',value]); return {status:'CANCELLED',providerCalls:0}; },
    async uploadPassportCandidate(value) { calls.push(['passportCandidate', value]); return { candidate: { id: 'candidate-1' }, externalGenerationCalls: 0 }; },
    async runPassportQa(value) { calls.push(['passportQa', value]); return { qaSnapshot: { id: 'qa-1' }, automatedCertification: false }; },
    async reviewPassportCandidate(value) { calls.push(['passportReview', value]); return { reviewEvent: { action: value.action } }; },
    async certifyPassportCandidate(value) { calls.push(['passportCandidateCertify', value]); return { avatar: { currentLevel: 1 }, paidProviderCalls: 0 }; },
    async reviewQueue(value) { calls.push(['reviewQueue', value]); return []; },
    async listIntakes(value) { calls.push(['listIntakes', value]); return []; },
    async identityCoverage(value) { calls.push(['identityCoverage', value]); return { status:'NOT_READY' }; },
    async intakeIdentityBatch(value) { calls.push(['identityBatch', value]); return { photos:value.photos, coverage:{status:'NOT_READY'}, paidProviderCalls:0, externalGenerationCalls:0 }; },
    async existingAssets(value) { calls.push(['existingAssets', value]); return []; },
    async intakeAsset(value) { calls.push(['intakeAsset', value]); return { asset: { id: 'intake-1' }, gate0: { status: 'PASS' } }; },
    async reviewIntake(value) { calls.push(['reviewIntake', value]); return { event: { action: value.action } }; },
    async requestConsent(value) { calls.push(['requestConsent', value]); return { externalCalls: 0 }; },
    async grantConsent(value) { calls.push(['grantConsent', value]); return { event: { status: 'APPROVED' } }; },
    async revokeConsent(value) { calls.push(['revokeConsent', value]); return { event: { status: 'REVOKED' } }; },
    async useIntake(value) { calls.push(['useIntake', value]); return { paidProviderCalls: 0, externalGenerationCalls: 0 }; },
    async importSource(value) { calls.push(['source', value]); return { gate0: { status: 'PASS', externalCalls: 0 } }; },
    async recordSourceViewpoint(value) { calls.push(['sourceViewpoint', value]); return { effectiveViewpoint: value.value, paidProviderCalls: 0, externalGenerationCalls: 0 }; },
    async registerPassport(value) { calls.push(['passport', value]); return { passport: { id: 'passport-1' } }; },
    async certifyPassport(value) { calls.push(['certify', value]); return { avatar: { currentLevel: 1 } }; },
    async addLevelAsset(value) { calls.push(['asset', value]); return { asset: {} }; },
    async compileTestPlan(value) { calls.push(['plan', value]); return { externalCallCount: 0, expectedPaidCalls: 0 }; },
  };
  const server = createControlServer({ service: {}, avatarService, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal((await request(server, 'GET', '/api/avatar-studio/verticals')).status, 200);
    assert.equal((await request(server, 'GET', '/api/avatar-studio/avatars?brandId=brand-1&vertical=TRAVEL')).status, 200);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars', { internalName: 'Mara' })).status, 201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/identity',
      { brandId: 'brand-1', identity: { personality: 'calm' } })).status, 201);
    assert.equal((await request(server, 'GET', '/api/avatar-studio/avatars/avatar-1/passport-lab?brandId=brand-1')).status, 200);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/smoke-readiness',{brandId:'brand-1',kind:'PASSPORT'})).status,200);
    const motionScope={workspaceId:'workspace-1',brandId:'brand-1',vertical:'TRAVEL',identityVersionId:'11111111-1111-4111-8111-111111111111'};
    const validMotionExecution='11111111-1111-4111-8111-111111111111',validMotionAttempt='22222222-2222-4222-8222-222222222222';
    assert.equal((await request(server,'GET',`/api/avatar-studio/avatars/avatar-1/motion-pilot-executions/${validMotionExecution}?workspaceId=workspace-1&brandId=brand-1&vertical=TRAVEL&identityVersionId=identity-1`)).status,200);
    assert.equal((await request(server,'POST',`/api/avatar-studio/avatars/avatar-1/motion-pilot-executions/${validMotionExecution}/identity-review`,{...motionScope,attemptId:validMotionAttempt,decision:'FAIL',reasonCode:'BODY_DRIFT'})).status,201);
    const malformedMotion=await request(server,'POST','/api/avatar-studio/avatars/avatar-1/motion-pilot-executions/undefined/identity-review',{...motionScope,attemptId:validMotionAttempt,decision:'FAIL',reasonCode:'BODY_DRIFT'});
    assert.equal(malformedMotion.status,400);assert.equal(malformedMotion.payload.error.code,'MOTION_PILOT_EXECUTION_ID_INVALID');
    assert.equal((await request(server,'GET','/api/avatar-studio/avatars/avatar-1/body-expressions-lab?workspaceId=workspace-1&brandId=brand-1&vertical=TRAVEL&identityVersionId=identity-1')).status,200);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/identity-locks',
      { brandId: 'brand-1', humanApproval: true })).status, 201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/passport-generation-plans',
      { brandId: 'brand-1', sourceAssetIds: ['source-1'] })).status, 201);
    const executionScope={workspaceId:'workspace-1',brandId:'brand-1',vertical:'TRAVEL',identityVersionId:'identity-1'};
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/passport-generation-plans/plan-1/preflight',
      {...executionScope,maximumAllowedCost:5,executionCandidateCount:1})).status,201);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/passport-executions/execution-1/approve',
      {...executionScope,explicitConfirmation:true,unknownCostAcknowledged:true})).status,201);
    assert.equal((await request(server,'GET','/api/avatar-studio/avatars/avatar-1/passport-executions/execution-1?workspaceId=workspace-1&brandId=brand-1&vertical=TRAVEL&identityVersionId=identity-1')).status,200);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/passport-executions/execution-1/generate',executionScope)).status,202);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/passport-executions/execution-2/cancel',executionScope)).status,201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/passport-candidates',
      { brandId: 'brand-1', generationSpecId: 'plan-1', intakeId: 'intake-1' })).status, 201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/passport-candidates/candidate-1/qa',
      { brandId: 'brand-1' })).status, 201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/passport-candidates/candidate-1/review',
      { brandId: 'brand-1', action: 'KEEP', humanApproval: true })).status, 201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/passport-candidates/candidate-1/certify',
      { brandId: 'brand-1', humanApproval: true, explicitConfirmation: true })).status, 201);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/body-builds',{...executionScope,humanApproval:true,profile:{}})).status,201);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/l2-generation-plans',{...executionScope,kind:'BODY',referenceType:'CHEST_UP_NEUTRAL'})).status,201);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/l2-generation-plans/l2-plan-1/preflight',{...executionScope,maximumAllowedCost:1})).status,201);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/l2-executions/l2-execution-1/approve',{...executionScope,explicitConfirmation:true,unknownCostAcknowledged:true})).status,201);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/l2-executions/l2-execution-1/generate',executionScope)).status,202);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/l2-candidates',{...executionScope,kind:'BODY',generationSpecId:'l2-plan-1',intakeId:'intake-1'})).status,201);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/l2-candidates/l2-candidate-1/qa',{...executionScope,kind:'BODY'})).status,201);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/l2-candidates/l2-candidate-1/review',{...executionScope,kind:'BODY',action:'KEEP',humanApproval:true})).status,201);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/l2-candidates/l2-candidate-1/certify',{...executionScope,kind:'BODY',explicitConfirmation:true,humanApproval:true})).status,201);
    assert.equal((await request(server,'GET','/api/avatar-studio/avatars/avatar-1/l2-readiness?workspaceId=workspace-1&brandId=brand-1&vertical=TRAVEL&identityVersionId=identity-1')).status,200);
    assert.equal((await request(server,'POST','/api/avatar-studio/avatars/avatar-1/l2-certification',{...executionScope,explicitConfirmation:true,humanApproval:true})).status,201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/sources', { brandId: 'brand-1' })).status, 201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/source-viewpoints', { brandId: 'brand-1', sourceId: 'source-1', value: 'FRONTAL', humanApproval: true })).status, 201);
    assert.equal((await request(server, 'GET', '/api/avatar-studio/gate0-reviews?brandId=brand-1')).status, 200);
    assert.equal((await request(server, 'GET', '/api/avatar-studio/avatars/avatar-1/intakes?brandId=brand-1')).status, 200);
    assert.equal((await request(server, 'GET', '/api/avatar-studio/avatars/avatar-1/existing-assets?brandId=brand-1')).status, 200);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/intakes',
      { brandId: 'brand-1', sourceType: 'UPLOAD', file: { contentBase64: 'AA==' } })).status, 201);
    // Normal photo bytes travel individually through the 36 MB asset route; the V1 batch is small intake-ID metadata.
    for (const id of ['a','b','c']) assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/intakes',
      { brandId:'brand-1', sourceType:'UPLOAD', file:{name:`phone-${id}.jpg`,mimeType:'image/jpeg',contentBase64:'x'.repeat(20 * 1024)} })).status,201);
    const identityBatch=await request(server,'POST','/api/avatar-studio/avatars/avatar-1/identity-photo-batches',
      {brandId:'brand-1',photos:[{intakeId:'intake-a',viewpoint:'FRONTAL'},{intakeId:'intake-b',viewpoint:'THREE_QUARTER_LEFT'},{intakeId:'intake-c',viewpoint:'THREE_QUARTER_RIGHT'}]});
    assert.equal(identityBatch.status,201);assert(identityBatch.payload.photos.every((photo)=>photo.intakeId));
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/intakes/intake-1/review',
      { brandId: 'brand-1', action: 'APPROVE_FOR_USE' })).status, 201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/intakes/intake-1/consent-requests',
      { brandId: 'brand-1', modality: 'FACE' })).status, 201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/intakes/intake-1/consents',
      { brandId: 'brand-1', modality: 'FACE' })).status, 201);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/intakes/intake-1/revoke-consent',
      { brandId: 'brand-1', modality: 'FACE' })).status, 201);
    const use = await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/intakes/intake-1/use',
      { brandId: 'brand-1', roles: ['IDENTITY'] });
    assert.equal(use.status, 201); assert.equal(use.payload.paidProviderCalls, 0);
    assert.equal((await request(server, 'POST', '/api/avatar-studio/avatars/avatar-1/passports/passport-1/certify',
      { brandId: 'brand-1', humanApproval: true })).status, 201);
    const plan = await request(server, 'POST', '/api/avatar-studio/test-content/plan', { brandId: 'brand-1' });
    assert.equal(plan.status, 201); assert.equal(plan.payload.externalCallCount, 0);
    assert.deepEqual(calls.find(([name]) => name === 'list')[1], { brandId: 'brand-1', vertical: 'TRAVEL' });
    assert.equal(calls.find(([name]) => name === 'certify')[1].passportId, 'passport-1');
    assert.equal(calls.find(([name]) => name === 'reviewIntake')[1].intakeId, 'intake-1');
    assert.equal(calls.find(([name]) => name === 'passportQa')[1].candidateId, 'candidate-1');
    assert.equal(calls.find(([name]) => name === 'passportCandidateCertify')[1].candidateId, 'candidate-1');
    assert.deepEqual(calls.find(([name]) => name === 'useIntake')[1].roles, ['IDENTITY']);
    const batchCall=calls.find(([name])=>name==='identityBatch')[1];assert.equal(JSON.stringify(batchCall).includes('contentBase64'),false);assert.equal(batchCall.photos.length,3);
    assert.equal(calls.find(([name]) => name === 'sourceViewpoint')[1].value, 'FRONTAL');
    assert.equal(calls.find(([name])=>name==='passportPreflight')[1].generationSpecId,'plan-1');
    assert.equal(calls.find(([name])=>name==='motionPilotIdentityReview')[1].executionId,validMotionExecution);
    assert.equal(calls.some(([name])=>name==='motionPilotIdentityReview'&&String(name).includes('undefined')),false);
    assert.equal(calls.find(([name])=>name==='passportGenerate')[1].executionId,'execution-1');
    assert.equal(providerCalls, 2,'only explicit Passport and L2 Generate actions reach mocked execution boundaries');
  } finally { await new Promise((resolve) => server.close(resolve)); }
  console.log('Avatar Studio dashboard API routing passed; plan/preflight/approval provider calls = 0; explicit mocked Generate calls = 2; real provider calls = 0');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
