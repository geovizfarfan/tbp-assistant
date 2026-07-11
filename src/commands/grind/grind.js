const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, PermissionFlagsBits, ChannelType,
} = require('discord.js');
const { query } = require('../../utils/database');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getConfig(guildId) {
  const res = await query('SELECT * FROM grind_config WHERE guild_id = $1', [guildId]);
  return res.rows[0] || null;
}

async function getChannelCount(guildId) {
  const res = await query('SELECT COUNT(*) as c FROM grind_channels WHERE guild_id = $1', [guildId]);
  return Number(res.rows[0]?.c || 0);
}

async function getUserChannel(guildId, userId) {
  const res = await query('SELECT * FROM grind_channels WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return res.rows[0] || null;
}

function buildPanelEmbeds(config, count) {
  const subEmbed = new EmbedBuilder()
    .setColor(config.embed_color || '#d6c2ee')
    .setTitle('<a:rumblesword:1522372420894330921> Rumble Grind Notifications')
    .setDescription(`Want to get notified when a **Grind** battle starts?\nClick Below! <a:whitesparkle:1512912831761092740>`);

  const chEmbed = new EmbedBuilder()
    .setColor(config.embed_color || '#d6c2ee')
    .setTitle(`<:rumble:1522372419338375299> Create Your Own Grind Channel <:rumble:1522372419338375299>`)
    .setDescription(
      `Click the button below to get your own rumble grind channel.\n` +
      `After **${config.duration_hours || 1} hour(s)**, it will self-delete. Pressing the button again will reset the timer.\n\n` +
      `**Current Active Grind Channels: ${count}/${config.max_channels || 50}**`
    );

  const subRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('grind_subscribe').setLabel('Get Notified').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('grind_unsubscribe').setLabel('Remove Notifications').setStyle(ButtonStyle.Danger),
  );

  const chRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('grind_create').setLabel('Create Grind Channel').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('grind_delete').setLabel('Delete Grind Channel').setStyle(ButtonStyle.Danger),
  );

  return { subEmbed, chEmbed, subRow, chRow };
}

