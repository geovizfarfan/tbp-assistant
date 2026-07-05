const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete messages from the current channel')
    .addIntegerOption(o => o.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addRoleOption(o => o.setName('allowed_role').setDescription('Only members with this role can use /purge (admin can always use it)')),

  async execute(interaction) {
    // Check permission — admin always allowed, or has the configured purge role
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                    interaction.user.id === process.env.OWNER_ID;

    if (!isAdmin) {
      // Check if they have the purge role from guild_config
      const res = await query('SELECT purge_role_id FROM guild_config WHERE guild_id = $1', [interaction.guild.id]);
      const purgeRoleId = res.rows[0]?.purge_role_id;
      if (!purgeRoleId || !interaction.member.roles.cache.has(purgeRoleId)) {
        return interaction.reply({ content: '❌ You don\'t have permission to use this command.', ephemeral: true });
      }
    }

    await interaction.deferReply({ ephemeral: true });
    const amount = interaction.options.getInteger('amount');

    const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
    const count = deleted?.size || 0;

    return interaction.editReply(`✅ Deleted **${count}** message(s).`);
  },
};
