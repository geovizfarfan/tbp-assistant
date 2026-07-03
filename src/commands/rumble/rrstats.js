const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');

// Strip custom emoji tags from usernames
const cleanName = (name) => name?.replace(/<a?:[^:]+:\d+>/g, '').replace(/:[^:]+:/g, '').trim() || 'Unknown';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rrstats')
    .setDescription('Rumble Royale stats — server, channel, or global')
    .addUserOption(o => o.setName('user').setDescription('View a specific user\'s stats'))
    .addChannelOption(o => o.setName('channel').setDescription('Filter leaderboard by a specific RR channel'))
    .addStringOption(o => o.setName('period').setDescription('Time period').addChoices(
      { name: 'All Time', value: 'all' },
      { name: 'This Week', value: 'week' },
      { name: 'This Month', value: 'month' },
    ))
    .addStringOption(o => o.setName('scope').setDescription('Scope of stats').addChoices(
      { name: 'Server', value: 'server' },
      { name: 'Global (all servers)', value: 'global' },
    )),

  async execute(interaction) {
    await interaction.deferReply();

    const user    = interaction.options.getUser('user');
    const channel = interaction.options.getChannel('channel');
    const period  = interaction.options.getString('period') || 'all';
    const scope   = interaction.options.getString('scope') || 'server';

    // ── Single user stats ──────────────────────────────────────────────────
    if (user) {
      // Per-channel breakdown for this server
      const serverRes = await query(
        'SELECT channel_id, wins, games FROM rr_stats WHERE guild_id = $1 AND user_id = $2 ORDER BY wins DESC',
        [interaction.guild.id, user.id]
      );

      // Global totals across all servers
      const globalRes = await query(
        'SELECT SUM(wins) as tw, SUM(games) as tg FROM rr_stats WHERE user_id = $1',
        [user.id]
      );

      // Achievement completions
      const achieveRes = await query(
        'SELECT completions FROM rr_achievements WHERE guild_id = $1 AND user_id = $2',
        [interaction.guild.id, user.id]
      );

      const serverTotal = serverRes.rows.reduce((s, r) => s + Number(r.wins), 0);
      const globalTotal = Number(globalRes.rows[0]?.tw || 0);
      const completions = achieveRes.rows[0]?.completions || 0;

      const channelLines = serverRes.rows.length
        ? await Promise.all(serverRes.rows.map(async r => {
            let chName = `<#${r.channel_id}>`;
            return `${chName} — **${r.wins}W**`;
          }))
        : ['No wins yet'];

      return interaction.editReply({ embeds: [
        new EmbedBuilder()
          .setColor('#d6c2ee')
          .setTitle(`<a:trophies:1512912823062364281> ${user.username}'s RR Stats`)
          .setThumbnail(user.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '<:rumble:1522372419338375299> Server Wins', value: `**${serverTotal}**`, inline: true },
            { name: '<a:rumblesword:1522372420894330921> Global Wins', value: `**${globalTotal}**`, inline: true },
            { name: '<a:trophies:1512912823062364281> Full Sets Collected', value: `**${completions}**`, inline: true },
            { name: 'Wins by Channel', value: channelLines.join('\n') || '—', inline: false },
          )
          .setFooter({ text: interaction.guild.name })
      ]});
    }

    // ── Leaderboard ────────────────────────────────────────────────────────
    let periodFilter = '';
    if (period === 'week')  periodFilter = "AND s.updated_at > NOW() - INTERVAL '7 days'";
    if (period === 'month') periodFilter = "AND s.updated_at > NOW() - INTERVAL '30 days'";

    const periodLabel = period === 'week' ? ' · This Week' : period === 'month' ? ' · This Month' : ' · All Time';

    if (scope === 'global') {
      // Global leaderboard across all servers
      const res = await query(
        `SELECT user_id, username, SUM(wins) as tw, SUM(games) as tg
         FROM rr_stats s WHERE 1=1 ${periodFilter}
         GROUP BY user_id, username ORDER BY tw DESC LIMIT 10`
      );

      if (!res.rows.length) return interaction.editReply('No global Rumble Royale stats yet.');

      const lines = res.rows.map((r, i) =>
        `**${i + 1}.** ${cleanName(r.username)} — **${r.tw}W** (${r.tg} games)`
      ).join('\n');

      return interaction.editReply({ embeds: [
        new EmbedBuilder()
          .setColor('#d6c2ee')
          .setTitle(`<a:trophies:1512912823062364281> Global RR Leaderboard${periodLabel}`)
          .setDescription(lines)
          .setFooter({ text: 'Across all servers tracked by VELOURA' })
      ]});
    }

    // Server leaderboard (optionally filtered by channel)
    const params = [interaction.guild.id];
    let channelFilter = '';
    if (channel) {
      channelFilter = `AND s.channel_id = $${params.length + 1}`;
      params.push(channel.id);
    }

    const res = await query(
      `SELECT user_id, username, SUM(wins) as tw, SUM(games) as tg
       FROM rr_stats s WHERE guild_id = $1 ${channelFilter} ${periodFilter}
       GROUP BY user_id, username ORDER BY tw DESC LIMIT 10`,
      params
    );

    if (!res.rows.length) return interaction.editReply('No Rumble Royale stats yet.');

    const lines = res.rows.map((r, i) =>
      `**${i + 1}.** ${cleanName(r.username)} — **${r.tw}W** (${r.tg} games)`
    ).join('\n');

    const channelLabel = channel ? ` · <#${channel.id}>` : '';

    return interaction.editReply({ embeds: [
      new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle(`<a:trophies:1512912823062364281> RR Leaderboard${periodLabel}${channelLabel}`)
        .setDescription(lines)
        .setFooter({ text: interaction.guild.name })
    ]});
  },
};
