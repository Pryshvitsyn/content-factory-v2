'use strict';

const { AvatarStudioError } = require('./domain');

function camel(row = {}) {
  const result = {};
  for (const [key, value] of Object.entries(row)) result[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
  return result;
}
function json(value) { return JSON.stringify(value ?? null); }

class AvatarStudioPostgresRepository {
  constructor({ db } = {}) { if (!db?.query) throw new Error('db is required'); this.db = db; }

  async verticals() {
    return (await this.db.query('SELECT code,display_name AS "displayName" FROM avatar_studio.audience_verticals WHERE status=\'ACTIVE\' ORDER BY code')).rows;
  }

  async createCharacter({ character, identityHash, actor }) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const brands = (await client.query(`SELECT id,workspace_id,status FROM v2_2.brands
        WHERE id=ANY($1::uuid[]) FOR UPDATE`, [character.brandIds])).rows;
      if (brands.length !== character.brandIds.length || brands.some((item) => item.status !== 'ACTIVE')) {
        throw new AvatarStudioError(404, 'BRAND_NOT_FOUND', 'Every allowed brand must exist and be active');
      }
      const workspaces = new Set(brands.map((item) => item.workspace_id));
      if (workspaces.size !== 1) throw new AvatarStudioError(409, 'WORKSPACE_ISOLATION_VIOLATION', 'Allowed brands must share one workspace');
      const workspaceId = brands[0].workspace_id;
      const assigned = (await client.query('SELECT brand_id,vertical_code FROM avatar_studio.brand_verticals WHERE brand_id=ANY($1::uuid[]) FOR UPDATE', [character.brandIds])).rows;
      const conflict = assigned.find((item) => item.vertical_code !== character.vertical);
      if (conflict) throw new AvatarStudioError(409, 'VERTICAL_ISOLATION_VIOLATION', 'A selected brand belongs to a different audience vertical');
      await client.query(`INSERT INTO avatar_studio.brand_verticals(workspace_id,brand_id,vertical_code,assigned_by)
        SELECT $1,id,$2,$3 FROM v2_2.brands WHERE id=ANY($4::uuid[]) ON CONFLICT(brand_id) DO NOTHING`,
      [workspaceId, character.vertical, actor, character.brandIds]);
      const row = (await client.query(`INSERT INTO avatar_studio.characters
        (workspace_id,vertical_code,internal_name,subject_type,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [workspaceId, character.vertical, character.internalName, character.subjectType, actor])).rows[0];
      await client.query(`INSERT INTO avatar_studio.character_versions
        (workspace_id,character_id,version,identity_spec,identity_hash,provenance,created_by) VALUES($1,$2,1,$3,$4,$5,$6)`,
      [workspaceId, row.id, character.identity, identityHash, character.provenance, actor]);
      for (const brandId of character.brandIds) await client.query(`INSERT INTO avatar_studio.brand_permissions
        (workspace_id,character_id,brand_id,approved_by) VALUES($1,$2,$3,$4)`, [workspaceId, row.id, brandId, actor]);
      await client.query(`INSERT INTO avatar_studio.consent_records
        (workspace_id,character_id,scope,status,rights_basis,evidence_artifact_id,evidence_artifact_version,restrictions,provenance,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [workspaceId, row.id,
        character.subjectType === 'SYNTHETIC' ? 'SYNTHETIC_IDENTITY' : 'FACE_AND_VOICE', character.consent.status,
        character.consent.rightsBasis, character.consent.evidenceArtifactId, character.consent.evidenceArtifactVersion,
        json(character.consent.restrictions), character.provenance, actor]);
      await client.query('INSERT INTO avatar_studio.level_states(workspace_id,character_id) VALUES($1,$2)', [workspaceId, row.id]);
      await client.query('COMMIT'); return camel(row);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async listCharacters({ brandId = null, vertical = null } = {}) {
    const rows = (await this.db.query(`SELECT c.*,ls.current_level,ls.level_name,ls.blocking_failures,
      coalesce(jsonb_agg(DISTINCT bp.brand_id) FILTER (WHERE bp.allowed),'[]'::jsonb) AS allowed_brand_ids,
      (coalesce(bool_or(cr.status='APPROVED'),false) OR EXISTS(SELECT 1 FROM avatar_studio.consent_events ce
        WHERE ce.character_id=c.id AND ce.modality='FACE' AND ce.status='APPROVED' AND ce.event_type='GRANT'
        AND (ce.expires_at IS NULL OR ce.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM avatar_studio.consent_events newer
          WHERE newer.character_id=ce.character_id AND newer.modality=ce.modality AND newer.recorded_at>ce.recorded_at))) AS consent_approved
      FROM avatar_studio.characters c JOIN avatar_studio.level_states ls ON ls.character_id=c.id
      JOIN avatar_studio.brand_permissions bp ON bp.character_id=c.id
      LEFT JOIN avatar_studio.consent_records cr ON cr.character_id=c.id
      WHERE ($1::uuid IS NULL OR (bp.brand_id=$1 AND bp.allowed)) AND ($2::text IS NULL OR c.vertical_code=$2)
      GROUP BY c.id,ls.character_id ORDER BY c.created_at DESC`, [brandId, vertical])).rows;
    return rows.map(camel);
  }

  async getCharacter({ id, brandId = null } = {}) {
    const base = (await this.db.query(`SELECT c.*,cv.version,cv.identity_spec,cv.identity_hash,ls.current_level,ls.level_name,
      ls.completed_requirements,ls.missing_requirements,ls.blocking_failures
      FROM avatar_studio.characters c JOIN avatar_studio.character_versions cv ON cv.character_id=c.id
      AND cv.version=(SELECT max(version) FROM avatar_studio.character_versions WHERE character_id=c.id)
      JOIN avatar_studio.level_states ls ON ls.character_id=c.id
      WHERE c.id=$1 AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM avatar_studio.brand_permissions bp
        WHERE bp.character_id=c.id AND bp.brand_id=$2 AND bp.allowed))`, [id, brandId])).rows[0];
    if (!base) return null;
    const tableQueries = [
      ['brandPermissions', 'SELECT brand_id,allowed,approved_by,approved_at FROM avatar_studio.brand_permissions WHERE character_id=$1'],
      ['consentRecords', 'SELECT * FROM avatar_studio.consent_records WHERE character_id=$1 ORDER BY recorded_at DESC'],
      ['consentEvents', 'SELECT * FROM avatar_studio.consent_events WHERE character_id=$1 ORDER BY recorded_at DESC,id DESC'],
      ['sources', 'SELECT * FROM avatar_studio.source_assets WHERE character_id=$1 ORDER BY imported_at DESC'],
      ['bodyReferences', 'SELECT * FROM avatar_studio.body_references WHERE character_id=$1 ORDER BY created_at'],
      ['expressionReferences', 'SELECT * FROM avatar_studio.expression_references WHERE character_id=$1 ORDER BY created_at'],
      ['wardrobes', 'SELECT * FROM avatar_studio.wardrobe_packs WHERE character_id=$1 ORDER BY created_at'],
      ['voiceProfiles', 'SELECT * FROM avatar_studio.voice_profiles WHERE character_id=$1 ORDER BY created_at'],
      ['locations', 'SELECT * FROM avatar_studio.location_packs WHERE character_id=$1 ORDER BY created_at'],
      ['performancePacks', 'SELECT * FROM avatar_studio.performance_packs WHERE character_id=$1 ORDER BY created_at'],
      ['continuityReadiness', 'SELECT * FROM avatar_studio.continuity_readiness WHERE character_id=$1 ORDER BY approved_at'],
    ];
    const results = await Promise.all(tableQueries.map(([, sql]) => this.db.query(sql, [id])));
    const avatar = camel(base);
    tableQueries.forEach(([key], index) => { avatar[key] = results[index].rows.map(camel); });
    avatar.vertical = avatar.verticalCode; avatar.subjectType = avatar.subjectType; avatar.identity = avatar.identitySpec;
    avatar.brandIds = avatar.brandPermissions.filter((item) => item.allowed).map((item) => item.brandId);
    const latestFaceEvent = avatar.consentEvents.find((item) => item.modality === 'FACE');
    avatar.consent = (latestFaceEvent?.status === 'APPROVED' ? latestFaceEvent : null)
      || avatar.consentRecords.find((item) => item.status === 'APPROVED') || null;
    const passports = (await this.db.query(`SELECT p.*,pc.decision,pc.approved_by,pc.approved_at
      FROM avatar_studio.passports p LEFT JOIN avatar_studio.passport_certifications pc ON pc.passport_id=p.id
      WHERE p.character_id=$1 ORDER BY p.candidate_no`, [id])).rows.map(camel);
    for (const passport of passports) passport.panels = (await this.db.query('SELECT * FROM avatar_studio.passport_panels WHERE passport_id=$1 ORDER BY angle', [passport.id])).rows.map(camel);
    avatar.passports = passports; return avatar;
  }

  async saveLevelState({ avatarId, workspaceId, state }) {
    await this.db.query(`UPDATE avatar_studio.level_states SET current_level=$3,level_name=$4,completed_requirements=$5,
      missing_requirements=$6,blocking_failures=$7,evaluated_at=now() WHERE workspace_id=$1 AND character_id=$2`,
    [workspaceId, avatarId, state.currentLevel, state.currentLevelName, json(state.completedRequirements),
      json(state.missingRequirements), json(state.blockingFailures)]);
  }

  async appendIdentityVersion({ avatar, brandId, identity, identityHash, provenance, actor }) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const owner = (await client.query(`SELECT c.id,c.workspace_id FROM avatar_studio.characters c
        WHERE c.id=$1 AND c.workspace_id=$2 AND EXISTS(SELECT 1 FROM avatar_studio.brand_permissions bp
          WHERE bp.character_id=c.id AND bp.brand_id=$3 AND bp.allowed) FOR UPDATE`, [avatar.id,avatar.workspaceId,brandId])).rows[0];
      if (!owner) throw new AvatarStudioError(404, 'AVATAR_NOT_FOUND', 'Avatar was not found in this brand scope');
      const version = Number((await client.query('SELECT coalesce(max(version),0)+1 AS version FROM avatar_studio.character_versions WHERE character_id=$1', [avatar.id])).rows[0].version);
      const row = (await client.query(`INSERT INTO avatar_studio.character_versions
        (workspace_id,character_id,version,identity_spec,identity_hash,provenance,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [avatar.workspaceId,avatar.id,version,identity,identityHash,provenance,actor])).rows[0];
      await client.query('COMMIT'); return camel(row);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async createIntake({ id, avatar, brandId, artifact, media, sourceType, sourceLocator, existingAssetId,
    gate0, rightsStatus, provenance, actor }) {
    const row = (await this.db.query(`INSERT INTO avatar_studio.asset_intakes
      (id,workspace_id,brand_id,vertical_code,character_id,artifact_id,artifact_version,artifact_storage_key,content_hash,
       original_filename,mime_type,extension,byte_size,width,height,duration_ms,source_type,source_locator,
       existing_asset_registry_id,gate0_status,gate0_findings,gate0_policy_version,rights_status,provenance,uploader)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *`,
    [id,avatar.workspaceId,brandId,avatar.vertical,avatar.id,artifact.artifactId,artifact.version,artifact.storageKey,
      artifact.contentHash,media.filename,media.mimeType,media.extension,media.byteSize,media.width,media.height,media.durationMs,
      sourceType,sourceLocator || null,existingAssetId || null,gate0.status,json(gate0.findings),gate0.policyVersion,
      rightsStatus,provenance,actor])).rows[0];
    return this.intake({ id: row.id, brandId, avatarId: avatar.id });
  }

  async intake({ id, brandId, avatarId = null }) {
    const row = (await this.db.query(`SELECT ai.*,
      gre.action AS latest_review_action,gre.reason AS latest_review_reason,gre.decided_by,gre.decided_at,
      CASE
        WHEN ai.gate0_status='BLOCK' THEN 'BLOCK'
        WHEN gre.action IN ('REJECT','KEEP_BLOCKED') THEN 'BLOCK'
        WHEN ai.gate0_status='REVIEW' AND gre.action='APPROVE_FOR_USE' THEN 'PASS'
        ELSE ai.gate0_status END AS effective_gate0_status,
      CASE WHEN rights.id IS NOT NULL THEN 'VERIFIED' ELSE ai.rights_status END AS effective_rights_status
      FROM avatar_studio.asset_intakes ai
      LEFT JOIN LATERAL (SELECT * FROM avatar_studio.gate0_review_events e WHERE e.intake_asset_id=ai.id
        AND e.action<>'MARK_RIGHTS_VERIFIED'
        ORDER BY e.decided_at DESC,e.id DESC LIMIT 1) gre ON true
      LEFT JOIN LATERAL (SELECT id FROM avatar_studio.gate0_review_events e WHERE e.intake_asset_id=ai.id
        AND e.action='MARK_RIGHTS_VERIFIED' ORDER BY e.decided_at DESC,e.id DESC LIMIT 1) rights ON true
      WHERE ai.id=$1 AND ai.brand_id=$2 AND ($3::uuid IS NULL OR ai.character_id=$3)`, [id,brandId,avatarId])).rows[0];
    if (!row) return null;
    const [reviews, consents] = await Promise.all([
      this.db.query('SELECT * FROM avatar_studio.gate0_review_events WHERE intake_asset_id=$1 ORDER BY decided_at,id', [id]),
      this.db.query(`SELECT DISTINCT ON (modality) * FROM avatar_studio.consent_events
        WHERE character_id=$1 AND (intake_asset_id=$2 OR intake_asset_id IS NULL)
        ORDER BY modality,recorded_at DESC,id DESC`, [row.character_id,id]),
    ]);
    const result = camel(row); result.reviewEvents = reviews.rows.map(camel); result.effectiveConsents = consents.rows.map(camel);
    return result;
  }

  async listIntakes({ brandId, avatarId = null, reviewOnly = false }) {
    const rows = (await this.db.query(`SELECT ai.id FROM avatar_studio.asset_intakes ai
      WHERE ai.brand_id=$1 AND ($2::uuid IS NULL OR ai.character_id=$2)
        AND (NOT $3::boolean OR (ai.gate0_status IN ('REVIEW','BLOCK') AND NOT EXISTS(
          SELECT 1 FROM avatar_studio.gate0_review_events terminal WHERE terminal.intake_asset_id=ai.id
          AND terminal.action IN ('APPROVE_FOR_USE','REJECT','KEEP_BLOCKED')))) ORDER BY ai.created_at DESC`,
    [brandId,avatarId,reviewOnly])).rows;
    return Promise.all(rows.map((row) => this.intake({ id: row.id, brandId, avatarId })));
  }

  async addReviewEvent({ intake, action, reason, actor }) {
    return camel((await this.db.query(`INSERT INTO avatar_studio.gate0_review_events
      (workspace_id,brand_id,intake_asset_id,action,reason,findings_snapshot,decided_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [intake.workspaceId,intake.brandId,intake.id,action,reason,
      json(intake.gate0Findings),actor])).rows[0]);
  }

  async createConsentRequest({ intake, modality, tokenHash, disclosureText, expiresAt, actor }) {
    return camel((await this.db.query(`INSERT INTO avatar_studio.consent_requests
      (workspace_id,brand_id,character_id,intake_asset_id,modality,token_hash,disclosure_text,requested_by,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,workspace_id,brand_id,character_id,intake_asset_id,modality,
      disclosure_text,requested_by,expires_at,created_at`, [intake.workspaceId,intake.brandId,intake.characterId,intake.id,
      modality,tokenHash,disclosureText,actor,expiresAt])).rows[0]);
  }

  async addConsentEvent({ intake, requestId = null, modality, eventType, status, subjectIdentity, rightsBasis,
    allowedBrandIds, allowedVerticals, allowedChannels, allowedUseTypes, evidenceArtifactId, evidenceArtifactVersion,
    evidenceNotes, expiresAt, supersedesEventId = null, actor }) {
    return camel((await this.db.query(`INSERT INTO avatar_studio.consent_events
      (workspace_id,brand_id,character_id,intake_asset_id,consent_request_id,modality,event_type,status,subject_identity,
       rights_basis,allowed_brand_ids,allowed_verticals,allowed_channels,allowed_use_types,evidence_artifact_id,
       evidence_artifact_version,evidence_notes,expires_at,supersedes_event_id,recorded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [intake.workspaceId,intake.brandId,intake.characterId,intake.id,requestId,modality,eventType,status,subjectIdentity,
      rightsBasis,json(allowedBrandIds),json(allowedVerticals),json(allowedChannels),json(allowedUseTypes),evidenceArtifactId || null,
      evidenceArtifactVersion || null,evidenceNotes || null,expiresAt || null,supersedesEventId,actor])).rows[0]);
  }

  async listExistingAssets({ brandId, workspaceId }) {
    return (await this.db.query(`SELECT ar.id,ar.asset_id AS "artifactId",ar.artifact_version AS "artifactVersion",
      ar.artifact_storage_key AS "storageKey",ar.kind,ar.metadata,ar.created_at AS "createdAt",p.workspace_id AS "workspaceId",
      p.brand_id AS "brandId" FROM v2_1.asset_registry ar JOIN v2_1.productions p ON p.id=ar.production_id
      WHERE p.brand_id=$1 AND p.workspace_id=$2 AND ar.status='READY' ORDER BY ar.created_at DESC`, [brandId,workspaceId])).rows;
  }

  async existingAsset({ id, brandId, workspaceId }) {
    return (await this.db.query(`SELECT ar.id,ar.asset_id AS "artifactId",ar.artifact_version AS "artifactVersion",
      ar.artifact_storage_key AS "storageKey",ar.kind,ar.metadata,p.workspace_id AS "workspaceId",p.brand_id AS "brandId"
      FROM v2_1.asset_registry ar JOIN v2_1.productions p ON p.id=ar.production_id
      WHERE ar.id=$1 AND p.brand_id=$2 AND p.workspace_id=$3 AND ar.status='READY'`, [id,brandId,workspaceId])).rows[0] || null;
  }

  async useIntake({ avatar, intake, roles, actor }) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const locked = (await client.query(`SELECT * FROM avatar_studio.asset_intakes
        WHERE id=$1 AND character_id=$2 AND brand_id=$3 FOR SHARE`, [intake.id,avatar.id,intake.brandId])).rows[0];
      if (!locked) throw new AvatarStudioError(404, 'INTAKE_NOT_FOUND', 'Asset intake was not found in this avatar scope');
      const mediaType = String(intake.mimeType).split('/')[0];
      const sourceType = intake.sourceType === 'EXISTING_ASSET' ? 'EXISTING_ARTIFACT'
        : mediaType === 'image' ? 'IMAGE' : mediaType === 'video' ? 'VIDEO' : 'AUDIO';
      const source = (await client.query(`INSERT INTO avatar_studio.source_assets
        (workspace_id,character_id,brand_id,intake_asset_id,source_type,source_locator,artifact_id,artifact_version,
         content_hash,gate0_status,gate0_findings,provenance,imported_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PASS',$10,$11,$12) RETURNING *`,
      [avatar.workspaceId,avatar.id,intake.brandId,intake.id,sourceType,intake.sourceLocator || null,intake.artifactId,
        intake.artifactVersion,intake.contentHash,json(intake.gate0Findings),{ ...intake.provenance, intakeAssetId: intake.id },actor])).rows[0];
      for (const role of roles) await client.query(`INSERT INTO avatar_studio.source_asset_roles(source_asset_id,role,assigned_by)
        VALUES($1,$2,$3)`, [source.id,role,actor]);
      await client.query('COMMIT'); const result = camel(source); result.roles = roles; return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async registerSource({ avatar, source, gate0, actor }) {
    return camel((await this.db.query(`INSERT INTO avatar_studio.source_assets
      (workspace_id,character_id,source_type,source_locator,artifact_id,artifact_version,content_hash,gate0_status,gate0_findings,provenance,imported_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [avatar.workspaceId, avatar.id, source.sourceType,
      source.sourceLocator || null, source.artifactId || null, source.artifactVersion || null, source.contentHash || null,
      gate0.status, json(gate0.findings), { ...(source.provenance || {}), gate0Policy: gate0.policyVersion }, actor])).rows[0]);
  }

  async registerPassport({ avatar, sourceId, panels, qa, actor }) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const source = (await client.query('SELECT * FROM avatar_studio.source_assets WHERE id=$1 AND character_id=$2 FOR SHARE', [sourceId, avatar.id])).rows[0];
      if (!source) throw new AvatarStudioError(404, 'SOURCE_NOT_FOUND', 'Passport source was not found in this avatar scope');
      if (source.gate0_status === 'BLOCK') throw new AvatarStudioError(409, 'GATE0_BLOCKED', 'Blocked source cannot become a passport');
      const number = Number((await client.query('SELECT coalesce(max(candidate_no),0)+1 AS n FROM avatar_studio.passports WHERE character_id=$1', [avatar.id])).rows[0].n);
      const passport = (await client.query(`INSERT INTO avatar_studio.passports
        (workspace_id,character_id,candidate_no,source_asset_id,qa,registered_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [avatar.workspaceId, avatar.id, number, sourceId, qa || {}, actor])).rows[0];
      for (const panel of panels) await client.query(`INSERT INTO avatar_studio.passport_panels
        (passport_id,angle,artifact_id,artifact_version,content_hash,reference_geometry,provenance)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [passport.id, panel.angle, panel.artifactId, panel.artifactVersion,
        panel.contentHash || null, panel.referenceGeometry || {}, panel.provenance || {}]);
      await client.query('COMMIT'); return camel(passport);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  async certifyPassport({ avatar, passportId, decision, notes, actor }) {
    const result = await this.db.query(`INSERT INTO avatar_studio.passport_certifications
      (workspace_id,character_id,passport_id,decision,approval_notes,approved_by)
      SELECT $1,$2,p.id,$4,$5,$6 FROM avatar_studio.passports p WHERE p.id=$3 AND p.character_id=$2 RETURNING *`,
    [avatar.workspaceId, avatar.id, passportId, decision, notes || null, actor]);
    if (!result.rows[0]) throw new AvatarStudioError(404, 'PASSPORT_NOT_FOUND', 'Passport candidate was not found');
    return camel(result.rows[0]);
  }

  async insertLevelAsset({ avatar, type, value, actor }) {
    const common = [avatar.workspaceId, avatar.id]; let query; let params;
    if (type === 'BODY') { query = `INSERT INTO avatar_studio.body_references
      (workspace_id,character_id,kind,artifact_id,artifact_version,approval_status,provenance,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`; params = [...common,value.kind,value.artifactId,value.artifactVersion,value.approvalStatus,value.provenance || {},actor]; }
    else if (type === 'EXPRESSION') { query = `INSERT INTO avatar_studio.expression_references
      (workspace_id,character_id,expression,artifact_id,artifact_version,approval_status,provenance,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`; params = [...common,value.expression,value.artifactId,value.artifactVersion,value.approvalStatus,value.provenance || {},actor]; }
    else if (type === 'WARDROBE') { query = `INSERT INTO avatar_studio.wardrobe_packs
      (workspace_id,character_id,name,clothing_description,footwear,accessories,allowed_brand_ids,allowed_verticals,prohibited_combinations,reference_artifacts,approval_status,provenance,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`; params = [...common,value.name,value.clothingDescription,value.footwear || null,json(value.accessories || []),json(value.allowedBrandIds || []),json(value.allowedVerticals || []),json(value.prohibitedCombinations || []),json(value.referenceArtifacts || []),value.approvalStatus,value.provenance || {},actor]; }
    else if (type === 'VOICE') { query = `INSERT INTO avatar_studio.voice_profiles
      (workspace_id,character_id,name,source_type,language,source_artifact_id,source_artifact_version,consent_record_id,consent_event_id,delivery_presets,approval_status,provenance,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`; params = [...common,value.name,value.sourceType,value.language,value.sourceArtifactId || null,value.sourceArtifactVersion || null,value.consentRecordId || null,value.consentEventId || null,json(value.deliveryPresets || []),value.approvalStatus,value.provenance || {},actor]; }
    else if (type === 'LOCATION') { query = `INSERT INTO avatar_studio.location_packs
      (workspace_id,character_id,name,environment_artifact_id,environment_artifact_version,perspective,camera_height,lens_character,lighting_direction,lighting_temperature,time_of_day,reference_geometry,key_geometry_objects,rights_provenance,allowed_verticals,approval_status,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`; params = [...common,value.name,value.environmentArtifactId,value.environmentArtifactVersion,value.perspective,value.cameraHeight,value.lensCharacter,value.lightingDirection,value.lightingTemperature,value.timeOfDay || null,value.referenceGeometry,json(value.keyGeometryObjects || []),value.rightsProvenance,json(value.allowedVerticals || []),value.approvalStatus,actor]; }
    else if (type === 'PERFORMANCE') { query = `INSERT INTO avatar_studio.performance_packs
      (workspace_id,character_id,preset,motion_spec,failure_notes,approval_status,provenance,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`; params = [...common,value.preset,value.motionSpec || {},json(value.failureNotes || []),value.approvalStatus,value.provenance || {},actor]; }
    else if (type === 'CONTINUITY') { query = `INSERT INTO avatar_studio.continuity_readiness
      (workspace_id,character_id,continuity_snapshot_id,identity_status,wardrobe_status,prop_status,location_status,geometry_status,voice_status,lip_sync_status,evidence,approval_status,approved_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`; params = [...common,value.continuitySnapshotId,value.identity.status,value.wardrobe.status,value.props.status,value.location.status,value.geometry.status,value.voice.status,value.lipSync.status,value.evidence || {},value.approvalStatus,actor]; }
    else throw new AvatarStudioError(400, 'LEVEL_ASSET_TYPE_INVALID', 'Unknown Avatar Level asset type');
    return camel((await this.db.query(query, params)).rows[0]);
  }

  async source({ id, avatarId }) {
    const row = (await this.db.query('SELECT * FROM avatar_studio.source_assets WHERE id=$1 AND character_id=$2', [id, avatarId])).rows[0];
    if (!row) return null; const result = camel(row);
    result.roles = (await this.db.query('SELECT role FROM avatar_studio.source_asset_roles WHERE source_asset_id=$1 ORDER BY role', [id])).rows.map((item) => item.role);
    return result;
  }

  async storePlan({ avatar, plan, actor }) {
    const result = await this.db.query(`INSERT INTO avatar_studio.test_content_plans
      (workspace_id,brand_id,character_id,vertical_code,format,reference_source_id,script,shot_plan,compiled_provider_plan,plan_fingerprint,external_call_count,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11) ON CONFLICT(workspace_id,plan_fingerprint) DO NOTHING RETURNING *`,
    [avatar.workspaceId, plan.brandId, avatar.id, plan.vertical, plan.format, plan.referenceSourceId,
      plan.script, json(plan.shotPlan), plan.compiledProviderPlan, plan.planFingerprint, actor]);
    if (result.rows[0]) return camel(result.rows[0]);
    return camel((await this.db.query('SELECT * FROM avatar_studio.test_content_plans WHERE workspace_id=$1 AND plan_fingerprint=$2',
      [avatar.workspaceId, plan.planFingerprint])).rows[0]);
  }
}

module.exports = { AvatarStudioPostgresRepository, camel, json };
