const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');


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
      await ch.send(`${e('calender')} **Days Off Request #${reqId}** — <@${interaction.user.id}> is requesting off: **${date}**\nReason: ${reason}\nStaff: run \`/schedule cover request_id:${reqId}\` to cover. Admin: run \`/schedule approve-off request_id:${reqId}\` to approve.`);
    }
  } catch {}

  await interaction.editReply({ content: `${e('checkmark')} Days off request #${reqId} submitted for **${date}**. Admins notified.` });
}

async function offerCover(interaction) {
  const reqId = interaction.options.getInteger('request_id');
  await interaction.deferReply({ ephemeral: true });

  const reqRes = await query(`SELECT * FROM days_off_requests WHERE id=$1 AND guild_id=$2`, [reqId, interaction.guildId]);
  if (!reqRes.rows.length) return interaction.editReply({ content: `${e('wrong')} Request #${reqId} not found.` });

  const req = reqRes.rows[0];
  await query(`UPDATE days_off_requests SET cover_id=$1, cover_username=$2 WHERE id=$3`, [interaction.user.id, interaction.user.username, reqId]);

  try {
    const cfg = await query(`SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1`, [interaction.guildId]);
    if (cfg.rows.length && cfg.rows[0].staff_notif_channel_id) {
      const ch = await interaction.client.channels.fetch(cfg.rows[0].staff_notif_channel_id);
      await ch.send(`${e('checkmark')} <@${interaction.user.id}> has volunteered to cover <@${req.user_id}>'s days off (${req.date_range}). Admin: run \`/schedule approve-off request_id:${reqId}\` to confirm.`);
    }
  } catch {}

  await interaction.editReply({ content: `${e('checkmark')} You've offered to cover request #${reqId}. Admins notified.` });
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
    await user.send(`${approved ? e('checkmark') : e('wrong')} Your days off request #${reqId} for **${req.date_range}** has been **${status}** by <@${interaction.user.id}>.${req.cover_id ? ' Cover: <@' + req.cover_id + '>' : ''}`);
  } catch {}

  try {
    const cfg = await query(`SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1`, [interaction.guildId]);
    if (cfg.rows.length && cfg.rows[0].staff_notif_channel_id) {
      const ch = await interaction.client.channels.fetch(cfg.rows[0].staff_notif_channel_id);
      await ch.send(`${approved ? e('checkmark') : e('wrong')} Days off request #${reqId} for <@${req.user_id}> (${req.date_range}) has been **${status}**.${req.cover_id ? ' Cover: <@' + req.cover_id + '>' : ' No cover assigned.'}`);
    }
  } catch {}

  await interaction.editReply({ content: `${e('checkmark')} Request #${reqId} ${status}.` });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Staff schedule management')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a hosting schedule')
      .addStringOption(o => o.setName('date').setDescription('Date (YYYY-MM-DD or e.g. June 7)').setRequired(true))
      .addStringOption(o => o.setName('time').setDescription('Time range e.g. 6PM-8PM').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Hosting type').setRequired(true)
        .addChoices(
          { name: 'Games',    value: 'Games' },
          { name: 'Giveaway', value: 'Giveaway' },
          { name: 'Raffle',   value: 'Raffle' },
          { name: 'General',  value: 'General' },
          { name: 'Other',    value: 'Other' },
        ))
    )
    .addSubcommand(sub => sub
      .setName('checkin')
      .setDescription('Check in for your scheduled shift')
      .addIntegerOption(o => o.setName('id').setDescription('Schedule ID').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('checkout')
      .setDescription('Check out of your shift')
      .addIntegerOption(o => o.setName('id').setDescription('Schedule ID').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('View upcoming schedules')
    )
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
    )
    .addSubcommand(sub => sub
      .setName('cover')
      .setDescription('Volunteer to cover another staff member')
      .addIntegerOption(o => o.setName('request_id').setDescription('Days off request ID').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('mark-missed')
      .setDescription('[Admin] Mark a schedule as missed')
      .addIntegerOption(o => o.setName('id').setDescription('Schedule ID').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add')         await addSchedule(interaction);
    if (sub === 'checkin')     await checkIn(interaction);
    if (sub === 'checkout')    await checkOut(interaction);
    if (sub === 'list')        await listSchedules(interaction);
    if (sub === 'approve-off') await approveDaysOff(interaction);
    if (sub === 'days-off')   await requestDaysOff(interaction);
    if (sub === 'cover')       await offerCover(interaction);
    if (sub === 'mark-missed') await markMissed(interaction);
  },
};

function parseDate(str) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const d = new Date(str + ' ' + new Date().getFullYear());
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  return null;
}

async function addSchedule(interaction) {
  const dateStr = interaction.options.getString('date');
  const timeStr = interaction.options.getString('time');
  const type    = interaction.options.getString('type');
  const [start, end] = timeStr.split('-');
  const date = parseDate(dateStr);
  if (!date) return interaction.reply({ content: `${e('wrong')} Invalid date format. Use YYYY-MM-DD or "June 7".`, ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `INSERT INTO schedules (guild_id, staff_id, scheduled_date, time_start, time_end, type)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [interaction.guildId, interaction.user.id, date, start?.trim() || timeStr, end?.trim() || '', type]
  );

  await interaction.editReply({
    content: `${e('checkmark')} Schedule #${res.rows[0].id} added!\n${e('calender')} **${date}** | ${e('RojasClock')} ${timeStr} | ${e('controller')} ${type}`,
  });
}

async function checkIn(interaction) {
  const id  = interaction.options.getInteger('id');
  const now = new Date();
  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `UPDATE schedules SET checked_in_at=$1, status='completed' WHERE id=$2 AND staff_id=$3 AND guild_id=$4 RETURNING *`,
    [now, id, interaction.user.id, interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: `${e('wrong')} Schedule not found or not yours.` });
  await interaction.editReply({ content: `${e('checkmark')} Checked in for shift #${id} at ${tsF(now)}` });
}

