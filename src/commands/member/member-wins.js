const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('member-wins')
    .setDescription("View a member's win history")
    .addUserOption(o => o.setName('user').setDescription('Member to look up').setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    await interaction.deferReply();

    const res = await query(
      `SELECT * FROM member_wins WHERE guild_id=$1 AND user_id=$2 ORDER BY won_at DESC LIMIT 25`,
      [interaction.guildId, user.id]
    );

    if (!res.rows.length) return interaction.editReply({ content: `No wins found for <@${user.id}>.` });

    const totalWins    = res.rows.length;
    const paidCount    = res.rows.filter(w => w.payout_status === 'paid').length;
    const pendingCount = res.rows.filter(w => w.payout_status === 'pending').length;

    const embed = baseEmbed(`${e('trophies')} Win History — ${user.username}`, COLORS.tbppurple, interaction.guild?.name)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: `${e('trophies')} Total Wins`, value: `${totalWins}`, inline: true },
        { name: `${e('payout')} Paid`,         value: `${paidCount}`, inline: true },
        { name: `${e('Loading')} Pending`,      value: `${pendingCount}`, inline: true },
        { name: `${e('raffle')} Raffles`,       value: `${res.rows.filter(w => w.type === 'raffle').length}`, inline: true },
        { name: `${e('gift')} Giveaways`,       value: `${res.rows.filter(w => w.type === 'giveaway').length}`, inline: true },
        { name: `${e('controller')} Games`,     value: `${res.rows.filter(w => w.type === 'game').length}`, inline: true },
      );

    const recent = res.rows.slice(0, 10);
    const lines = recent.map(w => {
      const payIcon  = w.payout_status === 'paid' ? e('checkmark') : w.payout_status === 'late' ? e('atention') : e('Loading');
      const typeIcon = w.type === 'raffle' ? e('raffle') : w.type === 'giveaway' ? e('gift') : e('controller');
      return `${typeIcon} **${w.prize}**${w.prize_amount ? ` (${w.prize_amount} ${w.currency})` : ''} — ${tsF(w.won_at)} ${payIcon}`;
    });

    embed.addFields({ name: `${e('recent')} Recent Wins`, value: lines.join('\n') || 'None' });
    await interaction.editReply({ embeds: [embed] });
  },
};
