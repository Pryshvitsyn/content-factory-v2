'use strict';

const { AUDIENCE_VERTICALS, AvatarStudioError, PERFORMANCE_PACKS, assertBrandPermission,
  canonicalCharacter, canonicalIdentity, canonicalIdentityLock, fingerprint, requiredText, stringList } = require('./domain');
const { assertGateUsable, inspectGateZero } = require('./gate-zero');
const { evaluateAvatarLevels } = require('./level-engine');
const { compilePlanOnlyTest } = require('./plan-compiler');
const { validateLocationReferenceGeometry } = require('../v2.10.2/reference-geometry');
const { validateAvatarContinuityReadiness } = require('../v2.10/continuity-contract');
const { compilePassportGenerationSpec } = require('./passport-plan-compiler');
const { analyzePassportCandidate } = require('./passport-qa');
const { buildSmokeReadiness } = require('./smoke-readiness');
const { viewpoint } = require('./source-viewpoint');
const { loadIdentityIntakePolicy } = require('./identity-intake-policy');
const { coverageFromSources } = require('./identity-coverage');

const PASSPORT_REJECTION_REASONS = Object.freeze(['PROFILE_DRIFT','NOSE_CHANGED','JAW_CHANGED','CHIN_CHANGED','AGE_CHANGED',
  'HAIR_CHANGED','HAIRLINE_CHANGED','FACE_CHANGED','ACCESSORY_CONTAMINATION','WARDROBE_CONTAMINATION','BACKGROUND_ERROR',
  'LIGHTING_ERROR','IMAGE_QUALITY','OTHER']);

function approval(value) {
  const result = String(value || '').toUpperCase();
  if (!['DRAFT','APPROVED','REJECTED'].includes(result)) throw new AvatarStudioError(400, 'APPROVAL_INVALID', 'Approval status is invalid');
  return result;
}

class AvatarStudioService {
  constructor({ repository, assetIntakeService = null, providerCatalog = null, passportExecutionService = null, l2Service = null, motionPilotService = null,
    actor = 'local-operator', env = process.env } = {}) {
    if (!repository) throw new Error('AvatarStudioService requires repository');
    this.repository = repository; this.assetIntakeService = assetIntakeService; this.providerCatalog = providerCatalog;
    this.passportExecutionService = passportExecutionService; this.l2Service = l2Service; this.motionPilotService = motionPilotService; this.actor = actor; this.env = env;
  }

  async verticals() { return this.repository.verticals(); }
  async list({ brandId, vertical = null } = {}) {
    if (!brandId) throw new AvatarStudioError(400, 'BRAND_SCOPE_REQUIRED', 'brandId is required to list avatars');
    if (vertical && !AUDIENCE_VERTICALS.includes(vertical)) throw new AvatarStudioError(400, 'VERTICAL_INVALID', 'Audience vertical is invalid');
    return this.repository.listCharacters({ brandId, vertical });
  }

  async create(input) {
    const character = canonicalCharacter(input);
    const created = await this.repository.createCharacter({ character, identityHash: fingerprint(character.identity), actor: this.actor });
    return this.refresh(created.id);
  }

  async updateIdentity({ avatarId, brandId, identity, provenance = {} } = {}) {
    const avatar = await this.avatar({ id: avatarId, brandId });
    const canonical = canonicalIdentity(identity || {});
    const version = await this.repository.appendIdentityVersion({ avatar, brandId, identity: canonical,
      identityHash: fingerprint(canonical), provenance: { ...provenance, source: provenance.source || 'AVATAR_STUDIO_IDENTITY_STEP' }, actor: this.actor });
    return Object.freeze({ identityVersion: version, avatar: await this.refresh(avatar.id, brandId) });
  }

  async createIdentityLock({ avatarId, brandId, permanent = {}, temporary = {}, uncertain = {}, notes = null,
    provenance = {}, humanApproval = false } = {}) {
    if (!humanApproval) throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED', 'Identity Lock requires an explicit human classification decision');
    const avatar = await this.avatar({ id: avatarId, brandId });
    const lock = canonicalIdentityLock({ permanent, temporary, uncertain, notes });
    const created = await this.repository.createIdentityLock({ avatar, brandId, identityLock: lock, lockHash: fingerprint(lock),
      provenance: { ...provenance, source: provenance.source || 'AVATAR_STUDIO_IDENTITY_LOCK', immutable: true }, actor: this.actor });
    return Object.freeze({ identityLock: created, avatar: await this.refresh(avatar.id,brandId) });
  }

  requireIntake() {
    if (!this.assetIntakeService) throw new AvatarStudioError(503, 'ASSET_INTAKE_UNAVAILABLE', 'Avatar asset intake is not configured');
    return this.assetIntakeService;
  }

