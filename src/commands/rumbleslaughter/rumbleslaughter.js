const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rs')
    .setDescription('Rumble Slaughter management')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Configure a Rumble Slaughter channel (only updates fields you provide)')
      .addChannelOption(o => o.setName('channel').setDescription('Channel Rumble Slaughter runs in').setRequired(true))
      .addRoleOption(o => o.setName('winner_role').setDescription('Role to auto-assign to the champion'))
      .addRoleOption(o => o.setName('ping_role').setDescription('Role to ping in the announcement and to host again'))
      .addChannelOption(o => o.setName('next_channel').setDescription('Next game room'))
      .addStringOption(o => o.setName('battle_title').setDescription('Custom title for the champion announcement'))
      .addStringOption(o => o.setName('description').setDescription('Custom description (use \\n for new lines)'))
      .addBooleanOption(o => o.setName('announce').setDescription('Post a confirmation embed when a role is assigned (default: True)')))
    .addSubcommandGroup(group => group
      .setName('reward')
      .setDescription('One-time rewards for the next game')
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Add a one-time reward or description to the next champion announcement (staff/mod)')
        .addChannelOption(o => o.setName('channel').setDescription('RS channel').setRequired(true))
        .addStringOption(o => o.setName('other_reward').setDescription('Custom reward (e.g. Sticker, Nitro Basic)'))
        .addStringOption(o => o.setName('description').setDescription('One-time description (use \\n for new lines)')))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Clear the pending one-time reward before it gets used')
        .addChannelOption(o => o.setName('channel').setDescription('RS channel').setRequired(true))))
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

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const winnerRole = interaction.options.getRole('winner_role');
      const pingRole = interaction.options.getRole('ping_role');
      const nextChannel = interaction.options.getChannel('next_channel');
      const battleTitle = interaction.options.getString('battle_title');
      const description = interaction.options.getString('description')?.replace(/\\n/g, '\n');
      const announce = interaction.options.getBoolean('announce');

      await query(`
        INSERT INTO rumble_slaughter_config (channel_id, guild_id, winner_role_id, ping_role_id, next_channel_id, battle_title, description, announce)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (channel_id) DO UPDATE SET
          winner_role_id = COALESCE($3, rumble_slaughter_config.winner_role_id),
          ping_role_id = COALESCE($4, rumble_slaughter_config.ping_role_id),
          next_channel_id = COALESCE($5, rumble_slaughter_config.next_channel_id),
          battle_title = COALESCE($6, rumble_slaughter_config.battle_title),
          description = COALESCE($7, rumble_slaughter_config.description),
          announce = COALESCE($8, rumble_slaughter_config.announce)
      `, [channel.id, interaction.guildId, winnerRole?.id || null, pingRole?.id || null, nextChannel?.id || null, battleTitle, description, announce]);

      return interaction.editReply(`✅ <#${channel.id}> configured for Rumble Slaughter.`);
    }

    if (group === 'reward' && sub === 'add') {
      const channel = interaction.options.getChannel('channel');
      const otherReward = interaction.options.getString('other_reward') || null;
      const description = interaction.options.getString('description')?.replace(/\\n/g, '\n') || null;

      const res = await query('SELECT 1 FROM rumble_slaughter_config WHERE channel_id = $1', [channel.id]);
      if (!res.rows.length) return interaction.editReply(`❌ <#${channel.id}> isn't configured yet — run \`/rs setup\` first.`);

      await query(`UPDATE rumble_slaughter_config SET other_reward = $1, host_description = $2 WHERE channel_id = $3`,
        [otherReward, description, channel.id]);

      return interaction.editReply(`✅ One-time reward/description added — will appear on the next champion announcement in <#${channel.id}>, then clear automatically.`);
    }

    if (group === 'reward' && sub === 'remove') {
      const channel = interaction.options.getChannel('channel');
      const res = await query('SELECT * FROM rumble_slaughter_config WHERE channel_id = $1', [channel.id]);
      if (!res.rows.length) return interaction.editReply(`❌ <#${channel.id}> isn't configured yet — run \`/rs setup\` first.`);

      if (!res.rows[0].other_reward && !res.rows[0].host_description) {
        return interaction.editReply(`❌ There's no pending one-time reward to remove for <#${channel.id}>.`);
      }

      await query(`UPDATE rumble_slaughter_config SET other_reward = NULL, host_description = NULL WHERE channel_id = $1`, [channel.id]);
      return interaction.editReply(`✅ Pending one-time reward removed for <#${channel.id}>.`);
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
          { name: 'Next Channel', value: cfg.next_channel_id ? `<#${cfg.next_channel_id}>` : 'Not set', inline: true },
          { name: 'Announce', value: cfg.announce ? 'Yes' : 'No', inline: true },
          { name: 'Battle Title', value: cfg.battle_title || '*(default)*', inline: false },
          { name: 'Description', value: cfg.description || '*(none)*', inline: false },
          { name: 'Pending One-Time Reward', value: cfg.other_reward || '*(none)*', inline: false },
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
