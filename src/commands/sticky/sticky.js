const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');
const { markExpected } = require('../../utils/stickyDeleteTracker');

// If two messages land in the same channel within milliseconds of each
// other, handleStickyRepost could run twice concurrently — both fetching
// the same old message before either updates the DB, both deleting it,
// both posting a new one. Only one gets tracked, the other is orphaned and
// piles up forever. This lock makes sure only one repost cycle runs at a
// time per channel; anything that arrives while one is in flight is skipped
// (the message that triggered it already did its job of prompting a repost).
const stickyRepostInProgress = new Set();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Manage sticky (persistent) messages in a channel')
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set a sticky message in the current channel')
      .addStringOption(o => o.setName('message').setDescription('The message to keep at the bottom').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex (default: #d6c2ee)'))
      .addStringOption(o => o.setName('title').setDescription('Optional embed title')))
    .addSubcommand(sub => sub
      .setName('edit')
      .setDescription('Edit the sticky message in the current channel')
      .addStringOption(o => o.setName('message').setDescription('New message content').setRequired(true))
      .addStringOption(o => o.setName('title').setDescription('New title (leave empty to keep current)'))
      .addStringOption(o => o.setName('color').setDescription('New embed color hex')))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove the sticky message from the current channel'))
    .addSubcommandGroup(group => group
      .setName('permissions')
      .setDescription('Grant non-admins the ability to manage stickies (admin only)')
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Allow a role or user to manage stickies')
        .addRoleOption(o => o.setName('role').setDescription('Role to allow'))
        .addUserOption(o => o.setName('user').setDescription('User to allow')))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Revoke sticky permission from a role or user')
        .addRoleOption(o => o.setName('role').setDescription('Role to revoke'))
        .addUserOption(o => o.setName('user').setDescription('User to revoke')))
      .addSubcommand(sub => sub
        .setName('list')
        .setDescription('List every role/user currently allowed to manage stickies'))),

  async execute(interaction) {
    const sub   = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
      interaction.user.id === process.env.OWNER_ID;

    if (group === 'permissions') {
      if (!isAdmin) return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      if (sub === 'add') return grantStickyPermission(interaction);
      if (sub === 'remove') return revokeStickyPermission(interaction);
      if (sub === 'list') return listStickyPermissions(interaction);
      return;
    }

    if (!isAdmin) {
      const roleIds = interaction.member.roles.cache.map(r => r.id);
      const permRes = await query(
        `SELECT 1 FROM sticky_permissions WHERE guild_id=$1 AND (
           (target_type='user' AND target_id=$2) OR
           (target_type='role' AND target_id = ANY($3::text[]))
         ) LIMIT 1`,
        [interaction.guildId, interaction.user.id, roleIds]
      );
      if (!permRes.rows.length) {
        return interaction.reply({ content: '❌ Admin only, or a role/user granted sticky permission.', ephemeral: true });
      }
    }
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.channel;

    if (sub === 'set') {
      const text  = interaction.options.getString('message').replace(/\\n/g, '\n');
      const color = interaction.options.getString('color') || '#d6c2ee';
      const title = interaction.options.getString('title') || null;

      const embed = new EmbedBuilder().setColor(color).setDescription(text);
      if (title) embed.setTitle(title);

      const msg = await channel.send({ embeds: [embed] });

      await query(`
        INSERT INTO sticky_messages (guild_id, channel_id, message_id, content, title, color)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (guild_id, channel_id) DO UPDATE SET
          message_id = EXCLUDED.message_id,
          content    = EXCLUDED.content,
          title      = EXCLUDED.title,
          color      = EXCLUDED.color
      `, [interaction.guild.id, channel.id, msg.id, text, title, color]);

      return interaction.editReply(`✅ Sticky message set in <#${channel.id}>. It will stay at the bottom.`);
    }

    if (sub === 'edit') {
      const text  = interaction.options.getString('message').replace(/\\n/g, '\n');
      const color = interaction.options.getString('color');
      const title = interaction.options.getString('title');

      const res = await query('SELECT * FROM sticky_messages WHERE guild_id = $1 AND channel_id = $2', [interaction.guild.id, channel.id]);
      if (!res.rows.length) return interaction.editReply('❌ No sticky message found in this channel. Set one up via `/server-setup` → Panels & Sticky Content first.');

      const sticky = res.rows[0];
      const newColor = color || sticky.color;
      const newTitle = title !== null ? title : sticky.title;

      // Delete old message
      const oldMsg = await channel.messages.fetch(sticky.message_id).catch(() => null);
      if (oldMsg) { markExpected(oldMsg.id); await oldMsg.delete().catch(() => {}); }

      // Post updated message
      const embed = new EmbedBuilder().setColor(newColor).setDescription(text);
      if (newTitle) embed.setTitle(newTitle);
      const newMsg = await channel.send({ embeds: [embed] });

      await query('UPDATE sticky_messages SET message_id = $1, content = $2, title = $3, color = $4 WHERE guild_id = $5 AND channel_id = $6',
        [newMsg.id, text, newTitle, newColor, interaction.guild.id, channel.id]);

      return interaction.editReply('✅ Sticky message updated!');
    }

    if (sub === 'remove') {
      const res = await query(
        'DELETE FROM sticky_messages WHERE guild_id = $1 AND channel_id = $2 RETURNING message_id',
        [interaction.guild.id, channel.id]
      );
      if (!res.rows.length) return interaction.editReply('❌ No sticky message found in this channel.');

      // Delete the actual message
      const oldMsg = await channel.messages.fetch(res.rows[0].message_id).catch(() => null);
      if (oldMsg) { markExpected(oldMsg.id); await oldMsg.delete().catch(() => {}); }

      return interaction.editReply(`✅ Sticky message removed from <#${channel.id}>.`);
    }
  },

  // Called from index.js on every messageCreate
  async handleStickyRepost(message, client) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const lockKey = `${message.guild.id}:${message.channel.id}`;
    if (stickyRepostInProgress.has(lockKey)) return; // a repost cycle for this channel is already running
    stickyRepostInProgress.add(lockKey);

    try {
      const res = await query(
        'SELECT * FROM sticky_messages WHERE guild_id = $1 AND channel_id = $2',
        [message.guild.id, message.channel.id]
      );
      if (!res.rows.length) return;

      const sticky = res.rows[0];

      // Delete old sticky message
      const oldMsg = await message.channel.messages.fetch(sticky.message_id).catch(() => null);
      if (oldMsg) {
        markExpected(oldMsg.id);
        await oldMsg.delete().catch(err => console.error(`[Sticky] Failed to delete old message ${oldMsg.id} in channel ${message.channel.id}:`, err.message));
      }

      // Repost
      const embed = new EmbedBuilder().setColor(sticky.color || '#d6c2ee').setDescription(sticky.content);
      if (sticky.title) embed.setTitle(sticky.title);

      const newMsg = await message.channel.send({ embeds: [embed] });

      // Update stored message ID
      await query('UPDATE sticky_messages SET message_id = $1 WHERE guild_id = $2 AND channel_id = $3',
        [newMsg.id, message.guild.id, message.channel.id]);
    } catch (e) {
      console.error(`[Sticky] Repost cycle failed in channel ${message.channel.id}:`, e.message);
    } finally {
      stickyRepostInProgress.delete(lockKey);
    }
  },
};

