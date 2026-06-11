const { query } = require('./database');
const { e } = require('../utils/appEmojis');

const REMINDER_INTERVALS = [
  { minutes: 15,   level: 0, tagAdmin: false, markLate: false },
  { minutes: 60,   level: 1, tagAdmin: true,  markLate: false },
  { minutes: 120,  level: 2, tagAdmin: true,  markLate: true  },
  { minutes: 1440, level: 3, tagAdmin: true,  markLate: true  }, // 24h
];

async function runPayoutReminders(client) {
  const now = new Date();

  const res = await query(
    'SELECT * FROM payout_reminders WHERE resolved = false',
    []
  );

  for (const reminder of res.rows) {
    const created = new Date(reminder.created_at);
    const minutesElapsed = (now - created) / 60000;

    // Find next reminder tier
    const tier = REMINDER_INTERVALS.slice().reverse().find(t => minutesElapsed >= t.minutes);
    if (!tier) continue;
    if (reminder.escalation_level >= tier.level && reminder.last_reminded_at) continue;

    try {
      const guild = await client.guilds.fetch(reminder.guild_id);
      const channel = await guild.channels.fetch(reminder.channel_id);

      // Fetch admin role to ping if needed
      let adminMention = '';
      if (tier.tagAdmin) {
        const adminStaff = await query(
          `SELECT user_id FROM staff WHERE role IN ('admin','owner') AND active = true`,
          []
        );
        adminMention = adminStaff.rows.map(r => `<@${r.user_id}>`).join(' ');
      }

      const clock   = e('RojasClock') || '<a:RojasClock:1512912822613446787>';
      const alert   = tier.markLate ? (e('atention') || '<a:atention:1512916995543273642>') : '';
      const lateTag = tier.markLate ? ' **LATE PAYOUT**' : '';
      const suffix  = adminMention ? '\n' + adminMention : '';
      // Get game details for jump link
      let gameInfo = '';
      try {
        const table = reminder.type === 'raffle' ? 'raffles' : reminder.type === 'giveaway' ? 'giveaways' : 'game_logs';
        const nameCol = reminder.type === 'game' ? 'game_name' : 'prize';
        const gameRes = await query(`SELECT ${nameCol}, message_link FROM ${table} WHERE id=$1`, [reminder.ref_id]);
        if (gameRes.rows.length) {
          const g = gameRes.rows[0];
          const name = g.game_name || g.prize || reminder.type;
          const link = g.message_link ? ` — [Jump to Game](${g.message_link})` : '';
          gameInfo = ' | **' + name + '**' + link;
        }
      } catch {}

      const msg = clock + alert + lateTag + ' <@' + reminder.host_id + '> reminder: <@' + reminder.winner_id + '> is waiting for **' + reminder.prize + '**' + gameInfo + '.' + suffix;
      // Post to staff notif channel if configured, otherwise fall back to game channel
      try {
        const configRes = await query(`SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1`, [reminder.guild_id]);
        if (configRes.rows.length && configRes.rows[0].staff_notif_channel_id) {
          const notifChannel = await client.channels.fetch(configRes.rows[0].staff_notif_channel_id);
          await notifChannel.send(msg);
        } else {
          await channel.send(msg);
        }
      } catch {
        await channel.send(msg);
      }

      // If first time hitting markLate, update DB record
      if (tier.markLate) {
        const table = reminder.type === 'raffle' ? 'raffles' : reminder.type === 'giveaway' ? 'giveaways' : 'game_logs';
        await query(`UPDATE ${table} SET payout_status='late' WHERE id=$1`, [reminder.ref_id]);
      }

      await query(
        'UPDATE payout_reminders SET last_reminded_at=$1, reminder_count=reminder_count+1, escalation_level=$2 WHERE id=$3',
        [now, tier.level, reminder.id]
      );
    } catch (err) {
      console.error(`[Reminders] Failed for reminder ${reminder.id}:`, err.message);
    }
  }
}

async function checkNotClaimed(client) {
  try {
    const now = new Date();
    const res = await query(`SELECT wa.*, b.id as booster_id FROM winner_announcements wa LEFT JOIN boosters b ON wa.winner_id = b.user_id AND wa.guild_id = b.guild_id AND b.active = true WHERE wa.status = 'pending'`, []);
    for (const ann of res.rows) {
      const claimHours = ann.booster_id ? 12 : 6;
      const hoursElapsed = (now - new Date(ann.created_at)) / (60 * 60 * 1000);
      if (hoursElapsed < claimHours) continue;
      const ticketRes = await query(`SELECT id FROM ticket_logs WHERE guild_id=$1 AND opened_by=$2 AND opened_at > $3`, [ann.guild_id, ann.winner_id, new Date(ann.created_at)]);
      if (ticketRes.rows.length) continue;
      await query(`UPDATE winner_announcements SET status='not_claimed' WHERE id=$1`, [ann.id]);
      try {
        const { EmbedBuilder } = require('discord.js');
        const ch = await client.channels.fetch(ann.channel_id);
        const msg = await ch.messages.fetch(ann.message_id);
        if (msg.embeds[0]) {
          const embed = EmbedBuilder.from(msg.embeds[0]).setColor(0x00FFF9).spliceFields(3, 1, { name: 'Status', value: 'Not Claimed — winner did not open a ticket within ' + claimHours + 'hrs', inline: false });
          await msg.edit({ embeds: [embed] });
        }
      } catch {}
      console.log('[NotClaimed] Marked #' + ann.id + ' as not claimed');
    }
  } catch (err) { console.error('[NotClaimed] Check failed:', err.message); }
}

function startReminderLoop(client) {
  // Payout reminders disabled
  // setInterval(() => runPayoutReminders(client), 5 * 60 * 1000);
  setInterval(() => checkNotClaimed(client), 5 * 60 * 1000);
  console.log('[Reminders] Payout reminder loop started.');
}

module.exports = { startReminderLoop };
