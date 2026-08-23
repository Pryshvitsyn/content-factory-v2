'use strict';

const crypto = require('node:crypto');

const TABLE_CONTRACTS = Object.freeze({
  'v2_1.productions': {
    columns: { id: 'uuid', workspace_id: 'uuid', brand_id: 'uuid', name: 'text', status: 'text', objective: 'text',
      created_at: 'timestamp with time zone', started_at: 'timestamp with time zone', completed_at: 'timestamp with time zone',
      updated_at: 'timestamp with time zone', metadata: 'jsonb' },
    notNull: ['id', 'workspace_id', 'brand_id', 'name', 'status', 'created_at', 'updated_at', 'metadata'],
    defaults: ['id', 'status', 'created_at', 'updated_at', 'metadata'],
    insertColumns: ['workspace_id', 'brand_id', 'name', 'status', 'objective', 'metadata'],
    unique: [['workspace_id', 'name']],
    statuses: ['DRAFT', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  },
  'v2_1.jobs': {
    columns: { id: 'uuid', production_id: 'uuid', generation_job_id: 'uuid', stage: 'text', status: 'text', attempt: 'integer',
      max_attempts: 'integer', worker_id: 'text', lease_expires_at: 'timestamp with time zone', heartbeat_at: 'timestamp with time zone',
      next_attempt_at: 'timestamp with time zone', idempotency_key: 'text', payload: 'jsonb', result: 'jsonb', error: 'jsonb',
      created_at: 'timestamp with time zone', started_at: 'timestamp with time zone', completed_at: 'timestamp with time zone',
      updated_at: 'timestamp with time zone' },
    notNull: ['id', 'production_id', 'stage', 'status', 'attempt', 'max_attempts', 'idempotency_key', 'payload', 'result', 'error', 'created_at', 'updated_at'],
    defaults: ['id', 'status', 'attempt', 'max_attempts', 'payload', 'result', 'error', 'created_at', 'updated_at'],
    insertColumns: ['production_id', 'stage', 'status', 'idempotency_key', 'payload'],
    unique: [['production_id', 'idempotency_key']],
    statuses: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'RETRYING', 'DEAD_LETTER'],
  },
  'v2_1.stage_runs': {
    columns: { id: 'uuid', job_id: 'uuid', stage: 'text', attempt: 'integer', status: 'text', worker_id: 'text',
      lease_expires_at: 'timestamp with time zone', heartbeat_at: 'timestamp with time zone', input_artifacts: 'jsonb',
      output_artifacts: 'jsonb', input_fingerprint: 'text', output_fingerprint: 'text', max_attempts: 'integer',
      next_attempt_at: 'timestamp with time zone', error: 'jsonb', metadata: 'jsonb', created_at: 'timestamp with time zone',
      started_at: 'timestamp with time zone', completed_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
    notNull: ['id', 'job_id', 'stage', 'attempt', 'status', 'input_artifacts', 'output_artifacts', 'max_attempts', 'error', 'metadata', 'created_at', 'updated_at'],
    defaults: ['id', 'attempt', 'status', 'input_artifacts', 'output_artifacts', 'max_attempts', 'error', 'metadata', 'created_at', 'updated_at'],
    insertColumns: ['job_id', 'stage', 'attempt', 'status', 'max_attempts'],
    unique: [['job_id', 'stage', 'attempt']],
    statuses: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'DEAD_LETTER', 'SKIPPED'],
  },
  'v2_1.asset_registry': {
    columns: { id: 'uuid', production_id: 'uuid', asset_id: 'text', kind: 'text', semantic_key: 'text', artifact_storage_key: 'text',
      artifact_version: 'integer', status: 'text', metadata: 'jsonb', created_by: 'text', created_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
    notNull: ['id', 'asset_id', 'kind', 'semantic_key', 'artifact_storage_key', 'artifact_version', 'status', 'metadata', 'created_by', 'created_at', 'updated_at'],
    defaults: ['id', 'status', 'metadata', 'created_at', 'updated_at'],
    insertColumns: ['production_id', 'asset_id', 'kind', 'semantic_key', 'artifact_storage_key', 'artifact_version', 'status', 'metadata', 'created_by'],
    unique: [['production_id', 'asset_id']],
    statuses: ['READY', 'INVALID', 'ARCHIVED'],
  },
  'v2_1.publications': {
    columns: { id: 'uuid', artifact_version_id: 'uuid', destination: 'text', publication_key: 'text', status: 'text', external_id: 'text',
      result: 'jsonb', error: 'jsonb', attempt: 'integer', created_at: 'timestamp with time zone', started_at: 'timestamp with time zone',
      published_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
    notNull: ['id', 'artifact_version_id', 'destination', 'publication_key', 'status', 'result', 'error', 'attempt', 'created_at', 'updated_at'],
    defaults: ['id', 'status', 'result', 'error', 'attempt', 'created_at', 'updated_at'],
    insertColumns: ['artifact_version_id', 'destination', 'publication_key'],
    unique: [['publication_key']],
    statuses: ['PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED'],
  },
  'v2_2.brands': {
    columns: { id: 'uuid', workspace_id: 'uuid', name: 'text', slug: 'text', status: 'text', mission: 'text', positioning: 'text',
      metadata: 'jsonb', created_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
    notNull: ['id', 'workspace_id', 'name', 'slug', 'status', 'metadata', 'created_at', 'updated_at'],
    defaults: ['id', 'status', 'metadata', 'created_at', 'updated_at'],
    insertColumns: ['id', 'workspace_id', 'name', 'slug', 'status', 'metadata'],
    unique: [['workspace_id', 'slug']],
    statuses: ['ACTIVE', 'PAUSED', 'ARCHIVED'],
  },
  'v2_3.master_review_items': {
    columns: { id: 'uuid', workspace_id: 'uuid', brand_id: 'uuid', production_id: 'uuid', master_artifact_id: 'text',
      master_artifact_version: 'integer', master_storage_key: 'text', master_content_hash: 'text', content_type: 'text',
      validation_status: 'text', review_payload: 'jsonb', validation_evidence: 'jsonb', provenance: 'jsonb', generated_assets: 'jsonb',
      created_at: 'timestamp with time zone' },
    notNull: ['id', 'workspace_id', 'brand_id', 'production_id', 'master_artifact_id', 'master_artifact_version', 'master_storage_key',
      'master_content_hash', 'content_type', 'validation_status', 'review_payload', 'validation_evidence', 'provenance', 'generated_assets', 'created_at'],
    defaults: ['id', 'content_type', 'review_payload', 'validation_evidence', 'provenance', 'generated_assets', 'created_at'],
    insertColumns: ['workspace_id', 'brand_id', 'production_id', 'master_artifact_id', 'master_artifact_version', 'master_storage_key',
      'master_content_hash', 'content_type', 'validation_status', 'review_payload', 'validation_evidence', 'provenance', 'generated_assets'],
    unique: [['production_id', 'master_artifact_id', 'master_storage_key']],
    statusColumn: 'validation_status',
    statuses: ['PASS'],
  },
  'v2_3.master_review_decisions': {
    columns: { id: 'uuid', review_item_id: 'uuid', decision: 'text', actor: 'text', reason: 'text', metadata: 'jsonb', decided_at: 'timestamp with time zone' },
    notNull: ['id', 'review_item_id', 'decision', 'actor', 'metadata', 'decided_at'],
    defaults: ['id', 'metadata', 'decided_at'],
    insertColumns: ['review_item_id', 'decision', 'actor', 'reason'],
    unique: [['review_item_id']],
    statusColumn: 'decision',
    statuses: ['APPROVED', 'REJECTED'],
  },
});

const FUNCTION_CONTRACTS = Object.freeze({
  'claim_job(text,integer)': 'SETOF v2_1.jobs',
  'claim_job_for_production(uuid,uuid,text,integer)': 'SETOF v2_1.jobs',
  'heartbeat_job(uuid,text,integer)': 'boolean',
  'claim_stage(uuid,text,integer)': 'SETOF v2_1.stage_runs',
  'heartbeat_stage(uuid,text,integer)': 'boolean',
  'recover_expired_work()': 'TABLE(jobs_recovered integer, jobs_failed integer, stages_recovered integer, stages_failed integer)',
});

function compact(value) { return String(value || '').replace(/\s+/g, '').replace(/"/g, '').toLowerCase(); }
function issue(severity, code, subject, message) { return { severity, code, subject, message }; }

async function inspectSchemaCompatibility(db) {
  const tableNames = Object.keys(TABLE_CONTRACTS);
  const [columnsResult, constraintsResult, indexesResult, functionsResult] = await Promise.all([
    db.query(`/* v2.4:schema-columns */
      SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema || '.' || table_name = ANY($1::text[])
      ORDER BY table_schema, table_name, ordinal_position`, [tableNames]),
    db.query(`/* v2.4:schema-constraints */
      SELECT n.nspname AS table_schema, c.relname AS table_name, con.conname, con.contype,
             con.convalidated, pg_get_constraintdef(con.oid) AS definition,
             array_remove(array_agg(a.attname ORDER BY key_column.ordinality),NULL) AS source_columns
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key_column(attnum,ordinality) ON true
      LEFT JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=key_column.attnum
      WHERE n.nspname || '.' || c.relname = ANY($1::text[])
      GROUP BY n.nspname,c.relname,con.conname,con.contype,con.convalidated,con.oid
      ORDER BY n.nspname, c.relname, con.conname`, [tableNames]),
    db.query(`/* v2.4:schema-indexes */
      SELECT n.nspname AS table_schema,c.relname AS table_name,i.relname AS indexname,
             pg_get_indexdef(ix.indexrelid) AS indexdef,ix.indisunique,(ix.indpred IS NOT NULL) AS is_partial
      FROM pg_index ix JOIN pg_class c ON c.oid=ix.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class i ON i.oid=ix.indexrelid
      WHERE n.nspname || '.' || c.relname = ANY($1::text[])
      ORDER BY n.nspname,c.relname,i.relname`, [tableNames]),
    db.query(`/* v2.4:schema-functions */
      SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS result
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='v2_1' AND p.proname = ANY($1::text[])
      ORDER BY p.proname, arguments`, [[...new Set(Object.keys(FUNCTION_CONTRACTS).map((key) => key.split('(')[0]))]]),
  ]);

  const issues = [];
  const columnsByTable = new Map();
  for (const row of columnsResult.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    if (!columnsByTable.has(key)) columnsByTable.set(key, new Map());
    columnsByTable.get(key).set(row.column_name, row);
  }
  const constraintsByTable = new Map();
  for (const row of constraintsResult.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    if (!constraintsByTable.has(key)) constraintsByTable.set(key, []);
    constraintsByTable.get(key).push(row);
  }
  const indexesByTable = new Map();
  for (const row of indexesResult.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    if (!indexesByTable.has(key)) indexesByTable.set(key, []);
    indexesByTable.get(key).push(row);
  }

  for (const [table, contract] of Object.entries(TABLE_CONTRACTS)) {
    const columns = columnsByTable.get(table);
    if (!columns) {
      issues.push(issue('ERROR', 'TABLE_MISSING', table, 'required table is missing'));
      continue;
    }
    for (const [name, type] of Object.entries(contract.columns)) {
      const column = columns.get(name);
      if (!column) issues.push(issue('ERROR', 'COLUMN_MISSING', `${table}.${name}`, `required ${type} column is missing`));
      else if (column.data_type !== type) issues.push(issue('ERROR', 'COLUMN_TYPE_MISMATCH', `${table}.${name}`, `expected ${type}, found ${column.data_type}`));
    }
    for (const name of contract.notNull) {
      const column = columns.get(name);
      if (column && column.is_nullable !== 'NO') issues.push(issue('WARN', 'CANONICAL_NULLABILITY_RELAXED', `${table}.${name}`, 'legacy rows require nullable compatibility; V2.4 write probe supplies this field'));
    }
    for (const name of contract.defaults) {
      const column = columns.get(name);
      if (column && column.column_default == null) issues.push(issue('WARN', 'CANONICAL_DEFAULT_MISSING', `${table}.${name}`, 'canonical default is missing'));
    }
    const supplied = new Set(contract.insertColumns);
    for (const column of columns.values()) {
      if (column.is_nullable === 'NO' && column.column_default == null && !supplied.has(column.column_name)) {
        issues.push(issue('ERROR', 'UNEXPECTED_REQUIRED_COLUMN', `${table}.${column.column_name}`, 'legacy NOT NULL/no-default column blocks canonical inserts'));
      }
    }
    const indexes = indexesByTable.get(table) || [];
    for (const fields of contract.unique) {
      const signature = `(${fields.join(',')})`;
      if (!indexes.some((row) => compact(row.indexdef).includes(signature))) {
        issues.push(issue('ERROR', 'UNIQUE_INDEX_MISSING', table, `missing unique index on (${fields.join(', ')})`));
      }
    }
    const statusColumn = contract.statusColumn || 'status';
    const checks = (constraintsByTable.get(table) || []).filter((row) => row.contype === 'c' && compact(row.definition).includes(statusColumn));
    if (contract.statuses && !checks.some((row) => contract.statuses.every((status) => row.definition.includes(`'${status}'`)))) {
      issues.push(issue('ERROR', 'STATUS_CONTRACT_MISMATCH', table, `status constraint must accept ${contract.statuses.join(', ')}`));
    }
  }

  const productionConstraints = constraintsByTable.get('v2_1.productions') || [];
  const brandFks = productionConstraints.filter((row) => row.contype === 'f' && compact(row.definition).startsWith('foreignkey(brand_id)'));
  const canonicalBrandFk = brandFks.find((row) => compact(row.definition).includes('referencesv2_2.brands(id)'));
  if (!canonicalBrandFk) issues.push(issue('ERROR', 'CANONICAL_BRAND_FK_MISSING', 'v2_1.productions.brand_id', 'must reference v2_2.brands(id)'));
  else if (!canonicalBrandFk.convalidated) issues.push(issue('WARN', 'CANONICAL_BRAND_FK_NOT_VALIDATED', canonicalBrandFk.conname, 'new writes are enforced; historical legacy brand rows remain unvalidated'));
  for (const fk of brandFks.filter((row) => !compact(row.definition).includes('referencesv2_2.brands(id)'))) {
    issues.push(issue('ERROR', 'LEGACY_BRAND_FK_ACTIVE', fk.conname, fk.definition));
  }

  const requiredFks = [
    ['v2_1.jobs', 'production_id', 'v2_1.productions'], ['v2_1.stage_runs', 'job_id', 'v2_1.jobs'],
    ['v2_1.asset_registry', 'production_id', 'v2_1.productions'], ['v2_3.master_review_items', 'workspace_id', 'workspaces'],
    ['v2_3.master_review_items', 'brand_id', 'v2_2.brands'], ['v2_3.master_review_items', 'production_id', 'v2_1.productions'],
  ];
  for (const [table, column, target] of requiredFks) {
    const found = (constraintsByTable.get(table) || []).some((row) => row.contype === 'f'
      && compact(row.definition).startsWith(`foreignkey(${column})`) && compact(row.definition).includes(`references${target}(id)`));
    if (!found) issues.push(issue('ERROR', 'FOREIGN_KEY_MISSING', `${table}.${column}`, `must reference ${target}(id)`));
  }

  const functions = new Map(functionsResult.rows.map((row) => {
    const args = row.arguments.split(',').map((part) => part.trim().split(/\s+/).at(-1)).join(',');
    return [`${row.proname}(${args})`, row.result];
  }));
  for (const [signature, expected] of Object.entries(FUNCTION_CONTRACTS)) {
    const actual = functions.get(signature);
    if (!actual) issues.push(issue('ERROR', 'FUNCTION_MISSING', `v2_1.${signature}`, `expected ${expected}`));
    else if (compact(actual) !== compact(expected)) issues.push(issue('ERROR', 'FUNCTION_RETURN_MISMATCH', `v2_1.${signature}`, `expected ${expected}, found ${actual}`));
  }

  const counts = issues.reduce((value, item) => ({ ...value, [item.severity.toLowerCase()]: (value[item.severity.toLowerCase()] || 0) + 1 }), { error: 0, warn: 0 });
  return Object.freeze({ compatible: counts.error === 0, checkedTables: tableNames.length, issues: Object.freeze(issues), counts: Object.freeze(counts) });
}

function assertSchemaCompatible(report) {
  if (report?.compatible) return report;
  const error = new Error(`Database schema is not V2.4-compatible (${report?.counts?.error || 0} errors)`);
  error.code = 'LIVE_SCHEMA_INCOMPATIBLE';
  error.details = report;
  throw error;
}

function formatCompatibilityReport(report) {
  const lines = [`Schema compatibility: ${report.compatible ? 'READY' : 'BLOCKED'} (${report.counts.error} errors, ${report.counts.warn} warnings)`];
  const errors = report.issues.filter((item) => item.severity === 'ERROR');
  const warnings = report.issues.filter((item) => item.severity === 'WARN');
  for (const item of errors) lines.push(`- ERROR ${item.code} ${item.subject}: ${item.message}`);
  for (const item of warnings.slice(0, 6)) lines.push(`- WARN ${item.code} ${item.subject}: ${item.message}`);
  if (warnings.length > 6) lines.push(`- WARN +${warnings.length - 6} additional legacy compatibility warnings`);
  return lines.join('\n');
}

async function verifyTransactionalLiveWrites(db, { workspaceId, brandId, objective }) {
  if (!db || typeof db.connect !== 'function') throw Object.assign(new Error('transaction-capable database pool is required'), { code: 'LIVE_TRANSACTION_PROBE_UNAVAILABLE' });
  const client = await db.connect();
  const nonce = crypto.randomUUID();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    const production = await client.query(`/* v2.4:probe-production */
      INSERT INTO v2_1.productions(workspace_id,brand_id,name,status,objective,metadata)
      VALUES($1,$2,$3,'DRAFT',$4,$5::jsonb) RETURNING id`,
    [workspaceId, brandId, `v2.4-preflight:${nonce}`, objective, JSON.stringify({ source: 'v2.4-prepaid-rollback-probe' })]);
    const productionId = production.rows[0].id;
    const job = await client.query(`/* v2.4:probe-job */
      INSERT INTO v2_1.jobs(production_id,stage,status,idempotency_key,payload)
      VALUES($1,'EDIT','QUEUED',$2,$3::jsonb) RETURNING id`,
    [productionId, `v2.4-preflight:${nonce}`, JSON.stringify({ source: 'v2.4-prepaid-rollback-probe' })]);
    await client.query(`/* v2.4:probe-stage */
      INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,max_attempts)
      VALUES($1,'EDIT',1,'PENDING',3)`, [job.rows[0].id]);
    await client.query(`/* v2.4:probe-asset-registry */
      INSERT INTO v2_1.asset_registry(production_id,asset_id,kind,semantic_key,artifact_storage_key,artifact_version,status,metadata,created_by)
      VALUES($1,$2,'video',$2,$3,1,'READY',$4::jsonb,'v2.4-preflight')`,
    [productionId, `preflight-${nonce}`, `preflight/${nonce}.mp4`, JSON.stringify({ temporary: true })]);
    await client.query(`/* v2.4:probe-review */
      INSERT INTO v2_3.master_review_items(workspace_id,brand_id,production_id,master_artifact_id,master_artifact_version,
        master_storage_key,master_content_hash,content_type,validation_status,review_payload,validation_evidence,provenance,generated_assets)
      VALUES($1,$2,$3,$4,1,$5,$6,'video/mp4','PASS','{}','{}','{}','[]')`,
    [workspaceId, brandId, productionId, `preflight-master-${nonce}`, `preflight/${nonce}-master.mp4`, nonce]);
    await client.query('ROLLBACK');
    return Object.freeze({ passed: true, persisted: false });
  } catch (cause) {
    await client.query('ROLLBACK').catch(() => {});
    const error = new Error(`Pre-paid database write probe failed: ${cause.message}`);
    error.code = 'LIVE_TRANSACTION_PROBE_FAILED';
    error.cause = cause;
    throw error;
  } finally {
    client.release();
  }
}

async function verifyArtifactStorage(storage) {
  if (!storage || typeof storage.put !== 'function' || typeof storage.get !== 'function' || typeof storage.delete !== 'function') {
    throw Object.assign(new Error('reversible artifact storage adapter is required'), { code: 'LIVE_STORAGE_PROBE_UNAVAILABLE' });
  }
  const key = `.preflight/v2.4/${crypto.randomUUID()}.bin`;
  const expected = Buffer.from('v2.4-storage-preflight', 'utf8');
  let created = false;
  try {
    await storage.put({ key, bytes: expected, metadata: { temporary: true } });
    created = true;
    const actual = await storage.get({ key });
    if (!Buffer.isBuffer(actual) || !actual.equals(expected)) throw new Error('artifact storage round-trip mismatch');
  } finally {
    if (created) await storage.delete({ key });
  }
  return Object.freeze({ passed: true, persisted: false });
}

module.exports = {
  FUNCTION_CONTRACTS,
  TABLE_CONTRACTS,
  assertSchemaCompatible,
  formatCompatibilityReport,
  inspectSchemaCompatibility,
  verifyArtifactStorage,
  verifyTransactionalLiveWrites,
};
