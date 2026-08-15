
require("dotenv").config();
const { Client } = require("pg");
const { spawnSync } = require("child_process");

const db = new Client({ connectionString: process.env.DATABASE_URL });
const worker = process.env.SMOKE_WORKER || "./worker/factory-worker-v2.js";

async function q(sql, params=[]) {
  const r = await db.query(sql, params);
  return r.rows;
}

function runWorker(jobId) {
  console.log(`SMOKE: running worker for ${jobId}`);
  const result = spawnSync(process.execPath, [worker], {
    stdio: "inherit",
    env: { ...process.env, FACTORY_JOB_ID: jobId }
  });
  if (result.status !== 0) {
    throw new Error(`Worker exited with status ${result.status}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  if (!process.env.NVIDIA_API_KEY) throw new Error("NVIDIA_API_KEY is not set.");

  await db.connect();

  const base = await q(`
    SELECT
      w.id AS workspace_id,
      c.id AS concept_id,
      m.id AS model_id,
      m.provider_id
    FROM workspaces w
    CROSS JOIN LATERAL (
      SELECT id FROM creative_concepts
      WHERE campaign_id IN (SELECT id FROM campaigns LIMIT 1)
      ORDER BY created_at DESC LIMIT 1
    ) c
    JOIN ai_models m ON m.enabled=true
    JOIN ai_providers p ON p.id=m.provider_id
    WHERE p.slug='nvidia'
    ORDER BY w.created_at NULLS LAST
    LIMIT 1
  `);

  if (!base.length) {
    throw new Error("Smoke test needs at least one workspace, creative concept and enabled NVIDIA model.");
  }

  const key = `smoke-v2:${Date.now()}`;
  const job = await q(`
    INSERT INTO generation_jobs(
      workspace_id,provider_id,model_id,job_type,status,
      input_data,max_attempts,idempotency_key
    )
    VALUES($1,$2,$3,'script_generation','queued',$4::jsonb,3,$5)
    RETURNING id
  `, [
    base[0].workspace_id,
    base[0].provider_id,
    base[0].model_id,
    JSON.stringify({concept_id:base[0].concept_id, smoke_test:true, build:"2.0.0"}),
    key
  ]);

  const jobId = job[0].id;
  console.log(`SMOKE: source job ${jobId}`);

  runWorker(jobId);

  const source = await q(`
    SELECT status, output_data, error_data
    FROM generation_jobs WHERE id=$1
  `, [jobId]);

  if (source[0].status !== "completed") {
    throw new Error(`Script smoke stage failed: ${JSON.stringify(source[0])}`);
  }

  const scriptId = source[0].output_data.script_id;
  if (!scriptId) throw new Error("Smoke script_id missing.");

  const child = await q(`
    SELECT id,status,input_data
    FROM generation_jobs
    WHERE job_type='production_planning'
      AND input_data->>'source_job_id'=$1
    ORDER BY created_at DESC LIMIT 1
  `, [jobId]);

  if (!child.length) throw new Error("Production planning child job was not created.");

  runWorker(child[0].id);

  const result = await q(`
    SELECT
      (SELECT count(*) FROM pipeline_runs WHERE source_job_id IN ($1,$2)) AS pipelines,
      (SELECT count(*) FROM job_stages s
        JOIN pipeline_runs p ON p.id=s.pipeline_run_id
        WHERE p.source_job_id IN ($1,$2) AND s.status='completed') AS completed_stages,
      (SELECT count(*) FROM artifacts a
        JOIN pipeline_runs p ON p.id=a.pipeline_run_id
        WHERE p.source_job_id IN ($1,$2)) AS artifacts,
      (SELECT count(*) FROM shots WHERE script_id=$3) AS shots,
      (SELECT count(*) FROM continuity_snapshots WHERE script_id=$3) AS continuity,
      (SELECT count(*) FROM validation_results vr
        JOIN job_stages s ON s.id=vr.stage_id
        JOIN pipeline_runs p ON p.id=s.pipeline_run_id
        WHERE p.source_job_id IN ($1,$2) AND vr.status='passed') AS validations
  `, [jobId, child[0].id, scriptId]);

  const r = result[0];
  console.log("SMOKE RESULT:", r);

  for (const k of ["pipelines","completed_stages","artifacts","shots","continuity","validations"]) {
    if (Number(r[k]) < 1) throw new Error(`Smoke assertion failed: ${k}=${r[k]}`);
  }

  // Idempotency assertion: running the same completed source job must not
  // create another script version.
  const before = await q(`SELECT count(*)::int AS n FROM scripts WHERE id=$1`, [scriptId]);
  runWorker(jobId); // worker should find no claim because it is completed
  const after = await q(`SELECT count(*)::int AS n FROM scripts WHERE id=$1`, [scriptId]);
  if (before[0].n !== after[0].n) throw new Error("Idempotency assertion failed.");

  console.log("SMOKE TEST PASSED.");
  console.log("NVIDIA -> SCRIPT -> PRODUCTION_BIBLE -> SHOTS -> CONTINUITY -> ARTIFACTS -> VALIDATION");

  if (process.env.SMOKE_KEEP !== "1") {
    // Remove only this smoke run. Preserve unrelated factory data.
    const childId = child[0].id;
    await q(`
      DELETE FROM pipeline_runs
      WHERE source_job_id=$1 OR source_job_id=$2
    `, [jobId, childId]);
    await q(`DELETE FROM scripts WHERE metadata->>'source_generation_job_id'=$1`, [jobId]);
    await q(`
      DELETE FROM generation_jobs
      WHERE id=$1 OR id=$2
    `, [jobId, childId]);
    console.log("SMOKE: test data cleaned.");
  } else {
    console.log("SMOKE_KEEP=1: test data retained.");
  }

  await db.end();
}

main().catch(async (err) => {
  console.error("SMOKE TEST FAILED:", err.message);
  try { await db.end(); } catch {}
  process.exit(1);
});
