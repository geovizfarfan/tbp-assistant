const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rrstats')
    .setDescription('Rumble Royale leaderboard and stats')
    .addUserOption(o => o.setName('user').setDescription('View a specific user\'s stats')),

  async execute(interaction) {
    await interaction.deferReply();
    const user = interaction.options.getUser('user');

    if (user) {
      const res = await query(
        'SELECT * FROM rr_stats WHERE guild_id = $1 AND user_id = $2',
        [interaction.guild.id, user.id]
      );
      const row = res.rows[0];
      if (!row) return interaction.editReply(`❌ No Rumble Royale stats found for ${user.username}.`);
      return interaction.editReply({ embeds: [
        new EmbedBuilder().setColor('#9B2DF0')
          .setTitle(`🏆 ${user.username}'s RR Stats`)
          .addFields(
            { name: 'Wins',     value: `**${row.wins}**`,   inline: true },
            { name: 'Losses',   value: `**${row.losses}**`, inline: true },
            { name: 'Games',    value: `**${row.games}**`,  inline: true },
            { name: 'Win Rate', value: `**${row.games > 0 ? Math.round((row.wins / row.games) * 100) : 0}%**`, inline: true },
          )
      ]});
    }

    const res = await query(
      'SELECT * FROM rr_stats WHERE guild_id = $1 ORDER BY wins DESC LIMIT 10',
      [interaction.guild.id]
    );
    if (!res.rows.length) return interaction.editReply('No Rumble Royale stats yet for this server.');

    const lines = res.rows.map((r, i) =>
      `**${i + 1}.** ${r.username} — **${r.wins}W** / ${r.losses}L (${r.games} games)`
    ).join('\n');

    return interaction.editReply({ embeds: [
      new EmbedBuilder().setColor('#9B2DF0')
        .setTitle('🏆 Rumble Royale Leaderboard')
        .setDescription(lines)
    ]});
  },
};
