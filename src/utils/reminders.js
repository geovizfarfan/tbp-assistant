const { query } = require('./database');
const { e } = require('./appEmojis');

const REMINDER_INTERVALS = [
  { minutes: 15,   level: 0, tagAdmin: false, markLate: false },
  { minutes: 60,   level: 1, tagAdmin: true,  markLate: false },
  { minutes: 120,  level: 2, tagAdmin: true,  markLate: true  },
  { minutes: 1440, level: 3, tagAdmin: true,  markLate: true  },
];

async function runPayoutReminders(client) {
  const now = new Date();

  const res = await query(
    `SELECT * FROM payout_reminders WHERE resolved = false`,
    []
  );

  for (const reminder of res.rows) {
    const created = new Date(reminder.created_at);
    const minutesElapsed = (now - created) / 60000;

    const tier = REMINDER_INTERVALS.slice().reverse().find(t => minutesElapsed >= t.minutes);
    if (!tier) continue;
    if (reminder.escalation_level >= tier.level && reminder.last_reminded_at) continue;

    try {
      const guild   = await client.guilds.fetch(reminder.guild_id);
      const channel = await guild.channels.fetch(reminder.channel_id);

      let adminMention = '';
      if (tier.tagAdmin) {
        const adminStaff = await query(
          `SELECT user_id FROM staff WHERE role IN ('admin','owner') AND active = true`,
          []
        );
        adminMention = adminStaff.rows.map(r => `<@${r.user_id}>`).join(' ');
      }

      const lateTag  = tier.markLate ? ' **LATE PAYOUT**' : '';
      const mention  = adminMention ? '\n' + adminMention : '';
      const clock    = e('RojasClock') || '⏰';
      const alert    = tier.markLate ? (e('atention') || '🚨') : '';

      await channel.send(
        `${clock}${alert}${lateTag} <@${reminder.host_id}> reminder: <@${reminder.winner_id}> is waiting for **${reminder.prize}**.${mention}`
      );

      if (tier.markLate) {
        const table = reminder.type === 'raffle' ? 'raffles' : reminder.type === 'giveaway' ? 'giveaways' : 'game_logs';
        await query(`UPDATE ${table} SET payout_status='late' WHERE id=$1`, [reminder.ref_id]);
      }

      await query(
        `UPDATE payout_reminders SET last_reminded_at=$1, reminder_count=reminder_count+1, escalation_level=$2 WHERE id=$3`,
        [now, tier.level, reminder.id]
      );
    } catch (err) {
      console.error(`[Reminders] Failed for reminder ${reminder.id}:`, err.message);
    }
  }
}

function startReminderLoop(client) {
  setInterval(() => runPayoutReminders(client), 5 * 60 * 1000);
  console.log('[Reminders] Payout reminder loop started.');
}

module.exports = { startReminderLoop };
