'use strict';

const assert = require('node:assert/strict');
const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const { executePublicationWithDb, PUBLICATION_IN_PROGRESS } = require('../src/v2.1/publish-executor');

const WORKERS = 8;
const root = path.resolve(__dirname, '..');

function client() {
  return new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'content_os',
  });
}

async function setupDatabase(db) {
  await db.query('DROP SCHEMA IF EXISTS v2_1 CASCADE');
  await db.query('CREATE SCHEMA v2_1');
  await db.query(fs.readFileSync(path.join(root, 'migrations/20260820_v2_1_publication_execution.sql'), 'utf8'));
  await db.query(fs.readFileSync(path.join(root, 'migrations/20260821_v2_1_publication_atomicity.sql'), 'utf8'));
}

async function main() {
  const setup = client();
  await setup.connect();
  await setupDatabase(setup);
  await setup.end();

  let providerCalls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let markProviderStarted;
  const providerStarted = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('publisher was not claimed within 2 seconds')), 2000);
    markProviderStarted = () => { clearTimeout(timeout); resolve(); };
  });
  const publisher = async ({ idempotencyKey }) => {
    providerCalls += 1;
    markProviderStarted();
    assert.ok(idempotencyKey);
    await gate;
    return { delivery: 'CONFIRMED', remoteId: 'remote-1' };
  };

  const dbs = Array.from({ length: WORKERS }, () => client());
  await Promise.all(dbs.map((db) => db.connect()));
  try {
    const args = {
      artifactVersionId: '00000000-0000-0000-0000-000000000101',
      destination: 'test-destination',
      idempotencyKey: 'publication-atomic-1',
      gate: { allowed: true },
      publisher,
    };

    const attempts = dbs.map((db) => executePublicationWithDb({ ...args, db }));
    const settled = Promise.allSettled(attempts);
    await providerStarted;
    assert.equal(providerCalls, 1, 'exactly one database contender may invoke the provider');

    release();
    const results = await settled;
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'exactly one contender completes publication');
    assert.equal(rejected.length, WORKERS - 1, 'all competing contenders are fenced while publishing');
    assert.ok(rejected.every((r) => r.reason?.code === PUBLICATION_IN_PROGRESS));
    assert.equal(providerCalls, 1, 'provider execution must remain exactly once');

    const persisted = await dbs[0].query(
      `SELECT status, attempt, external_id FROM v2_1.publications WHERE publication_key = encode(digest($1, 'sha256'), 'hex')`,
      ['publication-atomic-1'],
    );
    assert.equal(persisted.rowCount, 1);
    assert.equal(persisted.rows[0].status, 'PUBLISHED');
    assert.equal(persisted.rows[0].attempt, 1);
    assert.equal(persisted.rows[0].external_id, 'remote-1');

    console.log(`V2.1 PUBLICATION DB IDEMPOTENCY CERTIFICATION PASSED: ${WORKERS} contenders -> exactly 1 provider execution and durable PUBLISHED state`);
  } finally {
    await Promise.all(dbs.map((db) => db.end()));
    const cleanup = client();
    await cleanup.connect();
    await cleanup.query('DROP SCHEMA IF EXISTS v2_1 CASCADE').catch(() => {});
    await cleanup.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
