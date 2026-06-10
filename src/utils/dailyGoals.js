const { query } = require('./database');
const { e } = require('./appEmojis');

async function updateDailyProgress(guildId, userId, type) {
  const now = new Date();
  const tzRes = await query('SELECT timezone FROM guild_config WHERE guild_id=$1', [guildId]);
  const tz = tzRes.rows[0]?.timezone || 'America/New_York';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const col = type === 'autogame' ? 'autogames' : type === 'payout' ? 'payouts' : 'games';
  await query(
    'INSERT INTO daily_progress (guild_id, user_id, date, ' + col + ') VALUES ($1,$2,$3,1) ON CONFLICT (guild_id, user_id, date) DO UPDATE SET ' + col + ' = daily_progress.' + col + ' + 1',
    [guildId, userId, today]
  );
}

async function sendCongratsIfGoalMet(client, guildId, userId) {
  const cfgRes = await query('SELECT timezone, staff_notif_channel_id FROM guild_config WHERE guild_id=$1', [guildId]);
  if (!cfgRes.rows.length || !cfgRes.rows[0].staff_notif_channel_id) return;
  const tz = cfgRes.rows[0].timezone || 'America/New_York';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

  const progressRes = await query('SELECT * FROM daily_progress WHERE guild_id=$1 AND user_id=$2 AND date=$3', [guildId, userId, today]);
  if (!progressRes.rows.length) return;
  const progress = progressRes.rows[0];
  if (progress.congrats_sent) return;

  const staffRes = await query('SELECT role FROM staff WHERE user_id=$1 AND active=true', [userId]);
  if (!staffRes.rows.length) return;
  const role = staffRes.rows[0].role;

  const goalRes = await query('SELECT * FROM daily_goals WHERE guild_id=$1 AND role=$2', [guildId, role]);
  if (!goalRes.rows.length) return;
  const goal = goalRes.rows[0];

  if (progress.games < goal.games || progress.autogames < goal.autogames || progress.payouts < goal.payouts) return;

  await query('UPDATE daily_progress SET goal_met=true, congrats_sent=true WHERE guild_id=$1 AND user_id=$2 AND date=$3', [guildId, userId, today]);

  try {
    const notifCh = await client.channels.fetch(cfgRes.rows[0].staff_notif_channel_id);
    await notifCh.send(
      e('confetti') + ' <@' + userId + '> completed their daily goals!\n' +
      e('controller') + ' Games: **' + progress.games + '/' + goal.games + '** \u2705\n' +
      e('bullet') + ' Auto-Games: **' + progress.autogames + '/' + goal.autogames + '** \u2705\n' +
      e('payout') + ' Payouts: **' + progress.payouts + '/' + goal.payouts + '** \u2705'
    );
  } catch (err) { console.error('[DailyGoals] Congrats failed:', err.message); }
}

module.exports = { updateDailyProgress, sendCongratsIfGoalMet };
