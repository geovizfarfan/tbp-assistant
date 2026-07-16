const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Toggle Send Messages off/on for everyone in a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to lock/unlock (default: current channel)'))
    .addStringOption(o => o.setName('reason').setDescription('Reason (shown in the lock message)')),

  async execute(interaction) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
      interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);
    if (!isAdmin) return interaction.reply({ content: '❌ You need Manage Channels permission to use this.', ephemeral: true });

    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason');

    await interaction.deferReply();

    const everyone = interaction.guild.roles.everyone;
    const currentOverwrite = channel.permissionOverwrites.cache.get(everyone.id);
    const isCurrentlyLocked = currentOverwrite?.deny?.has(PermissionFlagsBits.SendMessages);

    if (isCurrentlyLocked) {
      // Unlock: remove the explicit SendMessages deny
      await channel.permissionOverwrites.edit(everyone, { SendMessages: null }).catch(() => {});
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#2ecc71')
        .setDescription(`🔓 <#${channel.id}> has been unlocked — members can send messages again.`)] });
    } else {
      await channel.permissionOverwrites.edit(everyone, { SendMessages: false }).catch(() => {});
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#e74c3c')
        .setDescription(`🔒 <#${channel.id}> has been locked — members can view but not send messages.${reason ? `\n**Reason:** ${reason}` : ''}`)] });
    }
  },
};
