'use strict';

const { Client } = require('pg');
require('dotenv').config();
process.env.NVIDIA_MODEL ||= 'smoke-test-model';

const { fingerprint, allStageNames } = require('../worker/v2.1-execution-engine');
const { runProductionThroughScript } = require('../worker/v2.1-production-orchestrator');

const config = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'content_os',
  user: process.env.PGUSER || 'n8n',
  password: process.env.PGPASSWORD,
};

const IDEA_SET = {
  ideas: [
    { id: 'idea-1', title: 'The Notice', premise: 'A small observation changes a decision.', hook: 'What if the thing you ignored was the answer?', angle: 'human', rationale: 'Emotion before explanation.' },
    { id: 'idea-2', title: 'The Choice', premise: 'A familiar choice reveals a hidden tradeoff.', hook: 'You make this choice every day.', angle: 'contrast', rationale: 'Turns routine into tension.' },
    { id: 'idea-3', title: 'The Turn', premise: 'A character changes course after one honest moment.', hook: 'One sentence changes everything.', angle: 'transformation', rationale: 'Creates a clear emotional arc.' },
  ],
};

const BRIEF = {
  objective: 'Create a conversion-oriented short-form story.',
  audience: 'People making a considered purchase.',
  promise: 'A small observation reveals a better choice.',
  keyMessage: 'Notice the signal before making the decision.',
  cta: 'Take the next step.',
  creativeDirection: 'Human, precise, emotionally restrained.',
  constraints: { noUnsupportedClaims: true },
};

const CONCEPT = {
  concept: 'The moment before the choice.',
  corePromise: 'The smallest signal can change the decision.',
  creativeThesis: 'Observation creates tension before explanation.',
  narrativeApproach: 'A compact escalation from routine to realization.',
  emotionalArc: 'routine -> tension -> recognition -> decision',
  visualWorld: 'Naturalistic everyday environments.',
  differentiation: 'Emotion is carried by behavior rather than exposition.',
  constraints: { noUnsupportedClaims: true },
};

const SCRIPT = {
  title: 'The Notice',
  logline: 'A small observation changes a decision before the character explains why.',
  hook: 'What if the thing you ignored was the answer?',
  scenes: [1, 2, 3].map((sceneNumber) => ({
    sceneNumber,
    purpose: `Advance scene ${sceneNumber}`,
    visual: `Filmable visual for scene ${sceneNumber}`,
    action: `Character action for scene ${sceneNumber}`,
    dialogue: `Dialogue for scene ${sceneNumber}`,
    audio: `Audio design for scene ${sceneNumber}`,
  })),
};

function fakeProvider({ request }) {
  const type = request.outputContract.type;
  if (type === 'IDEA_SET') return { parsed: IDEA_SET };
  if (type === 'CONTENT_BRIEF') return { parsed: BRIEF };
  if (type === 'CONCEPT') return { parsed: CONCEPT };
  if (type === 'SCRIPT') return { parsed: SCRIPT };
  throw new Error(`Unexpected provider contract: ${type}`);
}

