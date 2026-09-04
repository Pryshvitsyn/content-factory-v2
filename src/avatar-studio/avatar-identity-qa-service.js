'use strict';

// Closed-world avatar QA contract.  It deliberately has no image-similarity
// fallback: a production evaluator must supply face detection/alignment and
// same-person embedding comparison locally.
const crypto=require('node:crypto');
const { AvatarStudioError,fingerprint }=require('./domain');

const POLICY=Object.freeze({version:'avatar-identity-truth-v1',minimumReferences:3,maximumReferences:5,viewpointOrder:Object.freeze(['FRONTAL','THREE_QUARTER_LEFT','THREE_QUARTER_RIGHT','PROFILE_LEFT','PROFILE_RIGHT'])});
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function unavailable(){throw new AvatarStudioError(503,'AUTO_AVATAR_QA_EVALUATOR_UNAVAILABLE','A configured local face detection/alignment/embedding evaluator is required; automatic Avatar QA fails closed.');}

class AvatarIdentityQaService {
  constructor({repository,storage,evaluator=null,policy=POLICY}={}){Object.assign(this,{repository,storage,evaluator,policy});}
  async truthSet({avatar,brandId}) { const lock=(avatar.identityLocks||[]).find((item)=>item.identityVersionId===avatar.identityVersionId);if(!lock)throw new AvatarStudioError(409,'CURRENT_IDENTITY_LOCK_REQUIRED','A current Identity Lock is required for source identity truth');const refs=[];
    for(const source of avatar.sources||[]){if(source.characterId!==avatar.id||source.brandId!==brandId||!(source.roles||[]).includes('IDENTITY'))continue;const intake=await this.repository.intake({id:source.intakeAssetId,brandId,avatarId:avatar.id});if(!intake||intake.effectiveGate0Status!=='PASS'||!String(intake.mimeType||'').startsWith('image/')||String(intake.sourceType||'').toUpperCase()==='PROVIDER_OUTPUT')continue;const bytes=await this.storage.get({key:intake.artifactStorageKey});if(!Buffer.isBuffer(bytes)||sha(bytes)!==intake.contentHash)throw new AvatarStudioError(409,'IDENTITY_TRUTH_SOURCE_HASH_MISMATCH','Original identity-source bytes are unavailable or changed');refs.push({intakeId:intake.id,viewpoint:source.effectiveViewpoint||'UNKNOWN',contentHash:intake.contentHash,artifactId:intake.artifactId,artifactVersion:intake.artifactVersion,byteSize:bytes.length,bytes});}
    const seen=new Set();const selected=refs.filter((ref)=>!seen.has(ref.contentHash)&&seen.add(ref.contentHash)).sort((a,b)=>{const ai=this.policy.viewpointOrder.indexOf(a.viewpoint),bi=this.policy.viewpointOrder.indexOf(b.viewpoint);return (ai<0?99:ai)-(bi<0?99:bi)||a.intakeId.localeCompare(b.intakeId);}).slice(0,this.policy.maximumReferences);if(selected.length<this.policy.minimumReferences)throw new AvatarStudioError(409,'IDENTITY_TRUTH_SET_INCOMPLETE','At least three durable original consented identity photos are required for automatic Avatar QA');const evidence=selected.map(({bytes,...ref})=>ref);const canonical={policyVersion:this.policy.version,avatarId:avatar.id,identityVersionId:avatar.identityVersionId,identityLockVersionId:lock.id,references:evidence};return Object.freeze({...canonical,truthSetId:fingerprint(canonical),truthSetFingerprint:fingerprint(canonical),_references:selected});
  }
  async evaluateDerivedImage({truthSet,candidateImage,candidateHash=null}) { if(!this.evaluator?.evaluate) unavailable();const result=await this.evaluator.evaluate({truthSet,candidateImage});if(!['PASS','FAIL','UNCERTAIN'].includes(result?.status))throw new AvatarStudioError(503,'AUTO_AVATAR_QA_EVALUATOR_INVALID','Local Avatar identity evaluator returned an invalid closed-world result');return Object.freeze({status:result.status,reasonCodes:Object.freeze(result.reasonCodes||[]),evaluator:{name:result.evaluator?.name,version:result.evaluator?.version,local:true},policyVersion:this.policy.version,truthSetFingerprint:truthSet.truthSetFingerprint,candidateHash:candidateHash||sha(candidateImage),observations:Object.freeze(result.observations||[])}); }
  async evaluateProviderInput({truthSet,referenceBytes}) { const results=[];for(const bytes of referenceBytes||[])results.push(await this.evaluateDerivedImage({truthSet,candidateImage:bytes}));const statuses=results.map((result)=>result.status);const status=statuses.includes('FAIL')?'FAIL':statuses.includes('UNCERTAIN')?'UNCERTAIN':'PASS';return Object.freeze({status,policyVersion:this.policy.version,truthSetFingerprint:truthSet.truthSetFingerprint,inputs:results}); }
}
module.exports={AvatarIdentityQaService,AVATAR_IDENTITY_QA_POLICY:POLICY};
