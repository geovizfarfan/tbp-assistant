const { query } = require('./database');

/**
 * Returns full eligibility result for a staff member in the current pay period.
 */
async function checkEligibility(guildId, userId) {
  // Load requirements
  const reqRes = await query(
    `SELECT * FROM pay_requirements WHERE guild_id = $1`,
    [guildId]
  );
  const req = reqRes.rows[0] || {
    min_games_hosted: 10,
    min_giveaways_hosted: 2,
    min_raffles_hosted: 2,
    max_late_payouts: 3,
    max_missed_shifts: 1,
    ticket_response_limit_minutes: 30,
    pay_period_days: 30,
  };

  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - req.pay_period_days);

  // Games hosted
  const gamesRes = await query(
    `SELECT COUNT(*) FROM game_logs WHERE guild_id=$1 AND host_id=$2 AND started_at >= $3`,
    [guildId, userId, periodStart]
  );
  const gamesHosted = parseInt(gamesRes.rows[0].count);

  // Giveaways hosted
  const gwRes = await query(
    `SELECT COUNT(*) FROM giveaways WHERE guild_id=$1 AND host_id=$2 AND started_at >= $3`,
    [guildId, userId, periodStart]
  );
  const giveawaysHosted = parseInt(gwRes.rows[0].count);

  // Raffles hosted
  const rfRes = await query(
    `SELECT COUNT(*) FROM raffles WHERE guild_id=$1 AND host_id=$2 AND created_at >= $3`,
    [guildId, userId, periodStart]
  );
  const rafflesHosted = parseInt(rfRes.rows[0].count);

  // Late payouts
  const lpRes = await query(
    `SELECT COUNT(*) FROM (
      SELECT payout_status FROM raffles WHERE host_id=$1 AND guild_id=$2 AND payout_status='late' AND created_at >= $3
      UNION ALL
      SELECT payout_status FROM giveaways WHERE host_id=$1 AND guild_id=$2 AND payout_status='late' AND started_at >= $3
      UNION ALL
      SELECT payout_status FROM game_logs WHERE host_id=$1 AND guild_id=$2 AND payout_status='late' AND started_at >= $3
    ) sub`,
    [userId, guildId, periodStart]
  );
  const latePayouts = parseInt(lpRes.rows[0].count);

  // Missed shifts
  const msRes = await query(
    `SELECT COUNT(*) FROM schedules WHERE guild_id=$1 AND staff_id=$2 AND status='missed' AND scheduled_date >= $3`,
    [guildId, userId, periodStart]
  );
  const missedShifts = parseInt(msRes.rows[0].count);

  // Late tickets
  const ltRes = await query(
    `SELECT COUNT(*) FROM ticket_logs WHERE guild_id=$1 AND first_staff_responder=$2 AND late_response=true AND opened_at >= $3`,
    [guildId, userId, periodStart]
  );
  const lateTickets = parseInt(ltRes.rows[0].count);

  const notes = [];
  let eligible = 'full';

  if (gamesHosted < req.min_games_hosted) {
    notes.push(`❌ Games short by ${req.min_games_hosted - gamesHosted}`);
    eligible = 'partial';
  }
  if (giveawaysHosted < req.min_giveaways_hosted) {
    notes.push(`❌ Giveaways short by ${req.min_giveaways_hosted - giveawaysHosted}`);
    eligible = 'partial';
  }
  if (rafflesHosted < req.min_raffles_hosted) {
    notes.push(`❌ Raffles short by ${req.min_raffles_hosted - rafflesHosted}`);
    eligible = 'partial';
  }
  if (latePayouts > req.max_late_payouts) {
    notes.push(`⚠️ Too many late payouts (${latePayouts})`);
    if (eligible === 'full') eligible = 'review';
  }
  if (missedShifts > req.max_missed_shifts) {
    notes.push(`⚠️ Missed shifts exceed limit (${missedShifts})`);
    if (eligible === 'full') eligible = 'review';
  }
  if (gamesHosted === 0 && giveawaysHosted === 0 && rafflesHosted === 0) {
    eligible = 'not_eligible';
    notes.push('❌ No hosting activity this period');
  }

  return {
    eligible,
    gamesHosted, giveawaysHosted, rafflesHosted,
    latePayouts, missedShifts, lateTickets,
    req, notes,
  };
}

module.exports = { checkEligibility };