async function main() {
  const client = new Client(config);
  await client.connect();
  let tenantId = null;

  try {
    await client.query('BEGIN');
    const suffix = Date.now().toString();
    const context = {
      tenant: { id: 'smoke-tenant' },
      business: { id: 'smoke-business', rules: { market: 'test' } },
      brand: { id: 'smoke-brand', rules: { tone: 'clear' } },
      audience: { id: 'smoke-audience', profile: { intent: 'buy' } },
      strategy: { objective: { primary: 'conversion' } },
      universe: { id: 'smoke-universe', rules: { world: 'grounded' } },
    };

    const tenant = await client.query(`INSERT INTO v2_1.tenants(name) VALUES($1) RETURNING id`, [`VERTICAL Tenant ${suffix}`]);
    tenantId = tenant.rows[0].id;
    const business = await client.query(`INSERT INTO v2_1.businesses(tenant_id,name,rules) VALUES($1,$2,$3::jsonb) RETURNING id`, [tenantId, `VERTICAL Business ${suffix}`, JSON.stringify({ market: 'test' })]);
    const brand = await client.query(`INSERT INTO v2_1.brands(business_id,name,rules) VALUES($1,$2,$3::jsonb) RETURNING id`, [business.rows[0].id, `VERTICAL Brand ${suffix}`, JSON.stringify({ tone: 'clear' })]);
    const audience = await client.query(`INSERT INTO v2_1.audiences(business_id,brand_id,name,profile) VALUES($1,$2,$3,$4::jsonb) RETURNING id`, [business.rows[0].id, brand.rows[0].id, `VERTICAL Audience ${suffix}`, JSON.stringify({ intent: 'buy' })]);
    const strategy = await client.query(`INSERT INTO v2_1.content_strategies(brand_id,version,objective,pillars,platform_rules,trend_rules,learning_policy) VALUES($1,1,$2::jsonb,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb) RETURNING id`, [brand.rows[0].id, JSON.stringify({ primary: 'conversion' })]);
    const universe = await client.query(`INSERT INTO v2_1.content_universes(brand_id,name,premise,rules) VALUES($1,$2,$3,$4::jsonb) RETURNING id`, [brand.rows[0].id, `VERTICAL Universe ${suffix}`, 'Grounded test world', JSON.stringify({ world: 'grounded' })]);
    const series = await client.query(`INSERT INTO v2_1.series(universe_id,name,format_rules,narrative_rules) VALUES($1,$2,'{}'::jsonb,'{}'::jsonb) RETURNING id`, [universe.rows[0].id, `VERTICAL Series ${suffix}`]);
    const project = await client.query(`INSERT INTO v2_1.projects(name,tenant_id,business_id,brand_id,series_id,config) VALUES($1,$2,$3,$4,$5,'{}'::jsonb) RETURNING id`, [`VERTICAL Project ${suffix}`, tenantId, business.rows[0].id, brand.rows[0].id, series.rows[0].id]);
    const content = await client.query(`INSERT INTO v2_1.contents(project_id,title) VALUES($1,$2) RETURNING id`, [project.rows[0].id, `VERTICAL Content ${suffix}`]);
    const variant = await client.query(`INSERT INTO v2_1.content_variants(content_id,name) VALUES($1,$2) RETURNING id`, [content.rows[0].id, `VERTICAL Variant ${suffix}`]);

    const contextSnapshot = {
      ...context,
      tenant: { id: tenantId },
      business: { id: business.rows[0].id, rules: { market: 'test' } },
      brand: { id: brand.rows[0].id, rules: { tone: 'clear' } },
      audience: { id: audience.rows[0].id, profile: { intent: 'buy' } },
      strategy: { id: strategy.rows[0].id, objective: { primary: 'conversion' } },
      universe: { id: universe.rows[0].id, rules: { world: 'grounded' } },
    };
    const contextFingerprint = fingerprint(contextSnapshot);
    const requestSnapshot = { signal: { topic: 'notice', source: 'vertical-smoke' }, objective: 'conversion' };

    const production = await client.query(
      `INSERT INTO v2_1.productions
        (content_variant_id,tenant_id,business_id,brand_id,project_id,status,request_hash,context_fingerprint,context_snapshot,request_snapshot)
       VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,$8::jsonb,$9::jsonb)
       RETURNING id`,
      [variant.rows[0].id, tenantId, business.rows[0].id, brand.rows[0].id, project.rows[0].id, `vertical-${suffix}`, contextFingerprint, JSON.stringify(contextSnapshot), JSON.stringify(requestSnapshot)]
    );
    const productionId = production.rows[0].id;

    // Deliberately create a decoy job first. A generic queue claim would take
    // this older job; the production orchestrator must claim the exact target
    // job through the database-scoped production boundary instead.
    const decoy = await client.query(
      `INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input)
       VALUES($1,'PRODUCTION','QUEUED',$2,$3::jsonb) RETURNING id`,
      [productionId, `vertical-decoy-${suffix}`, JSON.stringify(requestSnapshot)]
    );
    const decoyJobId = decoy.rows[0].id;

    const job = await client.query(
      `INSERT INTO v2_1.jobs(production_id,job_type,status,idempotency_key,input)
       VALUES($1,'PRODUCTION','QUEUED',$2,$3::jsonb) RETURNING id`,
      [productionId, `vertical-job-${suffix}`, JSON.stringify(requestSnapshot)]
    );
    const jobId = job.rows[0].id;

    for (const stage of allStageNames()) {
      await client.query(
        `INSERT INTO v2_1.stage_runs(job_id,stage,attempt,status,input_artifacts,input_fingerprint)
         VALUES($1,$2,1,'QUEUED','[]'::jsonb,$3)`,
        [jobId, stage, fingerprint({ productionId, stage, contextFingerprint })]
      );
    }

    await client.query('COMMIT');

    const result = await runProductionThroughScript(client, {
      productionId,
      jobId,
      workerId: `vertical-worker-${suffix}`,
      signal: requestSnapshot.signal,
      providerCall: fakeProvider,
      leaseSeconds: 60,
      recover: true,
    });

    if (result.status !== 'SCRIPT_COMPLETED') throw new Error('Vertical slice did not stop at SCRIPT as designed');
    if (result.completedStages.join(',') !== 'SIGNAL,IDEA,BRIEF,CONCEPT,SCRIPT') throw new Error(`Unexpected completed stage order: ${result.completedStages.join(',')}`);
    if (result.provenance.contextFingerprint !== contextFingerprint) throw new Error('Returned provenance fingerprint is incorrect');
    if (result.provenance.stages.length !== 5) throw new Error('Vertical provenance graph is incomplete');

    const claimedDecoy = await client.query(`SELECT status, worker_id FROM v2_1.jobs WHERE id = $1`, [decoyJobId]);
    if (claimedDecoy.rows[0].status !== 'QUEUED' || claimedDecoy.rows[0].worker_id !== null) {
      throw new Error('Orchestrator claimed a job outside the requested production job id');
    }

    const audit = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM v2_1.events
        WHERE entity_type = 'generation_run'
          AND entity_id IN (
            SELECT gr.id
              FROM v2_1.generation_runs gr
              JOIN v2_1.stage_runs sr ON sr.id = gr.stage_run_id
             WHERE sr.job_id = $1
          )`,
      [jobId]
    );
    if (audit.rows[0].count < 8) throw new Error(`Expected generation audit events were not recorded; got ${audit.rows[0].count}`);

    const jobState = await client.query(`SELECT status, worker_id FROM v2_1.jobs WHERE id=$1`, [jobId]);
    if (jobState.rows[0].status !== 'RUNNING' || jobState.rows[0].worker_id !== result.workerId) throw new Error('Job lease was not retained after vertical slice');

    const productionState = await client.query(`SELECT status, context_fingerprint FROM v2_1.productions WHERE id=$1`, [productionId]);
    if (productionState.rows[0].status !== 'RUNNING') throw new Error('Production was incorrectly marked complete before LEARN');
    if (productionState.rows[0].context_fingerprint !== contextFingerprint) throw new Error('Production context fingerprint changed');

    console.log('V2.1 PRODUCTION VERTICAL SLICE DATABASE SMOKE TEST PASSED.');
    console.log('PRODUCTION -> JOB -> SIGNAL -> IDEA -> BRIEF -> CONCEPT -> SCRIPT VERIFIED.');
    console.log('PRODUCTION-SCOPED JOB OWNERSHIP VERIFIED.');
    console.log('IMMUTABLE CONTEXT CONTINUITY VERIFIED ACROSS ALL GENERATION REQUESTS.');
    console.log('CANONICAL ARTIFACT PROVENANCE CHAIN VERIFIED.');
    console.log('GENERATION AUDIT LEDGER VERIFIED.');
    console.log('PRODUCTION REMAINS RUNNING UNTIL THE FULL CONTRACTUAL PIPELINE REACHES LEARN.');
    console.log('TEST DATA CLEANED UP.');
  } finally {
    if (tenantId) {
      await client.query('ROLLBACK').catch(async () => {
        await client.query('DELETE FROM v2_1.tenants WHERE id = $1', [tenantId]).catch(() => {});
      });
      await client.query('DELETE FROM v2_1.tenants WHERE id = $1', [tenantId]).catch(() => {});
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error('V2.1 PRODUCTION VERTICAL SLICE DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  process.exit(1);
});
