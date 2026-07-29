const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');
const { e } = require('../../utils/appEmojis');
const { getGuildCurrencyConfig, adjustGuildBalance } = require('../../utils/currency');

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
      .addUserOption(o => o.setName('user').setDescription('Staff member or booster').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Which payment to revoke (default: both)').addChoices(
        { name: 'Both', value: 'both' },
        { name: 'Staff only', value: 'staff' },
        { name: 'Booster only', value: 'booster' },
      ))),

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

  const { useSins, currencyName } = await getGuildCurrencyConfig(interaction.guildId);

  // Block re-paying before the current period is actually due.
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
  const skippedNotes = [];

  if (staffRes.rows.length && notYetDueStaff) {
    skippedNotes.push(`${e('atention')} Staff pay skipped — not due until ${tsF(staffRes.rows[0].next_pay_due_at)}`);
  }
  if (boosterRes.rows.length && notYetDueBooster) {
    skippedNotes.push(`${e('atention')} Booster pay skipped — not due until ${tsF(boosterRes.rows[0].next_pay_due_at)}`);
  }

  if (staffRes.rows.length && !notYetDueStaff) {
    const s = staffRes.rows[0];

    let staffAmount = amount;
    if (staffAmount === null) {
      const { getPayRequirements } = require('../../utils/eligibility');
      const req = await getPayRequirements(interaction.guildId, s.role);
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

    let newBalanceNote = '';
    const staffNewBalance = await adjustGuildBalance(interaction.guildId, user.id, user.username, staffAmount);
    if (staffNewBalance !== null) newBalanceNote = ` | New ${currencyName} balance: ${Number(staffNewBalance).toLocaleString()}`;

    await query(`UPDATE staff SET last_paid_at=$1, next_pay_due_at=$2 WHERE user_id=$3`, [now, nextDue, user.id]);
    await query(
      `INSERT INTO staff_payments (user_id, guild_id, amount, currency, paid_at, approved_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [user.id, interaction.guildId, staffAmount, currencyName, now, interaction.user.id]
    );

    embed.addFields({
      name: `${e('payday')} Staff Pay`,
      value: `Amount: **${staffAmount} ${currencyName}**${newBalanceNote}\nNext Due: ${tsF(nextDue)}`,
      inline: true,
    });
    receiptLines.push(`${e('payday')} **Staff Pay:** ${staffAmount} ${currencyName}`);
  }

  if (boosterRes.rows.length && !notYetDueBooster) {
    const b = boosterRes.rows[0];
    const boosterAmount = amount || b.amount_owed;

    let newBalanceNote = '';
    const boosterNewBalance = await adjustGuildBalance(interaction.guildId, user.id, user.username, boosterAmount);
    if (boosterNewBalance !== null) newBalanceNote = ` | New ${currencyName} balance: ${Number(boosterNewBalance).toLocaleString()}`;

    await query(`UPDATE boosters SET last_paid_at=$1, next_pay_due_at=$2, currency=$3 WHERE guild_id=$4 AND user_id=$5`, [now, nextDue, currencyName, interaction.guildId, user.id]);
    await query(
      `INSERT INTO booster_payments (user_id, guild_id, amount, currency, paid_at, approved_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [user.id, interaction.guildId, boosterAmount, currencyName, now, interaction.user.id]
    );

    embed.addFields({
      name: `${e('payday')} Booster Pay`,
      value: `Amount: **${boosterAmount} ${currencyName}**${newBalanceNote}\nNext Due: ${tsF(nextDue)}`,
      inline: true,
    });
    receiptLines.push(`${e('payday')} **Booster Pay:** ${boosterAmount} ${currencyName}`);
  }

  embed.addFields({ name: '✍️ Approved by', value: `<@${interaction.user.id}>`, inline: false });
  if (skippedNotes.length) {
    embed.addFields({ name: `${e('atention')} Skipped`, value: skippedNotes.join('\n'), inline: false });
  }

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
  const type = interaction.options.getString('type') || 'both';
  await interaction.deferReply({ ephemeral: true });

  const revokedLines = [];

  if (type === 'both' || type === 'staff') {
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

      let clawbackNote = '';
      if (last.amount) {
        const newBalance = await adjustGuildBalance(interaction.guildId, user.id, user.username, -last.amount);
        if (newBalance !== null) clawbackNote = ` | ${last.amount} ${last.currency} clawed back — new balance: ${Number(newBalance).toLocaleString()}`;
      }

      revokedLines.push(`${e('payday')} **Staff payment reversed:** ${last.amount} ${last.currency} (paid ${tsF(last.paid_at)})${clawbackNote}`);
    } else {
      const staffNow = await query('SELECT * FROM staff WHERE user_id=$1 AND active=true', [user.id]);
      if (staffNow.rows.length && staffNow.rows[0].last_paid_at) {
        await query(`UPDATE staff SET last_paid_at=NULL, next_pay_due_at=NULL WHERE user_id=$1`, [user.id]);
        revokedLines.push(`${e('payday')} **Staff paid-status cleared** (no payment history existed to roll back to or claw back from).`);
      }
    }
  }

  if (type === 'both' || type === 'booster') {
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

      let clawbackNote = '';
      if (last.amount) {
        const newBalance = await adjustGuildBalance(interaction.guildId, user.id, user.username, -last.amount);
        if (newBalance !== null) clawbackNote = ` | ${last.amount} ${last.currency} clawed back — new balance: ${Number(newBalance).toLocaleString()}`;
      }

      revokedLines.push(`${e('payday')} **Booster payment reversed:** ${last.amount} ${last.currency} (paid ${tsF(last.paid_at)})${clawbackNote}`);
    } else {
      const boosterNow = await query('SELECT * FROM boosters WHERE guild_id=$1 AND user_id=$2 AND active=true', [interaction.guildId, user.id]);
      if (boosterNow.rows.length && boosterNow.rows[0].last_paid_at) {
        await query(`UPDATE boosters SET last_paid_at=NULL, next_pay_due_at=NULL WHERE guild_id=$1 AND user_id=$2`, [interaction.guildId, user.id]);
        revokedLines.push(`${e('payday')} **Booster paid-status cleared** (no payment history existed to roll back to or claw back from).`);
      }
    }
  }

  if (!revokedLines.length) {
    return interaction.editReply({ content: `${e('wrong')} No recorded payments found for <@${user.id}> to revoke${type !== 'both' ? ` (${type})` : ''}.` });
  }

  const embed = baseEmbed(`${e('checkmark')} Payment Revoked`, COLORS.softred, interaction.guild?.name)
    .addFields(
      { name: `${e('members')} Member`, value: `<@${user.id}>`, inline: false },
      { name: `${e('receipt')} Reversed`, value: revokedLines.join('\n'), inline: false },
      { name: '✍️ Revoked by', value: `<@${interaction.user.id}>`, inline: false },
    );

  await interaction.editReply({ embeds: [embed] });
}