async function grantStickyPermission(interaction) {
  const role = interaction.options.getRole('role');
  const user = interaction.options.getUser('user');
  if (!role && !user) return interaction.editReply('❌ Provide a `role` or a `user`.');
  if (role && user) return interaction.editReply('❌ Provide only one of `role` or `user`, not both.');

  const targetType = role ? 'role' : 'user';
  const targetId = role ? role.id : user.id;

  await query(
    `INSERT INTO sticky_permissions (guild_id, target_type, target_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [interaction.guildId, targetType, targetId]
  );

  return interaction.editReply(`✅ ${role ? `<@&${role.id}>` : `<@${user.id}>`} can now manage stickies.`);
}

async function revokeStickyPermission(interaction) {
  const role = interaction.options.getRole('role');
  const user = interaction.options.getUser('user');
  if (!role && !user) return interaction.editReply('❌ Provide a `role` or a `user`.');
  if (role && user) return interaction.editReply('❌ Provide only one of `role` or `user`, not both.');

  const targetType = role ? 'role' : 'user';
  const targetId = role ? role.id : user.id;

  const res = await query(
    `DELETE FROM sticky_permissions WHERE guild_id=$1 AND target_type=$2 AND target_id=$3 RETURNING id`,
    [interaction.guildId, targetType, targetId]
  );
  if (!res.rows.length) return interaction.editReply(`❌ ${role ? `<@&${role.id}>` : `<@${user.id}>`} didn't have sticky permission.`);

  return interaction.editReply(`✅ Revoked sticky permission from ${role ? `<@&${role.id}>` : `<@${user.id}>`}.`);
}

async function listStickyPermissions(interaction) {
  const res = await query(`SELECT target_type, target_id FROM sticky_permissions WHERE guild_id=$1`, [interaction.guildId]);
  if (!res.rows.length) return interaction.editReply('No extra roles/users have sticky permission — admins only for now.');

  const lines = res.rows.map(r => r.target_type === 'role' ? `<@&${r.target_id}>` : `<@${r.target_id}>`).join('\n');
  return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee').setTitle('📌 Sticky Permissions').setDescription(lines)] });
}
