const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');

async function getActiveSeason(guildId) {
  const res = await query('SELECT * FROM rr_seasons WHERE guild_id = $1 AND status = $2', [guildId, 'active']);
  return res.rows[0] || null;
}

async function getLogChannel(client, guildId) {
  const res = await query('SELECT log_channel_id FROM rr_guild_config WHERE guild_id = $1', [guildId]);
  const id = res.rows[0]?.log_channel_id;
  return id ? client.channels.cache.get(id) : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rrseason')
    .setDescription('Manage Rumble Royale seasons')
    .addSubcommand(sub => sub
      .setName('start')
      .setDescription('Start a new RR season')
      .addStringOption(o => o.setName('name').setDescription('Season name').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a channel to the active season')
      .addChannelOption(o => o.setName('channel').setDescription('RR channel to include').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a channel from the active season')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to remove').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('end')
      .setDescription('End the active season and remove all winner roles'))
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('View current season info and completions')),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const sub = interaction.options.getSubcommand();

    // ── Start ──────────────────────────────────────────────────────────────
    if (sub === 'start') {
      const name = interaction.options.getString('name');
      const existing = await getActiveSeason(interaction.guild.id);
      if (existing) {
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#ff4444')
          .setDescription(`❌ There's already an active season: **${existing.name}**. End it first with \`/rrseason end\`.`)]
        });
      }

      await query(
        'INSERT INTO rr_seasons (guild_id, name, status) VALUES ($1, $2, $3)',
        [interaction.guild.id, name, 'active']
      );

      const logCh = await getLogChannel(interaction.client, interaction.guild.id);
      const embed = new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('<:rumble:1522372419338375299> New Season Started!')
        .setDescription(`**${name}** has begun!\nUse \`/rrseason add\` to add channels to this season.`)
        .setTimestamp().setFooter({ text: interaction.guild.name });
      if (logCh) await logCh.send({ embeds: [embed] }).catch(() => {});
      return interaction.editReply({ embeds: [embed] });
    }

    // ── Add channel ────────────────────────────────────────────────────────
    if (sub === 'add') {
      const channel = interaction.options.getChannel('channel');
      const season = await getActiveSeason(interaction.guild.id);
      if (!season) return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#ff4444')
        .setDescription('❌ No active season. Start one with `/rrseason start`.')]});

      // Check channel has role+reaction configured
      const cfg = await query(
        'SELECT winner_role_id, reaction_emoji FROM rr_channel_config WHERE channel_id = $1 AND winner_role_id IS NOT NULL AND reaction_emoji IS NOT NULL',
        [channel.id]
      );
      if (!cfg.rows.length) {
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#ff4444')
          .setDescription(`❌ <#${channel.id}> doesn't have both a winner role AND reaction emoji configured. Run \`/rrsetup\` first.`)]});
      }

      await query(
        'INSERT INTO rr_season_channels (season_id, channel_id, guild_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [season.id, channel.id, interaction.guild.id]
      );

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setDescription(`<a:trophies:1512912823062364281> <#${channel.id}> added to season **${season.name}**!`)]});
    }

    // ── Remove channel ─────────────────────────────────────────────────────
    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel');
      const season = await getActiveSeason(interaction.guild.id);
      if (!season) return interaction.editReply('❌ No active season.');

      await query('DELETE FROM rr_season_channels WHERE season_id = $1 AND channel_id = $2', [season.id, channel.id]);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setDescription(`<#${channel.id}> removed from season **${season.name}**.`)]});
    }

    // ── End season ─────────────────────────────────────────────────────────
    if (sub === 'end') {
      const season = await getActiveSeason(interaction.guild.id);
      if (!season) return interaction.editReply('❌ No active season to end.');

      // Get all winner roles from season channels
      const chRes = await query(
        `SELECT rc.winner_role_id FROM rr_season_channels sc
         JOIN rr_channel_config rc ON rc.channel_id = sc.channel_id
         WHERE sc.season_id = $1 AND rc.winner_role_id IS NOT NULL`,
        [season.id]
      );

      const roleIds = [...new Set(chRes.rows.map(r => r.winner_role_id))];

      // Remove all winner roles from all members
      let removedCount = 0;
      if (roleIds.length) {
        const members = await interaction.guild.members.fetch().catch(() => null);
        if (members) {
          for (const [, member] of members) {
            for (const roleId of roleIds) {
              if (member.roles.cache.has(roleId)) {
                await member.roles.remove(roleId).catch(() => {});
                removedCount++;
              }
            }
          }
        }
      }

      // Mark season as ended
      await query('UPDATE rr_seasons SET status = $1, ended_at = NOW() WHERE id = $2', ['ended', season.id]);

      // Reset achievements for this guild
      await query('DELETE FROM rr_achievements WHERE guild_id = $1', [interaction.guild.id]);

      const embed = new EmbedBuilder().setColor('#5b209a')
        .setTitle('<:rumble:1522372419338375299> Season Ended!')
        .setDescription(`**${season.name}** has ended.\n\n<:member:1512912827424309278> **${removedCount}** winner role(s) removed from members.\n<a:again:1522458630795034694> Achievements reset — ready for a new season!`)
        .setTimestamp().setFooter({ text: interaction.guild.name });

      const logCh = await getLogChannel(interaction.client, interaction.guild.id);
      if (logCh) await logCh.send({ embeds: [embed] }).catch(() => {});
      return interaction.editReply({ embeds: [embed] });
    }

    // ── Info ───────────────────────────────────────────────────────────────
    if (sub === 'info') {
      const season = await getActiveSeason(interaction.guild.id);
      if (!season) return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setDescription('No active season. Start one with `/rrseason start`.')]});

      const chRes = await query(
        `SELECT sc.channel_id, rc.winner_role_id, rc.reaction_emoji
         FROM rr_season_channels sc
         JOIN rr_channel_config rc ON rc.channel_id = sc.channel_id
         WHERE sc.season_id = $1`,
        [season.id]
      );

      const achRes = await query(
        'SELECT user_id, completions FROM rr_achievements WHERE guild_id = $1 ORDER BY completions DESC LIMIT 10',
        [interaction.guild.id]
      );

      const channelLines = chRes.rows.length
        ? chRes.rows.map(r => `<#${r.channel_id}> — <@&${r.winner_role_id}> ${r.reaction_emoji || ''}`).join('\n')
        : 'No channels added yet.';

      const achieveLines = achRes.rows.length
        ? achRes.rows.map((r, i) => `**${i+1}.** <@${r.user_id}> — ${r.completions}x`).join('\n')
        : 'No completions yet.';

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle(`<:rumble:1522372419338375299> Season: ${season.name}`)
        .addFields(
          { name: `Channels (${chRes.rows.length})`, value: channelLines, inline: false },
          { name: '<a:trophies:1512912823062364281> Completions', value: achieveLines, inline: false },
        )
        .setTimestamp().setFooter({ text: interaction.guild.name })]});
    }
  },
};
