const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');

const cleanName = (name) => name?.replace(/<a?:[^:]+:\d+>/g, '').replace(/:[^:]+:/g, '').trim() || 'Unknown';

async function getActiveSeason(guildId) {
  const res = await query('SELECT * FROM rr_seasons WHERE guild_id = $1 AND status = $2', [guildId, 'active']);
  return res.rows[0] || null;
}

async function getLogChannel(client, guildId, type = 'admin') {
  const col = type === 'achievement' ? 'achievement_log_channel_id' : 'log_channel_id';
  const res = await query(`SELECT ${col} FROM rr_guild_config WHERE guild_id = $1`, [guildId]);
  const id = res.rows[0]?.[col];
  return id ? client.channels.cache.get(id) : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rr')
    .setDescription('Rumble Royale management')

    // ── setup ──────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Configure a Rumble Royale channel (only updates fields you provide)')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to configure').setRequired(true))
      .addIntegerOption(o => o.setName('reward').setDescription('Sins to give winner').setMinValue(1))
      .addRoleOption(o => o.setName('ping_role1').setDescription('Role to ping on battle start'))
      .addRoleOption(o => o.setName('winner_role').setDescription('Role to assign to winner'))
      .addRoleOption(o => o.setName('ping_role2').setDescription('Second ping role'))
      .addRoleOption(o => o.setName('ping_role3').setDescription('Third ping role'))
      .addChannelOption(o => o.setName('next_channel').setDescription('Next battle room'))
      .addAttachmentOption(o => o.setName('image').setDescription('Upload image for battle announcement'))
      .addStringOption(o => o.setName('image_url').setDescription('Or paste image URL'))
      .addStringOption(o => o.setName('embed_color').setDescription('Embed color hex'))
      .addStringOption(o => o.setName('reaction_emoji').setDescription('Emoji to auto-react to winner messages'))
      .addStringOption(o => o.setName('battle_title').setDescription('Custom title for battle announcement'))
      .addStringOption(o => o.setName('description').setDescription('Custom description (use \\n for new lines)')))

    // ── clear ──────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Remove config for a Rumble Royale channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to clear').setRequired(true)))

    // ── log ────────────────────────────────────────────────────────────────
    .addSubcommandGroup(group => group
      .setName('log')
      .setDescription('Manage RR log channels')
      .addSubcommand(sub => sub
        .setName('achievement')
        .setDescription('Set or clear the achievement log channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel for achievement logs (leave empty to clear)')))
      .addSubcommand(sub => sub
        .setName('admin')
        .setDescription('Set or clear the admin/config log channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel for admin logs (leave empty to clear)'))))

    // ── season ─────────────────────────────────────────────────────────────
    .addSubcommandGroup(group => group
      .setName('season')
      .setDescription('Manage RR seasons')
      .addSubcommand(sub => sub
        .setName('start')
        .setDescription('Start a new season')
        .addStringOption(o => o.setName('name').setDescription('Season name').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Add a channel to the active season')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to add').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Remove a channel from the active season')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to remove').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('end')
        .setDescription('End the active season and remove all winner roles'))
      .addSubcommand(sub => sub
        .setName('info')
        .setDescription('View current season info and completions')))

    // ── add (host description/reward) ────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a one-time reward or description to the next battle (staff/mod)')
      .addChannelOption(o => o.setName('channel').setDescription('RR channel').setRequired(true))
      .addStringOption(o => o.setName('other_reward').setDescription('Custom reward (e.g. Sticker, Nitro Basic)'))
      .addStringOption(o => o.setName('description').setDescription('One-time battle description (use \\n for new lines)')))

    // ── stats ──────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('stats')
      .setDescription('Rumble Royale leaderboard and stats')
      .addUserOption(o => o.setName('user').setDescription('View a specific user\'s stats'))
      .addChannelOption(o => o.setName('channel').setDescription('Filter by channel'))
      .addStringOption(o => o.setName('period').setDescription('Time period').addChoices(
        { name: 'All Time', value: 'all' },
        { name: 'This Week', value: 'week' },
        { name: 'This Month', value: 'month' },
      ))
      .addStringOption(o => o.setName('scope').setDescription('Scope').addChoices(
        { name: 'Server', value: 'server' },
        { name: 'Global', value: 'global' },
      ))),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);

    await interaction.deferReply({ ephemeral: true });

    // ── /rr setup ──────────────────────────────────────────────────────────
    if (sub === 'setup') {
      const channel      = interaction.options.getChannel('channel');
      const reward       = interaction.options.getInteger('reward');
      const winnerRole   = interaction.options.getRole('winner_role');
      const pingRole1    = interaction.options.getRole('ping_role1');
      const pingRole2    = interaction.options.getRole('ping_role2');
      const pingRole3    = interaction.options.getRole('ping_role3');
      const nextChannel  = interaction.options.getChannel('next_channel');
      const imageAttach  = interaction.options.getAttachment('image');
      const imageUrl     = imageAttach?.url || interaction.options.getString('image_url');
      const color        = interaction.options.getString('embed_color');
      const reactionEmoji = interaction.options.getString('reaction_emoji');
      const battleTitle  = interaction.options.getString('battle_title');
      const description  = interaction.options.getString('description')?.replace(/\\n/g, '\n');

      // Get existing config to merge
      const existing = await query('SELECT * FROM rr_channel_config WHERE channel_id = $1', [channel.id]);
      const ex = existing.rows[0];

      if (!ex && !reward && !pingRole1) {
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#ff4444')
          .setDescription('❌ First time setup requires at least `reward` and `ping_role1`.')]});
      }

      const newReward      = reward ?? ex?.reward_amount;
      const newWinnerRole  = winnerRole !== null ? winnerRole?.id : ex?.winner_role_id;
      const newPingRole1   = pingRole1 !== null ? pingRole1?.id : ex?.ping_role1_id;
      const newPingRole2   = pingRole2 !== null ? pingRole2?.id : ex?.ping_role2_id;
      const newPingRole3   = pingRole3 !== null ? pingRole3?.id : ex?.ping_role3_id;
      const newNextChannel = nextChannel !== null ? nextChannel?.id : ex?.next_channel_id;
      const newImage       = imageUrl ?? ex?.battle_image;
      const newColor       = color ?? ex?.embed_color ?? '#d6c2ee';
      const newReaction    = reactionEmoji ?? ex?.reaction_emoji;
      const newTitle       = battleTitle ?? ex?.battle_title;
      const newDesc        = description ?? ex?.battle_description;

      await query(`
        INSERT INTO rr_channel_config
          (channel_id, guild_id, winner_role_id, ping_role1_id, ping_role2_id, ping_role3_id,
           next_channel_id, reward_amount, battle_image, embed_color, reaction_emoji,
           battle_title, battle_description, total_games, total_players)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0)
        ON CONFLICT (channel_id) DO UPDATE SET
          winner_role_id     = EXCLUDED.winner_role_id,
          ping_role1_id      = EXCLUDED.ping_role1_id,
          ping_role2_id      = EXCLUDED.ping_role2_id,
          ping_role3_id      = EXCLUDED.ping_role3_id,
          next_channel_id    = EXCLUDED.next_channel_id,
          reward_amount      = EXCLUDED.reward_amount,
          battle_image       = EXCLUDED.battle_image,
          embed_color        = EXCLUDED.embed_color,
          reaction_emoji     = EXCLUDED.reaction_emoji,
          battle_title       = EXCLUDED.battle_title,
          battle_description = EXCLUDED.battle_description
      `, [
        channel.id, interaction.guild.id,
        newWinnerRole || null, newPingRole1 || null, newPingRole2 || null, newPingRole3 || null,
        newNextChannel || null, newReward || null, newImage || null,
        newColor, newReaction || null, newTitle || null, newDesc || null,
      ]);

      const pingList = [newPingRole1, newPingRole2, newPingRole3].filter(Boolean)
        .map(id => `<@&${id}>`).join(', ') || '—';

      const embed = new EmbedBuilder().setColor(newColor)
        .setTitle('<:rumble:1522372419338375299> RR Channel Configured!')
        .setDescription(`<#${channel.id}> — run \`/rr setup\` again anytime to update any field.`)
        .addFields(
          { name: '<a:trophies:1512912823062364281> Winner Role',    value: newWinnerRole ? `<@&${newWinnerRole}>` : '—', inline: true },
          { name: '<a:purplesparkle:1512912828489793626> Ping Roles', value: pingList,                                    inline: true },
          { name: '<a:moneybag:1522373120147849226> Reward',          value: newReward ? `${Number(newReward).toLocaleString()} sins` : '—', inline: true },
          { name: '<a:rumblesword:1522372420894330921> Next Room',    value: newNextChannel ? `<#${newNextChannel}>` : '—', inline: true },
          { name: '✨ Reaction',                                      value: newReaction || '—',                           inline: true },
          { name: '🎨 Color',                                        value: newColor,                                      inline: true },
          { name: '📝 Title',                                        value: newTitle || '—',                               inline: false },
          { name: '📄 Description',                                  value: newDesc ? newDesc.slice(0,100) : '—',          inline: false },
        );

      // Log to admin log channel
      const adminLog = await getLogChannel(interaction.client, interaction.guild.id, 'admin');
      if (adminLog) await adminLog.send({ embeds: [new EmbedBuilder().setColor(newColor)
        .setTitle('<:rumble:1522372419338375299> RR Channel Configured')
        .setDescription(`<#${channel.id}> configured by <@${interaction.user.id}>`)
        .setTimestamp().setFooter({ text: interaction.guild.name })
      ]}).catch(() => {});

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /rr clear ──────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const channel = interaction.options.getChannel('channel');
      const res = await query('DELETE FROM rr_channel_config WHERE channel_id = $1 RETURNING channel_id', [channel.id]);

      if (!res.rows.length) return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#ff4444')
        .setDescription(`❌ No config found for <#${channel.id}>.`)]});

      const adminLog = await getLogChannel(interaction.client, interaction.guild.id, 'admin');
      if (adminLog) await adminLog.send({ embeds: [new EmbedBuilder().setColor('#ff4444')
        .setTitle('<:rumble:1522372419338375299> RR Config Cleared')
        .setDescription(`<#${channel.id}> cleared by <@${interaction.user.id}>`)
        .setTimestamp().setFooter({ text: interaction.guild.name })
      ]}).catch(() => {});

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setDescription(`Config for <#${channel.id}> has been removed.`)]});
    }

    // ── /rr log ────────────────────────────────────────────────────────────
    if (group === 'log') {
      const channel = interaction.options.getChannel('channel');
      const col = sub === 'achievement' ? 'achievement_log_channel_id' : 'log_channel_id';

      await query(`
        INSERT INTO rr_guild_config (guild_id, ${col})
        VALUES ($1, $2)
        ON CONFLICT (guild_id) DO UPDATE SET ${col} = EXCLUDED.${col}
      `, [interaction.guild.id, channel?.id || null]);

      const label = sub === 'achievement' ? 'Achievement' : 'Admin';
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setDescription(channel
          ? `<:rumble:1522372419338375299> **${label}** logs will be posted in <#${channel.id}>.`
          : `**${label}** log channel cleared.`)]});
    }

    // ── /rr season ─────────────────────────────────────────────────────────
    if (group === 'season') {
      if (sub === 'start') {
        const name = interaction.options.getString('name');
        const existing = await getActiveSeason(interaction.guild.id);
        if (existing) return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#ff4444')
          .setDescription(`❌ Active season: **${existing.name}**. End it first.`)]});

        await query('INSERT INTO rr_seasons (guild_id, name, status) VALUES ($1, $2, $3)', [interaction.guild.id, name, 'active']);

        const adminLog = await getLogChannel(interaction.client, interaction.guild.id, 'admin');
        const embed = new EmbedBuilder().setColor('#d6c2ee')
          .setTitle('<:rumble:1522372419338375299> New Season Started!')
          .setDescription(`**${name}** has begun! Use \`/rr season add\` to add channels.`)
          .setTimestamp().setFooter({ text: interaction.guild.name });
        if (adminLog) await adminLog.send({ embeds: [embed] }).catch(() => {});
        return interaction.editReply({ embeds: [embed] });
      }

      if (sub === 'add') {
        const channel = interaction.options.getChannel('channel');
        const season = await getActiveSeason(interaction.guild.id);
        if (!season) return interaction.editReply('❌ No active season.');

        const cfg = await query(
          'SELECT winner_role_id, reaction_emoji FROM rr_channel_config WHERE channel_id = $1 AND winner_role_id IS NOT NULL AND reaction_emoji IS NOT NULL',
          [channel.id]
        );
        if (!cfg.rows.length) return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#ff4444')
          .setDescription(`❌ <#${channel.id}> needs both a winner role AND reaction emoji. Run \`/rr setup\` first.`)]});

        await query('INSERT INTO rr_season_channels (season_id, channel_id, guild_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [season.id, channel.id, interaction.guild.id]);
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
          .setDescription(`<a:trophies:1512912823062364281> <#${channel.id}> added to season **${season.name}**!`)]});
      }

      if (sub === 'remove') {
        const channel = interaction.options.getChannel('channel');
        const season = await getActiveSeason(interaction.guild.id);
        if (!season) return interaction.editReply('❌ No active season.');
        await query('DELETE FROM rr_season_channels WHERE season_id = $1 AND channel_id = $2', [season.id, channel.id]);
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
          .setDescription(`<#${channel.id}> removed from season **${season.name}**.`)]});
      }

      if (sub === 'end') {
        const season = await getActiveSeason(interaction.guild.id);
        if (!season) return interaction.editReply('❌ No active season.');

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
        await query('DELETE FROM rr_achievements WHERE guild_id = $1', [interaction.guild.id]);

        const embed = new EmbedBuilder().setColor('#5b209a')
          .setTitle('<:rumble:1522372419338375299> Season Ended!')
          .setDescription(`**${season.name}** ended.\n<:member:1512912827424309278> **${removed}** roles removed.\n<a:again:1522458630795034694> Achievements reset!`)
          .setTimestamp().setFooter({ text: interaction.guild.name });

        const adminLog = await getLogChannel(interaction.client, interaction.guild.id, 'admin');
        if (adminLog) await adminLog.send({ embeds: [embed] }).catch(() => {});
        return interaction.editReply({ embeds: [embed] });
      }

      if (sub === 'info') {
        const season = await getActiveSeason(interaction.guild.id);
        if (!season) return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
          .setDescription('No active season. Start one with `/rr season start`.')]});

        const chRes = await query(
          `SELECT sc.channel_id, rc.winner_role_id, rc.reaction_emoji
           FROM rr_season_channels sc JOIN rr_channel_config rc ON rc.channel_id = sc.channel_id
           WHERE sc.season_id = $1`, [season.id]
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
            { name: `Channels (${chRes.rows.length})`, value: channelLines },
            { name: '<a:trophies:1512912823062364281> Completions', value: achieveLines },
          ).setTimestamp().setFooter({ text: interaction.guild.name })]});
      }
    }

    // ── /rr add ───────────────────────────────────────────────────────────
    if (sub === 'add') {
      await interaction.deferReply({ ephemeral: true });

      // Check mod/admin role
      const gcRes = await query('SELECT mod_role_id, admin_role_id FROM guild_config WHERE guild_id = $1', [interaction.guild.id]);
      const gc = gcRes.rows[0];
      const isAllowed = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
        interaction.user.id === process.env.OWNER_ID ||
        (gc?.mod_role_id && interaction.member.roles.cache.has(gc.mod_role_id)) ||
        (gc?.admin_role_id && interaction.member.roles.cache.has(gc.admin_role_id));

      if (!isAllowed) return interaction.editReply('❌ Staff/Mod only.');

      const channel      = interaction.options.getChannel('channel');
      const otherReward  = interaction.options.getString('other_reward') || null;
      const description  = interaction.options.getString('description')?.replace(/\\n/g, '\n') || null;

      // Check channel is configured
      const cfgRes = await query('SELECT * FROM rr_channel_config WHERE channel_id = $1', [channel.id]);
      if (!cfgRes.rows.length) return interaction.editReply('❌ That channel is not configured for RR tracking.');

      await query(`UPDATE rr_channel_config SET other_reward = $1, host_description = $2 WHERE channel_id = $3`,
        [otherReward, description, channel.id]);

      const lines = [];
      if (otherReward) lines.push(`🎁 **Other Reward:** ${otherReward}`);
      if (description) lines.push(`📝 **Description:** ${description.slice(0, 50)}...`);

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('<:rumble:1522372419338375299> Battle Info Added!')
        .setDescription(lines.join('\n') || 'Nothing added.')
        .setFooter({ text: 'This will appear in the next battle announcement and clear after.' })]});
    }

    // ── /rr stats ──────────────────────────────────────────────────────────
    if (sub === 'stats') {
      const user    = interaction.options.getUser('user');
      const channel = interaction.options.getChannel('channel');
      const period  = interaction.options.getString('period') || 'all';
      const scope   = interaction.options.getString('scope') || 'server';

      if (user) {
        const serverRes = await query('SELECT channel_id, wins, games FROM rr_stats WHERE guild_id = $1 AND user_id = $2 ORDER BY wins DESC', [interaction.guild.id, user.id]);
        const globalRes = await query('SELECT SUM(wins) as tw, SUM(games) as tg FROM rr_stats WHERE user_id = $1', [user.id]);
        const achRes    = await query('SELECT completions FROM rr_achievements WHERE guild_id = $1 AND user_id = $2', [interaction.guild.id, user.id]);

        const serverTotal = serverRes.rows.reduce((s, r) => s + Number(r.wins), 0);
        const globalTotal = Number(globalRes.rows[0]?.tw || 0);
        const completions = achRes.rows[0]?.completions || 0;
        const channelLines = serverRes.rows.length ? serverRes.rows.map(r => `<#${r.channel_id}> — **${r.wins}W**`).join('\n') : 'No wins yet';

        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
          .setTitle(`<a:trophies:1512912823062364281> ${user.username}'s RR Stats`)
          .setThumbnail(user.displayAvatarURL({ dynamic: true }))
          .addFields(
            { name: '<:rumble:1522372419338375299> Server Wins', value: `**${serverTotal}**`, inline: true },
            { name: '<a:rumblesword:1522372420894330921> Global Wins', value: `**${globalTotal}**`, inline: true },
            { name: '<a:trophies:1512912823062364281> Completions', value: `**${completions}**`, inline: true },
            { name: 'By Channel', value: channelLines },
          ).setFooter({ text: interaction.guild.name })]});
      }

      const periodFilter = period === 'week' ? "AND updated_at > NOW() - INTERVAL '7 days'" : period === 'month' ? "AND updated_at > NOW() - INTERVAL '30 days'" : '';
      const periodLabel  = period === 'week' ? ' · This Week' : period === 'month' ? ' · This Month' : ' · All Time';

      if (scope === 'global') {
        const res = await query(`SELECT user_id, username, SUM(wins) as tw, SUM(games) as tg FROM rr_stats s WHERE 1=1 ${periodFilter} GROUP BY user_id, username ORDER BY tw DESC LIMIT 10`);
        if (!res.rows.length) return interaction.editReply('No global stats yet.');
        const lines = res.rows.map((r, i) => `**${i+1}.** ${cleanName(r.username)} — **${r.tw}W** (${r.tg} games)`).join('\n');
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
          .setTitle(`<a:trophies:1512912823062364281> Global RR Leaderboard${periodLabel}`)
          .setDescription(lines).setFooter({ text: 'All servers tracked by VELOURA' })]});
      }

      const params = [interaction.guild.id];
      let channelFilter = '';
      if (channel) { channelFilter = `AND s.channel_id = $${params.length + 1}`; params.push(channel.id); }

      const res = await query(
        `SELECT user_id, username, SUM(wins) as tw, SUM(games) as tg FROM rr_stats s WHERE guild_id = $1 ${channelFilter} ${periodFilter} GROUP BY user_id, username ORDER BY tw DESC LIMIT 10`,
        params
      );
      if (!res.rows.length) return interaction.editReply('No stats yet.');
      const lines = res.rows.map((r, i) => `**${i+1}.** ${cleanName(r.username)} — **${r.tw}W** (${r.tg} games)`).join('\n');
      const chLabel = channel ? ` · <#${channel.id}>` : '';
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle(`<a:trophies:1512912823062364281> RR Leaderboard${periodLabel}${chLabel}`)
        .setDescription(lines).setFooter({ text: interaction.guild.name })]});
    }
  },
};
