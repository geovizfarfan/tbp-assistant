const { query } = require('./database');

async function checkEligibility(guildId, userId, periodDays) {
  const now = new Date();
  const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

  const reqRes = await query(`SELECT * FROM pay_requirements WHERE guild_id=$1`, [guildId]);
  const req = reqRes.rows[0] || {
    min_games: 20, min_rumble: 4, min_raffles: 3, min_giveaways: 2,
    max_late_payouts: 3, max_missed_shifts: 0, pay_period_days: 30
  };

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
    `SELECT COUNT(*) FROM payout_reminders WHERE guild_id=$1 AND host_id=$2 AND created_at > $3 AND escalation_level >= 2`,
    [guildId, userId, periodStart]
  );
  const missedRes = await query(
    `SELECT COUNT(*) FROM schedules WHERE guild_id=$1 AND host_id=$2 AND scheduled_at > $3 AND status='missed'`,
    [guildId, userId, periodStart]
  );
  const totalScheduled = parseInt((await query(
    `SELECT COUNT(*) FROM schedules WHERE guild_id=$1 AND host_id=$2 AND scheduled_at > $3`,
    [guildId, userId, periodStart]
  )).rows[0].count);

  const totalGames     = parseInt(gamesRes.rows[0].count);
  const rumbleGames    = parseInt(rumbleRes.rows[0].count);
  const totalRaffles   = parseInt(rafflesRes.rows[0].count);
  const totalGiveaways = parseInt(giveawaysRes.rows[0].count);
  const latePayouts    = parseInt(lateRes.rows[0].count);
  const missedShifts   = parseInt(missedRes.rows[0].count);
  const grandTotal     = totalGames + totalRaffles + totalGiveaways;

  const checks = [
    { name: 'Games',        actual: grandTotal,      required: req.min_games,        pass: grandTotal >= req.min_games },
    { name: 'Rumble',       actual: rumbleGames,      required: req.min_rumble || 4,  pass: rumbleGames >= (req.min_rumble || 4) },
    { name: 'Raffles',      actual: totalRaffles,     required: req.min_raffles,      pass: totalRaffles >= req.min_raffles },
    { name: 'Giveaways',    actual: totalGiveaways,   required: req.min_giveaways,    pass: totalGiveaways >= req.min_giveaways },
    { name: 'Late payouts', actual: latePayouts,      required: req.max_late_payouts, pass: latePayouts <= req.max_late_payouts, inverse: true },
  ];

  if (totalScheduled > 0) {
    checks.push({ name: 'Missed shifts', actual: missedShifts, required: req.max_missed_shifts, pass: missedShifts <= req.max_missed_shifts, inverse: true });
  }

  const eligible = checks.every(c => c.pass);
  return { checks, eligible, grandTotal, rumbleGames, totalRaffles, totalGiveaways, latePayouts, missedShifts };
}

module.exports = { checkEligibility };