  async intakeAsset(input = {}) {
    const avatar = await this.avatar({ id: input.avatarId, brandId: input.brandId });
    return this.requireIntake().intake({ avatar, ...input });
  }
  async listIntakes(input = {}) {
    const avatar = await this.avatar({ id: input.avatarId, brandId: input.brandId });
    return this.requireIntake().list({ avatar, ...input });
  }
  async reviewQueue(input = {}) { return this.requireIntake().reviewQueue(input); }
  async existingAssets(input = {}) {
    const avatar = await this.avatar({ id: input.avatarId, brandId: input.brandId });
    return this.requireIntake().existingAssets({ avatar, ...input });
  }
  async reviewIntake(input = {}) {
    const avatar = await this.avatar({ id: input.avatarId, brandId: input.brandId });
    return this.requireIntake().review({ avatar, ...input });
  }
  async requestConsent(input = {}) {
    const avatar = await this.avatar({ id: input.avatarId, brandId: input.brandId });
    return this.requireIntake().createConsentRequest({ avatar, ...input });
  }
  async grantConsent(input = {}) {
    const avatar = await this.avatar({ id: input.avatarId, brandId: input.brandId });
    return this.requireIntake().grantConsent({ avatar, ...input });
  }
  async revokeConsent(input = {}) {
    const avatar = await this.avatar({ id: input.avatarId, brandId: input.brandId });
    return this.requireIntake().revokeConsent({ avatar, ...input });
  }
  async useIntake(input = {}) {
    const avatar = await this.avatar({ id: input.avatarId, brandId: input.brandId });
    return this.requireIntake().use({ avatar, ...input });
  }
  async intakeContent(input = {}) {
    const avatar = await this.avatar({ id: input.avatarId, brandId: input.brandId });
    return this.requireIntake().content({ avatar, ...input });
  }

  async intakeIdentityBatch({ avatarId, brandId, photos = [] } = {}) {
    const policy = loadIdentityIntakePolicy(); const avatar = await this.avatar({ id: avatarId, brandId });
    if (!Array.isArray(photos) || photos.length < policy.photoBatch.minimum || photos.length > policy.photoBatch.maximum) throw new AvatarStudioError(400, 'IDENTITY_PHOTO_BATCH_INVALID', 'Add between 1 and 10 photos in one batch');
    const results = [];
    for (const photo of photos) {
      const proposedViewpoint = viewpoint(photo.viewpoint || 'UNKNOWN');
      const intake = await this.requireIntake().intake({ avatar, brandId, sourceType: 'UPLOAD', file: photo.file,
        provenance: { ...(photo.provenance || {}), source: 'AVATAR_STUDIO_V1_IDENTITY_BATCH', visualOnly: true,
          viewpointProposal: proposedViewpoint, viewpointClassifier: 'HUMAN_GUIDED_NO_AUTOMATIC_BIOMETRICS' } });
      let source = null; let duplicate = (avatar.sources || []).some((item) => item.contentHash === intake.asset.contentHash && (item.roles || []).includes('IDENTITY'));
      const existing = await this.repository.sourceForIntake({ intakeId: intake.asset.id, avatarId: avatar.id, brandId });
      if (existing) { source = existing; duplicate = true; }
      else if (!duplicate && intake.asset.effectiveGate0Status === 'PASS') {
        const used = await this.requireIntake().use({ avatar, brandId, intakeId: intake.asset.id, roles: ['IDENTITY'] }); source = used.source;
        if (proposedViewpoint !== 'UNKNOWN') await this.repository.addSourceViewpointClassification({ avatar, source, viewpoint: proposedViewpoint,
          provenance: { source: 'AVATAR_STUDIO_V1_GUIDED_VIEWPOINT', proposedViewpoint, automatedVisualInference: false }, actor: this.actor });
      }
      results.push(Object.freeze({ ...intake, source, duplicate }));
    }
    return Object.freeze({ photos: Object.freeze(results), coverage: await this.identityCoverage({ avatarId, brandId }), paidProviderCalls: 0, externalGenerationCalls: 0 });
  }

  async identityCoverage({ avatarId, brandId } = {}) {
    const avatar = await this.avatar({ id: avatarId, brandId }); const intakes = await this.repository.listIntakes({ brandId, avatarId: avatar.id });
    const byId = new Map(intakes.map((item) => [item.id, item]));
    return coverageFromSources(avatar.sources || [], (source) => byId.get(source.intakeAssetId));
  }

  async confirmIdentityIntake({ avatarId, brandId, confirmed = false } = {}) {
    if (!confirmed) throw new AvatarStudioError(409, 'IDENTITY_CONFIRMATION_REQUIRED', 'Confirm that the accepted photos show the intended person');
    const avatar = await this.avatar({ id: avatarId, brandId }); const coverage = await this.identityCoverage({ avatarId, brandId });
    if (coverage.status === 'NOT_READY') throw new AvatarStudioError(409, 'IDENTITY_COVERAGE_INCOMPLETE', 'Complete the required front and slight-angle photos first', coverage);
    const confirmation = await this.repository.createIdentityIntakeConfirmation({ avatar, brandId, confirmationText: 'I confirm these photos show the intended person.', actor: this.actor });
    return Object.freeze({ confirmation, coverage, status: coverage.status, paidProviderCalls: 0, externalGenerationCalls: 0 });
  }

