const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');
const { e } = require('../../utils/appEmojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mark-paid')
    .setDescription('Mark a staff member or booster as paid (auto-detects which)')
    .addSubcommand(sub => sub
      .setName('pay')
      .setDescription('Mark as paid — blocked if already paid for the current period')
      .addUserOption(o => o.setName('user').setDescription('Staff member or booster').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount paid (leave blank to use their default)').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('revoke')
      .setDescription('Undo the most recent payment if it was marked by mistake')
      .addUserOption(o => o.setName('user').setDescription('Staff member or booster').setRequired(true))),

  async execute(interaction) {
    const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || (!member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID)) {
      return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'pay') return payUser(interaction);
    if (sub === 'revoke') return revokeUser(interaction);
  },
};

async function payUser(interaction) {
  const user   = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const now     = new Date();
  const nextDue = new Date();
  nextDue.setDate(nextDue.getDate() + 30);

  await interaction.deferReply({ ephemeral: true });

  const staffRes   = await query('SELECT * FROM staff WHERE user_id=$1 AND active=true', [user.id]);
  const boosterRes = await query('SELECT * FROM boosters WHERE guild_id=$1 AND user_id=$2 AND active=true', [interaction.guildId, user.id]);

  if (!staffRes.rows.length && !boosterRes.rows.length) {
    return interaction.editReply({ content: `${e('wrong')} <@${user.id}> isn't active staff or an active booster.` });
  }

  // Block re-paying before the current period is actually due — this is what
  // stops the same person from being marked paid multiple times in a row.
  const notYetDueStaff   = staffRes.rows[0]?.next_pay_due_at && new Date(staffRes.rows[0].next_pay_due_at) > now;
  const notYetDueBooster = boosterRes.rows[0]?.next_pay_due_at && new Date(boosterRes.rows[0].next_pay_due_at) > now;

  const staffBlocked   = staffRes.rows.length ? notYetDueStaff : true;
  const boosterBlocked = boosterRes.rows.length ? notYetDueBooster : true;

  if (staffBlocked && boosterBlocked) {
    const dueDates = [
      staffRes.rows.length && notYetDueStaff ? `Staff: ${tsF(staffRes.rows[0].next_pay_due_at)}` : null,
      boosterRes.rows.length && notYetDueBooster ? `Booster: ${tsF(boosterRes.rows[0].next_pay_due_at)}` : null,
    ].filter(Boolean).join('\n');
    return interaction.editReply({
      content: `${e('wrong')} <@${user.id}> was already paid this period — not due again until:\n${dueDates}\n\nUse \`/mark-paid revoke\` first if this was a mistake.`,
    });
  }

  const embed = baseEmbed(`${e('checkmark')} Payment Recorded`, COLORS.softgreen, interaction.guild?.name)
    .addFields({ name: `${e('members')} Paid`, value: `<@${user.id}>`, inline: false });

  const receiptLines = [];

  if (staffRes.rows.length && !notYetDueStaff) {
    const s = staffRes.rows[0];
    const staffCurrency = s.pay_currency || 'MEE6';

    let staffAmount = amount;
    if (staffAmount === null) {
      const reqRes = await query(`SELECT * FROM pay_requirements WHERE guild_id=$1`, [interaction.guildId]);
      const req = reqRes.rows[0] || { bonus_per_game: 400, pay_period_days: 30 };
      const bonusPerGame = req.bonus_per_game || 400;
      const periodDays   = req.pay_period_days || 30;
      const periodStart  = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

      const gamesRes = await query(
        `SELECT COUNT(*) FROM game_logs WHERE guild_id=$1 AND host_id=$2 AND started_at > $3`,
        [interaction.guildId, user.id, periodStart]
      );
      const gamesHosted = parseInt(gamesRes.rows[0].count);
      staffAmount = (s.pay_amount || 0) + gamesHosted * bonusPerGame;
    }

    await query(`UPDATE staff SET last_paid_at=$1, next_pay_due_at=$2 WHERE user_id=$3`, [now, nextDue, user.id]);
    await query(
      `INSERT INTO staff_payments (user_id, guild_id, amount, currency, paid_at, approved_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [user.id, interaction.guildId, staffAmount, staffCurrency, now, interaction.user.id]
    );

    embed.addFields({
      name: `${e('payday')} Staff Pay`,
      value: `Amount: **${staffAmount} ${staffCurrency}**\nNext Due: ${tsF(nextDue)}`,
      inline: true,
    });
    receiptLines.push(`${e('payday')} **Staff Pay:** ${staffAmount} ${staffCurrency}`);
  }

  if (boosterRes.rows.length && !notYetDueBooster) {
    const b = boosterRes.rows[0];
    const boosterAmount = amount || b.amount_owed;
    const boosterCurrency = b.currency;

    await query(`UPDATE boosters SET last_paid_at=$1, next_pay_due_at=$2 WHERE guild_id=$3 AND user_id=$4`, [now, nextDue, interaction.guildId, user.id]);
    await query(
      `INSERT INTO booster_payments (user_id, guild_id, amount, currency, paid_at, approved_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [user.id, interaction.guildId, boosterAmount, boosterCurrency, now, interaction.user.id]
    );

    embed.addFields({
      name: `${e('payday')} Booster Pay`,
      value: `Amount: **${boosterAmount} ${boosterCurrency}**\nNext Due: ${tsF(nextDue)}`,
      inline: true,
    });
    receiptLines.push(`${e('payday')} **Booster Pay:** ${boosterAmount} ${boosterCurrency}`);
  }

  embed.addFields({ name: '✍️ Approved by', value: `<@${interaction.user.id}>`, inline: false });

  // Single combined DM receipt covering whichever payment(s) actually happened.
  if (receiptLines.length) {
    const dmMember = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (dmMember) {
      await dmMember.send({
        embeds: [baseEmbed(`${e('payday')} Payment Receipt`, COLORS.softgreen, interaction.guild?.name)
          .addFields(
            { name: `${e('payday')} Amount(s)`,   value: receiptLines.join('\n'), inline: false },
            { name: `${e('RojasClock')} Paid At`, value: tsF(now), inline: true },
            { name: `${e('calender')} Next Due`,  value: tsF(nextDue), inline: true },
            { name: '✍️ Approved by',             value: `<@${interaction.user.id}>`, inline: true },
          )]
      }).catch(() => {});
    }
  }

  await interaction.editReply({ embeds: [embed] });
}

async function revokeUser(interaction) {
  const user = interaction.options.getUser('user');
  await interaction.deferReply({ ephemeral: true });

  const revokedLines = [];

  const staffPayments = await query(
    `SELECT * FROM staff_payments WHERE user_id=$1 AND guild_id=$2 ORDER BY paid_at DESC LIMIT 2`,
    [user.id, interaction.guildId]
  );
  if (staffPayments.rows.length) {
    const [last, prior] = staffPayments.rows;
    await query('DELETE FROM staff_payments WHERE id=$1', [last.id]);
    await query(
      `UPDATE staff SET last_paid_at=$1, next_pay_due_at=$2 WHERE user_id=$3`,
      [prior?.paid_at || null, prior ? new Date(new Date(prior.paid_at).getTime() + 30 * 86400000) : null, user.id]
    );
    revokedLines.push(`${e('payday')} **Staff payment reversed:** ${last.amount} ${last.currency} (paid ${tsF(last.paid_at)})`);
  }

  const boosterPayments = await query(
    `SELECT * FROM booster_payments WHERE user_id=$1 AND guild_id=$2 ORDER BY paid_at DESC LIMIT 2`,
    [user.id, interaction.guildId]
  );
  if (boosterPayments.rows.length) {
    const [last, prior] = boosterPayments.rows;
    await query('DELETE FROM booster_payments WHERE id=$1', [last.id]);
    await query(
      `UPDATE boosters SET last_paid_at=$1, next_pay_due_at=$2 WHERE guild_id=$3 AND user_id=$4`,
      [prior?.paid_at || null, prior ? new Date(new Date(prior.paid_at).getTime() + 30 * 86400000) : null, interaction.guildId, user.id]
    );
    revokedLines.push(`${e('payday')} **Booster payment reversed:** ${last.amount} ${last.currency} (paid ${tsF(last.paid_at)})`);
  }

  if (!revokedLines.length) {
    return interaction.editReply({ content: `${e('wrong')} No recorded payments found for <@${user.id}> to revoke.` });
  }

  const embed = baseEmbed(`${e('checkmark')} Payment Revoked`, COLORS.softred, interaction.guild?.name)
    .addFields(
      { name: `${e('members')} Member`, value: `<@${user.id}>`, inline: false },
      { name: `${e('receipt')} Reversed`, value: revokedLines.join('\n'), inline: false },
      { name: '✍️ Revoked by', value: `<@${interaction.user.id}>`, inline: false },
    );

  await interaction.editReply({ embeds: [embed] });
}
