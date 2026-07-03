const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rrlog')
    .setDescription('Admin: Set the log channel for Rumble Royale all-roles achievements')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to post achievement logs').setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.options.getChannel('channel');

    await query(`
      INSERT INTO rr_guild_config (guild_id, log_channel_id)
      VALUES ($1, $2)
      ON CONFLICT (guild_id) DO UPDATE SET log_channel_id = EXCLUDED.log_channel_id
    `, [interaction.guild.id, channel.id]);

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle('✅ RR Log Channel Set')
        .setDescription(`Achievement logs will be posted in <#${channel.id}>.`)]
    });
  },
};