  async avatar({ id, brandId }) {
    if (!brandId) throw new AvatarStudioError(400, 'BRAND_SCOPE_REQUIRED', 'brandId is required');
    const avatar = await this.repository.getCharacter({ id, brandId });
    if (!avatar) throw new AvatarStudioError(404, 'AVATAR_NOT_FOUND', 'Avatar was not found in this brand scope');
    const state = evaluateAvatarLevels(avatar);
    return Object.freeze({ ...avatar, ...state, levelState: state });
  }

  async refresh(id, brandId = null) {
    const avatar = await this.repository.getCharacter({ id, brandId });
    if (!avatar) throw new AvatarStudioError(404, 'AVATAR_NOT_FOUND', 'Avatar was not found');
    const state = evaluateAvatarLevels(avatar);
    await this.repository.saveLevelState({ avatarId: avatar.id, workspaceId: avatar.workspaceId, state });
    return Object.freeze({ ...avatar, ...state, levelState: state });
  }

  async importSource({ avatarId, brandId, source = {} } = {}) {
    const avatar = await this.avatar({ id: avatarId, brandId }); assertBrandPermission(avatar, brandId);
    const normalized = { ...source, sourceType: String(source.sourceType || '').toUpperCase() };
    if (!normalized.sourceType) throw new AvatarStudioError(400, 'SOURCE_TYPE_REQUIRED', 'Source type is required');
    const gate0 = inspectGateZero({ ...normalized,
      text: normalized.gate0Text || normalized.text || normalized.sourceLocator || normalized.artifactId,
      metadata: { ...(normalized.metadata || {}), artifactId: normalized.artifactId || null } });
    const registered = await this.repository.registerSource({ avatar, source: normalized, gate0, actor: this.actor });
    return Object.freeze({ source: registered, gate0 });
  }

  async recordSourceViewpoint({ avatarId, brandId, sourceId, value, humanApproval = false, provenance = {} } = {}) {
    if (!humanApproval) throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED', 'Viewpoint classification requires an explicit human decision');
    const avatar = await this.avatar({ id: avatarId, brandId });
    const source = await this.repository.source({ id: sourceId, avatarId });
    if (!source || source.brandId !== brandId || !(source.roles || []).some((role) => ['IDENTITY','PASSPORT_SOURCE'].includes(role))) {
      throw new AvatarStudioError(404, 'IDENTITY_SOURCE_NOT_FOUND', 'An eligible identity or Passport source was not found in this scope');
    }
    let normalized; try { normalized = viewpoint(value); } catch (error) { throw new AvatarStudioError(400, error.code, error.message); }
    const classification = await this.repository.addSourceViewpointClassification({ avatar, source, viewpoint: normalized,
      provenance: { ...provenance, source: 'AVATAR_STUDIO_HUMAN_VIEWPOINT_CLASSIFICATION', automatedVisualInference: false }, actor: this.actor });
    return Object.freeze({ classification, effectiveViewpoint: normalized, passportPlanningInvalidated: true, paidProviderCalls: 0, externalGenerationCalls: 0 });
  }

  async registerPassport({ avatarId, brandId, sourceId, panels, qa = {} } = {}) {
    const avatar = await this.avatar({ id: avatarId, brandId });
    const source = await this.repository.source({ id: sourceId, avatarId });
    if (!source) throw new AvatarStudioError(404, 'SOURCE_NOT_FOUND', 'Passport source was not found');
    assertGateUsable(source);
    const angles = new Set((panels || []).map((panel) => panel.angle));
    if (panels?.length !== 3 || angles.size !== 3 || !['FRONTAL','THREE_QUARTER_45','PROFILE_90'].every((angle) => angles.has(angle))) {
      throw new AvatarStudioError(400, 'PASSPORT_ANGLES_INCOMPLETE', 'Passport requires frontal, 45-degree and 90-degree panels');
    }
    for (const panel of panels) {
      requiredText('panel.artifactId', panel.artifactId);
      if (!Number.isInteger(Number(panel.artifactVersion)) || Number(panel.artifactVersion) < 1) throw new AvatarStudioError(400, 'ARTIFACT_VERSION_INVALID', 'Passport panels require immutable artifact versions');
    }
    const passport = await this.repository.registerPassport({ avatar, sourceId, panels, qa, actor: this.actor });
    return Object.freeze({ passport, avatar: await this.refresh(avatar.id, brandId) });
  }

