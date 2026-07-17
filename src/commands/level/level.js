const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { xpForNextLevel, levelFromXp, getTier, getLevelConfig, getUserLevel } = require('../../utils/levelSystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Level up system — earn XP by chatting')

    .addSubcommand(sub => sub
      .setName('check')
      .setDescription('Check your (or someone else\'s) level and XP')
      .addUserOption(o => o.setName('user').setDescription('Member to check (defaults to you)')))

    .addSubcommand(sub => sub
      .setName('leaderboard')
      .setDescription('See the top members by level'))

    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Manually set a member\'s level (admin)')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption(o => o.setName('level').setDescription('Level to set').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('reset')
      .setDescription('Reset every member\'s level and XP on this server (admin, cannot be undone)')
      .addBooleanOption(o => o.setName('confirm').setDescription('Type True to confirm — this cannot be undone').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('config')
      .setDescription('Configure XP gain and level-up announcements (admin)')
      .addBooleanOption(o => o.setName('enabled').setDescription('Turn XP gain on/off — starts OFF until you enable it'))
      .addChannelOption(o => o.setName('levelup_channel').setDescription('Where level-up announcements post (blank = same channel as the message)'))
      .addBooleanOption(o => o.setName('announce').setDescription('Announce level-ups at all'))
      .addIntegerOption(o => o.setName('xp_min').setDescription('Minimum XP per message'))
      .addIntegerOption(o => o.setName('xp_max').setDescription('Maximum XP per message'))
      .addIntegerOption(o => o.setName('cooldown_seconds').setDescription('Seconds between XP gains per member')))

    .addSubcommandGroup(group => group
      .setName('exclude')
      .setDescription('Manage which channels don\'t earn XP')
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Exclude a channel from earning XP')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Re-enable XP for a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('list')
        .setDescription('List excluded channels'))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (group === 'exclude' || sub === 'set' || sub === 'config' || sub === 'reset') {
      if (!isAdmin) return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: group === 'exclude' || sub === 'set' || sub === 'config' || sub === 'reset' });

    if (group === 'exclude') {
      if (sub === 'add') {
        const channel = interaction.options.getChannel('channel');
        await query('INSERT INTO level_excluded_channels (guild_id, channel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [interaction.guildId, channel.id]);
        return interaction.editReply(`✅ <#${channel.id}> no longer earns XP.`);
      }
      if (sub === 'remove') {
        const channel = interaction.options.getChannel('channel');
        await query('DELETE FROM level_excluded_channels WHERE guild_id = $1 AND channel_id = $2', [interaction.guildId, channel.id]);
        return interaction.editReply(`✅ <#${channel.id}> earns XP again.`);
      }
      if (sub === 'list') {
        const res = await query('SELECT channel_id FROM level_excluded_channels WHERE guild_id = $1', [interaction.guildId]);
        if (!res.rows.length) return interaction.editReply('No channels are excluded — every channel earns XP.');
        return interaction.editReply(`Excluded channels:\n${res.rows.map(r => `<#${r.channel_id}>`).join('\n')}`);
      }
      return;
    }

    if (sub === 'config') {
      const levelupChannel = interaction.options.getChannel('levelup_channel');
      const announce = interaction.options.getBoolean('announce');
      const xpMin = interaction.options.getInteger('xp_min');
      const xpMax = interaction.options.getInteger('xp_max');
      const cooldown = interaction.options.getInteger('cooldown_seconds');
      const enabled = interaction.options.getBoolean('enabled');

      await query(`
        INSERT INTO level_config (guild_id, levelup_channel_id, announce_levelup, xp_min, xp_max, cooldown_seconds, enabled)
        VALUES ($1,$2,COALESCE($3,true),COALESCE($4,15),COALESCE($5,25),COALESCE($6,60),COALESCE($7,false))
        ON CONFLICT (guild_id) DO UPDATE SET
          levelup_channel_id = COALESCE($2, level_config.levelup_channel_id),
          announce_levelup   = COALESCE($3, level_config.announce_levelup),
          xp_min             = COALESCE($4, level_config.xp_min),
          xp_max             = COALESCE($5, level_config.xp_max),
          cooldown_seconds   = COALESCE($6, level_config.cooldown_seconds),
          enabled            = COALESCE($7, level_config.enabled)
      `, [interaction.guildId, levelupChannel?.id || null, announce, xpMin, xpMax, cooldown, enabled]);

      const statusNote = enabled === true ? '\n🟢 XP gain is now **ON**.' : enabled === false ? '\n🔴 XP gain is now **OFF**.' : '';
      return interaction.editReply('✅ Level system config updated.' + statusNote);
    }

    if (sub === 'set') {
      const user = interaction.options.getUser('user');
      const level = interaction.options.getInteger('level');
      if (level < 0) return interaction.editReply('❌ Level can\'t be negative.');

      // Compute the minimum total XP needed to sit at exactly this level
      let totalXp = 0;
      for (let i = 0; i < level; i++) totalXp += xpForNextLevel(i);

      await query(`
        INSERT INTO levels (guild_id, user_id, username, xp, level)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = $4, level = $5, username = $3
      `, [interaction.guildId, user.id, user.username, totalXp, level]);

      return interaction.editReply(`✅ Set <@${user.id}> to **Level ${level}**.`);
    }

    if (sub === 'reset') {
      const confirm = interaction.options.getBoolean('confirm');
      if (!confirm) {
        return interaction.editReply('❌ Reset cancelled — pass `confirm:True` to actually wipe every member\'s level and XP on this server.');
      }
      const res = await query('DELETE FROM levels WHERE guild_id = $1', [interaction.guildId]);
      return interaction.editReply(`✅ Reset complete — cleared level/XP data for **${res.rowCount}** member${res.rowCount === 1 ? '' : 's'} on this server.`);
    }

    if (sub === 'check') {
      const user = interaction.options.getUser('user') || interaction.user;
      const row = await getUserLevel(interaction.guildId, user.id);

      if (!row) {
        return interaction.editReply(`${user.id === interaction.user.id ? 'You haven\'t' : `${user.username} hasn't`} earned any XP yet.`);
      }

      const tier = getTier(row.level);
      const xpIntoLevel = Number(row.xp) - Array.from({ length: row.level }, (_, i) => xpForNextLevel(i)).reduce((a, b) => a + b, 0);
      const xpNeeded = xpForNextLevel(row.level);

      const embed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle(`${tier.emoji} ${user.username} — Level ${row.level}`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: 'Tier', value: tier.name, inline: true },
          { name: 'Total XP', value: `${Number(row.xp).toLocaleString()}`, inline: true },
          { name: 'Progress to Next Level', value: `${xpIntoLevel.toLocaleString()} / ${xpNeeded.toLocaleString()} XP`, inline: false },
        );
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'leaderboard') {
      const res = await query('SELECT * FROM levels WHERE guild_id = $1 ORDER BY xp DESC LIMIT 10', [interaction.guildId]);
      if (!res.rows.length) return interaction.editReply('No one has earned XP yet.');

      const lines = res.rows.map((r, i) => {
        const tier = getTier(r.level);
        return `**${i + 1}.** ${tier.emoji} **${r.username}** — Level ${r.level} (${Number(r.xp).toLocaleString()} XP)`;
      }).join('\n');

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee').setTitle('🏆 Level Leaderboard').setDescription(lines)] });
    }
  },
};
