'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { AvatarMotionPilotService } = require('../src/avatar-studio/motion-pilot-service');

const scope = { workspaceId:'w', brandId:'b', vertical:'PSYCHOLOGY_WELLBEING', avatarId:'a', identityVersionId:'i' };
const bytes = Buffer.from('provider-mp4-bytes');
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
const c = { avatar:{ id:'a', workspaceId:'w', vertical:'PSYCHOLOGY_WELLBEING', identityVersionId:'i', subjectType:'SYNTHETIC' },
  passport:{id:'passport'}, identityLock:{id:'lock'}, certification:{id:'cert'}, candidate:{id:'candidate'},
  intake:{effectiveGate0Status:'PASS', artifactId:'source', artifactVersion:1} };
const plan = { id:'plan', brandId:'b', identityVersionId:'i', identityLockVersionId:'lock', planFingerprint:'fp', costPlan:{knownTotalCost:.5} };

(async () => {
  let attempt = { id:'attempt', executionId:'execution', idempotencyKey:'key', status:'STARTED', mayHaveSpent:true };
  const execution = { id:'execution', approval:{id:'approval'}, provider:'replicate', model:'alibaba/wan-3', capability:'IMAGE_TO_VIDEO',
    identityVersionId:'i', maximumAllowedCost:1, preflightSnapshot:{planFingerprint:'fp'}, attempts:[] };
  let result = null; let executionReads = 0; let generateCalls = 0; let persisted = false; let providerSucceeded = false; let ingestCalls = 0;
  const repo = {
    motionPilotExecution: async () => ({ ...execution, attempts:executionReads++ === 0 ? [] : [attempt] }), motionPilotPlan: async () => plan,
    createMotionPilotAttempt: async () => attempt,
    recordMotionPilotProviderRequest: async () => attempt,
    recordMotionPilotProviderSuccess: async ({ result: providerResult, rawArtifact }) => {
      providerSucceeded = true;
      attempt = { ...attempt, providerRequestId:providerResult.requestId, providerStatus:'succeeded', rawArtifactId:rawArtifact.artifactId,
        rawArtifactVersion:rawArtifact.version, rawArtifactStorageKey:rawArtifact.storageKey, rawContentHash:rawArtifact.contentHash };
      return attempt;
    },
    failMotionPilotAttempt: async ({ error }) => (attempt = { ...attempt, status:'FAILED', failureClassification:error.code }),
    motionPilotResult: async () => result,
    createRecoveredMotionPilotResult: async ({ ingested }) => (result = { id:'result', attemptId:'attempt', artifactId:ingested.asset.artifactId, intakeAssetId:ingested.asset.id }),
  };
  const assetIntakeService = {
    persistMotionPilotRawProviderOutput: async ({ bytes: output }) => {
      assert.equal(output, bytes); persisted = true;
      return { artifactId:'raw-artifact', version:1, storageKey:'raw/key', contentHash:hash, size:bytes.length };
    },
    ingestProviderVideoOutput: async () => {
      ingestCalls += 1; assert.equal(persisted, true, 'raw output must precede Gate 0/intake');
      if (ingestCalls === 1) { const error = new Error('Gate 0 rejected'); error.code = 'SECURITY_REJECTED_OUTPUT'; throw error; }
      return { asset:{ id:'intake', artifactId:'final-artifact', artifactVersion:1 } };
    },
  };
  const service = new AvatarMotionPilotService({ repository:repo, providerCatalog:{resolveSelection:()=>({})}, assetIntakeService,
    storage:{get:async ({key}) => { assert.equal(key,'raw/key'); return bytes; }}, mediaInspector:{inspect:async()=>({kind:'video',width:720,height:1280,durationMs:5000})},
    adapterFactory:() => ({ generate:async () => { generateCalls += 1; return { requestId:'provider-request', output:bytes, metrics:{predict_time:5} }; }, recover:async()=>{ throw new Error('provider recovery must not run when raw output exists'); } }),
    env:{LIVE_PAID_GENERATION:'true',REPLICATE_API_TOKEN:'test'} });
  service.context = async () => c;
  service.canonicalRequest = async () => ({ request:{}, evidence:{} });
  await assert.rejects(() => service.generate({ ...scope, executionId:'execution' }), (error) => error.code === 'SECURITY_REJECTED_OUTPUT');
  assert.equal(generateCalls,1); assert.equal(persisted,true); assert.equal(providerSucceeded,true);
  assert.equal(attempt.providerStatus,'succeeded'); assert.equal(attempt.status,'FAILED'); assert.equal(attempt.failureClassification,'SECURITY_REJECTED_OUTPUT');
  const recovered = await service.recoverFromPersistedProviderOutput({ ...scope, executionId:'execution', attemptId:'attempt' });
  assert.equal(recovered.status,'RECOVERED'); assert.equal(recovered.newPredictionsCreated,0); assert.equal(ingestCalls,2);
  const again = await service.recoverFromPersistedProviderOutput({ ...scope, executionId:'execution', attemptId:'attempt' });
  assert.equal(again.idempotent,true); assert.equal(generateCalls,1, 'no replacement provider call');
  console.log('Motion Pilot raw-provider checkpoint tests passed; provider calls = 0 in test transport.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
