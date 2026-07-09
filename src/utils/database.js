const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

// Without this listener, a dropped idle connection (network blip, Postgres
// closing an idle client, etc.) throws as an unhandled 'error' event and
// crashes the entire process. The pool itself handles reconnecting new
// clients as needed — we just need to not let it go unhandled.
pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error (connection recovered automatically):', err.message);
});

async function initDB() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[DB] Schema initialized.');
}

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

module.exports = { pool, query, initDB };