async function checkOut(interaction) {
  const id  = interaction.options.getInteger('id');
  const now = new Date();
  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `UPDATE schedules SET checked_out_at=$1 WHERE id=$2 AND staff_id=$3 AND guild_id=$4 RETURNING *`,
    [now, id, interaction.user.id, interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: `${e('wrong')} Schedule not found or not yours.` });
  const sched = res.rows[0];
  const duration = sched.checked_in_at ? Math.round((now - new Date(sched.checked_in_at)) / 60000) : null;
  await interaction.editReply({ content: `${e('checkmark')} Checked out of shift #${id}${duration ? ` — hosted for ${duration} minutes` : ''}.` });
}

async function listSchedules(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(
    `SELECT * FROM schedules WHERE guild_id=$1 AND scheduled_date >= CURRENT_DATE ORDER BY scheduled_date ASC, time_start ASC LIMIT 20`,
    [interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: 'No upcoming schedules.' });

  const embed = baseEmbed(`${e('calender')} Upcoming Schedules`, COLORS.lightpurple, interaction.guild?.name);
  for (const s of res.rows) {
    const statusEmoji = s.status === 'completed' ? e('checkmark') : s.status === 'missed' ? e('wrong') : e('RojasClock');
    const typeEmoji   = s.type === 'Games' ? e('controller') : s.type === 'Giveaway' ? e('gift') : s.type === 'Raffle' ? e('raffle') : e('calender');
    embed.addFields({
      name: `${statusEmoji} #${s.id} — ${s.scheduled_date} | ${typeEmoji} ${s.type}`,
      value: `<@${s.staff_id}> | ${s.time_start}–${s.time_end}${s.checked_in_at ? ` | In: ${tsF(s.checked_in_at)}` : ''}`,
    });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function markMissed(interaction) {
  const id = interaction.options.getInteger('id');
  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `UPDATE schedules SET status='missed' WHERE id=$1 AND guild_id=$2 RETURNING staff_id`,
    [id, interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: `${e('wrong')} Schedule not found.` });
  await interaction.editReply({ content: `${e('checkmark')} Schedule #${id} marked as missed. Staff <@${res.rows[0].staff_id}> noted.` });
}
