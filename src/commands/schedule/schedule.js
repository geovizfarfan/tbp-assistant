const { SlashCommandBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');

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
      .setName('mark-missed')
      .setDescription('[Admin] Mark a schedule as missed')
      .addIntegerOption(o => o.setName('id').setDescription('Schedule ID').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add')          await addSchedule(interaction);
    if (sub === 'checkin')      await checkIn(interaction);
    if (sub === 'checkout')     await checkOut(interaction);
    if (sub === 'list')         await listSchedules(interaction);
    if (sub === 'mark-missed')  await markMissed(interaction);
  },
};

function parseDate(str) {
  // Try YYYY-MM-DD first
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // Try "June 7" style
  const d = new Date(str + ' ' + new Date().getFullYear());
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  return null;
}

async function addSchedule(interaction) {
  const dateStr  = interaction.options.getString('date');
  const timeStr  = interaction.options.getString('time');
  const type     = interaction.options.getString('type');
  const [start, end] = timeStr.split('-');

  const date = parseDate(dateStr);
  if (!date) return interaction.reply({ content: '❌ Invalid date format. Use YYYY-MM-DD or "June 7".', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `INSERT INTO schedules (guild_id, staff_id, scheduled_date, time_start, time_end, type)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [interaction.guildId, interaction.user.id, date, start?.trim() || timeStr, end?.trim() || '', type]
  );

  await interaction.editReply({
    content: `✅ Schedule #${res.rows[0].id} added!\n📅 **${date}** | 🕐 ${timeStr} | 🎮 ${type}`,
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
  if (!res.rows.length) return interaction.editReply({ content: '❌ Schedule not found or not yours.' });

  await interaction.editReply({ content: `✅ Checked in for shift #${id} at ${tsF(now)}` });
}

async function checkOut(interaction) {
  const id  = interaction.options.getInteger('id');
  const now = new Date();
  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `UPDATE schedules SET checked_out_at=$1 WHERE id=$2 AND staff_id=$3 AND guild_id=$4 RETURNING *`,
    [now, id, interaction.user.id, interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: '❌ Schedule not found or not yours.' });

  const sched = res.rows[0];
  const duration = sched.checked_in_at
    ? Math.round((now - new Date(sched.checked_in_at)) / 60000)
    : null;

  await interaction.editReply({
    content: `✅ Checked out of shift #${id}${duration ? ` — hosted for ${duration} minutes` : ''}.`,
  });
}

async function listSchedules(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(
    `SELECT * FROM schedules WHERE guild_id=$1 AND scheduled_date >= CURRENT_DATE ORDER BY scheduled_date ASC, time_start ASC LIMIT 20`,
    [interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: 'No upcoming schedules.' });

  const embed = baseEmbed('📅 Upcoming Schedules', COLORS.blue);
  for (const s of res.rows) {
    const statusEmoji = s.status === 'completed' ? '✅' : s.status === 'missed' ? '❌' : '🕐';
    embed.addFields({
      name: `${statusEmoji} #${s.id} — ${s.scheduled_date} | ${s.type}`,
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
  if (!res.rows.length) return interaction.editReply({ content: '❌ Schedule not found.' });

  await interaction.editReply({ content: `✅ Schedule #${id} marked as missed. Staff <@${res.rows[0].staff_id}> noted.` });
}
