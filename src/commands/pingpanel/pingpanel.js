const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');

function buildPanel(title, description, roleId, color) {
  const embed = new EmbedBuilder()
    .setColor(color || '#d6c2ee')
    .setTitle(title)
    .setDescription(description);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pingpanel_get:${roleId}`)
      .setLabel('Get Notified')
      .setEmoji('<a:notify:1522746425639960636>')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`pingpanel_remove:${roleId}`)
      .setLabel('Remove Ping')
      .setStyle(ButtonStyle.Danger),
  );

  return { embed, row };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pingpanel')
    .setDescription('Post a sticky role ping toggle panel')
    .addSubcommand(sub => sub
      .setName('post')
      .setDescription('Post a sticky Get Ping / Remove Ping panel')
      
      .addRoleOption(o => o.setName('role').setDescription('Role to give/remove').setRequired(true))
      .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post in (default: current channel)'))
      .addStringOption(o => o.setName('description').setDescription('Custom description (leave empty for default)'))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex (default: #d6c2ee)')))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove the sticky panel from a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to remove panel from').setRequired(true))),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const sub = interaction.options.getSubcommand();

    if (sub === 'post') {
      const channel     = interaction.options.getChannel('channel') || interaction.channel;
      const role        = interaction.options.getRole('role');
      const title       = interaction.options.getString('title');
      const description = interaction.options.getString('description') ||
        `Want to get notified <a:notify:1522746425639960636> ?\nClick Below <a:whitesparkle:1512912831761092740>`;
      const color       = interaction.options.getString('color') || '#d6c2ee';

      const { embed, row } = buildPanel(title, description, role.id, color);
      const msg = await channel.send({ embeds: [embed], components: [row] });

      await query(`
        INSERT INTO pingpanel_sticky (guild_id, channel_id, role_id, message_id, title, description, color)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (guild_id, channel_id) DO UPDATE SET
          role_id = EXCLUDED.role_id, message_id = EXCLUDED.message_id,
          title = EXCLUDED.title, description = EXCLUDED.description, color = EXCLUDED.color
      `, [interaction.guild.id, channel.id, role.id, msg.id, title, description, color]);

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`✅ Sticky panel posted in <#${channel.id}> for <@&${role.id}>.`)]});
    }

    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel');
      await query('DELETE FROM pingpanel_sticky WHERE guild_id = $1 AND channel_id = $2',
        [interaction.guild.id, channel.id]);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setDescription(`✅ Sticky panel removed from <#${channel.id}>.`)]});
    }
  },

  async handleButton(interaction) {
    const [action, roleId] = interaction.customId.split(':');

    if (action === 'pingpanel_get') {
      if (interaction.member.roles.cache.has(roleId)) {
        return interaction.reply({ content: `You already have this notification role!`, ephemeral: true });
      }
      await interaction.member.roles.add(roleId).catch(() => {});
      return interaction.reply({ content: `<a:notify:1522746425639960636> You'll now be notified!`, ephemeral: true });
    }

    if (action === 'pingpanel_remove') {
      if (!interaction.member.roles.cache.has(roleId)) {
        return interaction.reply({ content: `You don't have this notification role.`, ephemeral: true });
      }
      await interaction.member.roles.remove(roleId).catch(() => {});
      return interaction.reply({ content: `✅ Notifications removed.`, ephemeral: true });
    }
  },

  // Called from index.js messageCreate to handle sticky repost
  async handleStickyRepost(message, client) {
    if (message.author.bot) return;
    if (!message.guild) return;

    try {
      const res = await query(
        'SELECT * FROM pingpanel_sticky WHERE guild_id = $1 AND channel_id = $2',
        [message.guild.id, message.channel.id]
      );
      if (!res.rows.length) return;

      const panel = res.rows[0];

      // Delete old panel message
      const oldMsg = await message.channel.messages.fetch(panel.message_id).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});

      // Repost
      const { embed, row } = buildPanel(panel.title, panel.description, panel.role_id, panel.color);
      const newMsg = await message.channel.send({ embeds: [embed], components: [row] });

      // Update stored message ID
      await query('UPDATE pingpanel_sticky SET message_id = $1 WHERE guild_id = $2 AND channel_id = $3',
        [newMsg.id, message.guild.id, message.channel.id]);
    } catch (e) { /* ignore */ }
  },
};
