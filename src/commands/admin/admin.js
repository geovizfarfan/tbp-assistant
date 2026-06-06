const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');
const { checkEligibility } = require('../../utils/eligibility');
const { eligibilityEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin dashboard')
    .addSubcommand(sub => sub
      .setName('payroll')
      .setDescription('Full payroll overview')
    )
    .addSubcommand(sub => sub
      .setName('paycheck-check')
      .setDescription('Check if a staff member is pay-eligible')
      .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('late-payouts')
      .setDescription('List all late/pending payouts')
    )
    .addSubcommand(sub => sub
      .setName('missed-schedules')
      .setDescription('List missed/no-show schedules')
    )
    .addSubcommand(sub => sub
      .setName('ticket-report')
      .setDescription('Ticket response time report')
    )
    .addSubcommand(sub => sub
      .setName('set-requirements')
      .setDescription('Set pay requirements')
      .addIntegerOption(o => o.setName('min_games').setDescription('Min games hosted').setRequired(false))
      .addIntegerOption(o => o.setName('min_giveaways').setDescription('Min giveaways').setRequired(false))
      .addIntegerOption(o => o.setName('min_raffles').setDescription('Min raffles').setRequired(false))
      .addIntegerOption(o => o.setName('max_late_payouts').setDescription('Max late payouts').setRequired(false))
      .addIntegerOption(o => o.setName('max_missed_shifts').setDescription('Max missed shifts').setRequired(false))
      .addIntegerOption(o => o.setName('ticket_limit_minutes').setDescription('Ticket response limit (minutes)').setRequired(false))
      .addIntegerOption(o => o.setName('pay_period_days').setDescription('Pay period length (days)').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('mark-paid')
      .setDescription('Mark a staff member as paid')
      .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount paid').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'payroll')         await payroll(interaction);
    if (sub === 'paycheck-check')  await paycheckCheck(interaction);
    if (sub === 'late-payouts')    await latePayouts(interaction);
    if (sub === 'missed-schedules')await missedSchedules(interaction);
    if (sub === 'ticket-report')   await ticketReport(interaction);
    if (sub === 'set-requirements')await setRequirements(interaction);
    if (sub === 'mark-paid')       await markPaid(interaction);
  },
};

async function payroll(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const staffRes = await query(`SELECT * FROM staff WHERE active=true ORDER BY role`, []);
  if (!staffRes.rows.length) return interaction.editReply({ content: 'No active staff.' });

  const embed = baseEmbed(`${e('payday')} TBP Payroll`, COLORS.tbppurple, interaction.guild?.name);
  let totalCrowns = 0, totalSins = 0, totalGoos = 0;

  for (const s of staffRes.rows) {
    const overdue = s.next_pay_due_at && new Date(s.next_pay_due_at) < new Date();
    const status = overdue ? `${e('atention')} OVERDUE` : `${e('checkmark')}`;
    if (s.pay_currency === 'Crowns') totalCrowns += s.pay_amount;
    if (s.pay_currency === 'Sins')   totalSins   += s.pay_amount;
    if (s.pay_currency === 'Goos')   totalGoos   += s.pay_amount;
    embed.addFields({
      name: `${status} ${s.username} [${s.role === 'staff' ? 'mod' : s.role}]`,
      value: `<@${s.user_id}> | ${s.pay_amount} ${s.pay_currency} | Due: ${s.next_pay_due_at ? tsF(s.next_pay_due_at) : 'N/A'} | Last paid: ${s.last_paid_at ? tsF(s.last_paid_at) : 'Never'}`,
    });
  }

  embed.addFields({ name: `${e('payout')} Totals This Period`, value: `MEE6: ${totalMEE6} | SINS: ${totalSINS} | OOS: ${totalOOS}` });
  await interaction.editReply({ embeds: [embed] });
}

async function paycheckCheck(interaction) {
  const user = interaction.options.getUser('user');
  await interaction.deferReply({ ephemeral: true });

  const staffRes = await query(`SELECT * FROM staff WHERE user_id=$1`, [user.id]);
  if (!staffRes.rows.length) return interaction.editReply({ content: `${e('wrong')} Not in staff database.` });

  const result = await checkEligibility(interaction.guildId, user.id);
  const embed = eligibilityEmbed(staffRes.rows[0], result);
  await interaction.editReply({ embeds: [embed] });
}

async function latePayouts(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const [raffles, giveaways, games] = await Promise.all([
    query(`SELECT 'raffle' as type, id, prize, prize_amount, currency, host_id, winner_id, ended_at FROM raffles WHERE guild_id=$1 AND payout_status IN ('pending','late') AND status='ended' ORDER BY ended_at ASC LIMIT 10`, [interaction.guildId]),
    query(`SELECT 'giveaway' as type, id, prize, prize_amount, currency, host_id, winner_id, ended_at FROM giveaways WHERE guild_id=$1 AND payout_status IN ('pending','late') AND status='ended' ORDER BY ended_at ASC LIMIT 10`, [interaction.guildId]),
    query(`SELECT 'game' as type, id, prize, prize_amount, currency, host_id, winner_id, ended_at FROM game_logs WHERE guild_id=$1 AND payout_status IN ('pending','late') AND status='ended' ORDER BY ended_at ASC LIMIT 10`, [interaction.guildId]),
  ]);

  const all = [...raffles.rows, ...giveaways.rows, ...games.rows];
  if (!all.length) return interaction.editReply({ content: `${e('checkmark')} No pending/late payouts!` });

  const embed = baseEmbed(`${e('atention')} Pending & Late Payouts`, COLORS.softred, interaction.guild?.name);
  for (const p of all) {
    const minutesOld = Math.floor((Date.now() - new Date(p.ended_at)) / 60000);
    const isLate = minutesOld >= 120;
    embed.addFields({
      name: `${isLate ? e('atention') : e('Loading')} ${p.type} #${p.id} — ${p.prize_amount || p.prize} ${p.currency}`,
      value: `Host: <@${p.host_id}> | Winner: <@${p.winner_id}> | Ended: ${tsF(p.ended_at)} (${minutesOld}m ago)`,
    });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function missedSchedules(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(
    `SELECT * FROM schedules WHERE guild_id=$1 AND status='missed' ORDER BY scheduled_date DESC LIMIT 15`,
    [interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: `${e('checkmark')} No missed schedules.` });

  const embed = baseEmbed(`${e('calender')} Missed Schedules`, COLORS.softpeach, interaction.guild?.name);
  for (const s of res.rows) {
    embed.addFields({
      name: `${s.scheduled_date} — ${s.type}`,
      value: `Staff: <@${s.staff_id}> | Time: ${s.time_start}–${s.time_end} | Notes: ${s.notes || 'None'}`,
    });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function ticketReport(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(
    `SELECT first_staff_responder, COUNT(*) as total, 
     SUM(CASE WHEN late_response THEN 1 ELSE 0 END) as late,
     AVG(response_time_minutes) as avg_response
     FROM ticket_logs WHERE guild_id=$1 AND first_staff_responder IS NOT NULL
     GROUP BY first_staff_responder ORDER BY late DESC`,
    [interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: 'No ticket data.' });

  const embed = baseEmbed(`${e('rules')} Ticket Response Report`, COLORS.lightpurple, interaction.guild?.name);
  for (const r of res.rows) {
    embed.addFields({
      name: `<@${r.first_staff_responder}>`,
      value: `Tickets: ${r.total} | Late: ${r.late} | Avg response: ${Math.round(r.avg_response || 0)}min`,
    });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function setRequirements(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const fields = {
    min_games_hosted:           interaction.options.getInteger('min_games'),
    min_giveaways_hosted:       interaction.options.getInteger('min_giveaways'),
    min_raffles_hosted:         interaction.options.getInteger('min_raffles'),
    max_late_payouts:           interaction.options.getInteger('max_late_payouts'),
    max_missed_shifts:          interaction.options.getInteger('max_missed_shifts'),
    ticket_response_limit_minutes: interaction.options.getInteger('ticket_limit_minutes'),
    pay_period_days:            interaction.options.getInteger('pay_period_days'),
  };

  const setClauses = [];
  const vals = [interaction.guildId];
  let i = 2;
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null) { setClauses.push(`${k}=$${i++}`); vals.push(v); }
  }

  if (!setClauses.length) return interaction.editReply({ content: `${e('moneyfly')} No fields provided.` });

  await query(
    `INSERT INTO pay_requirements (guild_id) VALUES ($1)
     ON CONFLICT (guild_id) DO UPDATE SET ${setClauses.join(', ')}, updated_at=NOW()`,
    vals
  );

  await interaction.editReply({ content: `${e('checkmark')} Pay requirements updated.` });
}

async function markPaid(interaction) {
  const user   = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const now    = new Date();
  const nextDue = new Date();
  nextDue.setDate(nextDue.getDate() + 30);

  await interaction.deferReply({ ephemeral: true });

  await query(
    `UPDATE staff SET last_paid_at=$1, next_pay_due_at=$2 WHERE user_id=$3`,
    [now, nextDue, user.id]
  );

  const embed = baseEmbed(`${e('checkmark')} Staff Paid`, COLORS.softgreen, interaction.guild?.name)
    .addFields(
      { name: `${e('members')} Staff`,      value: `<@${user.id}>`, inline: true },
      { name: `${e('payday')} Amount`,     value: amount ? `${amount}` : 'Logged', inline: true },
      { name: `${e('RojasClock')} Paid At`,    value: tsF(now), inline: true },
      { name: `${e('calender')} Next Due`,   value: tsF(nextDue), inline: true },
      { name: '✍️ Approved by',value: `<@${interaction.user.id}>`, inline: true },
    );
  await interaction.editReply({ embeds: [embed] });
}
