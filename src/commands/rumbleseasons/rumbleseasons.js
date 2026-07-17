const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');

async function getLogChannel(client, guildId, type = 'admin') {
  const col = type === 'achievement' ? 'achievement_log_channel_id' : 'log_channel_id';
  const res = await query(`SELECT ${col} FROM rr_guild_config WHERE guild_id = $1`, [guildId]);
  const id = res.rows[0]?.[col];
  return id ? (await client.channels.fetch(id).catch(() => null)) : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rumble')
    .setDescription('Manage Rumble Royale seasons')
    .addSubcommandGroup(group => group
      .setName('season')
      .setDescription('Run multiple concurrent RR seasons, each with their own roles and completions')
      .addSubcommand(sub => sub
        .setName('start')
        .setDescription('Start a new season — doesn\'t require ending any other active season')
        .addStringOption(o => o.setName('name').setDescription('Season name').setRequired(true))
        .addStringOption(o => o.setName('wheel_campaign').setDescription('Wheel Roles campaign to auto-enter members into when they complete this season').setAutocomplete(true)))
      .addSubcommand(sub => sub
        .setName('link')
        .setDescription('Link (or unlink) a season to a Wheel Roles campaign')
        .addStringOption(o => o.setName('season').setDescription('Season name').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('wheel_campaign').setDescription('Campaign name (leave blank to unlink)').setAutocomplete(true)))
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Add a channel to a season')
        .addStringOption(o => o.setName('season').setDescription('Season name').setRequired(true).setAutocomplete(true))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to add').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Remove a channel from a season')
        .addStringOption(o => o.setName('season').setDescription('Season name').setRequired(true).setAutocomplete(true))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to remove').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('end')
        .setDescription('End a season and remove all its winner roles')
        .addStringOption(o => o.setName('season').setDescription('Season name').setRequired(true).setAutocomplete(true)))
      .addSubcommand(sub => sub
        .setName('info')
        .setDescription('View a season\'s channels and completions')
        .addStringOption(o => o.setName('season').setDescription('Season name (blank = list all active seasons)').setAutocomplete(true)))
      .addSubcommand(sub => sub
        .setName('list')
        .setDescription('List every active season'))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'wheel_campaign') {
      const res = await query(
        `SELECT name FROM wheel_role_campaigns WHERE guild_id = $1 AND status = 'active' AND name ILIKE $2 ORDER BY created_at DESC LIMIT 25`,
        [interaction.guild.id, `%${focused.value}%`]
      );
      return interaction.respond(res.rows.map(r => ({ name: r.name, value: r.name })));
    }
    const res = await query(
      `SELECT name FROM rr_seasons WHERE guild_id = $1 AND status = 'active' AND name ILIKE $2 ORDER BY started_at DESC LIMIT 25`,
      [interaction.guild.id, `%${focused.value}%`]
    );
    await interaction.respond(res.rows.map(r => ({ name: r.name, value: r.name })));
  },

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    if (sub === 'start') {
      const name = interaction.options.getString('name');
      const wheelCampaignName = interaction.options.getString('wheel_campaign');

      const existing = await query('SELECT id FROM rr_seasons WHERE guild_id=$1 AND name=$2 AND status=$3', [interaction.guild.id, name, 'active']);
      if (existing.rows.length) {
        return interaction.editReply(`❌ A season named **${name}** is already active. Pick a different name, or end it first.`);
      }

      let wheelCampaignId = null;
      if (wheelCampaignName) {
        const campRes = await query(`SELECT id FROM wheel_role_campaigns WHERE guild_id=$1 AND name=$2 AND status='active'`, [interaction.guild.id, wheelCampaignName]);
        if (!campRes.rows.length) return interaction.editReply(`❌ No active Wheel Roles campaign named **${wheelCampaignName}**. Create one first with \`/wheel roles create\`, or leave this blank.`);
        wheelCampaignId = campRes.rows[0].id;
      }

      const insertRes = await query('INSERT INTO rr_seasons (guild_id, name, status, linked_wheel_campaign_id) VALUES ($1, $2, $3, $4) RETURNING id', [interaction.guild.id, name, 'active', wheelCampaignId]);

      const adminLog = await getLogChannel(interaction.client, interaction.guild.id, 'admin');
      const embed = new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('<:rumble:1522372419338375299> New Season Started!')
        .setDescription(`**${name}** has begun! Use \`/rumble season add season:"${name}"\` to add channels.\n\nOther active seasons keep running independently — this doesn't affect them.${wheelCampaignName ? `\n\n🎡 Completing this season will auto-enter members into Wheel Roles campaign **${wheelCampaignName}**.` : ''}`)
        .setTimestamp().setFooter({ text: interaction.guild.name });
      if (adminLog) await adminLog.send({ embeds: [embed] }).catch(() => {});
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'link') {
      const seasonName = interaction.options.getString('season');
      const wheelCampaignName = interaction.options.getString('wheel_campaign');

      const seasonRes = await query('SELECT * FROM rr_seasons WHERE guild_id=$1 AND name=$2 AND status=$3', [interaction.guild.id, seasonName, 'active']);
      const season = seasonRes.rows[0];
      if (!season) return interaction.editReply(`❌ No active season named **${seasonName}**.`);

      if (!wheelCampaignName) {
        await query('UPDATE rr_seasons SET linked_wheel_campaign_id = NULL WHERE id = $1', [season.id]);
        return interaction.editReply(`✅ **${seasonName}** is no longer linked to a Wheel Roles campaign.`);
      }

      const campRes = await query(`SELECT id FROM wheel_role_campaigns WHERE guild_id=$1 AND name=$2 AND status='active'`, [interaction.guild.id, wheelCampaignName]);
      if (!campRes.rows.length) return interaction.editReply(`❌ No active Wheel Roles campaign named **${wheelCampaignName}**.`);

      await query('UPDATE rr_seasons SET linked_wheel_campaign_id = $1 WHERE id = $2', [campRes.rows[0].id, season.id]);
      return interaction.editReply(`✅ **${seasonName}** now auto-enters members into Wheel Roles campaign **${wheelCampaignName}** when they complete it.`);
    }

    if (sub === 'add') {
      const seasonName = interaction.options.getString('season');
      const channel = interaction.options.getChannel('channel');

      const seasonRes = await query('SELECT * FROM rr_seasons WHERE guild_id=$1 AND name=$2 AND status=$3', [interaction.guild.id, seasonName, 'active']);
      const season = seasonRes.rows[0];
      if (!season) return interaction.editReply(`❌ No active season named **${seasonName}**.`);

      const cfg = await query(
        'SELECT winner_role_id, reaction_emoji FROM rr_channel_config WHERE channel_id = $1 AND winner_role_id IS NOT NULL',
        [channel.id]
      );
      if (!cfg.rows.length) return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#ff4444')
        .setDescription(`❌ <#${channel.id}> needs a winner role configured. Run \`/rr setup\` first.`)]});

      await query('INSERT INTO rr_season_channels (season_id, channel_id, guild_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [season.id, channel.id, interaction.guild.id]);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setDescription(`<a:trophies:1512912823062364281> <#${channel.id}> added to season **${season.name}**!`)]});
    }

    if (sub === 'remove') {
      const seasonName = interaction.options.getString('season');
      const channel = interaction.options.getChannel('channel');

      const seasonRes = await query('SELECT * FROM rr_seasons WHERE guild_id=$1 AND name=$2 AND status=$3', [interaction.guild.id, seasonName, 'active']);
      const season = seasonRes.rows[0];
      if (!season) return interaction.editReply(`❌ No active season named **${seasonName}**.`);

      await query('DELETE FROM rr_season_channels WHERE season_id = $1 AND channel_id = $2', [season.id, channel.id]);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setDescription(`<#${channel.id}> removed from season **${season.name}**.`)]});
    }

    if (sub === 'end') {
      const seasonName = interaction.options.getString('season');

      const seasonRes = await query('SELECT * FROM rr_seasons WHERE guild_id=$1 AND name=$2 AND status=$3', [interaction.guild.id, seasonName, 'active']);
      const season = seasonRes.rows[0];
      if (!season) return interaction.editReply(`❌ No active season named **${seasonName}**.`);

      const chRes = await query(
        `SELECT rc.winner_role_id FROM rr_season_channels sc
         JOIN rr_channel_config rc ON rc.channel_id = sc.channel_id
         WHERE sc.season_id = $1 AND rc.winner_role_id IS NOT NULL`, [season.id]
      );
      const roleIds = [...new Set(chRes.rows.map(r => r.winner_role_id))];
      let removed = 0;
      if (roleIds.length) {
        const members = await interaction.guild.members.fetch().catch(() => null);
        if (members) {
          for (const [, member] of members) {
            for (const roleId of roleIds) {
              if (member.roles.cache.has(roleId)) {
                await member.roles.remove(roleId).catch(() => {});
                removed++;
              }
            }
          }
        }
      }

      await query('UPDATE rr_seasons SET status = $1, ended_at = NOW() WHERE id = $2', ['ended', season.id]);
      await query('DELETE FROM rr_achievements WHERE season_id = $1', [season.id]);

      const embed = new EmbedBuilder().setColor('#5b209a')
        .setTitle('<:rumble:1522372419338375299> Season Ended!')
        .setDescription(`**${season.name}** ended.\n<:member:1512912827424309278> **${removed}** roles removed.\n<a:again:1522458630795034694> This season's achievements reset — other active seasons are unaffected.`)
        .setTimestamp().setFooter({ text: interaction.guild.name });

      const adminLog = await getLogChannel(interaction.client, interaction.guild.id, 'admin');
      if (adminLog) await adminLog.send({ embeds: [embed] }).catch(() => {});
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'list') {
      const res = await query(
        `SELECT s.*, COUNT(DISTINCT sc.channel_id) AS channel_count
         FROM rr_seasons s LEFT JOIN rr_season_channels sc ON sc.season_id = s.id
         WHERE s.guild_id = $1 AND s.status = 'active'
         GROUP BY s.id ORDER BY s.started_at ASC`,
        [interaction.guild.id]
      );
      if (!res.rows.length) return interaction.editReply('No active seasons. Start one with `/rumble season start`.');

      const lines = res.rows.map(s => `**${s.name}** — ${s.channel_count} channel(s) — started <t:${Math.floor(new Date(s.started_at).getTime()/1000)}:R>`).join('\n');
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('<:rumble:1522372419338375299> Active Seasons')
        .setDescription(lines).setFooter({ text: interaction.guild.name })]});
    }

    if (sub === 'info') {
      const seasonName = interaction.options.getString('season');

      if (!seasonName) {
        // No season specified — same as list
        const res = await query(
          `SELECT s.*, COUNT(DISTINCT sc.channel_id) AS channel_count
           FROM rr_seasons s LEFT JOIN rr_season_channels sc ON sc.season_id = s.id
           WHERE s.guild_id = $1 AND s.status = 'active'
           GROUP BY s.id ORDER BY s.started_at ASC`,
          [interaction.guild.id]
        );
        if (!res.rows.length) return interaction.editReply('No active seasons. Start one with `/rumble season start`.');
        const lines = res.rows.map(s => `**${s.name}** — ${s.channel_count} channel(s)`).join('\n');
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
          .setTitle('<:rumble:1522372419338375299> Active Seasons')
          .setDescription(lines + '\n\nUse `/rumble season info season:"..."` for details on one.')]});
      }

      const seasonRes = await query('SELECT * FROM rr_seasons WHERE guild_id=$1 AND name=$2 AND status=$3', [interaction.guild.id, seasonName, 'active']);
      const season = seasonRes.rows[0];
      if (!season) return interaction.editReply(`❌ No active season named **${seasonName}**.`);

      const chRes = await query(
        `SELECT sc.channel_id, rc.winner_role_id, rc.reaction_emoji
         FROM rr_season_channels sc JOIN rr_channel_config rc ON rc.channel_id = sc.channel_id
         WHERE sc.season_id = $1`, [season.id]
      );
      const achRes = await query(
        'SELECT user_id, completions FROM rr_achievements WHERE season_id = $1 ORDER BY completions DESC LIMIT 10',
        [season.id]
      );

      const channelLines = chRes.rows.length
        ? chRes.rows.map(r => `<#${r.channel_id}> — <@&${r.winner_role_id}> ${r.reaction_emoji || ''}`).join('\n')
        : 'No channels added yet.';
      const achieveLines = achRes.rows.length
        ? achRes.rows.map((r, i) => `**${i+1}.** <@${r.user_id}> — ${r.completions} completion(s)`).join('\n')
        : 'No completions yet.';

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle(`<:rumble:1522372419338375299> Season: ${season.name}`)
        .addFields(
          { name: 'Channels', value: channelLines, inline: false },
          { name: 'Top Completions', value: achieveLines, inline: false },
        )
        .setFooter({ text: interaction.guild.name })]});
    }
  },
};
