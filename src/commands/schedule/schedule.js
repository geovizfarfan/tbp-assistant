const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');


async function requestDaysOff(interaction) {
  const date   = interaction.options.getString('date');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `INSERT INTO days_off_requests (guild_id, user_id, username, date_range, reason, status, created_at) VALUES ($1,$2,$3,$4,$5,'pending',NOW()) RETURNING id`,
    [interaction.guildId, interaction.user.id, interaction.user.username, date, reason]
  );
  const reqId = res.rows[0].id;

  try {
    const cfg = await query(`SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1`, [interaction.guildId]);
    if (cfg.rows.length && cfg.rows[0].staff_notif_channel_id) {
      const ch = await interaction.client.channels.fetch(cfg.rows[0].staff_notif_channel_id);
      await ch.send(`${e('calender')} **Days Off Request #${reqId}** — <@${interaction.user.id}> is requesting off: **${date}**\nReason: ${reason}\nAdmin: run \`/schedule approve-off request_id:${reqId}\` to approve.`);
    }
  } catch {}

  await interaction.editReply({ content: `${e('checkmark')} Days off request #${reqId} submitted for **${date}**. Admins notified.` });
}

async function approveDaysOff(interaction) {
  const reqId    = interaction.options.getInteger('request_id');
  const approved = interaction.options.getBoolean('approved');
  await interaction.deferReply({ ephemeral: true });

  const staffCheck = await query(`SELECT role FROM staff WHERE user_id=$1 AND active=true`, [interaction.user.id]);
  if (!staffCheck.rows.length || !['admin','owner'].includes(staffCheck.rows[0].role)) {
    return interaction.editReply({ content: `${e('wrong')} Only admins and owners can approve days off.` });
  }

  const reqRes = await query(`SELECT * FROM days_off_requests WHERE id=$1 AND guild_id=$2`, [reqId, interaction.guildId]);
  if (!reqRes.rows.length) return interaction.editReply({ content: `${e('wrong')} Request #${reqId} not found.` });

  const req = reqRes.rows[0];
  const status = approved ? 'approved' : 'denied';
  await query(`UPDATE days_off_requests SET status=$1, approved_by=$2 WHERE id=$3`, [status, interaction.user.id, reqId]);

  try {
    const user = await interaction.client.users.fetch(req.user_id);
    await user.send(`${approved ? e('checkmark') : e('wrong')} Your days off request #${reqId} for **${req.date_range}** has been **${status}** by <@${interaction.user.id}>.`);
  } catch {}

  try {
    const cfg = await query(`SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1`, [interaction.guildId]);
    if (cfg.rows.length && cfg.rows[0].staff_notif_channel_id) {
      const ch = await interaction.client.channels.fetch(cfg.rows[0].staff_notif_channel_id);
      await ch.send(`${approved ? e('checkmark') : e('wrong')} Days off request #${reqId} for <@${req.user_id}> (${req.date_range}) has been **${status}**.`);
    }
  } catch {}

  await interaction.editReply({ content: `${e('checkmark')} Request #${reqId} ${status}.` });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Staff days-off requests')
    .addSubcommand(sub => sub
      .setName('approve-off')
      .setDescription('Approve or deny a days off request (Admin only)')
      .addIntegerOption(o => o.setName('request_id').setDescription('Request ID').setRequired(true))
      .addBooleanOption(o => o.setName('approved').setDescription('Approve or deny').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('days-off')
      .setDescription('Request days off')
      .addStringOption(o => o.setName('date').setDescription('Date or range e.g. June 10 or June 10-12').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'approve-off') await approveDaysOff(interaction);
    if (sub === 'days-off')    await requestDaysOff(interaction);
  },
};
