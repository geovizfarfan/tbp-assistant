const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pingpanel')
    .setDescription('Post a role ping toggle panel')
    .addSubcommand(sub => sub
      .setName('post')
      .setDescription('Post a Get Ping / Remove Ping panel for a role')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post in').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to give/remove').setRequired(true))
      .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Custom description (leave empty for default)'))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex (default: #d6c2ee)'))),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const channel     = interaction.options.getChannel('channel');
    const role        = interaction.options.getRole('role');
    const title       = interaction.options.getString('title');
    const description = interaction.options.getString('description') ||
      `Want to get notified <a:notify:1522746425639960636> ?\nClick Below <a:whitesparkle:1512912831761092740>`;
    const color       = interaction.options.getString('color') || '#d6c2ee';

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pingpanel_get:${role.id}`)
        .setLabel('Get Notified')
        .setEmoji('<a:notify:1522746425639960636>')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`pingpanel_remove:${role.id}`)
        .setLabel('Remove Ping')
        .setStyle(ButtonStyle.Danger),
    );

    await channel.send({ embeds: [embed], components: [row] });

    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(color)
      .setDescription(`✅ Panel posted in <#${channel.id}> for <@&${role.id}>.`)]});
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
};