  async certifyPassport({ avatarId, brandId, passportId, decision, notes = null, humanApproval = false } = {}) {
    if (!humanApproval) throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED', 'Explicit human approval is required to certify a passport');
    const normalized = String(decision || '').toUpperCase();
    if (!['CERTIFIED','REJECTED'].includes(normalized)) throw new AvatarStudioError(400, 'PASSPORT_DECISION_INVALID', 'Passport decision is invalid');
    const avatar = await this.avatar({ id: avatarId, brandId });
    if (Array.isArray(avatar.identityLocks)) throw new AvatarStudioError(409, 'PASSPORT_LAB_CERTIFICATION_REQUIRED',
      'V1.2 avatars must certify an immutable Passport Lab candidate for the current Identity Version');
    const candidate = avatar.passports.find((item) => item.id === passportId);
    if (!candidate) throw new AvatarStudioError(404, 'PASSPORT_NOT_FOUND', 'Passport candidate was not found');
    if (normalized === 'CERTIFIED' && avatar.passports.some((item) => item.decision === 'CERTIFIED' && item.id !== passportId)) {
      throw new AvatarStudioError(409, 'PASSPORT_ALREADY_CERTIFIED', 'This avatar already has one immutable certified passport');
    }
    if (candidate.decision) throw new AvatarStudioError(409, 'PASSPORT_ALREADY_DECIDED', 'Passport decision is immutable');
    if (candidate.panels.length !== 3) throw new AvatarStudioError(409, 'PASSPORT_ANGLES_INCOMPLETE', 'All passport panels are required before certification');
    const certification = await this.repository.certifyPassport({ avatar, passportId, decision: normalized, notes, actor: this.actor });
    return Object.freeze({ certification, avatar: await this.refresh(avatar.id, brandId) });
  }

  async passportLab({ avatarId, brandId } = {}) { return this.avatar({ id: avatarId, brandId }); }

  requirePassportExecution() {
    if (!this.passportExecutionService) throw new AvatarStudioError(503, 'PASSPORT_EXECUTION_UNAVAILABLE',
      'Controlled Passport provider execution is not configured');
    return this.passportExecutionService;
  }

  async preflightPassportGeneration(input = {}) { return this.requirePassportExecution().preflight(input); }
  async approvePassportGeneration(input = {}) { return this.requirePassportExecution().approve(input); }
  async generatePassportCandidates(input = {}) { return this.requirePassportExecution().generate(input); }
  async passportExecution(input = {}) { return this.requirePassportExecution().inspect(input); }
  async cancelPassportExecution(input = {}) { return this.requirePassportExecution().cancel(input); }

  async smokeReadiness({ avatarId,brandId,kind='PASSPORT',sourceAssetId=null,generationSpecId=null,executionId=null,
    workspaceId=null,vertical=null,identityVersionId=null }={}) {
    const avatar=await this.avatar({id:avatarId,brandId}); const normalized=String(kind).toUpperCase();
    let generationSpec=null,execution=null,source=null,intake=null;
    if(normalized==='PASSPORT'){
      generationSpec=generationSpecId?await this.repository.generationSpec({id:generationSpecId,avatarId,brandId})
        :(avatar.passportGenerationSpecs||[])[0]||null;
      const selectedSourceId=sourceAssetId||(generationSpec?.sourceAssetIds||[])[0];
      source=selectedSourceId?await this.repository.source({id:selectedSourceId,avatarId}):null;
      if(source?.intakeAssetId)intake=await this.repository.intake({id:source.intakeAssetId,brandId,avatarId});
      if(executionId)execution=await this.repository.passportExecution({id:executionId,avatarId,brandId,
        workspaceId:workspaceId||avatar.workspaceId,vertical:vertical||avatar.vertical,identityVersionId:identityVersionId||avatar.identityVersionId});
    }else if(normalized==='BODY'){
      generationSpec=generationSpecId?await this.repository.l2GenerationSpec({id:generationSpecId,kind:'BODY',avatarId,brandId})
        :(avatar.bodyGenerationSpecs||[])[0]||null;
      const certification=(avatar.passportCertificationEvents||[]).find((item)=>item.identityVersionId===avatar.identityVersionId);
      const passport=(avatar.passportCandidates||[]).find((item)=>item.certificationEventId===certification?.id);
      if(passport?.intakeAssetId)intake=await this.repository.intake({id:passport.intakeAssetId,brandId,avatarId});
      source=intake?{id:passport?.id,gate0Status:intake.effectiveGate0Status}:null;
      if(executionId)execution=await this.repository.l2Execution({id:executionId,avatarId,brandId,
        workspaceId:workspaceId||avatar.workspaceId,vertical:vertical||avatar.vertical,identityVersionId:identityVersionId||avatar.identityVersionId});
    }
    return buildSmokeReadiness({kind:normalized,env:this.env,providerCatalog:this.providerCatalog,avatar,source,intake,generationSpec,execution});
  }

