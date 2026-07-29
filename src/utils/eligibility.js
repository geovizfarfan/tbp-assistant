const { query } = require('./database');

async function checkEligibility(guildId, userId, periodDays) {
  const now = new Date();
  const reqRes0 = await query(`SELECT pay_period_days FROM pay_requirements WHERE guild_id=$1`, [guildId]);
  const days = parseInt(periodDays) || parseInt(reqRes0.rows[0]?.pay_period_days) || 30;
  const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const reqRes = await query(`SELECT * FROM pay_requirements WHERE guild_id=$1`, [guildId]);
  const req = reqRes.rows[0] || {
    min_games_hosted: 10, min_giveaways_hosted: 2, min_raffles_hosted: 2,
    max_late_payouts: 3, max_missed_shifts: 1, pay_period_days: 30,
  };
  // Rumble minimum isn't a configurable column — kept as a fixed baseline.
  const minRumble = 4;

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
  const lateRes = await query(
    `SELECT COUNT(*) FROM game_logs WHERE guild_id=$1 AND host_id=$2 AND started_at > $3 AND payout_status='late'`,
    [guildId, userId, periodStart]
  );
  const missedRes = await query(
    `SELECT COUNT(*) FROM schedules WHERE guild_id=$1 AND staff_id=$2 AND scheduled_date > $3 AND status='missed'`,
    [guildId, userId, periodStart]
  );
  const totalScheduled = parseInt((await query(
    `SELECT COUNT(*) FROM schedules WHERE guild_id=$1 AND staff_id=$2 AND scheduled_date > $3`,
    [guildId, userId, periodStart]
  )).rows[0].count);

  const gamesHosted     = parseInt(gamesRes.rows[0].count);
  const rumbleGames     = parseInt(rumbleRes.rows[0].count);
  const rafflesHosted   = parseInt(rafflesRes.rows[0].count);
  const giveawaysHosted = parseInt(giveawaysRes.rows[0].count);
  const latePayouts     = parseInt(lateRes.rows[0].count);
  const missedShifts    = parseInt(missedRes.rows[0].count);
  // Late ticket tracking doesn't exist yet as its own system — always 0 for now.
  const lateTickets     = 0;

  const checks = [
    { name: 'Games',        actual: gamesHosted,     required: req.min_games_hosted,     pass: gamesHosted >= req.min_games_hosted },
    { name: 'Rumble',       actual: rumbleGames,      required: minRumble,                pass: rumbleGames >= minRumble },
    { name: 'Raffles',      actual: rafflesHosted,    required: req.min_raffles_hosted,   pass: rafflesHosted >= req.min_raffles_hosted },
    { name: 'Giveaways',    actual: giveawaysHosted,  required: req.min_giveaways_hosted, pass: giveawaysHosted >= req.min_giveaways_hosted },
    { name: 'Late payouts', actual: latePayouts,      required: req.max_late_payouts,     pass: latePayouts <= req.max_late_payouts, inverse: true },
  ];

  if (totalScheduled > 0) {
    checks.push({ name: 'Missed shifts', actual: missedShifts, required: req.max_missed_shifts, pass: missedShifts <= req.max_missed_shifts, inverse: true });
  }

  const passCount = checks.filter(c => c.pass).length;
  // full = every check passes, partial = at least half pass, none = fewer than half.
  // There's no defined criteria anywhere for a distinct "review" state yet —
  // if that's wanted, it needs a rule (e.g. "missed shifts alone triggers review").
  const eligible = passCount === checks.length ? 'full'
    : passCount >= checks.length / 2 ? 'partial'
    : 'none';

  const notes = [];
  if (totalScheduled === 0) notes.push('No shifts scheduled this period — missed-shift check skipped.');

  return {
    checks, eligible, notes,
    gamesHosted, rumbleGames, rafflesHosted, giveawaysHosted, latePayouts, missedShifts, lateTickets,
    req: {
      min_games_hosted: req.min_games_hosted,
      min_giveaways_hosted: req.min_giveaways_hosted,
      min_raffles_hosted: req.min_raffles_hosted,
      max_late_payouts: req.max_late_payouts,
      max_missed_shifts: req.max_missed_shifts,
    },
  };
}

module.exports = { checkEligibility };
