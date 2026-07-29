const { query } = require('./database');

// Looks up pay requirements for a specific role, falling back to the guild's
// "default" tier if no role-specific override has been set.
async function getPayRequirements(guildId, role) {
  const roleKey = role || 'default';
  const reqRes = await query(`SELECT * FROM pay_requirements WHERE guild_id=$1 AND role=$2`, [guildId, roleKey]);
  let req = reqRes.rows[0];
  if (!req && roleKey !== 'default') {
    const fallbackRes = await query(`SELECT * FROM pay_requirements WHERE guild_id=$1 AND role='default'`, [guildId]);
    req = fallbackRes.rows[0];
  }
  return req || {
    min_games_hosted: 10, min_giveaways_hosted: 2, min_raffles_hosted: 2, min_rumble: 4,
    max_late_payouts: 3, max_missed_shifts: 1, pay_period_days: 30, bonus_per_game: 400,
  };
}

async function checkEligibility(guildId, userId, role, periodDays) {
  const now = new Date();
  const req = await getPayRequirements(guildId, role);
  const days = parseInt(periodDays) || parseInt(req.pay_period_days) || 30;
  const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const gamesRes = await query(
    `SELECT COUNT(*) FROM game_logs WHERE guild_id=$1 AND host_id=$2 AND started_at > $3 AND status != 'cancelled'`,
    [guildId, userId, periodStart]
  );
  const rumbleRes = await query(
    `SELECT COUNT(*) FROM game_logs WHERE guild_id=$1 AND host_id=$2 AND started_at > $3 AND LOWER(game_name) LIKE '%rumble%'`,
    [guildId, userId, periodStart]
  );
  const rafflesRes = await query(
    `SELECT COUNT(*) FROM raffles WHERE guild_id=$1 AND host_id=$2 AND created_at > $3`,
    [guildId, userId, periodStart]
  );
  const giveawaysRes = await query(
    `SELECT COUNT(*) FROM giveaways WHERE guild_id=$1 AND host_id=$2 AND created_at > $3`,
    [guildId, userId, periodStart]
  );

  const gamesHosted     = parseInt(gamesRes.rows[0].count);
  const rumbleGames     = parseInt(rumbleRes.rows[0].count);
  const rafflesHosted   = parseInt(rafflesRes.rows[0].count);
  const giveawaysHosted = parseInt(giveawaysRes.rows[0].count);

  const checks = [
    { name: 'Games',     actual: gamesHosted,     required: req.min_games_hosted,     pass: gamesHosted >= req.min_games_hosted },
    { name: 'Rumble',    actual: rumbleGames,      required: req.min_rumble,           pass: rumbleGames >= req.min_rumble },
    { name: 'Raffles',   actual: rafflesHosted,    required: req.min_raffles_hosted,   pass: rafflesHosted >= req.min_raffles_hosted },
    { name: 'Giveaways', actual: giveawaysHosted,  required: req.min_giveaways_hosted, pass: giveawaysHosted >= req.min_giveaways_hosted },
  ];

  const passCount = checks.filter(c => c.pass).length;
  // full = every check passes, partial = at least half pass, none = fewer than half.
  const eligible = passCount === checks.length ? 'full'
    : passCount >= checks.length / 2 ? 'partial'
    : 'none';

  return {
    checks, eligible, notes: [],
    gamesHosted, rumbleGames, rafflesHosted, giveawaysHosted,
    req: {
      min_games_hosted: req.min_games_hosted,
      min_giveaways_hosted: req.min_giveaways_hosted,
      min_raffles_hosted: req.min_raffles_hosted,
      min_rumble: req.min_rumble,
    },
  };
}

module.exports = { checkEligibility, getPayRequirements };