async function updatePanelCount(client, config) {
  if (!config.panel_channel_id || !config.panel_message_id2) return;
  const count = await getChannelCount(config.guild_id);
  const ch = (await client.channels.fetch(config.panel_channel_id).catch(() => null));
  if (!ch) return;
  const msg = await ch.messages.fetch(config.panel_message_id2).catch(() => null);
  if (!msg) return;
  const { chEmbed } = buildPanelEmbeds(config, count);
  await msg.edit({ embeds: [chEmbed] }).catch(() => {});
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grind')
    .setDescription('Rumble Grind channel management')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Set up the Rumble Grind panel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post the panel in').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Notification role for subscribers').setRequired(true))
      .addIntegerOption(o => o.setName('max_channels').setDescription('Max temp channels allowed (default: 50)').setMinValue(1).setMaxValue(200))
      .addIntegerOption(o => o.setName('duration').setDescription('Hours before auto-delete (default: 1)').setMinValue(1).setMaxValue(24))
      .addStringOption(o => o.setName('embed_color').setDescription('Embed color hex (default: #d6c2ee)')))
    .addSubcommand(sub => sub
      .setName('panel')
      .setDescription('Re-post the Rumble Grind panel'))
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('View current Grind config and active channels')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── /grind setup ────────────────────────────────────────────────────────
    if (sub === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID) {
        return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });

      const channel     = interaction.options.getChannel('channel');
      const role        = interaction.options.getRole('role');
      const maxChannels = interaction.options.getInteger('max_channels') || 50;
      const duration    = interaction.options.getInteger('duration') || 1;
      const color       = interaction.options.getString('embed_color') || '#d6c2ee';

      await query(`
        INSERT INTO grind_config (guild_id, panel_channel_id, role_id, max_channels, duration_hours, embed_color)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (guild_id) DO UPDATE SET
          panel_channel_id = EXCLUDED.panel_channel_id,
          role_id          = EXCLUDED.role_id,
          max_channels     = EXCLUDED.max_channels,
          duration_hours   = EXCLUDED.duration_hours,
          embed_color      = EXCLUDED.embed_color
      `, [interaction.guild.id, channel.id, role.id, maxChannels, duration, color]);

      // Post panel
      const count = await getChannelCount(interaction.guild.id);
      const config = { guild_id: interaction.guild.id, embed_color: color, max_channels: maxChannels, duration_hours: duration };
      const { subEmbed, chEmbed, subRow, chRow } = buildPanelEmbeds(config, count);

      const msg1 = await channel.send({ embeds: [subEmbed], components: [subRow] });
      const msg2 = await channel.send({ embeds: [chEmbed], components: [chRow] });

      await query(`
        UPDATE grind_config SET panel_message_id1 = $1, panel_message_id2 = $2 WHERE guild_id = $3
      `, [msg1.id, msg2.id, interaction.guild.id]);

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(color)
        .setTitle('✅ Grind Panel Posted!')
        .setDescription(`Panel posted in <#${channel.id}>.\nRole: <@&${role.id}>\nMax channels: ${maxChannels}\nAuto-delete: ${duration}h`)]});
    }

    // ── /grind panel (re-post) ──────────────────────────────────────────────
    if (sub === 'panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID) {
        return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });

      const config = await getConfig(interaction.guild.id);
      if (!config) return interaction.editReply('❌ Run `/grind setup` first.');

      const ch = (await interaction.client.channels.fetch(config.panel_channel_id).catch(() => null));
      if (!ch) return interaction.editReply('❌ Panel channel not found.');

      const count = await getChannelCount(interaction.guild.id);
      const { subEmbed, chEmbed, subRow, chRow } = buildPanelEmbeds(config, count);

      const msg1 = await ch.send({ embeds: [subEmbed], components: [subRow] });
      const msg2 = await ch.send({ embeds: [chEmbed], components: [chRow] });

      await query('UPDATE grind_config SET panel_message_id1 = $1, panel_message_id2 = $2 WHERE guild_id = $3',
        [msg1.id, msg2.id, interaction.guild.id]);

      return interaction.editReply('✅ Panel re-posted!');
    }

    // ── /grind info ─────────────────────────────────────────────────────────
    if (sub === 'info') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID) {
        return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });

      const config = await getConfig(interaction.guild.id);
      if (!config) return interaction.editReply('❌ No Grind config found. Run `/grind setup` first.');

      const count = await getChannelCount(interaction.guild.id);
      const chRes = await query(
        'SELECT user_id, channel_id, created_at, expires_at FROM grind_channels WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 10',
        [interaction.guild.id]
      );

      const chLines = chRes.rows.length
        ? chRes.rows.map(r => `<@${r.user_id}> → <#${r.channel_id}>`).join('\n')
        : 'No active channels.';

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(config.embed_color || '#d6c2ee')
        .setTitle('<:rumble:1522372419338375299> Grind Config')
        .addFields(
          { name: 'Panel Channel',  value: `<#${config.panel_channel_id}>`, inline: true },
          { name: 'Notify Role',    value: `<@&${config.role_id}>`,          inline: true },
          { name: 'Max Channels',   value: `${config.max_channels}`,          inline: true },
          { name: 'Auto-delete',    value: `${config.duration_hours}h`,       inline: true },
          { name: 'Active Channels', value: `${count}/${config.max_channels}`, inline: true },
          { name: 'Active List',    value: chLines, inline: false },
        )]});
    }
  },

  // ── Button handler ────────────────────────────────────────────────────────
  async handleButton(interaction, client) {
    const { customId, guild, member } = interaction;

    const config = await getConfig(guild.id);
    if (!config) return interaction.reply({ content: '❌ Grind not configured.', ephemeral: true });

    // ── Subscribe / Unsubscribe ─────────────────────────────────────────────
    if (customId === 'grind_subscribe') {
      const role = guild.roles.cache.get(config.role_id);
      if (!role) return interaction.reply({ content: '❌ Role not found.', ephemeral: true });
      if (member.roles.cache.has(config.role_id)) {
        return interaction.reply({ content: `You already have the <@&${config.role_id}> role!`, ephemeral: true });
      }
      await member.roles.add(role);
      return interaction.reply({ content: `✅ You're now subscribed! You'll be pinged for Grind battles.`, ephemeral: true });
    }

    if (customId === 'grind_unsubscribe') {
      if (!member.roles.cache.has(config.role_id)) {
        return interaction.reply({ content: `You don't have the <@&${config.role_id}> role.`, ephemeral: true });
      }
      await member.roles.remove(config.role_id);
      return interaction.reply({ content: `✅ Unsubscribed — you won't be pinged for Grind battles anymore.`, ephemeral: true });
    }

    // ── Create channel ──────────────────────────────────────────────────────
    if (customId === 'grind_create') {
      await interaction.deferReply({ ephemeral: true });

      // Check if user already has a channel
      const existing = await getUserChannel(guild.id, member.id);
      if (existing) {
        // Reset timer instead
        const newExpiry = new Date(Date.now() + (config.duration_hours * 60 * 60 * 1000));
        await query('UPDATE grind_channels SET expires_at = $1 WHERE guild_id = $2 AND user_id = $3',
          [newExpiry, guild.id, member.id]);
        return interaction.editReply({ content: `⏰ Your channel <#${existing.channel_id}> timer has been reset to ${config.duration_hours}h!` });
      }

      // Check capacity
      const count = await getChannelCount(guild.id);
      if (count >= config.max_channels) {
        return interaction.editReply({ content: `❌ Max channel capacity reached (${config.max_channels}). Try again later!` });
      }

      // Create channel in same category, inheriting the category's own permissions
      // (e.g. staff roles already granted access there) on top of channel privacy
      const parentId = interaction.channel.parentId;
      const parentCategory = parentId ? await guild.channels.fetch(parentId).catch(() => null) : null;

      // Start with whatever the category already has set up
      const overwriteMap = new Map();
      if (parentCategory) {
        for (const ow of parentCategory.permissionOverwrites.cache.values()) {
          overwriteMap.set(ow.id, { id: ow.id, allow: ow.allow.toArray(), deny: ow.deny.toArray() });
        }
      }
      // Then enforce the channel's own privacy rules — these take priority over
      // whatever the category has, so the channel stays private to its owner
      overwriteMap.set(guild.roles.everyone.id, { id: guild.roles.everyone.id, deny: ['ViewChannel'] });
      overwriteMap.set(member.id, { id: member.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });
      overwriteMap.set(client.user.id, { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels'] });

      const newChannel = await guild.channels.create({
        name: `grind-${member.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 100),
        type: ChannelType.GuildText,
        parent: parentId || null,
        permissionOverwrites: [...overwriteMap.values()],
      });

      const expiry = new Date(Date.now() + (config.duration_hours * 60 * 60 * 1000));
      await query(
        'INSERT INTO grind_channels (guild_id, user_id, channel_id, expires_at) VALUES ($1,$2,$3,$4)',
        [guild.id, member.id, newChannel.id, expiry]
      );

      // Schedule auto-delete
      scheduleDelete(newChannel, guild.id, member.id, config.duration_hours * 60 * 60 * 1000, client, config);

      // Update panel count
      await updatePanelCount(client, { ...config, guild_id: guild.id });

      // Welcome message in new channel
      await newChannel.send({ embeds: [new EmbedBuilder()
        .setColor(config.embed_color || '#d6c2ee')
        .setTitle('<:rumble:1522372419338375299> Your Grind Channel')
        .setDescription(`Welcome <@${member.id}>! This channel auto-deletes in **${config.duration_hours}h**.\nClick "Create Grind Channel" again to reset the timer.`)
        .setFooter({ text: `Expires at` }).setTimestamp(expiry)
      ]});

      return interaction.editReply({ content: `✅ Your grind channel <#${newChannel.id}> has been created! It auto-deletes in ${config.duration_hours}h.` });
    }

    // ── Delete channel ──────────────────────────────────────────────────────
    if (customId === 'grind_delete') {
      await interaction.deferReply({ ephemeral: true });

      const existing = await getUserChannel(guild.id, member.id);

      // Admins can delete any channel
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator) || member.id === process.env.OWNER_ID;

      if (!existing && !isAdmin) {
        return interaction.editReply({ content: `❌ You don't have a Grind channel to delete.` });
      }

      if (existing) {
        const ch = (await guild.channels.fetch(existing.channel_id).catch(() => null));
        if (ch) await ch.delete().catch(() => {});
        await query('DELETE FROM grind_channels WHERE guild_id = $1 AND user_id = $2', [guild.id, member.id]);
        await updatePanelCount(client, { ...config, guild_id: guild.id });
        return interaction.editReply({ content: `✅ Your Grind channel has been deleted.` });
      }

      return interaction.editReply({ content: `❌ No channel found to delete.` });
    }
  },
};

// ── Auto-delete scheduler ─────────────────────────────────────────────────────
const deleteTimers = new Map();

function scheduleDelete(channel, guildId, userId, ms, client, config) {
  const key = `${guildId}:${userId}`;
  if (deleteTimers.has(key)) clearTimeout(deleteTimers.get(key));

  const timer = setTimeout(async () => {
    try {
      await channel.delete().catch(() => {});
      await query('DELETE FROM grind_channels WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
      deleteTimers.delete(key);
      // Update panel count
      const cfg = await query('SELECT * FROM grind_config WHERE guild_id = $1', [guildId]);
      if (cfg.rows[0]) await updatePanelCount(client, cfg.rows[0]);
    } catch (e) { console.error('[Grind] auto-delete error:', e.message); }
  }, ms);

  deleteTimers.set(key, timer);
}

module.exports.scheduleDelete = scheduleDelete;
module.exports.deleteTimers = deleteTimers;