  requireL2() { if (!this.l2Service) throw new AvatarStudioError(503,'L2_SERVICE_UNAVAILABLE','Body + Expressions Lab is not configured'); return this.l2Service; }
  async bodyExpressionsLab(input={}) { return this.requireL2().lab(input); }
  async createBodyBuild(input={}) { return this.requireL2().createBodyBuild(input); }
  async planL2Reference(input={}) { return this.requireL2().plan(input); }
  async uploadL2Candidate(input={}) { return this.requireL2().uploadCandidate(input); }
  async runL2Qa(input={}) { return this.requireL2().qa(input); }
  async reviewL2Candidate(input={}) { return this.requireL2().review(input); }
  async certifyL2Reference(input={}) { return this.requireL2().certifyReference(input); }
  async l2Readiness(input={}) { return this.requireL2().readiness(input); }
  async certifyL2Pack(input={}) { const result=await this.requireL2().certifyPack(input);return Object.freeze({...result,
    avatar:await this.refresh(input.avatarId,input.brandId)}); }
  async preflightL2Generation(input={}) { return this.requireL2().preflight(input); }
  async approveL2Generation(input={}) { return this.requireL2().approve(input); }
  async generateL2Candidates(input={}) { return this.requireL2().generate(input); }
  requireMotionPilot() { if (!this.motionPilotService) throw new AvatarStudioError(503,'MOTION_PILOT_SERVICE_UNAVAILABLE','Avatar Motion Pilot is not configured'); return this.motionPilotService; }
  async planMotionPilot(input={}) { return this.requireMotionPilot().plan(input); }
  async preflightMotionPilot(input={}) { return this.requireMotionPilot().preflight(input); }
  async approveMotionPilot(input={}) { return this.requireMotionPilot().approve(input); }
  async generateMotionPilot(input={}) { return this.requireMotionPilot().generate(input); }
  async recoverMotionPilot(input={}) { return this.requireMotionPilot().recoverExisting(input); }
  async recoverMotionPilotLocalOutput(input={}) { return this.requireMotionPilot().recoverFromPersistedProviderOutput(input); }
  async reviewMotionPilotIdentity(input={}) { return this.requireMotionPilot().reviewIdentity(input); }
  async motionPilotState(input={}) { return this.requireMotionPilot().state(input); }

  async planPassportGeneration({ avatarId, brandId, sourceAssetIds, requestedCandidateCount = 4,
    preferredProvider = null, preferredModel = null, originalGenerationSpecId = null, repairDelta = null } = {}) {
    const avatar = await this.avatar({ id: avatarId, brandId });
    const identityLock = (avatar.identityLocks || []).find((item) => item.identityVersionId === avatar.identityVersionId);
    if (!identityLock) throw new AvatarStudioError(409, 'IDENTITY_LOCK_REQUIRED', 'Complete the current immutable Identity Lock before Passport planning');
    const ids = stringList('sourceAssetIds',sourceAssetIds,{ required: true }); const sources = [];
    for (const id of ids) {
      const source = await this.repository.source({ id, avatarId: avatar.id });
      if (!source || source.brandId !== brandId) throw new AvatarStudioError(404, 'PASSPORT_SOURCE_NOT_FOUND', 'Passport source was not found in this brand/avatar scope');
      if (!(source.roles || []).some((role) => ['IDENTITY','PASSPORT_SOURCE'].includes(role))) throw new AvatarStudioError(409,
        'PASSPORT_SOURCE_ROLE_REQUIRED', 'Passport plans require an explicit IDENTITY or PASSPORT_SOURCE role');
      assertGateUsable(source,{ allowReview: false });
      if (source.intakeAssetId && this.assetIntakeService) {
        const intake = await this.repository.intake({ id: source.intakeAssetId,brandId,avatarId: avatar.id });
        const eligibility = this.assetIntakeService.eligibility(intake,avatar,source.roles);
        if (!eligibility.eligible) throw new AvatarStudioError(409,'PASSPORT_SOURCE_INELIGIBLE','Source consent, rights or Gate 0 eligibility is no longer valid',eligibility);
      }
      sources.push(source);
    }
    const plan = compilePassportGenerationSpec({ avatar, identityVersion: { id: avatar.identityVersionId,version: avatar.version },
      identityLock,sourceAssets:sources,requestedCandidateCount,preferred:{ provider:preferredProvider,model:preferredModel },
      providerCatalog:this.providerCatalog,originalGenerationSpecId,repairDelta,actor:this.actor });
    const stored = await this.repository.storePassportGenerationSpec({ avatar,plan,actor:this.actor });
    return Object.freeze({ ...plan,id:stored.id,durable:true,paidProviderCalls:0,externalGenerationCalls:0 });
  }

