const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');
const { isGuildAllowedSins } = require('../../utils/sinsRequests');

const cleanName = (name) => name?.replace(/<a?:[^:]+:\d+>/g, '').replace(/:[^:]+:/g, '').trim() || 'Unknown';

async function getLogChannel(client, guildId, type = 'admin') {
  const col = type === 'achievement' ? 'achievement_log_channel_id' : 'log_channel_id';
  const res = await query(`SELECT ${col} FROM rr_guild_config WHERE guild_id = $1`, [guildId]);
  const id = res.rows[0]?.[col];
  return id ? (await client.channels.fetch(id).catch(() => null)) : null;
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
      .addStringOption(o => o.setName('announce_style').setDescription('Battle announcement format').addChoices(
        { name: 'Embed (default)', value: 'embed' },
        { name: 'Ping Only (no embed)', value: 'ping' },
      ))
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

    // ── add (host description/reward) ────────────────────────────────────
    .addSubcommandGroup(group => group
      .setName('reward')
      .setDescription('One-time rewards for the next battle')
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Add a one-time reward or description to the next battle (staff/mod)')
        .addChannelOption(o => o.setName('channel').setDescription('RR channel').setRequired(true))
        .addStringOption(o => o.setName('other_reward').setDescription('Custom reward (e.g. Sticker, Nitro Basic)'))
        .addStringOption(o => o.setName('description').setDescription('One-time battle description (use \\n for new lines)')))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Clear the pending one-time reward before it gets used')
        .addChannelOption(o => o.setName('channel').setDescription('RR channel').setRequired(true))))

    // ── repost (manually resend battle-start announcement) ──────────────────
    .addSubcommand(sub => sub
      .setName('repost')
      .setDescription('Manually repost the battle-start announcement for a channel')
      .addChannelOption(o => o.setName('channel').setDescription('RR channel').setRequired(true)))

    // ── currency (choose Sins or a custom local currency) ────────────────────
    .addSubcommand(sub => sub
      .setName('currency')
      .setDescription('Set whether RR rewards use real Sins or your own custom currency')
      .addBooleanOption(o => o.setName('use_sins').setDescription('True = real Sins (Play & Regret). False = your own custom currency').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('Custom currency name, e.g. "Coins" (only used if use_sins is False)'))
      .addStringOption(o => o.setName('emoji').setDescription('Custom currency emoji, e.g. 🪙 or <:coin:id> (only used if use_sins is False)')))

    // ── wallet (check custom currency balance) ────────────────────────────────
    .addSubcommand(sub => sub
      .setName('wallet')
      .setDescription('Check your (or someone else\'s) custom RR currency balance')
      .addUserOption(o => o.setName('user').setDescription('Member to check (defaults to you)'))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);

    // /rr add and /rr repost have their own mod/admin/staff role check below — every other subcommand is admin/owner only
    if (sub !== 'add' && sub !== 'repost' && sub !== 'wallet' &&
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

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
      const announceStyle = interaction.options.getString('announce_style');
      const imageAttach  = interaction.options.getAttachment('image');
      const imageUrl     = imageAttach?.url || interaction.options.getString('image_url');
      const color        = interaction.options.getString('embed_color');
      const reactionEmoji = interaction.options.getString('reaction_emoji');
      const battleTitle  = interaction.options.getString('battle_title');
      const description  = interaction.options.getString('description')?.replace(/\\n/g, '\n');

      // Get existing config to merge
      const existing = await query('SELECT * FROM rr_channel_config WHERE channel_id = $1', [channel.id]);
      const ex = existing.rows[0];

      if (!ex && !pingRole1) {
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#ff4444')
          .setDescription('❌ First time setup requires at least `ping_role1`. (`reward` is optional.)')]});
      }

      const newReward      = reward ?? ex?.reward_amount;
      const newWinnerRole  = winnerRole !== null ? winnerRole?.id : ex?.winner_role_id;
      const newPingRole1   = pingRole1 !== null ? pingRole1?.id : ex?.ping_role1_id;
      const newPingRole2   = pingRole2 !== null ? pingRole2?.id : ex?.ping_role2_id;
      const newPingRole3   = pingRole3 !== null ? pingRole3?.id : ex?.ping_role3_id;
      const newNextChannel = nextChannel !== null ? nextChannel?.id : ex?.next_channel_id;
      const newAnnounceStyle = announceStyle ?? ex?.announce_style ?? 'embed';
      const newImage       = imageUrl ?? ex?.battle_image;
      const newColor       = color ?? ex?.embed_color ?? '#d6c2ee';
      const newReaction    = reactionEmoji ?? ex?.reaction_emoji;
      const newTitle       = battleTitle ?? ex?.battle_title;
      const newDesc        = description ?? ex?.battle_description;

      await query(`
        INSERT INTO rr_channel_config
          (channel_id, guild_id, winner_role_id, ping_role1_id, ping_role2_id, ping_role3_id,
           next_channel_id, reward_amount, battle_image, embed_color, reaction_emoji,
           battle_title, battle_description, announce_style, total_games, total_players)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,0)
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
          battle_description = EXCLUDED.battle_description,
          announce_style     = EXCLUDED.announce_style
      `, [
        channel.id, interaction.guild.id,
        newWinnerRole || null, newPingRole1 || null, newPingRole2 || null, newPingRole3 || null,
        newNextChannel || null, newReward || null, newImage || null,
        newColor, newReaction || null, newTitle || null, newDesc || null, newAnnounceStyle,
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
          { name: '📣 Announce Style',                               value: newAnnounceStyle === 'ping' ? 'Ping Only' : 'Embed', inline: true },
          { name: '📝 Title',                                        value: newTitle || '—',                               inline: false },
          { name: '📄 Description',                                  value: newDesc ? newDesc.slice(0,100) : '—',          inline: false },
        );

      // Log to admin log channel
      const adminLog = await getLogChannel(interaction.client, interaction.guild.id, 'admin');
      if (adminLog) {
        if (ex) {
          // Diff log — only show changed fields
          const changes = [];
          if (reward !== null && reward !== Number(ex.reward_amount)) changes.push({ name: '<a:moneybag:1522373120147849226> Reward', value: `${Number(newReward).toLocaleString()} sins`, inline: true });
          if (winnerRole !== null && winnerRole?.id !== ex.winner_role_id) changes.push({ name: '<a:trophies:1512912823062364281> Winner Role', value: newWinnerRole ? `<@&${newWinnerRole}>` : '—', inline: true });
          if (pingRole1 !== null && pingRole1?.id !== ex.ping_role1_id) changes.push({ name: '<a:purplesparkle:1512912828489793626> Ping Role 1', value: newPingRole1 ? `<@&${newPingRole1}>` : '—', inline: true });
          if (nextChannel !== null && nextChannel?.id !== ex.next_channel_id) changes.push({ name: '<a:rumblesword:1522372420894330921> Next Room', value: newNextChannel ? `<#${newNextChannel}>` : '—', inline: true });
          if (imageUrl && imageUrl !== ex.battle_image) changes.push({ name: '<a:Fire:1522374930681823433> Image', value: '✓ Updated', inline: true });
          if (color && color !== ex.embed_color) changes.push({ name: '🎨 Color', value: newColor, inline: true });
          if (reactionEmoji && reactionEmoji !== ex.reaction_emoji) changes.push({ name: '✨ Reaction', value: newReaction || '—', inline: true });
          if (battleTitle && battleTitle !== ex.battle_title) changes.push({ name: '📝 Battle Title', value: newTitle || '—', inline: true });
          if (description && description !== ex.battle_description) changes.push({ name: '📄 Description', value: newDesc ? newDesc.slice(0,50)+'...' : '—', inline: true });
          if (announceStyle && announceStyle !== (ex.announce_style || 'embed')) changes.push({ name: '📣 Announce Style', value: newAnnounceStyle === 'ping' ? 'Ping Only' : 'Embed', inline: true });

          if (changes.length) {
            await adminLog.send({ embeds: [new EmbedBuilder().setColor(newColor)
              .setTitle('<:rumble:1522372419338375299> RR Channel Updated')
              .setDescription(`<#${channel.id}> updated by <@${interaction.user.id}>`)
              .addFields(changes)
              .setTimestamp().setFooter({ text: interaction.guild.name })
            ]}).catch(() => {});
          }
        } else {
          // Full log for new setup
          await adminLog.send({ embeds: [new EmbedBuilder().setColor(newColor)
            .setTitle('<:rumble:1522372419338375299> RR Channel Configured')
            .setDescription(`<#${channel.id}> configured by <@${interaction.user.id}>`)
            .addFields(
              { name: '<a:trophies:1512912823062364281> Winner Role',     value: newWinnerRole ? `<@&${newWinnerRole}>` : '—', inline: true },
              { name: '<a:purplesparkle:1512912828489793626> Ping Roles', value: newPingRole1 ? `<@&${newPingRole1}>` : '—', inline: true },
              { name: '<a:moneybag:1522373120147849226> Reward',          value: newReward ? `${Number(newReward).toLocaleString()} sins` : '—', inline: true },
              { name: '<a:rumblesword:1522372420894330921> Next Room',    value: newNextChannel ? `<#${newNextChannel}>` : '—', inline: true },
              { name: '✨ Reaction',                                      value: newReaction || '—', inline: true },
              { name: '🎨 Color',                                        value: newColor, inline: true },
              { name: '📝 Battle Title',                                 value: newTitle || '—', inline: true },
              { name: '<a:Fire:1522374930681823433> Image',              value: newImage ? '✓ Set' : '—', inline: true },
              { name: '📣 Announce Style',                               value: newAnnounceStyle === 'ping' ? 'Ping Only' : 'Embed', inline: true },
            )
            .setTimestamp().setFooter({ text: interaction.guild.name })
          ]}).catch(() => {});
        }
      }

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

    // ── /rr add ───────────────────────────────────────────────────────────
    if (group === 'reward' && sub === 'add') {
      // Check mod/admin role OR staff roster membership
      const gcRes = await query('SELECT mod_role_id, admin_role_id FROM guild_config WHERE guild_id = $1', [interaction.guild.id]);
      const gc = gcRes.rows[0];
      const staffRes = await query('SELECT 1 FROM staff WHERE user_id = $1 AND active = true', [interaction.user.id]);
      const isAllowed = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
        interaction.user.id === process.env.OWNER_ID ||
        (gc?.mod_role_id && interaction.member.roles.cache.has(gc.mod_role_id)) ||
        (gc?.admin_role_id && interaction.member.roles.cache.has(gc.admin_role_id)) ||
        staffRes.rows.length > 0;

      if (!isAllowed) return interaction.editReply('❌ Staff/Mod only.');

      const channel      = interaction.options.getChannel('channel');
      const otherReward  = interaction.options.getString('other_reward') || null;
      const description  = interaction.options.getString('description')?.replace(/\\n/g, '\n') || null;

      // Check channel is configured
      const cfgRes = await query('SELECT * FROM rr_channel_config WHERE channel_id = $1', [channel.id]);
      if (!cfgRes.rows.length) return interaction.editReply('❌ That channel is not configured for RR tracking.');

      await query(`UPDATE rr_channel_config SET other_reward = $1, host_description = $2 WHERE channel_id = $3`,
        [otherReward, description, channel.id]);

      // Try to update the currently-live battle announcement in place, rather than waiting for the next one
      let liveUpdateNote = '';
      if (cfgRes.rows[0].last_battle_message_id && cfgRes.rows[0].announce_style !== 'ping') {
        const liveMsg = await channel.messages.fetch(cfgRes.rows[0].last_battle_message_id).catch(() => null);
        if (liveMsg) {
          const { buildBattleAnnouncement } = require('../../events/rumbleRoyale');
          const freshCfgRes = await query('SELECT * FROM rr_channel_config WHERE channel_id = $1', [channel.id]);
          const announcement = await buildBattleAnnouncement(freshCfgRes.rows[0], channel, liveMsg.embeds[0]?.footer?.text?.match(/Hosted by: ([^•]+)/)?.[1]?.trim() || 'Unknown');
          await liveMsg.edit({ embeds: announcement.embeds }).catch(() => {});
          liveUpdateNote = '\n*The current battle announcement was updated live.*';
        }
      }

      const lines = [];
      if (otherReward) lines.push(`<a:gift:1512915751458050268> **Other Reward:** ${otherReward}`);
      if (description) lines.push(`📝 **Description:** ${description.slice(0, 50)}...`);

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('<:rumble:1522372419338375299> Battle Info Added!')
        .setDescription((lines.join('\n') || 'Nothing added.') + liveUpdateNote)
        .setFooter({ text: liveUpdateNote ? 'Updated the live announcement — no need to wait for the next battle.' : 'This will appear in the next battle announcement and clear after.' })]});
    }

    if (group === 'reward' && sub === 'remove') {
      const gcRes = await query('SELECT mod_role_id, admin_role_id FROM guild_config WHERE guild_id = $1', [interaction.guild.id]);
      const gc = gcRes.rows[0];
      const staffRes = await query('SELECT 1 FROM staff WHERE user_id = $1 AND active = true', [interaction.user.id]);
      const isAllowed = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
        interaction.user.id === process.env.OWNER_ID ||
        (gc?.mod_role_id && interaction.member.roles.cache.has(gc.mod_role_id)) ||
        (gc?.admin_role_id && interaction.member.roles.cache.has(gc.admin_role_id)) ||
        staffRes.rows.length > 0;

      if (!isAllowed) return interaction.editReply('❌ Staff/Mod only.');

      const channel = interaction.options.getChannel('channel');
      const cfgRes = await query('SELECT * FROM rr_channel_config WHERE channel_id = $1', [channel.id]);
      if (!cfgRes.rows.length) return interaction.editReply('❌ That channel is not configured for RR tracking.');

      if (!cfgRes.rows[0].other_reward && !cfgRes.rows[0].host_description) {
        return interaction.editReply('❌ There\'s no pending one-time reward to remove for that channel.');
      }

      await query(`UPDATE rr_channel_config SET other_reward = NULL, host_description = NULL WHERE channel_id = $1`, [channel.id]);

      // Also clear it from the currently-live battle announcement, if one exists
      let liveUpdateNote = '';
      if (cfgRes.rows[0].last_battle_message_id && cfgRes.rows[0].announce_style !== 'ping') {
        const liveMsg = await channel.messages.fetch(cfgRes.rows[0].last_battle_message_id).catch(() => null);
        if (liveMsg) {
          const { buildBattleAnnouncement } = require('../../events/rumbleRoyale');
          const freshCfgRes = await query('SELECT * FROM rr_channel_config WHERE channel_id = $1', [channel.id]);
          const announcement = await buildBattleAnnouncement(freshCfgRes.rows[0], channel, liveMsg.embeds[0]?.footer?.text?.match(/Hosted by: ([^•]+)/)?.[1]?.trim() || 'Unknown');
          await liveMsg.edit({ embeds: announcement.embeds }).catch(() => {});
          liveUpdateNote = ' The live announcement was also updated.';
        }
      }

      return interaction.editReply(`✅ Pending one-time reward removed.${liveUpdateNote}`);
    }

    // ── /rr repost ────────────────────────────────────────────────────────
    if (sub === 'repost') {
      const gcRes = await query('SELECT mod_role_id, admin_role_id FROM guild_config WHERE guild_id = $1', [interaction.guild.id]);
      const gc = gcRes.rows[0];
      const staffRes = await query('SELECT 1 FROM staff WHERE user_id = $1 AND active = true', [interaction.user.id]);
      const isAllowed = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
        interaction.user.id === process.env.OWNER_ID ||
        (gc?.mod_role_id && interaction.member.roles.cache.has(gc.mod_role_id)) ||
        (gc?.admin_role_id && interaction.member.roles.cache.has(gc.admin_role_id)) ||
        staffRes.rows.length > 0;

      if (!isAllowed) return interaction.editReply('❌ Staff/Mod only.');

      const channel = interaction.options.getChannel('channel');
      const cfgRes = await query('SELECT * FROM rr_channel_config WHERE channel_id = $1', [channel.id]);
      if (!cfgRes.rows.length) return interaction.editReply('❌ That channel is not configured for RR tracking.');
      const config = cfgRes.rows[0];

      const { buildBattleAnnouncement } = require('../../events/rumbleRoyale');
      const announcement = await buildBattleAnnouncement(config, channel, interaction.user.username);

      const sentMsg = await channel.send({ content: announcement.content, embeds: announcement.embeds });
      await query('UPDATE rr_channel_config SET last_battle_message_id = $1 WHERE channel_id = $2', [sentMsg.id, channel.id]);
      return interaction.editReply(`✅ Reposted the battle announcement in <#${channel.id}>.`);
    }

    // ── /rr currency ──────────────────────────────────────────────────────
    if (sub === 'currency') {
      const useSins = interaction.options.getBoolean('use_sins');
      const name    = interaction.options.getString('name');
      const emoji   = interaction.options.getString('emoji');

      if (useSins && !isGuildAllowedSins(interaction.guild.id)) {
        return interaction.editReply('❌ Real Sins are only available in specific approved servers. Please set up your own custom currency instead (`use_sins:False name:"..." emoji:"..."`).');
      }
      if (!useSins && !name) {
        return interaction.editReply('❌ Please provide a `name` for your custom currency (e.g. "Coins") when `use_sins` is False.');
      }

      await query(`
        INSERT INTO rr_guild_config (guild_id, use_sins, currency_name, currency_emoji)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (guild_id) DO UPDATE SET
          use_sins = $2,
          currency_name = COALESCE($3, rr_guild_config.currency_name),
          currency_emoji = COALESCE($4, rr_guild_config.currency_emoji)
      `, [interaction.guild.id, useSins, name, emoji]);

      if (useSins) {
        return interaction.editReply('✅ RR rewards will use real **Sins** (Play & Regret) going forward.');
      }
      return interaction.editReply(`✅ RR rewards will use your own currency: **${name}** ${emoji || ''} going forward. Balances are tracked locally in Veloura, separate from Sins.`);
    }

    // ── /rr wallet ────────────────────────────────────────────────────────
    if (sub === 'wallet') {
      const user = interaction.options.getUser('user') || interaction.user;
      const gcRes = await query('SELECT use_sins, currency_name, currency_emoji FROM rr_guild_config WHERE guild_id = $1', [interaction.guild.id]);
      const gc = gcRes.rows[0] || { use_sins: isGuildAllowedSins(interaction.guild.id), currency_name: 'Sins', currency_emoji: '<a:SINS:1522338148380704910>' };

      if (gc.use_sins) {
        return interaction.editReply('ℹ️ This server uses real Sins — check your balance with `/sins balance` instead.');
      }

      const balRes = await query('SELECT balance FROM rr_custom_balances WHERE guild_id = $1 AND user_id = $2', [interaction.guild.id, user.id]);
      const balance = balRes.rows[0]?.balance || 0;

      return interaction.editReply(`${gc.currency_emoji || '🪙'} <@${user.id}>'s balance: **${Number(balance).toLocaleString()} ${gc.currency_name || 'Coins'}**`);
    }
  },
};
