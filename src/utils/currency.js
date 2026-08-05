const { query } = require('./database');
const { adjustBalance, getBalance } = require('./playAndRegretDb');

async function getGuildCurrencyConfig(guildId) {
  const res = await query('SELECT currency_use_sins, currency_name, currency_emoji, auto_pay_enabled FROM guild_config WHERE guild_id=$1', [guildId]);
  const cfg = res.rows[0];
  return {
    useSins: cfg?.currency_use_sins || false,
    currencyName: cfg?.currency_use_sins ? 'Sins' : (cfg?.currency_name || 'Coins'),
    currencyEmoji: cfg?.currency_emoji || (cfg?.currency_use_sins ? '<a:SINS:1522338148380704910>' : null),
    autoPayEnabled: cfg?.auto_pay_enabled || false,
  };
}

// Adjusts a member's balance in whichever system this server actually uses —
// real Sins (shared with Play & Regret) or a local wallet for a custom
// currency. Positive amount credits, negative amount debits. Returns the
// new balance, or null if the adjustment failed. `reason` is a short label
// for the audit log (e.g. 'RR reward', 'raffle prize', 'shop purchase') —
// existing call sites that don't pass one just get logged as 'unspecified'.
async function adjustGuildBalance(guildId, userId, username, amount, reason = 'unspecified') {
  const { useSins } = await getGuildCurrencyConfig(guildId);
  let newBalance;

  if (useSins) {
    newBalance = await adjustBalance(userId, username, amount).catch((err) => {
      console.error('[Currency] Failed to adjust Sins balance:', err.message);
      return null;
    });
  } else {
    const earnedDelta = amount > 0 ? amount : 0;
    const spentDelta  = amount < 0 ? Math.abs(amount) : 0;

    const res = await query(`
      INSERT INTO rr_custom_balances (guild_id, user_id, username, balance, total_earned, total_spent)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET
        balance = rr_custom_balances.balance + EXCLUDED.balance,
        total_earned = rr_custom_balances.total_earned + EXCLUDED.total_earned,
        total_spent = rr_custom_balances.total_spent + EXCLUDED.total_spent,
        username = EXCLUDED.username
      RETURNING balance
    `, [guildId, userId, username, amount, earnedDelta, spentDelta]).catch((err) => {
      console.error('[Currency] Failed to adjust local balance:', err.message);
      return null;
    });
    newBalance = res?.rows[0]?.balance ?? null;
  }

  if (newBalance !== null) {
    await query(
      `INSERT INTO currency_transactions (guild_id, user_id, username, amount, reason, new_balance) VALUES ($1,$2,$3,$4,$5,$6)`,
      [guildId, userId, username, amount, reason, newBalance]
    ).catch(err => console.error('[Currency] Failed to log transaction:', err.message));
  }

  return newBalance;
}

async function getGuildBalance(guildId, userId) {
  const { useSins } = await getGuildCurrencyConfig(guildId);

  if (useSins) {
    return getBalance(userId).catch(() => null);
  }

  const res = await query('SELECT balance FROM rr_custom_balances WHERE guild_id=$1 AND user_id=$2', [guildId, userId]);
  return res.rows[0]?.balance ?? 0;
}

module.exports = { getGuildCurrencyConfig, adjustGuildBalance, getGuildBalance };