  async uploadPassportCandidate({ avatarId, brandId, generationSpecId, intakeId, repairParentCandidateId = null } = {}) {
    const avatar = await this.avatar({ id:avatarId,brandId });
    const generationSpec = await this.repository.generationSpec({ id:generationSpecId,avatarId:avatar.id,brandId });
    if (!generationSpec) throw new AvatarStudioError(404,'PASSPORT_GENERATION_SPEC_NOT_FOUND','Passport generation plan was not found in this scope');
    if (generationSpec.identityVersionId !== avatar.identityVersionId) throw new AvatarStudioError(409,'PASSPORT_PLAN_STALE_IDENTITY','Create a new plan for the current Identity Version');
    const intake = await this.repository.intake({ id:intakeId,brandId,avatarId:avatar.id });
    if (!intake || intake.effectiveGate0Status !== 'PASS') throw new AvatarStudioError(409,'PASSPORT_CANDIDATE_GATE0_REQUIRED','Manual passport candidates must pass Gate 0');
    if (!String(intake.mimeType || '').startsWith('image/')) throw new AvatarStudioError(400,'PASSPORT_CANDIDATE_IMAGE_REQUIRED','Passport candidate must be an image');
    const source = await this.repository.sourceForIntake({ intakeId,avatarId:avatar.id,brandId });
    if (!source || !(source.roles || []).includes('PASSPORT_CANDIDATE')) throw new AvatarStudioError(409,'PASSPORT_CANDIDATE_ROLE_REQUIRED',
      'Assign the explicit PASSPORT_CANDIDATE source role before registration');
    if (repairParentCandidateId) {
      const parent = await this.repository.passportCandidate({ id:repairParentCandidateId,avatarId:avatar.id,brandId });
      if (!parent) throw new AvatarStudioError(404,'REPAIR_PARENT_NOT_FOUND','Repair parent candidate was not found in this scope');
    }
    const candidate = await this.repository.createPassportCandidate({ avatar,brandId,generationSpec,intake,source,
      repairParentCandidateId,actor:this.actor });
    return Object.freeze({ candidate,paidProviderCalls:0,externalGenerationCalls:0 });
  }

  async runPassportQa({ avatarId,brandId,candidateId,observations = {},profileDrift = false,evidence = {} } = {}) {
    const avatar = await this.avatar({ id:avatarId,brandId });
    const candidate = await this.repository.passportCandidate({ id:candidateId,avatarId:avatar.id,brandId });
    if (!candidate) throw new AvatarStudioError(404,'PASSPORT_CANDIDATE_NOT_FOUND','Passport candidate was not found in this scope');
    if (candidate.effectiveGate0Status !== 'PASS') throw new AvatarStudioError(409,'PASSPORT_CANDIDATE_GATE0_REQUIRED','Candidate Gate 0 eligibility is no longer valid');
    const qa = analyzePassportCandidate({ width:candidate.width,height:candidate.height,observations,profileDrift,evidence });
    const snapshot = await this.repository.createPassportQaSnapshot({ candidate,qa,sourceEvidence:{
      artifactId:candidate.artifactId,artifactVersion:candidate.artifactVersion,identityVersionId:candidate.identityVersionId,
      identityLockVersionId:candidate.identityLockVersionId,referenceGeometryContract:'V2.10.2_REFERENCE_GEOMETRY',
      continuityContract:'V2.10_CONTINUITY_CONTRACT' },actor:this.actor });
    return Object.freeze({ qaSnapshot:snapshot,analysis:qa,automatedCertification:false,paidProviderCalls:0,externalGenerationCalls:0 });
  }

  async reviewPassportCandidate({ avatarId,brandId,candidateId,action,rejectionReason = null,humanNote = null,
    guidedReview = {},humanApproval = false } = {}) {
    if (!humanApproval) throw new AvatarStudioError(409,'HUMAN_APPROVAL_REQUIRED','Candidate review requires an explicit human decision');
    const avatar = await this.avatar({ id:avatarId,brandId }); const normalized = String(action || '').toUpperCase();
    if (!['KEEP','REJECT','COMPARE','SUPERSEDE'].includes(normalized)) throw new AvatarStudioError(400,'PASSPORT_REVIEW_ACTION_INVALID','Choose a supported candidate review action');
    if (normalized === 'REJECT' && !PASSPORT_REJECTION_REASONS.includes(String(rejectionReason || '').toUpperCase())) throw new AvatarStudioError(400,
      'PASSPORT_REJECTION_REASON_REQUIRED','Choose a structured passport rejection reason');
    const candidate = await this.repository.passportCandidate({ id:candidateId,avatarId:avatar.id,brandId });
    if (!candidate) throw new AvatarStudioError(404,'PASSPORT_CANDIDATE_NOT_FOUND','Passport candidate was not found in this scope');
    const qa = await this.repository.latestPassportQa({ candidateId });
    const latest = this.repository.latestPassportReview ? await this.repository.latestPassportReview({ candidateId }) : null;
    if (normalized === 'KEEP' && latest?.action === 'KEEP' && latest.qaSnapshotId === qa?.id) {
      return Object.freeze({ reviewEvent:latest,avatar:await this.refresh(avatar.id,brandId),idempotent:true });
    }
    const event = await this.repository.addPassportReviewEvent({ candidate,qaSnapshotId:qa?.id,action:normalized,
      rejectionReason:normalized === 'REJECT' ? String(rejectionReason).toUpperCase() : null,humanNote,guidedReview,actor:this.actor });
    return Object.freeze({ reviewEvent:event,avatar:await this.refresh(avatar.id,brandId) });
  }

