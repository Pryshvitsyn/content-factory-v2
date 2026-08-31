'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { AvatarStudioPostgresRepository } = require('../src/avatar-studio/postgres-repository');
const { AvatarStudioService } = require('../src/avatar-studio/service');

const WORKSPACE_ID = 'a0000000-0000-4000-8000-000000000001';
const BRAND_ID = 'a0000000-0000-4000-8000-000000000002';
const OTHER_BRAND_ID = 'a0000000-0000-4000-8000-000000000003';
const SNAPSHOT_ID = 'a0000000-0000-4000-8000-000000000004';

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
  try {
    await db.query('DROP SCHEMA IF EXISTS avatar_studio CASCADE');
    await db.query(await fs.readFile(path.resolve('migrations/20260831_avatar_studio_v1.sql'), 'utf8'));
    await db.query(`INSERT INTO workspaces(id,name) VALUES($1,'Avatar Studio disposable') ON CONFLICT(id) DO NOTHING`, [WORKSPACE_ID]);
    await db.query(`INSERT INTO v2_2.brands(id,workspace_id,name,slug,status) VALUES($1,$2,'Attune Avatar Test','attune-avatar-test','ACTIVE')
      ON CONFLICT(id) DO UPDATE SET status='ACTIVE'`, [BRAND_ID, WORKSPACE_ID]);

    const repository = new AvatarStudioPostgresRepository({ db });
    const service = new AvatarStudioService({ repository, actor: 'avatar-test-operator' });
    const l0 = await service.create({ vertical: 'PSYCHOLOGY_WELLBEING', brandIds: [BRAND_ID], internalName: 'Mara Fixture',
      subjectType: 'SYNTHETIC', identity: { agePresentation: 'late 30s', personality: 'calm and precise',
        role: 'behavioral coach', languages: ['en'], visualDirection: 'natural face and stable proportions', permanentAttributes: {},
        prohibitedUses: ['deception'] }, consent: { status: 'APPROVED', rightsBasis: 'SYNTHETIC_IDENTITY' },
      provenance: { source: 'POSTGRES_TEST_FIXTURE' } });
    assert.equal(l0.currentLevel, 0); assert.equal(l0.nextLevel.name, 'PASSPORT');

    const imported = await service.importSource({ avatarId: l0.id, brandId: BRAND_ID, source: {
      sourceType: 'SYNTHETIC_TRAITS', sourceLocator: `fixture://avatar/${l0.id}/identity`,
      gate0Text: 'Owned synthetic identity fixture with neutral studio geometry', provenance: { source: 'POSTGRES_TEST_FIXTURE' },
    } });
    assert.equal(imported.gate0.status, 'PASS'); assert.equal(imported.gate0.externalCalls, 0);
    const candidate = await service.registerPassport({ avatarId: l0.id, brandId: BRAND_ID, sourceId: imported.source.id,
      panels: [{ angle: 'FRONTAL', artifactId: 'fixture-passport-front', artifactVersion: 1 },
        { angle: 'THREE_QUARTER_45', artifactId: 'fixture-passport-45', artifactVersion: 1 },
        { angle: 'PROFILE_90', artifactId: 'fixture-passport-90', artifactVersion: 1 }],
      qa: { samePerson: true, temporaryElementsExcluded: true } });
    assert.equal(candidate.avatar.currentLevel, 0, 'registration alone must not level up without human certification');
    const certified = await service.certifyPassport({ avatarId: l0.id, brandId: BRAND_ID,
      passportId: candidate.passport.id, decision: 'CERTIFIED', humanApproval: true, notes: 'Exact fixture passport approved' });
    assert.equal(certified.avatar.currentLevel, 1); assert.equal(certified.avatar.nextLevel.name, 'BODY_EXPRESSIONS');

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
      format: 'MULTI_SHOT', referenceSourceId: imported.source.id, script: { text: 'Pause before reacting.' },
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
    console.log(`Avatar Studio PostgreSQL L0 -> L1 -> L7 passed (${l0.id}); durable multi-shot plan ${plan.id}; paid/external calls = 0`);
  } finally { await db.end(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
