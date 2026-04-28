const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false // Required for many hosted Postgres services like Vercel/Supabase/Neon
  }
});

async function init() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS credentials (
        id UUID PRIMARY KEY,
        client_name TEXT NOT NULL,
        username JSONB NOT NULL,
        password JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tools (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        curl TEXT NOT NULL,
        variables JSONB NOT NULL,
        environments JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit (
        id UUID PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        user_id UUID,
        username TEXT,
        role TEXT,
        action TEXT,
        details TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS approvals (
        id UUID PRIMARY KEY,
        status TEXT NOT NULL,
        action TEXT NOT NULL,
        target_id UUID NOT NULL,
        details TEXT,
        requested_by TEXT,
        requested_at TIMESTAMPTZ DEFAULT NOW(),
        processed_by TEXT,
        processed_at TIMESTAMPTZ
      )
    `);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  init,
  pool
};
