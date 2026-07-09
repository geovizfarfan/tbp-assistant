const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.PLAY_AND_REGRET_DB_URL,
  ssl: process.env.PLAY_AND_REGRET_DB_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[PlayAndRegretDB] Unexpected pool error (connection recovered automatically):', err.message);
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function getBalance(userId) {
  const result = await query(
    'SELECT balance FROM users WHERE user_id = $1',
    [userId]
  );
  return result.rows[0]?.balance ?? null;
}

async function adjustBalance(userId, username, amount) {
  const earnedDelta = amount > 0 ? amount : 0;
  const spentDelta = amount < 0 ? Math.abs(amount) : 0;

  const result = await query(
    `INSERT INTO users (user_id, username, balance, total_earned, total_spent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       balance = users.balance + EXCLUDED.balance,
       total_earned = users.total_earned + EXCLUDED.total_earned,
       total_spent = users.total_spent + EXCLUDED.total_spent,
       username = EXCLUDED.username
     RETURNING balance`,
    [userId, username, amount, earnedDelta, spentDelta]
  );

  return result.rows[0].balance;
}

module.exports = { pool, query, getBalance, adjustBalance };
