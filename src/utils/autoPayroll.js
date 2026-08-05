const { query } = require('./database');
const { getGuildCurrencyConfig, adjustGuildBalance } = require('./currency');

async function runAutoPayroll(client) {
  try {
    const guildsRes = await query('SELECT guild_id FROM guild_config WHERE auto_pay_enabled = true', []);
    for (const { guild_id: guildId } of guildsRes.rows) {
      await payDueStaff(client, guildId).catch(err => console.error(`[AutoPay] Staff error in ${guildId}:`, err.message));
      await payDueBoosters(client, guildId).catch(err => console.error(`[AutoPay] Booster error in ${guildId}:`, err.message));
    }
  } catch (err) {
    console.error('[AutoPay] Loop error:', err.message);
  }
}

async function payDueStaff(client, guildId) {
  const now = new Date();
  const dueRes = await query(
    `SELECT * FROM staff WHERE guild_id=$1 AND active=true AND next_pay_due_at IS NOT NULL AND next_pay_due_at <= $2`,
    [guildId, now]
  );
  if (!dueRes.rows.length) return;

  const { currencyName } = await getGuildCurrencyConfig(guildId);
  const { getPayRequirements } = require('./eligibility');

  const paidLines = [];
  const guild = await client.guilds.fetch(guildId).catch(() => null);

  for (const s of dueRes.rows) {
    const req = await getPayRequirements(guildId, s.role);
    const bonusPerGame = req.bonus_per_game || 400;
    const periodDays = req.pay_period_days || 30;
    const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    const gamesRes = await query(
      `SELECT COUNT(*) FROM game_logs WHERE guild_id=$1 AND host_id=$2 AND started_at > $3`,
      [guildId, s.user_id, periodStart]
    );
    const gamesHosted = parseInt(gamesRes.rows[0].count);
    const amount = (s.pay_amount || 0) + gamesHosted * bonusPerGame;

    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + 30);

    const newBalance = await adjustGuildBalance(guildId, s.user_id, s.username, amount, 'Auto-payroll: staff pay');
    if (newBalance === null) continue; // don't mark as paid if the credit failed

    await query(`UPDATE staff SET last_paid_at=$1, next_pay_due_at=$2 WHERE user_id=$3 AND guild_id=$4`, [now, nextDue, s.user_id, guildId]);
    await query(
      `INSERT INTO staff_payments (user_id, guild_id, amount, currency, paid_at, approved_by, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [s.user_id, guildId, amount, currencyName, now, 'auto-pay', 'Automatic payment']
    );

    paidLines.push(`<@${s.user_id}> — ${amount} ${currencyName}`);

    if (guild) {
      const member = await guild.members.fetch(s.user_id).catch(() => null);
      if (member) {
        const { EmbedBuilder } = require('discord.js');
        await member.send({
          embeds: [new EmbedBuilder().setColor('#248046')
            .setTitle('⏰ Automatic Payment')
            .setDescription(`You've been automatically paid **${amount} ${currencyName}** in **${guild.name}**.`)
            .setTimestamp()]
        }).catch(() => {});
      }
    }
  }

  if (paidLines.length) await postAutoPaySummary(client, guildId, 'Staff', paidLines);
}

async function payDueBoosters(client, guildId) {
  const now = new Date();
  const dueRes = await query(
    `SELECT * FROM boosters WHERE guild_id=$1 AND active=true AND next_pay_due_at IS NOT NULL AND next_pay_due_at <= $2`,
    [guildId, now]
  );
  if (!dueRes.rows.length) return;

  const { currencyName } = await getGuildCurrencyConfig(guildId);
  const paidLines = [];
  const guild = await client.guilds.fetch(guildId).catch(() => null);

  for (const b of dueRes.rows) {
    const amount = b.amount_owed;
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + 30);

    const newBalance = await adjustGuildBalance(guildId, b.user_id, b.username, amount, 'Auto-payroll: booster pay');
    if (newBalance === null) continue;

    await query(`UPDATE boosters SET last_paid_at=$1, next_pay_due_at=$2 WHERE user_id=$3 AND guild_id=$4`, [now, nextDue, b.user_id, guildId]);
    await query(
      `INSERT INTO booster_payments (user_id, guild_id, amount, currency, paid_at, approved_by, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [b.user_id, guildId, amount, currencyName, now, 'auto-pay', 'Automatic payment']
    );

    paidLines.push(`<@${b.user_id}> — ${amount} ${currencyName}`);

    if (guild) {
      const member = await guild.members.fetch(b.user_id).catch(() => null);
      if (member) {
        const { EmbedBuilder } = require('discord.js');
        await member.send({
          embeds: [new EmbedBuilder().setColor('#248046')
            .setTitle('⏰ Automatic Payment')
            .setDescription(`You've been automatically paid **${amount} ${currencyName}** in **${guild.name}**.`)
            .setTimestamp()]
        }).catch(() => {});
      }
    }
  }

  if (paidLines.length) await postAutoPaySummary(client, guildId, 'Boosters', paidLines);
}

async function postAutoPaySummary(client, guildId, label, lines) {
  try {
    const cfgRes = await query('SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1', [guildId]);
    const channelId = cfgRes.rows[0]?.staff_notif_channel_id;
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const { EmbedBuilder } = require('discord.js');
    await channel.send({
      embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle(`⏰ Auto-Pay: ${label}`)
        .setDescription(lines.join('\n'))
        .setTimestamp()]
    }).catch(() => {});
  } catch (err) {
    console.error('[AutoPay] Summary post error:', err.message);
  }
}

function startAutoPayrollLoop(client) {
  // Runs every 6 hours — payments are due on a 30-day cycle, so this is
  // frequent enough to pay people promptly without hammering the database.
  setInterval(() => runAutoPayroll(client), 6 * 60 * 60 * 1000);
  console.log('[AutoPay] Auto-payroll loop started.');
}

module.exports = { startAutoPayrollLoop };