  async certifyPassportCandidate({ avatarId,brandId,candidateId,guidedReview = {},warningsAcknowledged = [],
    explicitConfirmation = false,humanApproval = false } = {}) {
    if (!humanApproval || !explicitConfirmation) throw new AvatarStudioError(409,'HUMAN_APPROVAL_REQUIRED',
      'Passport certification requires explicit human confirmation');
    const requiredSteps = ['frontal','threeQuarter','profile','allThree'];
    if (!requiredSteps.every((key) => guidedReview[key] === true)) throw new AvatarStudioError(409,'GUIDED_PASSPORT_REVIEW_REQUIRED',
      'Complete frontal, 45-degree, profile and all-three human review; uncertainty must reject');
    const avatar = await this.avatar({ id:avatarId,brandId });
    if (avatar.productionEligibility === 'BLOCKED') throw new AvatarStudioError(409,'AVATAR_PROVENANCE_NOT_PRODUCTION_ELIGIBLE',
      'This avatar is explicitly non-production until real-person provenance and consent are established through a superseding immutable event');
    if ((avatar.passportCertificationEvents || []).some((item) => item.identityVersionId === avatar.identityVersionId)) {
      throw new AvatarStudioError(409,'PASSPORT_ALREADY_CERTIFIED','Exactly one passport may be certified for the current Identity Version');
    }
    const candidate = await this.repository.passportCandidate({ id:candidateId,avatarId:avatar.id,brandId });
    if (!candidate) throw new AvatarStudioError(404,'PASSPORT_CANDIDATE_NOT_FOUND','Passport candidate was not found in this scope');
    if (candidate.identityVersionId !== avatar.identityVersionId) throw new AvatarStudioError(409,'PASSPORT_CANDIDATE_STALE_IDENTITY','Candidate does not belong to the current Identity Version');
    const currentIdentityLock = (avatar.identityLocks || []).find((item) => item.identityVersionId === avatar.identityVersionId);
    if (!currentIdentityLock || candidate.identityLockVersionId !== currentIdentityLock.id) throw new AvatarStudioError(409,
      'PASSPORT_CANDIDATE_STALE_IDENTITY_LOCK','Candidate does not belong to the current Identity Lock version');
    const generationSpec = await this.repository.generationSpec({ id:candidate.generationSpecId,avatarId:avatar.id,brandId });
    for (const sourceId of generationSpec?.sourceAssetIds || []) {
      const source = await this.repository.source({ id:sourceId,avatarId:avatar.id });
      if (!source) throw new AvatarStudioError(409,'PASSPORT_SOURCE_INELIGIBLE','Passport source evidence is no longer available in this scope');
      assertGateUsable(source,{ allowReview:false });
      if (source.intakeAssetId && this.assetIntakeService) {
        const intake = await this.repository.intake({ id:source.intakeAssetId,brandId,avatarId:avatar.id });
        const eligibility = this.assetIntakeService.eligibility(intake,avatar,source.roles || []);
        if (!eligibility.eligible) throw new AvatarStudioError(409,'PASSPORT_SOURCE_INELIGIBLE',
          'Passport source consent, rights or Gate 0 eligibility is no longer valid',eligibility);
      }
    }
    const qa = await this.repository.latestPassportQa({ candidateId });
    if (!qa || qa.status === 'REJECT') throw new AvatarStudioError(409,'PASSPORT_QA_NOT_READY','A non-rejected immutable QA snapshot is required');
    const warnings = stringList('warningsAcknowledged',warningsAcknowledged);
    const event = await this.repository.certifyPassportCandidate({ candidate,qa,warningsAcknowledged:warnings,actor:this.actor });
    return Object.freeze({ certificationEvent:event,avatar:await this.refresh(avatar.id,brandId),paidProviderCalls:0,externalGenerationCalls:0 });
  }

