const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rrlog')
    .setDescription('Admin: Manage Rumble Royale log channel')
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set the log channel for RR events')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post logs in').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Remove the log channel config')),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel');
      await query(`
        INSERT INTO rr_guild_config (guild_id, log_channel_id)
        VALUES ($1, $2)
        ON CONFLICT (guild_id) DO UPDATE SET log_channel_id = EXCLUDED.log_channel_id
      `, [interaction.guild.id, channel.id]);

      return interaction.editReply({ embeds: [
        new EmbedBuilder()
          .setColor('#d6c2ee')
          .setTitle('<:rumble:1522372419338375299> RR Log Channel Set')
          .setDescription(`Achievement and config logs will be posted in <#${channel.id}>.`)
      ]});
    }

    if (sub === 'clear') {
      await query('UPDATE rr_guild_config SET log_channel_id = NULL WHERE guild_id = $1', [interaction.guild.id]);
      return interaction.editReply({ embeds: [
        new EmbedBuilder()
          .setColor('#d6c2ee')
          .setDescription('RR log channel has been cleared.')
      ]});
    }
  },
};
