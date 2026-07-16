const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');

async function getConfig(guildId) {
  const res = await query('SELECT ban_log_channel_id FROM guild_config WHERE guild_id = $1', [guildId]);
  return res.rows[0] || null;
}

function buildBanEmbed(row) {
  return new EmbedBuilder()
    .setColor('#e74c3c')
    .setTitle('🔨 Member Banned')
    .addFields(
      { name: 'User', value: `${row.username || 'Unknown'} (${row.user_id})`, inline: true },
      { name: 'Banned By', value: row.banned_by ? `<@${row.banned_by}>` : 'Unknown', inline: true },
      { name: 'Reason', value: row.reason || '*No reason provided*', inline: false },
    )
    .setFooter({ text: `Log ID: ${row.id}` })
    .setTimestamp(new Date(row.banned_at));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('banlog')
    .setDescription('Ban log — auto-posts when a member is banned')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Set the channel bans get logged to')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for ban logs').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('reason')
      .setDescription('Add or update the reason on a logged ban')
      .addIntegerOption(o => o.setName('id').setDescription('Log ID (shown in the ban embed footer)').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('View recent bans')),

  async execute(interaction) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
      interaction.member.permissions.has(PermissionFlagsBits.BanMembers);
    if (!isAdmin) return interaction.reply({ content: '❌ You need Ban Members permission to use this.', ephemeral: true });

    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: sub !== 'list' });

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      await query(`
        INSERT INTO guild_config (guild_id, ban_log_channel_id) VALUES ($1,$2)
        ON CONFLICT (guild_id) DO UPDATE SET ban_log_channel_id = $2
      `, [interaction.guildId, channel.id]);
      return interaction.editReply(`✅ Ban log channel set to <#${channel.id}>.`);
    }

    if (sub === 'reason') {
      const id = interaction.options.getInteger('id');
      const reason = interaction.options.getString('reason');

      const res = await query('SELECT * FROM ban_logs WHERE id = $1 AND guild_id = $2', [id, interaction.guildId]);
      if (!res.rows.length) return interaction.editReply('❌ No ban log with that ID.');

      await query('UPDATE ban_logs SET reason = $1 WHERE id = $2', [reason, id]);
      const updated = { ...res.rows[0], reason };

      if (updated.message_id && updated.channel_id) {
        const ch = await interaction.client.channels.fetch(updated.channel_id).catch(() => null);
        const msg = ch ? await ch.messages.fetch(updated.message_id).catch(() => null) : null;
        if (msg) await msg.edit({ embeds: [buildBanEmbed(updated)] }).catch(() => {});
      }
      return interaction.editReply(`✅ Updated reason for ban log #${id}.`);
    }

    if (sub === 'list') {
      const res = await query('SELECT * FROM ban_logs WHERE guild_id = $1 ORDER BY banned_at DESC LIMIT 10', [interaction.guildId]);
      if (!res.rows.length) return interaction.editReply('No bans logged yet.');

      const lines = res.rows.map(r => `\`#${r.id}\` **${r.username || r.user_id}** — ${r.reason || '*no reason*'} — <t:${Math.floor(new Date(r.banned_at).getTime()/1000)}:R>`).join('\n');
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#e74c3c').setTitle('🔨 Recent Bans').setDescription(lines)] });
    }
  },

  // Called from index.js's guildBanAdd listener
  async handleBan(ban, client) {
    const config = await getConfig(ban.guild.id);
    if (!config?.ban_log_channel_id) return;

    const channel = await client.channels.fetch(config.ban_log_channel_id).catch(() => null);
    if (!channel) return;

    // Try to pull the reason + executor from the audit log
    let reason = ban.reason || null;
    let bannedBy = null;
    const auditLogs = await ban.guild.fetchAuditLogs({ type: 22 /* MEMBER_BAN_ADD */, limit: 5 }).catch(() => null);
    if (auditLogs) {
      const entry = auditLogs.entries.find(e => e.target?.id === ban.user.id);
      if (entry) {
        bannedBy = entry.executor?.id || null;
        reason = reason || entry.reason || null;
      }
    }

    const res = await query(
      `INSERT INTO ban_logs (guild_id, user_id, username, reason, banned_by, channel_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [ban.guild.id, ban.user.id, ban.user.username, reason, bannedBy, channel.id]
    );
    const row = res.rows[0];

    const msg = await channel.send({ embeds: [buildBanEmbed(row)] }).catch(() => null);
    if (msg) await query('UPDATE ban_logs SET message_id = $1 WHERE id = $2', [msg.id, row.id]).catch(() => {});
  },
};
