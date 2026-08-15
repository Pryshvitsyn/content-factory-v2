'use strict';

const { Client } = require('pg');
require('dotenv').config();

const config = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'content_os',
  user: process.env.PGUSER || 'n8n',
  password: process.env.PGPASSWORD,
};

async function main() {
  const client = new Client(config);
  await client.connect();
  try {
    await client.query('BEGIN');
    const suffix = Date.now().toString();

    const stageDefinition = await client.query(`SELECT requires, outputs FROM v2_1.stage_definitions WHERE stage='SCRIPT'`);
    if (stageDefinition.rowCount !== 1) throw new Error('SCRIPT stage definition is missing');
    if (!stageDefinition.rows[0].requires.includes('CONCEPT') || !stageDefinition.rows[0].requires.includes('IDEA_SET')) {
      throw new Error('Database SCRIPT dependency contract is incomplete');
    }

    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`Hardening Tenant ${suffix}`]);
    const tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name) VALUES($1,$2) RETURNING id`, [tenantId, `Hardening Business ${suffix}`]);
    const businessId = business.rows[0].id;
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name) VALUES($1,$2) RETURNING id`, [businessId, `Hardening Brand ${suffix}`]);
    const brandId = brand.rows[0].id;
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id) VALUES($1,$2,$3,$4) RETURNING id`, [`Hardening Project ${suffix}`, tenantId, businessId, brandId]);
    const projectId = project.rows[0].id;
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [projectId, `Hardening Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `Hardening Variant ${suffix}`]);
    const production = await client.query(`INSERT INTO v2_1.productions(content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot) VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,'{}'::jsonb,'{}'::jsonb) RETURNING id`, [variant.rows[0].id, tenantId, businessId, brandId, projectId, `hardening-${suffix}`, `context-${suffix}`]);
    const productionId = production.rows[0].id;
    const job = await client.query(`INSERT INTO v2_1.jobs(production_id,job_type,idempotency_key) VALUES($1,'PRODUCTION',$2) RETURNING id`, [productionId, `hardening-job-${suffix}`]);
    const jobId = job.rows[0].id;
    const stage = await client.query(`INSERT INTO v2_1.stage_runs(job_id,stage,attempt) VALUES($1,'SCRIPT',1) RETURNING id`, [jobId]);
    const stageId = stage.rows[0].id;

    await client.query('SAVEPOINT invalid_output');
    let rejected = false;
    try {
      await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED', output_artifacts='["CONCEPT"]'::jsonb WHERE id=$1`, [stageId]);
    } catch (error) {
      rejected = /output contract violation/i.test(error.message);
    }
    await client.query('ROLLBACK TO SAVEPOINT invalid_output');
    await client.query('RELEASE SAVEPOINT invalid_output');
    if (!rejected) throw new Error('Database accepted an undeclared SCRIPT output');

    await client.query(`UPDATE v2_1.stage_runs SET status='COMPLETED', output_artifacts='["SCRIPT"]'::jsonb, output_fingerprint=$1, completed_at=now() WHERE id=$2`, [`output-${suffix}`, stageId]);

    const provider = await client.query(`INSERT INTO v2_1.providers(name,capabilities) VALUES($1,'["TEXT_GENERATION"]'::jsonb) RETURNING id`, [`hardening-provider-${suffix}`]);
    const model = await client.query(`INSERT INTO v2_1.models(provider_id,name,capability) VALUES($1,$2,'TEXT_GENERATION') RETURNING id`, [provider.rows[0].id, `hardening-model-${suffix}`]);
    const generation = await client.query(`INSERT INTO v2_1.generation_runs(stage_run_id,provider_id,model_id,capability,request_hash,request,status) VALUES($1,$2,$3,'TEXT_GENERATION',$4,'{}'::jsonb,'RUNNING') RETURNING id`, [stageId, provider.rows[0].id, model.rows[0].id, `generation-${suffix}`]);
    const audit = await client.query(`SELECT event_type, entity_id, payload->>'request_hash' AS request_hash FROM v2_1.events WHERE entity_type='generation_run' AND entity_id=$1`, [generation.rows[0].id]);
    if (audit.rowCount !== 1 || audit.rows[0].event_type !== 'GENERATION_RUN_CREATED' || audit.rows[0].request_hash !== `generation-${suffix}`) {
      throw new Error('Generation audit event was not recorded correctly');
    }

    await client.query('ROLLBACK');
    console.log('V2.1 DATABASE CONTRACT HARDENING SMOKE TEST PASSED.');
    console.log('SCRIPT DEPENDENCY PARITY VERIFIED.');
    console.log('STAGE OUTPUT CONTRACT ENFORCED BY POSTGRES.');
    console.log('GENERATION RUN AUDIT EVENT VERIFIED.');
    console.log('TEST DATA ROLLED BACK.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('V2.1 DATABASE CONTRACT HARDENING SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
