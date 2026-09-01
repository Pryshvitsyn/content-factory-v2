'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { AvatarStudioPostgresRepository } = require('../src/avatar-studio/postgres-repository');
const { AvatarStudioService } = require('../src/avatar-studio/service');
const { AvatarAssetIntakeService } = require('../src/avatar-studio/asset-intake-service');
const { ArtifactService } = require('../src/artifacts/artifact-service');
const { FilesystemStorageAdapter } = require('../src/storage/storage-adapter');

const WORKSPACE_ID = 'a0000000-0000-4000-8000-000000000001';
const BRAND_ID = 'a0000000-0000-4000-8000-000000000002';
const OTHER_BRAND_ID = 'a0000000-0000-4000-8000-000000000003';
const SNAPSHOT_ID = 'a0000000-0000-4000-8000-000000000004';
const OTHER_WORKSPACE_ID = 'a0000000-0000-4000-8000-000000000005';
const CROSS_WORKSPACE_BRAND_ID = 'a0000000-0000-4000-8000-000000000006';

function assertDisposable() {
  const name = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : process.env.PGDATABASE;
  if (process.env.CONTENT_FACTORY_TEST_DATABASE !== '1' || !name || name === 'content_os') {
    throw Object.assign(new Error('Avatar Studio PostgreSQL test requires CONTENT_FACTORY_TEST_DATABASE=1 and a disposable database'),
      { code: 'TEST_DATABASE_NOT_EXPLICIT' });
  }
}

