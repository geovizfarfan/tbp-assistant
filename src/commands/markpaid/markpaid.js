const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');
const { e } = require('../../utils/appEmojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mark-paid')
    .setDescription('Mark a staff member or booster as paid (auto-detects which)')
    .addUserOption(o => o.setName('user').setDescription('Staff member or booster').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount paid (leave blank to use their default)').setRequired(false)),

  async execute(interaction) {
    const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || (!member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID)) {
      return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
    }

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

    const embed = baseEmbed(`${e('checkmark')} Payment Recorded`, COLORS.softgreen, interaction.guild?.name)
      .addFields({ name: `${e('members')} Paid`, value: `<@${user.id}>`, inline: false });

    if (staffRes.rows.length) {
      const s = staffRes.rows[0];
      const currency = s.pay_currency || 'MEE6';

      // If no amount was given, compute what they're actually owed —
      // same formula /admin pay-summary uses: base pay + games this period × bonus.
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
        [user.id, interaction.guildId, staffAmount, currency, now, interaction.user.id]
      );

      embed.addFields({
        name: `${e('payday')} Staff Pay`,
        value: `Amount: **${staffAmount} ${currency}**\nNext Due: ${tsF(nextDue)}`,
        inline: true,
      });

      // DM receipt — best effort, don't block on closed DMs
      const dmMember = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (dmMember) {
        await dmMember.send({
          embeds: [baseEmbed(`${e('payday')} Payment Receipt`, COLORS.softgreen, interaction.guild?.name)
            .addFields(
              { name: `${e('payday')} Amount`,     value: `${staffAmount} ${currency}`, inline: true },
              { name: `${e('RojasClock')} Paid At`, value: tsF(now), inline: true },
              { name: `${e('calender')} Next Due`,  value: tsF(nextDue), inline: true },
              { name: '✍️ Approved by',             value: `<@${interaction.user.id}>`, inline: true },
            )]
        }).catch(() => {});
      }
    }

    if (boosterRes.rows.length) {
      const b = boosterRes.rows[0];
      await query(`UPDATE boosters SET last_paid_at=$1, next_pay_due_at=$2 WHERE guild_id=$3 AND user_id=$4`, [now, nextDue, interaction.guildId, user.id]);

      embed.addFields({
        name: `${e('payday')} Booster Pay`,
        value: `Amount: **${amount || b.amount_owed} ${b.currency}**\nNext Due: ${tsF(nextDue)}`,
        inline: true,
      });
    }

    embed.addFields({ name: '✍️ Approved by', value: `<@${interaction.user.id}>`, inline: false });

    await interaction.editReply({ embeds: [embed] });
  },
};
