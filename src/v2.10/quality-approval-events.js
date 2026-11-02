'use strict';

// All writers lock the canonical draft, matching the database event trigger.
// Reuse only an approval that is STILL the latest event for this stage.
async function recordQualityApproval(db, args) {
  for (const key of ['draftId', 'workspaceId', 'brandId', 'stage', 'subjectType',
    'subjectId', 'subjectFingerprint', 'decision', 'actor']) {
    if (!args[key]) throw Object.assign(new Error(`Missing approval field: ${key}`),
      { code: 'QUALITY_APPROVAL_INPUT_REQUIRED', status: 400 });
  }
  if (typeof db.connect !== 'function') throw new Error('Quality approvals require a transaction-capable pool');
  const client = await db.connect();
  if (!client?.query || !client?.release) throw new Error('Quality approvals require a dedicated pool client');
  try {
    await client.query('BEGIN');
    const scope = [args.draftId, args.workspaceId, args.brandId];
    const draft = await client.query(`SELECT id FROM v2_10.creative_drafts
      WHERE id=$1 AND workspace_id=$2 AND brand_id=$3 FOR UPDATE`, scope);
    if (!draft.rows[0]) throw Object.assign(new Error('Draft not found in approval scope'),
      { code: 'DRAFT_NOT_FOUND', status: 404 });
    if (args.verifyCurrent) await args.verifyCurrent(client);
    const latest = (await client.query(`SELECT * FROM v2_10.quality_stage_approval_events
      WHERE draft_id=$1 AND workspace_id=$2 AND brand_id=$3 AND stage=$4
      ORDER BY decided_at DESC,id DESC LIMIT 1`, [...scope, args.stage])).rows[0];
    if (args.decision === 'APPROVED' && latest?.decision === 'APPROVED'
      && latest.subject_fingerprint === args.subjectFingerprint
      && latest.subject_type === args.subjectType && latest.subject_id === args.subjectId) {
      await client.query('COMMIT');
      return latest;
    }
    const result = await client.query(`INSERT INTO v2_10.quality_stage_approval_events
      (draft_id,workspace_id,brand_id,stage,subject_type,subject_id,subject_fingerprint,decision,reason,actor)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [...scope, args.stage, args.subjectType, args.subjectId, args.subjectFingerprint,
      args.decision, args.reason ?? null, args.actor]);
    if (args.afterApprovalChanged) await args.afterApprovalChanged(client);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
module.exports = { recordQualityApproval };
