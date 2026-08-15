const { Pool } = require('pg');

/**
 * Database connection singleton
 * Reuses the same pool across the application
 */
let db = null;

/**
 * Get database connection
 * @returns {Pool} Database pool
 */
function getDb() {
  if (!db) {
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });

    // Handle pool errors
    db.on('error', (err) => {
      console.error('Unexpected database error:', err);
      process.exit(1);
    });
  }

  return db;
}

/**
 * Close database connection
 */
async function closeDb() {
  if (db) {
    await db.end();
    db = null;
  }
}

module.exports = { getDb, closeDb };
