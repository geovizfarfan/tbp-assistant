const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rrclear')
    .setDescription('Admin: Remove Rumble Royale config for a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to clear config for').setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.options.getChannel('channel');

    const res = await query(
      'DELETE FROM rr_channel_config WHERE channel_id = $1 RETURNING channel_id',
      [channel.id]
    );

    if (!res.rows.length) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor('#ff4444')
          .setDescription(`❌ No config found for <#${channel.id}> — nothing to clear.`)]
      });
    }

    // Post to log channel
    const guildConfig = await query('SELECT log_channel_id FROM rr_guild_config WHERE guild_id = $1', [interaction.guild.id]);
    const logChannelId = guildConfig.rows[0]?.log_channel_id;
    if (logChannelId) {
      const logChannel = interaction.client.channels.cache.get(logChannelId);
      if (logChannel) await logChannel.send({ embeds: [
        new EmbedBuilder()
          .setColor('#ff4444')
          .setTitle('<:rumble:1522372419338375299> RR Config Cleared')
          .setDescription(`<#${channel.id}> config was cleared by <@${interaction.user.id}>.
VELOURA will no longer monitor that channel.`)
          .setTimestamp()
          .setFooter({ text: interaction.guild.name })
      ]}).catch(() => {});
    }

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle('<:rumble:1522372419338375299> Config Cleared')
        .setDescription(`All Rumble Royale config for <#${channel.id}> has been removed.\nVELOURA will no longer monitor that channel.`)]
    });
  },
};
