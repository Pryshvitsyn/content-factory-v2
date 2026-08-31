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
      coalesce(bool_or(cr.status='APPROVED'),false) AS consent_approved
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
    avatar.consent = avatar.consentRecords.find((item) => item.status === 'APPROVED') || null;
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
      (workspace_id,character_id,name,source_type,language,source_artifact_id,source_artifact_version,consent_record_id,delivery_presets,approval_status,provenance,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`; params = [...common,value.name,value.sourceType,value.language,value.sourceArtifactId || null,value.sourceArtifactVersion || null,value.consentRecordId || null,json(value.deliveryPresets || []),value.approvalStatus,value.provenance || {},actor]; }
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

  async source({ id, avatarId }) { const row = (await this.db.query('SELECT * FROM avatar_studio.source_assets WHERE id=$1 AND character_id=$2', [id, avatarId])).rows[0]; return row ? camel(row) : null; }

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
