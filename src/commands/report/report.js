const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { e } = require('../../utils/appEmojis');
const { baseEmbed, tsF } = require('../../utils/embeds');

function isAdmin(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
    interaction.user.id === process.env.OWNER_ID;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report a bug or issue with Veloura')
    .addSubcommand(sub => sub
      .setName('bug')
      .setDescription('Report a bug or issue')
      .addStringOption(o => o.setName('category').setDescription('What area is this about?').setRequired(true).addChoices(
        { name: 'Rumble Royale / Slaughter', value: 'rumble' },
        { name: 'Giveaways', value: 'giveaway' },
        { name: 'Raffles', value: 'raffle' },
        { name: 'Wheel', value: 'wheel' },
        { name: 'Shop', value: 'shop' },
        { name: 'Tickets', value: 'tickets' },
        { name: 'Leveling', value: 'level' },
        { name: 'Staff/Payroll', value: 'staff' },
        { name: 'Server Setup', value: 'serversetup' },
        { name: 'Other', value: 'other' },
      ))
      .addStringOption(o => o.setName('description').setDescription('Describe the bug or issue in detail').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Set the channel bug reports get posted to (admin only)')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for reports').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List open bug reports (admin only)'))
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Update a report\'s status (admin only)')
      .addIntegerOption(o => o.setName('report_id').setDescription('Report ID').setRequired(true))
      .addStringOption(o => o.setName('status').setDescription('New status').setRequired(true).addChoices(
        { name: 'Open', value: 'open' },
        { name: 'In Progress', value: 'in_progress' },
        { name: 'Resolved', value: 'resolved' },
        { name: "Won't Fix", value: 'wont_fix' },
      ))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'bug') return reportBug(interaction);

    if (!isAdmin(interaction)) {
      return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
    }
    if (sub === 'setup') return setupReports(interaction);
    if (sub === 'list') return listReports(interaction);
    if (sub === 'status') return updateStatus(interaction);
  },
};

const CATEGORY_LABELS = {
  rumble: 'Rumble Royale / Slaughter', giveaway: 'Giveaways', raffle: 'Raffles', wheel: 'Wheel',
  shop: 'Shop', tickets: 'Tickets', level: 'Leveling', staff: 'Staff/Payroll',
  serversetup: 'Server Setup', other: 'Other',
};

const STATUS_LABELS = {
  open: '🔴 Open', in_progress: '🟡 In Progress', resolved: '🟢 Resolved', wont_fix: '⚪ Won\'t Fix',
};

async function reportBug(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const category = interaction.options.getString('category');
  const description = interaction.options.getString('description');

  const cfgRes = await query('SELECT report_channel_id FROM guild_config WHERE guild_id=$1', [interaction.guildId]);
  const channelId = cfgRes.rows[0]?.report_channel_id;
  if (!channelId) {
    return interaction.editReply(`${e('wrong')} Bug reports aren't set up yet on this server — ask an admin to run \`/report setup\`.`);
  }

  const insertRes = await query(
    `INSERT INTO bug_reports (guild_id, user_id, username, category, description) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [interaction.guildId, interaction.user.id, interaction.user.username, category, description]
  );
  const reportId = insertRes.rows[0].id;

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (channel) {
    const embed = baseEmbed(`${e('wrong')} Bug Report #${reportId}`, '#d6c2ee', interaction.guild?.name)
      .addFields(
        { name: 'Reported By', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Category', value: CATEGORY_LABELS[category] || category, inline: true },
        { name: 'Status', value: STATUS_LABELS.open, inline: true },
        { name: 'Description', value: description },
      )
      .setTimestamp();
    const msg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (msg) await query('UPDATE bug_reports SET report_message_id=$1 WHERE id=$2', [msg.id, reportId]).catch(() => {});
  }

  return interaction.editReply(`${e('checkmark')} Report #${reportId} submitted — thanks for flagging it!`);
}

async function setupReports(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.options.getChannel('channel');
  await query(
    `INSERT INTO guild_config (guild_id, report_channel_id) VALUES ($1,$2)
     ON CONFLICT (guild_id) DO UPDATE SET report_channel_id=$2`,
    [interaction.guildId, channel.id]
  );
  return interaction.editReply(`${e('checkmark')} Bug reports will now post to <#${channel.id}>.`);
}

async function listReports(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(
    `SELECT * FROM bug_reports WHERE guild_id=$1 AND status IN ('open','in_progress') ORDER BY created_at DESC LIMIT 20`,
    [interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply('No open bug reports.');

  const lines = res.rows.map(r =>
    `**#${r.id}** ${STATUS_LABELS[r.status]} — ${CATEGORY_LABELS[r.category] || r.category} — <@${r.user_id}> (${tsF(r.created_at)})\n${r.description.slice(0, 100)}${r.description.length > 100 ? '...' : ''}`
  ).join('\n\n');

  return interaction.editReply({ embeds: [baseEmbed(`${e('wrong')} Open Bug Reports`, '#d6c2ee', interaction.guild?.name).setDescription(lines)] });
}

async function updateStatus(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const reportId = interaction.options.getInteger('report_id');
  const status = interaction.options.getString('status');

  const res = await query('UPDATE bug_reports SET status=$1 WHERE id=$2 AND guild_id=$3 RETURNING *', [status, reportId, interaction.guildId]);
  if (!res.rows.length) return interaction.editReply(`${e('wrong')} No report with ID #${reportId}.`);
  const report = res.rows[0];

  if (report.report_message_id) {
    const cfgRes = await query('SELECT report_channel_id FROM guild_config WHERE guild_id=$1', [interaction.guildId]);
    const channel = cfgRes.rows[0]?.report_channel_id
      ? await interaction.client.channels.fetch(cfgRes.rows[0].report_channel_id).catch(() => null)
      : null;
    const msg = channel ? await channel.messages.fetch(report.report_message_id).catch(() => null) : null;
    if (msg && msg.embeds[0]) {
      const updatedEmbed = EmbedBuilder.from(msg.embeds[0]);
      const fields = updatedEmbed.data.fields.map(f => f.name === 'Status' ? { ...f, value: STATUS_LABELS[status] } : f);
      updatedEmbed.setFields(fields);
      await msg.edit({ embeds: [updatedEmbed] }).catch(() => {});
    }
  }

  return interaction.editReply(`${e('checkmark')} Report #${reportId} updated to ${STATUS_LABELS[status]}.`);
}
