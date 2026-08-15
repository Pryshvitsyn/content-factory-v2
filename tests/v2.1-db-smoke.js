const { Client } = require('pg');

const client = new Client({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'n8n',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'content_os',
});

async function main() {
  await client.connect();

  const project = await client.query(`
    INSERT INTO v2_1.projects (name)
    VALUES ('V2.1 DB Smoke Test')
    RETURNING id
  `);

  const projectId = project.rows[0].id;

  try {
    const content = await client.query(`
      INSERT INTO v2_1.contents (project_id, title)
      VALUES ($1, 'Smoke Test Content')
      RETURNING id
    `, [projectId]);

    const contentId = content.rows[0].id;

    const variant = await client.query(`
      INSERT INTO v2_1.content_variants (content_id, name, hook)
      VALUES ($1, 'Smoke Variant', 'Smoke hook')
      RETURNING id
    `, [contentId]);

    const variantId = variant.rows[0].id;

    const production = await client.query(`
      INSERT INTO v2_1.productions (content_variant_id)
      VALUES ($1)
      RETURNING id
    `, [variantId]);

    const productionId = production.rows[0].id;

    const job = await client.query(`
      INSERT INTO v2_1.jobs (
        production_id,
        job_type,
        idempotency_key
      )
      VALUES ($1, 'SMOKE_TEST', 'v2.1-db-smoke-test')
      RETURNING id
    `, [productionId]);

    const jobId = job.rows[0].id;

    const stage = await client.query(`
      INSERT INTO v2_1.stage_runs (
        job_id,
        stage
      )
      VALUES ($1, 'SCRIPT')
      RETURNING id, status
    `, [jobId]);

    if (stage.rows[0].status !== 'QUEUED') {
      throw new Error(`Expected QUEUED stage, got ${stage.rows[0].status}`);
    }

    const verify = await client.query(`
      SELECT
        p.id AS project_id,
        c.id AS content_id,
        cv.id AS variant_id,
        pr.id AS production_id,
        j.id AS job_id,
        sr.id AS stage_run_id
      FROM v2_1.projects p
      JOIN v2_1.contents c
        ON c.project_id = p.id
      JOIN v2_1.content_variants cv
        ON cv.content_id = c.id
      JOIN v2_1.productions pr
        ON pr.content_variant_id = cv.id
      JOIN v2_1.jobs j
        ON j.production_id = pr.id
      JOIN v2_1.stage_runs sr
        ON sr.job_id = j.id
      WHERE p.id = $1
    `, [projectId]);

    if (verify.rowCount !== 1) {
      throw new Error(`Expected one complete production chain, got ${verify.rowCount}`);
    }

    console.log('V2.1 DATABASE SMOKE TEST PASSED.');
    console.log('PROJECT -> CONTENT -> VARIANT -> PRODUCTION -> JOB -> STAGE_RUN');
  } finally {
    await client.query(
      'DELETE FROM v2_1.projects WHERE id = $1',
      [projectId]
    );
  }

  await client.end();
}

main().catch(async (error) => {
  console.error('V2.1 DATABASE SMOKE TEST FAILED.');
  console.error(error.message);
  try {
    await client.end();
  } catch {}
  process.exit(1);
});