  async addLevelAsset({ avatarId, brandId, type, value = {}, humanApproval = false } = {}) {
    const avatar = await this.avatar({ id: avatarId, brandId }); const normalizedType = String(type || '').toUpperCase();
    if (avatar.l2ContractVersion === 'V1.3' && ['BODY','EXPRESSION'].includes(normalizedType)) throw new AvatarStudioError(409,
      'L2_PACK_CERTIFICATION_REQUIRED','Use Body + Expressions Lab; individual legacy assets cannot produce L2');
    value = { ...value, approvalStatus: approval(value.approvalStatus) };
    if (value.approvalStatus === 'APPROVED' && !humanApproval) {
      throw new AvatarStudioError(409, 'HUMAN_APPROVAL_REQUIRED', 'Approved Avatar Level assets require explicit human approval');
    }
    if (normalizedType === 'VOICE' && value.sourceType !== 'SYNTHETIC') {
      const consent = avatar.consentRecords.find((item) => item.id === value.consentRecordId && item.status === 'APPROVED'
        && ['VOICE','FACE_AND_VOICE'].includes(item.scope)) || (avatar.consentEvents || []).find((item) => item.id === value.consentEventId
        && item.modality === 'VOICE' && item.status === 'APPROVED' && item.eventType === 'GRANT'
        && (!item.expiresAt || new Date(item.expiresAt) > new Date()));
      if (!consent) throw new AvatarStudioError(409, 'VOICE_CONSENT_REQUIRED', 'Owned or cloned voices require approved immutable voice consent');
    }
    if (normalizedType === 'WARDROBE') {
      value = { ...value, allowedBrandIds: value.allowedBrandIds || [brandId], allowedVerticals: value.allowedVerticals || [avatar.vertical] };
      if (!value.allowedBrandIds.every((id) => avatar.brandIds.includes(id))) throw new AvatarStudioError(403, 'BRAND_ISOLATION_VIOLATION', 'Wardrobe brand scope exceeds avatar permission');
      if (!value.allowedVerticals.every((item) => item === avatar.vertical)) throw new AvatarStudioError(409, 'VERTICAL_ISOLATION_VIOLATION', 'Wardrobe cannot cross verticals implicitly');
    }
    if (normalizedType === 'LOCATION') {
      const geometry = validateLocationReferenceGeometry(value);
      if (geometry.status !== 'PASS') throw new AvatarStudioError(400, 'LOCATION_GEOMETRY_INVALID', 'Location perspective/light/reference geometry is incomplete', geometry);
      value = { ...value, allowedVerticals: value.allowedVerticals || [avatar.vertical] };
      if (!value.allowedVerticals.every((item) => item === avatar.vertical)) throw new AvatarStudioError(409, 'VERTICAL_ISOLATION_VIOLATION', 'Location cannot cross verticals implicitly');
    }
    if (normalizedType === 'PERFORMANCE' && !PERFORMANCE_PACKS.includes(value.preset)) throw new AvatarStudioError(400, 'PERFORMANCE_PRESET_INVALID', 'Performance preset is invalid');
    if (normalizedType === 'CONTINUITY') {
      if (!value.continuitySnapshotId) throw new AvatarStudioError(409, 'CONTINUITY_SNAPSHOT_REQUIRED', 'L7 must reference the existing canonical continuity snapshot');
      const continuity = validateAvatarContinuityReadiness(value);
      if (value.approvalStatus === 'APPROVED' && continuity.status !== 'PASS') throw new AvatarStudioError(409, 'CONTINUITY_NOT_READY', 'Every existing continuity family must pass before L7 approval', continuity);
      value = { ...value, evidence: { ...(value.evidence || {}), engine: continuity.engine, checks: continuity.checks } };
    }
    const asset = await this.repository.insertLevelAsset({ avatar, type: normalizedType, value, actor: this.actor });
    return Object.freeze({ asset, avatar: await this.refresh(avatar.id, brandId) });
  }

  async compileTestPlan(input = {}) {
    const avatar = await this.avatar({ id: input.avatarId, brandId: input.brandId });
    const reference = await this.repository.source({ id: input.referenceSourceId, avatarId: avatar.id });
    if (!reference) throw new AvatarStudioError(404, 'SOURCE_NOT_FOUND', 'Reference source was not found in this avatar scope');
    if (reference.intakeAssetId && this.assetIntakeService) {
      const intake = await this.repository.intake({ id: reference.intakeAssetId, brandId: input.brandId, avatarId: avatar.id });
      const eligibility = this.assetIntakeService.eligibility(intake, avatar, reference.roles || []);
      if (!eligibility.eligible) throw new AvatarStudioError(409, 'SOURCE_CONSENT_REVOKED', 'Source is no longer eligible for future generation plans', eligibility);
    }
    const continuity = avatar.continuityReadiness.find((item) => item.approvalStatus === 'APPROVED');
    const planAvatar = { ...avatar, continuityEvidence: continuity ? {
      identity: continuity.identityStatus, wardrobe: continuity.wardrobeStatus, props: continuity.propStatus,
      location: continuity.locationStatus, geometry: continuity.geometryStatus, voice: continuity.voiceStatus, lipSync: continuity.lipSyncStatus,
    } : {} };
    const plan = compilePlanOnlyTest({ avatar: planAvatar, levelState: avatar, vertical: input.vertical,
      brandId: input.brandId, format: input.format, reference, script: input.script, shotPlan: input.shotPlan,
      providerSelection: input.providerSelection, actor: this.actor });
    const stored = await this.repository.storePlan({ avatar, plan, actor: this.actor });
    return Object.freeze({ ...plan, id: stored.id, durable: true });
  }
}

module.exports = { AvatarStudioService, approval };
