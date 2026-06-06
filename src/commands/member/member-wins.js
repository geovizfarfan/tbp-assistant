const { SlashCommandBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('member-wins')
    .setDescription('View a member\'s win history')
    .addUserOption(o => o.setName('user').setDescription('Member to look up').setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    await interaction.deferReply();

    const res = await query(
      `SELECT * FROM member_wins WHERE guild_id=$1 AND user_id=$2 ORDER BY won_at DESC LIMIT 25`,
      [interaction.guildId, user.id]
    );

    if (!res.rows.length) {
      return interaction.editReply({ content: `📭 No wins found for <@${user.id}>.` });
    }

    const totalWins = res.rows.length;
    const paidCount = res.rows.filter(w => w.payout_status === 'paid').length;
    const pendingCount = res.rows.filter(w => w.payout_status === 'pending').length;

    const embed = baseEmbed(`🏆 Win History — ${user.username}`, COLORS.gold)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: '🏆 Total Wins',   value: `${totalWins}`, inline: true },
        { name: '✅ Paid',          value: `${paidCount}`, inline: true },
        { name: '⏳ Pending',       value: `${pendingCount}`, inline: true },
      );

    // Group by type
    const raffleWins   = res.rows.filter(w => w.type === 'raffle');
    const giveawayWins = res.rows.filter(w => w.type === 'giveaway');
    const gameWins     = res.rows.filter(w => w.type === 'game');

    if (raffleWins.length) embed.addFields({ name: `🎟️ Raffles (${raffleWins.length})`, value: 'See below' });
    if (giveawayWins.length) embed.addFields({ name: `🎁 Giveaways (${giveawayWins.length})`, value: 'See below' });
    if (gameWins.length) embed.addFields({ name: `🎮 Games (${gameWins.length})`, value: 'See below' });

    // Detailed entries (last 10)
    const recent = res.rows.slice(0, 10);
    const lines = recent.map(w => {
      const payIcon = w.payout_status === 'paid' ? '✅' : w.payout_status === 'late' ? '🚨' : '⏳';
      const typeIcon = w.type === 'raffle' ? '🎟️' : w.type === 'giveaway' ? '🎁' : '🎮';
      return `${typeIcon} **${w.prize}** ${w.prize_amount ? `(${w.prize_amount} ${w.currency})` : ''} — ${tsF(w.won_at)} ${payIcon}`;
    });

    embed.addFields({ name: '📜 Recent Wins', value: lines.join('\n') || 'None' });

    await interaction.editReply({ embeds: [embed] });
  },
};
