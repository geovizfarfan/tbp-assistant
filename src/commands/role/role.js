const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { e } = require('../../utils/appEmojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Season role achievements')
    .addSubcommand(sub => sub
      .setName('achievements')
      .setDescription('Set or clear the channel where "collected all roles" announcements post (admin only)')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for achievement announcements (leave empty to clear)')))
    .addSubcommand(sub => sub
      .setName('progress')
      .setDescription('See which season roles you have and which you\'re missing')
      .addStringOption(o => o.setName('season').setDescription('Check one specific season (leave blank for all active seasons)').setAutocomplete(true))
      .addUserOption(o => o.setName('user').setDescription('Check someone else instead of yourself (staff)'))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const res = await query(
      `SELECT name FROM rr_seasons WHERE guild_id = $1 AND status = 'active' AND name ILIKE $2 ORDER BY started_at DESC LIMIT 25`,
      [interaction.guild.id, `%${focused}%`]
    );
    await interaction.respond(res.rows.map(r => ({ name: r.name, value: r.name })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'achievements') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID) {
        return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.options.getChannel('channel');
      await query(`
        INSERT INTO rr_guild_config (guild_id, achievement_log_channel_id)
        VALUES ($1, $2)
        ON CONFLICT (guild_id) DO UPDATE SET achievement_log_channel_id = EXCLUDED.achievement_log_channel_id
      `, [interaction.guild.id, channel?.id || null]);

      return interaction.editReply(channel
        ? `<:rumble:1522372419338375299> **Achievement** announcements will post in <#${channel.id}>.`
        : '**Achievement** log channel cleared.');
    }

    if (sub === 'progress') {
      await interaction.deferReply();

      const targetUser = interaction.options.getUser('user') || interaction.user;
      const seasonName = interaction.options.getString('season');
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!member) return interaction.editReply(`${e('wrong')} Couldn't find that member in this server.`);

      const seasonsRes = seasonName
        ? await query('SELECT * FROM rr_seasons WHERE guild_id=$1 AND name=$2 AND status=$3', [interaction.guild.id, seasonName, 'active'])
        : await query('SELECT * FROM rr_seasons WHERE guild_id=$1 AND status=$2 ORDER BY started_at ASC', [interaction.guild.id, 'active']);

      if (!seasonsRes.rows.length) {
        return interaction.editReply(seasonName
          ? `${e('wrong')} No active season named **${seasonName}**.`
          : `${e('wrong')} No active seasons right now.`);
      }

      const embed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle(`${e('trophies')} ${targetUser.username}'s Season Progress`)
        .setFooter({ text: interaction.guild.name });

      for (const season of seasonsRes.rows) {
        const chRes = await query(
          `SELECT sc.channel_id, rc.winner_role_id, 'Rumble Royale' AS source_label
           FROM rr_season_channels sc JOIN rr_channel_config rc ON rc.channel_id = sc.channel_id
           WHERE sc.season_id = $1 AND sc.source = 'rr' AND rc.winner_role_id IS NOT NULL
           UNION ALL
           SELECT sc.channel_id, rs.winner_role_id, 'Rumble Slaughter' AS source_label
           FROM rr_season_channels sc JOIN rumble_slaughter_config rs ON rs.channel_id = sc.channel_id
           WHERE sc.season_id = $1 AND sc.source = 'rs' AND rs.winner_role_id IS NOT NULL`,
          [season.id]
        );

        if (!chRes.rows.length) {
          embed.addFields({ name: season.name, value: 'No roles configured yet.', inline: false });
          continue;
        }

        const lines = chRes.rows.map(r => {
          const has = member.roles.cache.has(r.winner_role_id);
          return `${has ? e('checkmark') : e('wrong')} <@&${r.winner_role_id}> *(${r.source_label})*`;
        });
        const haveCount = chRes.rows.filter(r => member.roles.cache.has(r.winner_role_id)).length;

        embed.addFields({
          name: `${season.name} — ${haveCount}/${chRes.rows.length}`,
          value: lines.join('\n'),
          inline: false,
        });
      }

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
