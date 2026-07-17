const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rumbleslaughter')
    .setDescription('Configure auto role assignment for Rumble Slaughter champions')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Set the winner role for a Rumble Slaughter channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel Rumble Slaughter runs in').setRequired(true))
      .addRoleOption(o => o.setName('winner_role').setDescription('Role to auto-assign to the champion').setRequired(true))
      .addRoleOption(o => o.setName('ping_role').setDescription('Role to ping in the announcement (optional)'))
      .addBooleanOption(o => o.setName('announce').setDescription('Post a confirmation embed when a role is assigned (default: True)')))
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('View the current config for a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to check').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove Rumble Slaughter config from a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true))),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const winnerRole = interaction.options.getRole('winner_role');
      const pingRole = interaction.options.getRole('ping_role');
      const announce = interaction.options.getBoolean('announce');

      await query(`
        INSERT INTO rumble_slaughter_config (channel_id, guild_id, winner_role_id, ping_role_id, announce)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (channel_id) DO UPDATE SET
          winner_role_id = $3,
          ping_role_id = COALESCE($4, rumble_slaughter_config.ping_role_id),
          announce = COALESCE($5, rumble_slaughter_config.announce)
      `, [channel.id, interaction.guildId, winnerRole.id, pingRole?.id || null, announce]);

      return interaction.editReply(`✅ <#${channel.id}> configured — champions will be auto-assigned <@&${winnerRole.id}>.${pingRole ? ` ${pingRole} will be pinged in the announcement.` : ''}`);
    }

    if (sub === 'info') {
      const channel = interaction.options.getChannel('channel');
      const res = await query('SELECT * FROM rumble_slaughter_config WHERE channel_id = $1', [channel.id]);
      if (!res.rows.length) return interaction.editReply(`❌ <#${channel.id}> isn't configured for Rumble Slaughter.`);

      const cfg = res.rows[0];
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('💀 Rumble Slaughter Config')
        .addFields(
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Winner Role', value: cfg.winner_role_id ? `<@&${cfg.winner_role_id}>` : 'Not set', inline: true },
          { name: 'Ping Role', value: cfg.ping_role_id ? `<@&${cfg.ping_role_id}>` : 'None', inline: true },
          { name: 'Announce', value: cfg.announce ? 'Yes' : 'No', inline: true },
        )]});
    }

    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel');
      const del = await query('DELETE FROM rumble_slaughter_config WHERE channel_id = $1 RETURNING channel_id', [channel.id]);
      if (!del.rows.length) return interaction.editReply(`❌ <#${channel.id}> wasn't configured.`);
      return interaction.editReply(`✅ Removed Rumble Slaughter config from <#${channel.id}>.`);
    }
  },
};
