'use strict';

// Optional local runner for the same SQL/services exercised by native PostgreSQL CI.
// Serialize transactions because one embedded database has one connection.
function embeddedPostgresPool() {
  const { PGlite } = require(process.env.APPROVAL_PGLITE_MODULE || '@electric-sql/pglite');
  const db = new PGlite();
  let tail = Promise.resolve();
  const query = async (sql, params) => {
    const text = sql.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '');
    if (!params) {
      const results = await db.exec(text);
      return results.at(-1) || { rows: [] };
    }
    return db.query(text, params);
  };
  return {
    query,
    async connect() {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      return { query, release };
    },
    end: () => db.close(),
  };
}
module.exports = { embeddedPostgresPool };