async function main() {
  assertDisposable();
  const db = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
    host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER,
    password: process.env.PGPASSWORD, database: process.env.PGDATABASE,
  });
  let paidProviderCalls = 0;
  const storageRoot = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'avatar-studio-pg-artifacts-'));
  try {
    await db.query('DROP SCHEMA IF EXISTS avatar_studio CASCADE');
    await db.query(await fs.readFile(path.resolve('migrations/20260831_avatar_studio_v1.sql'), 'utf8'));
    await db.query(await fs.readFile(path.resolve('migrations/20260831_avatar_studio_v1_1_asset_intake.sql'), 'utf8'));
    await db.query(await fs.readFile(path.resolve('migrations/20260901_avatar_studio_v1_2_passport_lab.sql'), 'utf8'));
    await db.query(`INSERT INTO workspaces(id,name) VALUES($1,'Avatar Studio disposable') ON CONFLICT(id) DO NOTHING`, [WORKSPACE_ID]);
    await db.query(`INSERT INTO v2_2.brands(id,workspace_id,name,slug,status) VALUES($1,$2,'Attune Avatar Test','attune-avatar-test','ACTIVE')
      ON CONFLICT(id) DO UPDATE SET status='ACTIVE'`, [BRAND_ID, WORKSPACE_ID]);

    const repository = new AvatarStudioPostgresRepository({ db });
    const storage = new FilesystemStorageAdapter({ root: storageRoot });
    const intakeService = new AvatarAssetIntakeService({ repository, artifactService: new ArtifactService({ storage }),
      storage, actor: 'avatar-test-operator' });
    const service = new AvatarStudioService({ repository, assetIntakeService: intakeService, actor: 'avatar-test-operator' });
    const l0 = await service.create({ vertical: 'PSYCHOLOGY_WELLBEING', brandIds: [BRAND_ID], internalName: 'Mara Fixture',
      subjectType: 'SYNTHETIC', identity: { agePresentation: 'TO_BE_DEFINED', personality: 'TO_BE_DEFINED',
        role: 'behavioral coach', languages: ['und'], visualDirection: 'TO_BE_DEFINED', permanentAttributes: {},
        prohibitedUses: ['deception'] }, consent: { status: 'APPROVED', rightsBasis: 'SYNTHETIC_IDENTITY' },
      provenance: { source: 'POSTGRES_TEST_FIXTURE' } });
    assert.equal(l0.currentLevel, 0); assert.equal(l0.nextLevel.name, 'IDENTITY');

    const png = Buffer.alloc(40); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(png);
    png.writeUInt32BE(13,8); png.write('IHDR',12,'ascii'); png.writeUInt32BE(2,16); png.writeUInt32BE(3,20);
    const intake = await service.intakeAsset({ avatarId: l0.id, brandId: BRAND_ID, sourceType: 'UPLOAD',
      file: { name: 'mara-l0.png', mimeType: 'image/png', contentBase64: png.toString('base64') },
      provenance: { owner: 'SYNTHETIC', source: 'POSTGRES_BROWSER_FIXTURE' } });
    assert.equal(intake.gate0.status,'PASS'); assert.equal(intake.asset.width,2); assert.equal(intake.asset.height,3);
    const intakeSource = await service.useIntake({ avatarId: l0.id, brandId: BRAND_ID, intakeId: intake.asset.id,
      roles: ['IDENTITY','PASSPORT_SOURCE'] });
    assert.deepEqual(intakeSource.source.roles,['IDENTITY','PASSPORT_SOURCE']);
    const resolvedIdentity = await service.updateIdentity({ avatarId: l0.id, brandId: BRAND_ID, identity: {
      agePresentation: 'late 30s', personality: 'calm and precise', role: 'behavioral coach', languages: ['en'],
      visualDirection: 'natural face and stable proportions', permanentAttributes: {}, prohibitedUses: ['deception'] },
      provenance: { source: 'POSTGRES_IDENTITY_AFTER_INTAKE' } });
    assert.equal(resolvedIdentity.identityVersion.version,2); assert.equal(resolvedIdentity.avatar.nextLevel.name,'IDENTITY');
    const identityLock = await service.createIdentityLock({ avatarId:l0.id,brandId:BRAND_ID,humanApproval:true,
      permanent:{facialStructure:'preserve',apparentAge:'late 30s',nose:'preserve',jaw:'preserve',hairline:'preserve'},
      temporary:{hat:'exclude',jacket:'exclude',wardrobe:'exclude',background:'exclude'},uncertain:{glasses:'human decision'},
      provenance:{source:'POSTGRES_IDENTITY_LOCK_FIXTURE'} });
    assert.equal(identityLock.avatar.currentLevel,0); assert.equal(identityLock.avatar.nextLevel.name,'PASSPORT');
    assert(identityLock.avatar.missingRequirements.includes('CERTIFIED_PASSPORT_REQUIRED'));
    const intakeRow = (await db.query('SELECT * FROM avatar_studio.asset_intakes WHERE id=$1',[intake.asset.id])).rows[0];
    assert.equal(intakeRow.brand_id,BRAND_ID); assert.equal(intakeRow.workspace_id,WORKSPACE_ID);
    await assert.rejects(() => db.query('UPDATE avatar_studio.asset_intakes SET original_filename=$2 WHERE id=$1',
      [intake.asset.id,'mutated.png']), (error) => error.code === 'P0001');

    const real = await service.create({ vertical: 'PSYCHOLOGY_WELLBEING', brandIds: [BRAND_ID], internalName: 'Real Person Draft',
      subjectType: 'CONSENTED_REAL_PERSON', identity: { agePresentation: 'adult', personality: 'warm', role: 'host', languages: ['en'],
        visualDirection: 'natural portrait', permanentAttributes: {}, prohibitedUses: ['deception'] },
      consent: { status: 'REVIEW', rightsBasis: 'UNVERIFIED_PENDING_CONSENT' }, provenance: { source: 'POSTGRES_TEST_FIXTURE' } });
    const realIntake = await service.intakeAsset({ avatarId: real.id, brandId: BRAND_ID, sourceType: 'UPLOAD',
      file: { name: 'real-person.png', mimeType: 'image/png', contentBase64: png.toString('base64') }, provenance: {} });
    assert.equal(realIntake.gate0.status,'REVIEW');
    await service.reviewIntake({ avatarId: real.id, brandId: BRAND_ID, intakeId: realIntake.asset.id,
      action: 'APPROVE_FOR_USE', reason: 'Human reviewed security and provenance findings', humanApproval: true });
    await assert.rejects(() => service.useIntake({ avatarId: real.id, brandId: BRAND_ID, intakeId: realIntake.asset.id,
      roles: ['IDENTITY'] }), (error) => error.code === 'ASSET_NOT_ELIGIBLE');
    const grant = await service.grantConsent({ avatarId: real.id, brandId: BRAND_ID, intakeId: realIntake.asset.id,
      modality: 'FACE', subjectIdentity: { name: 'Fixture Person' }, rightsBasis: 'SIGNED_RELEASE', allowedBrandIds: [BRAND_ID],
      allowedVerticals: ['PSYCHOLOGY_WELLBEING'], allowedChannels: ['TEST'], allowedUseTypes: ['AVATAR_IDENTITY'],
      evidenceNotes: 'Disposable integration fixture', disclosureAccepted: true, humanApproval: true });
    assert.equal(grant.event.status,'APPROVED');
    await service.useIntake({ avatarId: real.id, brandId: BRAND_ID, intakeId: realIntake.asset.id, roles: ['IDENTITY'] });
    await service.revokeConsent({ avatarId: real.id, brandId: BRAND_ID, intakeId: realIntake.asset.id, modality: 'FACE',
      reason: 'Integration fixture revocation', humanApproval: true });
    await assert.rejects(() => service.useIntake({ avatarId: real.id, brandId: BRAND_ID, intakeId: realIntake.asset.id,
      roles: ['IDENTITY'] }), (error) => error.code === 'ASSET_NOT_ELIGIBLE');
    assert.equal(Number((await db.query(`SELECT count(*) AS count FROM avatar_studio.consent_events
      WHERE character_id=$1 AND modality='FACE'`,[real.id])).rows[0].count),2,'grant and revocation must both remain append-only');

    const passportPlan = await service.planPassportGeneration({ avatarId:l0.id,brandId:BRAND_ID,
      sourceAssetIds:[intakeSource.source.id],requestedCandidateCount:4 });
    assert.equal(passportPlan.plannedExternalCallCount,4); assert.equal(passportPlan.externalGenerationCalls,0);
    assert.equal(passportPlan.paidProviderCalls,0); assert.equal(passportPlan.costPlan.status,'UNKNOWN');
    assert.equal(passportPlan.executionAuthorized,false);
    const composite = Buffer.alloc(40); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(composite);
    composite.writeUInt32BE(13,8); composite.write('IHDR',12,'ascii'); composite.writeUInt32BE(3000,16); composite.writeUInt32BE(1000,20);
    const candidates=[];
    for (const label of ['A','B','C','D']) {
      const candidateIntake=await service.intakeAsset({avatarId:l0.id,brandId:BRAND_ID,sourceType:'UPLOAD',
        file:{name:`passport-${label}.png`,mimeType:'image/png',contentBase64:composite.toString('base64')},
        provenance:{owner:'SYNTHETIC',source:'POSTGRES_MANUAL_PASSPORT_FIXTURE'}});
      await service.useIntake({avatarId:l0.id,brandId:BRAND_ID,intakeId:candidateIntake.asset.id,roles:['PASSPORT_CANDIDATE']});
      candidates.push((await service.uploadPassportCandidate({avatarId:l0.id,brandId:BRAND_ID,
        generationSpecId:passportPlan.id,intakeId:candidateIntake.asset.id})).candidate);
    }
    assert.equal(candidates.length,4); assert.equal((await service.refresh(l0.id,BRAND_ID)).currentLevel,0,
      'candidate uploads must not create L1');
    const qaA=await service.runPassportQa({avatarId:l0.id,brandId:BRAND_ID,candidateId:candidates[0].id,
      profileDrift:true,observations:{PROFILE_IDENTITY:'FAIL'}});
    assert.equal(qaA.analysis.status,'REJECT'); assert(qaA.analysis.blockingFailures.includes('PROFILE_DRIFT'));
    await service.reviewPassportCandidate({avatarId:l0.id,brandId:BRAND_ID,candidateId:candidates[0].id,
      action:'REJECT',rejectionReason:'PROFILE_DRIFT',humanNote:'Profile is another identity',humanApproval:true});
    const qaB=await service.runPassportQa({avatarId:l0.id,brandId:BRAND_ID,candidateId:candidates[1].id});
    assert.equal(qaB.analysis.status,'WARN'); assert.equal((await service.refresh(l0.id,BRAND_ID)).currentLevel,0,
      'automated QA PASS/WARN must not create L1');
    await service.reviewPassportCandidate({avatarId:l0.id,brandId:BRAND_ID,candidateId:candidates[1].id,
      action:'KEEP',humanNote:'Keep for guided comparison',humanApproval:true});
    assert.equal((await service.refresh(l0.id,BRAND_ID)).currentLevel,0,'KEEP must not create L1');
    const certified=await service.certifyPassportCandidate({avatarId:l0.id,brandId:BRAND_ID,candidateId:candidates[1].id,
      guidedReview:{frontal:true,threeQuarter:true,profile:true,allThree:true},warningsAcknowledged:qaB.analysis.warnings,
      explicitConfirmation:true,humanApproval:true});
    assert.equal(certified.avatar.currentLevel,1); assert.equal(certified.avatar.nextLevel.name,'BODY_EXPRESSIONS');
    await service.runPassportQa({avatarId:l0.id,brandId:BRAND_ID,candidateId:candidates[2].id});
    await assert.rejects(()=>service.certifyPassportCandidate({avatarId:l0.id,brandId:BRAND_ID,candidateId:candidates[2].id,
      guidedReview:{frontal:true,threeQuarter:true,profile:true,allThree:true},explicitConfirmation:true,humanApproval:true}),
    (error)=>error.code==='PASSPORT_ALREADY_CERTIFIED','exactly one certification per Identity Version must fail closed');
    await assert.rejects(()=>db.query('UPDATE avatar_studio.passport_candidates SET model=$2 WHERE id=$1',[candidates[1].id,'mutated']),
      (error)=>error.code==='P0001');
    await assert.rejects(()=>db.query('UPDATE avatar_studio.passport_candidate_review_events SET human_note=$2 WHERE candidate_id=$1',
      [candidates[0].id,'mutated']), (error)=>error.code==='P0001');

    const repairPlan=await service.planPassportGeneration({avatarId:l0.id,brandId:BRAND_ID,
      sourceAssetIds:[intakeSource.source.id],requestedCandidateCount:3,originalGenerationSpecId:passportPlan.id,
      repairDelta:{profile:'preserve original nose silhouette'}});
    assert.equal(repairPlan.originalGenerationSpecId,passportPlan.id); assert.equal(repairPlan.externalGenerationCalls,0);

    let progressed = certified.avatar;
    for (const kind of ['CHEST_UP','FULL_BODY_STANDING','SEATED']) progressed = (await service.addLevelAsset({ avatarId: l0.id,
      brandId: BRAND_ID, type: 'BODY', humanApproval: true, value: { kind, artifactId: `body-${kind}`, artifactVersion: 1,
        approvalStatus: 'APPROVED', provenance: { source: 'POSTGRES_TEST_FIXTURE' } } })).avatar;
    for (const expression of ['NEUTRAL','WARM_SMILE','CONCERNED_SERIOUS']) progressed = (await service.addLevelAsset({ avatarId: l0.id,
      brandId: BRAND_ID, type: 'EXPRESSION', humanApproval: true, value: { expression, artifactId: `expression-${expression}`, artifactVersion: 1,
        approvalStatus: 'APPROVED', provenance: { source: 'POSTGRES_TEST_FIXTURE' } } })).avatar;
    assert.equal(progressed.currentLevel, 2);
    progressed = (await service.addLevelAsset({ avatarId: l0.id, brandId: BRAND_ID, type: 'WARDROBE', humanApproval: true, value: {
      name: 'Calm Expert', clothingDescription: 'neutral structured knit and trousers', accessories: [],
      prohibitedCombinations: ['construction logos'], referenceArtifacts: [], approvalStatus: 'APPROVED',
      provenance: { source: 'POSTGRES_TEST_FIXTURE' } } })).avatar;
    assert.equal(progressed.currentLevel, 3);
    progressed = (await service.addLevelAsset({ avatarId: l0.id, brandId: BRAND_ID, type: 'VOICE', humanApproval: true, value: {
      name: 'Synthetic Calm Voice', sourceType: 'SYNTHETIC', language: 'en', deliveryPresets: ['CALM_EXPERT'],
      approvalStatus: 'APPROVED', provenance: { source: 'POSTGRES_TEST_FIXTURE' } } })).avatar;
    assert.equal(progressed.currentLevel, 4);
    progressed = (await service.addLevelAsset({ avatarId: l0.id, brandId: BRAND_ID, type: 'LOCATION', humanApproval: true, value: {
      name: 'Quiet Studio', environmentArtifactId: 'location-studio', environmentArtifactVersion: 1,
      perspective: { vanishingPoint: 'center' }, cameraHeight: 'eye-level', lensCharacter: 'natural 50mm',
      lightingDirection: 'camera left', lightingTemperature: '4300K', referenceGeometry: { width: 1080, height: 1920 },
      keyGeometryObjects: ['chair','window'], rightsProvenance: { rights: 'synthetic fixture' },
      approvalStatus: 'APPROVED' } })).avatar;
    assert.equal(progressed.currentLevel, 5);
    progressed = (await service.addLevelAsset({ avatarId: l0.id, brandId: BRAND_ID, type: 'PERFORMANCE', humanApproval: true, value: {
      preset: 'CALM_EXPERT', motionSpec: { hands: 'mostly still' }, failureNotes: ['monitor hand drift'],
      approvalStatus: 'APPROVED', provenance: { source: 'POSTGRES_TEST_FIXTURE' } } })).avatar;
    assert.equal(progressed.currentLevel, 6);
    const snapshotColumns = (await db.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='continuity_snapshots'`)).rows.map((item) => item.column_name);
    if (snapshotColumns.includes('workspace_id')) await db.query(`INSERT INTO continuity_snapshots
      (id,workspace_id,entity_type,entity_name,state_json,state_hash) VALUES($1,$2,'AVATAR','Mara Fixture','{}','fixture-hash') ON CONFLICT(id) DO NOTHING`,
    [SNAPSHOT_ID, WORKSPACE_ID]);
    else await db.query('INSERT INTO continuity_snapshots(id) VALUES($1) ON CONFLICT(id) DO NOTHING', [SNAPSHOT_ID]);
    progressed = (await service.addLevelAsset({ avatarId: l0.id, brandId: BRAND_ID, type: 'CONTINUITY', humanApproval: true, value: {
      continuitySnapshotId: SNAPSHOT_ID, identity: { status: 'PASS' }, wardrobe: { status: 'PASS' }, props: { status: 'PASS' },
      location: { status: 'PASS' }, geometry: { status: 'PASS' }, voice: { status: 'PASS' }, lipSync: { status: 'PASS' },
      evidence: { source: 'CANONICAL_CONTINUITY_SNAPSHOT' }, approvalStatus: 'APPROVED' } })).avatar;
    assert.equal(progressed.currentLevel, 7);

    const plan = await service.compileTestPlan({ vertical: 'PSYCHOLOGY_WELLBEING', brandId: BRAND_ID, avatarId: l0.id,
      format: 'MULTI_SHOT', referenceSourceId: intakeSource.source.id, script: { text: 'Pause before reacting.' },
      shotPlan: [{ shotId: 'shot-1', purpose: 'opening' },{ shotId: 'shot-2', purpose: 'reframe' }] });
    assert.equal(plan.externalCallCount, 0); assert.equal(plan.compiledProviderPlan.expectedPaidCalls, 0);
    assert.equal(plan.compiledProviderPlan.executionAuthorized, false); assert.equal(paidProviderCalls, 0);
    await assert.rejects(() => db.query(`UPDATE avatar_studio.character_versions SET identity_spec='{}' WHERE character_id=$1`, [l0.id]),
      (error) => error.code === 'P0001');
    await db.query(`INSERT INTO v2_2.brands(id,workspace_id,name,slug,status) VALUES($1,$2,'Travel Fixture','travel-fixture','ACTIVE')
      ON CONFLICT(id) DO UPDATE SET status='ACTIVE'`, [OTHER_BRAND_ID, WORKSPACE_ID]);
    await db.query(`INSERT INTO avatar_studio.brand_verticals(workspace_id,brand_id,vertical_code,assigned_by)
      VALUES($1,$2,'TRAVEL','avatar-test-operator')`, [WORKSPACE_ID, OTHER_BRAND_ID]);
    await assert.rejects(() => db.query(`INSERT INTO avatar_studio.brand_permissions(workspace_id,character_id,brand_id,approved_by)
      VALUES($1,$2,$3,'avatar-test-operator')`, [WORKSPACE_ID, l0.id, OTHER_BRAND_ID]), (error) => error.code === 'P0001');
    await db.query(`INSERT INTO workspaces(id,name) VALUES($1,'Other disposable workspace') ON CONFLICT(id) DO NOTHING`, [OTHER_WORKSPACE_ID]);
    await db.query(`INSERT INTO v2_2.brands(id,workspace_id,name,slug,status) VALUES($1,$2,'Other Workspace Brand','other-workspace-brand','ACTIVE')
      ON CONFLICT(id) DO UPDATE SET status='ACTIVE'`, [CROSS_WORKSPACE_BRAND_ID, OTHER_WORKSPACE_ID]);
    await assert.rejects(() => service.create({ vertical: 'PSYCHOLOGY_WELLBEING', brandIds: [BRAND_ID,CROSS_WORKSPACE_BRAND_ID],
      internalName: 'Cross Workspace Forbidden', subjectType: 'SYNTHETIC', identity: { agePresentation: 'adult', personality: 'calm',
        role: 'host', languages: ['en'], visualDirection: 'portrait', prohibitedUses: ['deception'] },
      consent: { status: 'APPROVED', rightsBasis: 'SYNTHETIC_IDENTITY' } }), (error) => error.code === 'WORKSPACE_ISOLATION_VIOLATION');
    console.log(`Avatar Studio PostgreSQL L0 -> L1 -> L7 passed (${l0.id}); durable multi-shot plan ${plan.id}; paid/external calls = 0`);
  } finally { await db.end(); await fs.rm(storageRoot,{ recursive:true,force:true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
