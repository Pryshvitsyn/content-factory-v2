'use strict';

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { discoverLocalDatabase } = require('./local-runtime');
const { syncCanonicalBrands } = require('../src/brand-registry/sync-canonical-brands');

async function main() {
  const discovered = discoverLocalDatabase(process.env);
  const db = new Pool({ connectionString: discovered.url, max: 2 });
  try {
    const result = await syncCanonicalBrands({ db, workspaceId: process.env.CONTENT_FACTORY_WORKSPACE_ID || null });
    console.log(`CANONICAL BRAND REGISTRY READY · workspace ${result.workspaceId}`);
    for (const brand of result.brands) {
      const action = brand.migratedLegacyAlias ? 'MIGRATED LEGACY ATTUNE' : brand.created ? 'CREATED' : 'UPDATED';
      console.log(`${action} · ${brand.name} · ${brand.slug}`);
    }
    for (const legacy of result.archivedLegacyAliases) console.log(`ARCHIVED LEGACY ALIAS · ${legacy.name} · ${legacy.slug}`);
    console.log(`Canonical brands: ${result.canonicalCount}`);
  } finally { await db.end(); }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[${error.code || 'CANONICAL_BRAND_SYNC_FAILED'}] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
