const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rs')
    .setDescription('Rumble Slaughter management')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Configure a Rumble Slaughter channel (only updates fields you provide)')
      .addChannelOption(o => o.setName('channel').setDescription('Channel Rumble Slaughter runs in').setRequired(true))
      .addRoleOption(o => o.setName('winner_role').setDescription('Role to auto-assign to the champion'))
      .addRoleOption(o => o.setName('ping_role').setDescription('Role to ping in the announcement and to host again'))
      .addRoleOption(o => o.setName('ping_role2').setDescription('Second ping role'))
      .addRoleOption(o => o.setName('ping_role3').setDescription('Third ping role'))
      .addChannelOption(o => o.setName('next_channel').setDescription('Next game room'))
      .addStringOption(o => o.setName('battle_title').setDescription('Custom title for the champion announcement'))
      .addStringOption(o => o.setName('description').setDescription('Custom description (use \\n for new lines)'))
      .addAttachmentOption(o => o.setName('image').setDescription('Upload image shown on the arena-open and champion announcements'))
      .addStringOption(o => o.setName('image_url').setDescription('Or paste image URL'))
      .addStringOption(o => o.setName('embed_color').setDescription('Embed color hex, e.g. #d6c2ee'))
      .addStringOption(o => o.setName('reaction_emoji').setDescription('Emoji to auto-react to winner-role chat messages. Type "clear" to remove.'))
      .addStringOption(o => o.setName('announce_style').setDescription('Announcement format').addChoices(
        { name: 'Full embed', value: 'embed' },
        { name: 'Ping only (no embed)', value: 'ping' },
      ))
      .addBooleanOption(o => o.setName('announce').setDescription('Post a confirmation embed when a role is assigned (default: True)'))
      .addBooleanOption(o => o.setName('auto_battle').setDescription('Does the next battle auto-start, or does someone run /rumbleslaughter? (default: False)')))
    .addSubcommandGroup(group => group
      .setName('reward')
      .setDescription('One-time rewards for the next game')
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Add a one-time reward or description to the next champion announcement (staff/mod)')
        .addChannelOption(o => o.setName('channel').setDescription('RS channel').setRequired(true))
        .addStringOption(o => o.setName('other_reward').setDescription('Custom reward (e.g. Sticker, Nitro Basic)'))
        .addStringOption(o => o.setName('description').setDescription('One-time description (use \\n for new lines)')))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Clear the pending one-time reward before it gets used')
        .addChannelOption(o => o.setName('channel').setDescription('RS channel').setRequired(true))))
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('View the current config for a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to check').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove Rumble Slaughter config from a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('repost')
      .setDescription('Repost the last arena-open or champion announcement if it was deleted')
      .addChannelOption(o => o.setName('channel').setDescription('RS channel').setRequired(true))),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const winnerRole = interaction.options.getRole('winner_role');
      const pingRole = interaction.options.getRole('ping_role');
      const pingRole2 = interaction.options.getRole('ping_role2');
      const pingRole3 = interaction.options.getRole('ping_role3');
      const nextChannel = interaction.options.getChannel('next_channel');
      const battleTitle = interaction.options.getString('battle_title');
      const description = interaction.options.getString('description')?.replace(/\\n/g, '\n');
      const imageAttach = interaction.options.getAttachment('image');
      const imageUrl = imageAttach?.url || interaction.options.getString('image_url') || null;
      const embedColor = interaction.options.getString('embed_color');
      const reactionEmojiRaw = interaction.options.getString('reaction_emoji');
      const reactionEmoji = (reactionEmojiRaw && ['clear', 'none'].includes(reactionEmojiRaw.toLowerCase())) ? '' : reactionEmojiRaw;
      const announceStyle = interaction.options.getString('announce_style');
      const announce = interaction.options.getBoolean('announce');
      const autoBattle = interaction.options.getBoolean('auto_battle');

      await query(`
        INSERT INTO rumble_slaughter_config (channel_id, guild_id, winner_role_id, ping_role_id, ping_role2_id, ping_role3_id, next_channel_id, battle_title, description, image_url, embed_color, reaction_emoji, announce_style, announce, auto_battle)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14, true),COALESCE($15, false))
        ON CONFLICT (channel_id) DO UPDATE SET
          winner_role_id = COALESCE($3, rumble_slaughter_config.winner_role_id),
          ping_role_id = COALESCE($4, rumble_slaughter_config.ping_role_id),
          ping_role2_id = COALESCE($5, rumble_slaughter_config.ping_role2_id),
          ping_role3_id = COALESCE($6, rumble_slaughter_config.ping_role3_id),
          next_channel_id = COALESCE($7, rumble_slaughter_config.next_channel_id),
          battle_title = COALESCE($8, rumble_slaughter_config.battle_title),
          description = COALESCE($9, rumble_slaughter_config.description),
          image_url = COALESCE($10, rumble_slaughter_config.image_url),
          embed_color = COALESCE($11, rumble_slaughter_config.embed_color),
          reaction_emoji = COALESCE($12, rumble_slaughter_config.reaction_emoji),
          announce_style = COALESCE($13, rumble_slaughter_config.announce_style),
          announce = COALESCE($14, rumble_slaughter_config.announce),
          auto_battle = COALESCE($15, rumble_slaughter_config.auto_battle)
      `, [channel.id, interaction.guildId, winnerRole?.id || null, pingRole?.id || null, pingRole2?.id || null, pingRole3?.id || null, nextChannel?.id || null, battleTitle, description, imageUrl, embedColor, reactionEmoji, announceStyle, announce, autoBattle]);

      // Live-update the currently-posted announcement, if there is one, so
      // edits don't have to wait for the next game to show up.
      let liveUpdateNote = '';
      const freshRes = await query('SELECT * FROM rumble_slaughter_config WHERE channel_id = $1', [channel.id]);
      const freshCfg = freshRes.rows[0];
      console.log(`[RS setup] channel ${channel.id}: autoBattle option passed in = ${JSON.stringify(autoBattle)}, stored value after save = ${JSON.stringify(freshCfg.auto_battle)}`);

      if (freshCfg.last_message_id && freshCfg.announce_style !== 'ping') {
        const liveMsg = await channel.messages.fetch(freshCfg.last_message_id).catch(() => null);
        if (liveMsg) {
          const { buildArenaEmbed, buildChampionEmbed } = require('../../events/rumbleSlaughter');
          let rebuiltEmbed = null;

          if (freshCfg.last_type === 'arena') {
            const hostMember = freshCfg.last_host_id ? await interaction.guild.members.fetch(freshCfg.last_host_id).catch(() => null) : null;
            rebuiltEmbed = buildArenaEmbed(freshCfg, {
              hostId: freshCfg.last_host_id,
              hostName: hostMember?.user?.username || 'Unknown',
              entryFee: freshCfg.last_entry_fee,
              era: freshCfg.last_era,
              guildName: interaction.guild.name,
              channelName: channel.name,
            });
          } else if (freshCfg.last_type === 'champion') {
            const winnerMember = freshCfg.last_winner_id ? await interaction.guild.members.fetch(freshCfg.last_winner_id).catch(() => null) : null;
            if (winnerMember) {
              rebuiltEmbed = buildChampionEmbed(freshCfg, winnerMember, {
                pot: freshCfg.last_pot,
                guildName: interaction.guild.name,
                channelName: channel.name,
              });
            }
          }

          if (rebuiltEmbed) {
            await liveMsg.edit({ embeds: [rebuiltEmbed] }).catch(() => {});
            liveUpdateNote = ' The currently-posted announcement was also updated live.';
          }
        }
      }

      return interaction.editReply(`✅ <#${channel.id}> configured for Rumble Slaughter.${liveUpdateNote}`);
    }

    if (group === 'reward' && sub === 'add') {
      const channel = interaction.options.getChannel('channel');
      const otherReward = interaction.options.getString('other_reward') || null;
      const description = interaction.options.getString('description')?.replace(/\\n/g, '\n') || null;

      const res = await query('SELECT 1 FROM rumble_slaughter_config WHERE channel_id = $1', [channel.id]);
      if (!res.rows.length) return interaction.editReply(`❌ <#${channel.id}> isn't configured yet — run \`/rs setup\` first.`);

      await query(`UPDATE rumble_slaughter_config SET other_reward = $1, host_description = $2 WHERE channel_id = $3`,
        [otherReward, description, channel.id]);

      return interaction.editReply(`✅ One-time reward/description added — will appear on the next champion announcement in <#${channel.id}>, then clear automatically.`);
    }

    if (group === 'reward' && sub === 'remove') {
      const channel = interaction.options.getChannel('channel');
      const res = await query('SELECT * FROM rumble_slaughter_config WHERE channel_id = $1', [channel.id]);
      if (!res.rows.length) return interaction.editReply(`❌ <#${channel.id}> isn't configured yet — run \`/rs setup\` first.`);

      if (!res.rows[0].other_reward && !res.rows[0].host_description) {
        return interaction.editReply(`❌ There's no pending one-time reward to remove for <#${channel.id}>.`);
      }

      await query(`UPDATE rumble_slaughter_config SET other_reward = NULL, host_description = NULL WHERE channel_id = $1`, [channel.id]);
      return interaction.editReply(`✅ Pending one-time reward removed for <#${channel.id}>.`);
    }

    if (sub === 'info') {
      const channel = interaction.options.getChannel('channel');
      const res = await query('SELECT * FROM rumble_slaughter_config WHERE channel_id = $1', [channel.id]);
      if (!res.rows.length) return interaction.editReply(`❌ <#${channel.id}> isn't configured for Rumble Slaughter.`);

      const cfg = res.rows[0];
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('💀 Rumble Slaughter Config')
        .addFields(
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Winner Role', value: cfg.winner_role_id ? `<@&${cfg.winner_role_id}>` : 'Not set', inline: true },
          { name: 'Ping Role', value: cfg.ping_role_id ? `<@&${cfg.ping_role_id}>` : 'None', inline: true },
          { name: 'Next Channel', value: cfg.next_channel_id ? `<#${cfg.next_channel_id}>` : 'Not set', inline: true },
          { name: 'Announce', value: cfg.announce ? 'Yes' : 'No', inline: true },
          { name: 'Battle Title', value: cfg.battle_title || '*(default)*', inline: false },
          { name: 'Description', value: cfg.description || '*(none)*', inline: false },
          { name: 'Pending One-Time Reward', value: cfg.other_reward || '*(none)*', inline: false },
          { name: 'Image', value: cfg.image_url ? '✅ Set' : '*(none)*', inline: false },
          { name: 'Ping Roles 2/3', value: `${cfg.ping_role2_id ? `<@&${cfg.ping_role2_id}>` : '—'} / ${cfg.ping_role3_id ? `<@&${cfg.ping_role3_id}>` : '—'}`, inline: true },
          { name: 'Embed Color', value: cfg.embed_color || '*(default)*', inline: true },
          { name: 'Reaction Emoji', value: cfg.reaction_emoji || '*(none)*', inline: true },
          { name: 'Announce Style', value: cfg.announce_style === 'ping' ? 'Ping only' : 'Full embed', inline: true },
        )]});
    }

    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel');
      const del = await query('DELETE FROM rumble_slaughter_config WHERE channel_id = $1 RETURNING channel_id', [channel.id]);
      if (!del.rows.length) return interaction.editReply(`❌ <#${channel.id}> wasn't configured.`);
      return interaction.editReply(`✅ Removed Rumble Slaughter config from <#${channel.id}>.`);
    }

    if (sub === 'repost') {
      const channel = interaction.options.getChannel('channel');
      const res = await query('SELECT * FROM rumble_slaughter_config WHERE channel_id = $1', [channel.id]);
      if (!res.rows.length) return interaction.editReply(`❌ <#${channel.id}> isn't configured for Rumble Slaughter.`);
      const cfg = res.rows[0];

      if (!cfg.last_type) return interaction.editReply(`❌ No announcement has been posted in <#${channel.id}> yet — nothing to repost.`);

      if (cfg.last_message_id) {
        const existing = await channel.messages.fetch(cfg.last_message_id).catch(() => null);
        if (existing) return interaction.editReply(`✅ That announcement still exists — no repost needed. ${existing.url}`);
      }

      const { buildArenaEmbed, buildChampionEmbed, buildPings } = require('../../events/rumbleSlaughter');
      const pings = buildPings(cfg);
      let rebuiltEmbed, content;

      if (cfg.last_type === 'arena') {
        const hostMember = cfg.last_host_id ? await interaction.guild.members.fetch(cfg.last_host_id).catch(() => null) : null;
        rebuiltEmbed = buildArenaEmbed(cfg, {
          hostId: cfg.last_host_id,
          hostName: hostMember?.user?.username || 'Unknown',
          entryFee: cfg.last_entry_fee,
          era: cfg.last_era,
          guildName: interaction.guild.name,
          channelName: channel.name,
        });
        content = pings || undefined;
      } else if (cfg.last_type === 'champion') {
        const winnerMember = cfg.last_winner_id ? await interaction.guild.members.fetch(cfg.last_winner_id).catch(() => null) : null;
        if (!winnerMember) return interaction.editReply(`❌ Couldn't find the champion's member record — can't rebuild that announcement.`);
        rebuiltEmbed = buildChampionEmbed(cfg, winnerMember, {
          pot: cfg.last_pot,
          guildName: interaction.guild.name,
          channelName: channel.name,
        });
      } else {
        return interaction.editReply(`❌ Unknown announcement type — nothing to repost.`);
      }

      const msg = await channel.send({
        content,
        embeds: [rebuiltEmbed],
      }).catch(() => null);
      if (!msg) return interaction.editReply(`❌ Couldn't repost — check Veloura's permissions in <#${channel.id}>.`);

      await query('UPDATE rumble_slaughter_config SET last_message_id = $1 WHERE channel_id = $2', [msg.id, channel.id]);
      return interaction.editReply(`✅ Reposted in <#${channel.id}> using your current settings. ${msg.url}`);
    }
  },
};
