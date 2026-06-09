const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');
const { checkEligibility } = require('../../utils/eligibility');
const { eligibilityEmbed } = require('../../utils/embeds');



async function ticketSetup(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const embed = baseEmbed(`${e('rules')} Ticket Tracking Setup`, COLORS.lightpurple, interaction.guild?.name)
    .setDescription('The bot automatically tracks ticket response times. Here is how it works:')
    .addFields(
      { name: '1. Channel Detection', value: 'The bot watches any channel with **"ticket"** in its name automatically. No setup needed.', inline: false },
      { name: '2. What it tracks', value: 'When a ticket opens, the bot logs the time. When a staff member replies, it records the response time and flags it as late if over the limit.', inline: false },
      { name: '3. Set response limit', value: 'Use `/admin set-requirements ticket_limit_minutes:30` to set how long staff have before a reply is marked late.', inline: false },
      { name: '4. View reports', value: 'Use `/admin ticket-report` to see response times per staff member.', inline: false },
      { name: '5. Make sure', value: 'The bot has **Read Messages** and **Read Message History** permissions in your ticket channels.', inline: false },
    );
  await interaction.editReply({ embeds: [embed] });
}


async function setRoles(interaction) {
  const modRole      = interaction.options.getRole('mod_role');
  const adminRole    = interaction.options.getRole('admin_role');
  const gamePingRole = interaction.options.getRole('game_ping_role');
  await interaction.deferReply({ ephemeral: true });

  if (!modRole && !adminRole && !gamePingRole) {
    return interaction.editReply({ content: `${e('wrong')} Please provide at least one role.` });
  }

  await query(
    `INSERT INTO guild_config (guild_id, mod_role_id, admin_role_id, game_ping_role_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id) DO UPDATE SET
       mod_role_id       = COALESCE($2, guild_config.mod_role_id),
       admin_role_id     = COALESCE($3, guild_config.admin_role_id),
       game_ping_role_id = COALESCE($4, guild_config.game_ping_role_id),
       updated_at = NOW()`,
    [interaction.guildId, modRole?.id || null, adminRole?.id || null, gamePingRole?.id || null]
  );

  const lines = [];
  if (modRole)      lines.push(`${e('checkmark')} Mod role → <@&${modRole.id}> (ticket 1hr/3hr pings)`);
  if (adminRole)    lines.push(`${e('checkmark')} Admin role → <@&${adminRole.id}> (ticket 6hr/12hr pings)`);
  if (gamePingRole) lines.push(`${e('checkmark')} Game ping role → <@&${gamePingRole.id}> (new game/raffle alerts)`);

  await interaction.editReply({ content: lines.join('\n') });
}

async function setChannels(interaction) {
  const scheduleChannel  = interaction.options.getChannel('schedule_channel');
  const winnerChannel    = interaction.options.getChannel('winner_channel');
  const ticketChannel    = interaction.options.getChannel('ticket_channel');
  const staffNotifChannel    = interaction.options.getChannel('staff_notif_channel');
  const transcriptChannel    = interaction.options.getChannel('transcript_channel');
  await interaction.deferReply({ ephemeral: true });

  if (!scheduleChannel && !winnerChannel && !ticketChannel && !staffNotifChannel && !transcriptChannel) {
    return interaction.editReply({ content: `${e('wrong')} Please provide at least one channel.` });
  }

  await query(
    `INSERT INTO guild_config (guild_id, schedule_channel_id, winner_channel_id, ticket_channel_id, staff_notif_channel_id, game_transcript_channel_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (guild_id) DO UPDATE SET
       schedule_channel_id        = COALESCE($2, guild_config.schedule_channel_id),
       winner_channel_id          = COALESCE($3, guild_config.winner_channel_id),
       ticket_channel_id          = COALESCE($4, guild_config.ticket_channel_id),
       staff_notif_channel_id     = COALESCE($5, guild_config.staff_notif_channel_id),
       game_transcript_channel_id = COALESCE($6, guild_config.game_transcript_channel_id),
       updated_at = NOW()`,
    [interaction.guildId, scheduleChannel?.id || null, winnerChannel?.id || null, ticketChannel?.id || null, staffNotifChannel?.id || null, transcriptChannel?.id || null]
  );

  const lines = [];
  if (scheduleChannel)   lines.push(`${e('checkmark')} Game schedule board → <#${scheduleChannel.id}>`);
  if (winnerChannel)     lines.push(`${e('checkmark')} Winner announcements → <#${winnerChannel.id}>`);
  if (ticketChannel)     lines.push(`${e('checkmark')} Ticket channel → <#${ticketChannel.id}>`);
  if (staffNotifChannel)  lines.push(`${e('checkmark')} Staff notifications → <#${staffNotifChannel.id}>`);
  if (transcriptChannel)  lines.push(`${e('checkmark')} Game transcripts → <#${transcriptChannel.id}>`);

  await interaction.editReply({ content: lines.join('\n') });

  // If schedule channel set, activate the board
  if (scheduleChannel) {
    const { refreshScheduleBoard } = require('../../utils/scheduleBoard');
    await refreshScheduleBoard(interaction.client, interaction.guildId);
  }
}


async function fixPayout(interaction) {
  const id     = interaction.options.getInteger('id');
  const winner = interaction.options.getUser('winner');
  await interaction.deferReply({ ephemeral: true });

  // Admin/owner only
  const staffRes = await query(`SELECT role FROM staff WHERE user_id=$1 AND active=true`, [interaction.user.id]);
  if (!staffRes.rows.length || !['admin','owner'].includes(staffRes.rows[0].role)) {
    return interaction.editReply({ content: `${e('wrong')} Only admins and owners can fix payouts.` });
  }

  // Find which table
  const tables = [
    { table: 'game_logs',  type: 'game'    },
    { table: 'raffles',    type: 'raffle'  },
    { table: 'giveaways',  type: 'giveaway'},
  ];
  let found = null, foundType = null;
  for (const { table, type } of tables) {
    const res = await query(`SELECT * FROM ${table} WHERE id=$1 AND guild_id=$2`, [id, interaction.guildId]);
    if (res.rows.length) { found = res.rows[0]; foundType = type; break; }
  }

  if (!found) return interaction.editReply({ content: `${e('wrong')} No game/raffle found with ID #${id}.` });

  const tableMap = { game: 'game_logs', raffle: 'raffles', giveaway: 'giveaways' };

  // Reset payout status and update winner
  await query(
    `UPDATE ${tableMap[foundType]} SET payout_status='pending', winner_id=$1 WHERE id=$2`,
    [winner.id, id]
  );
  await query(
    `UPDATE member_wins SET user_id=$1, username=$2 WHERE ref_id=$3 AND type=$4`,
    [winner.id, winner.username, id, foundType]
  );
  await query(
    `UPDATE payout_reminders SET resolved=false, winner_id=$1, escalation_level=0, last_reminded_at=NULL WHERE ref_id=$2 AND type=$3`,
    [winner.id, id, foundType]
  );

  // Update winner announcement if exists
  try {
    const { e: emoji } = require('../../utils/appEmojis');
    const { EmbedBuilder } = require('discord.js');
    const annRes = await query(`SELECT * FROM winner_announcements WHERE game_id=$1 AND guild_id=$2`, [id, interaction.guildId]);
    if (annRes.rows.length) {
      await query(`UPDATE winner_announcements SET winner_id=$1, status='pending' WHERE game_id=$2 AND guild_id=$3`, [winner.id, id, interaction.guildId]);
      const ann = annRes.rows[0];
      const winnerCh = await interaction.client.channels.fetch(ann.channel_id);
      const msg = await winnerCh.messages.fetch(ann.message_id);
      if (msg.embeds[0]) {
        const fixed = EmbedBuilder.from(msg.embeds[0])
          .spliceFields(0, 1, { name: `${emoji('trophies')} Winner`, value: `<@${winner.id}>`, inline: true });
        await msg.edit({ embeds: [fixed] });
      }
    }
  } catch {}

  await interaction.editReply({ content: `${e('checkmark')} Payout #${id} fixed. Winner updated to <@${winner.id}>. Reminder restarted.` });
}

async function stopReminder(interaction) {
  const id  = interaction.options.getInteger('id');
  await interaction.deferReply({ ephemeral: true });
  const res = await query(`UPDATE payout_reminders SET resolved=true WHERE id=$1 AND guild_id=$2 RETURNING *`, [id, interaction.guildId]);
  if (!res.rows.length) return interaction.editReply({ content: `${e('wrong')} Reminder #${id} not found.` });
  await interaction.editReply({ content: `${e('checkmark')} Reminder #${id} stopped.` });
}

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
      .setDescription('Set staff pay requirements')
      .addIntegerOption(o => o.setName('min_games').setDescription('Min total games per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_auto_games').setDescription('Min Auto-Games (Rumble, Regret, Dice Attack) per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_raffles').setDescription('Min raffles per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_giveaways').setDescription('Min giveaways per period').setRequired(false))
      .addIntegerOption(o => o.setName('max_late_payouts').setDescription('Max late payouts allowed').setRequired(false))
      .addIntegerOption(o => o.setName('bonus_per_game').setDescription('Bonus per game hosted e.g. 400').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('ticket-setup')
      .setDescription('How to set up ticket tracking for this bot')
    )
    .addSubcommand(sub => sub
      .setName('set-roles')
      .setDescription('Set roles for ticket notifications and game pings')
      .addRoleOption(o => o.setName('mod_role').setDescription('Mod role — pinged for unclaimed tickets at 1hr and 3hr').setRequired(false))
      .addRoleOption(o => o.setName('admin_role').setDescription('Admin role — pinged for unclaimed tickets at 6hr and 12hr').setRequired(false))
      .addRoleOption(o => o.setName('game_ping_role').setDescription('Role pinged when a new game or raffle goes live').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('set-channels')
      .setDescription('Set all bot channels in one command')
      .addChannelOption(o => o.setName('schedule_channel').setDescription('Live game schedule board channel').setRequired(false))
      .addChannelOption(o => o.setName('winner_channel').setDescription('Channel to post game winners in').setRequired(false))
      .addChannelOption(o => o.setName('ticket_channel').setDescription('Support ticket channel to direct winners to').setRequired(false))
      .addChannelOption(o => o.setName('staff_notif_channel').setDescription('Staff notifications channel e.g. #tbp-staff-notifications').setRequired(false))
      .addChannelOption(o => o.setName('transcript_channel').setDescription('Admin-only channel for game transcripts').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('fix-payout')
      .setDescription('Fix a payout that was confirmed with the wrong winner (Admin only)')
      .addIntegerOption(o => o.setName('id').setDescription('Game/raffle ID').setRequired(true))
      .addUserOption(o => o.setName('winner').setDescription('The correct winner').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('stop-reminder')
      .setDescription('Stop a payout reminder')
      .addIntegerOption(o => o.setName('id').setDescription('Reminder ID (from /admin late-payouts)').setRequired(true))
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
    if (sub === 'ticket-setup')    await ticketSetup(interaction);
    if (sub === 'set-roles')       await setRoles(interaction);
    if (sub === 'set-channels')    await setChannels(interaction);
    if (sub === 'fix-payout')      await fixPayout(interaction);
    if (sub === 'stop-reminder')   await stopReminder(interaction);
    if (sub === 'mark-paid')       await markPaid(interaction);
  },
};

async function payroll(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const reqRes = await query(`SELECT * FROM pay_requirements WHERE guild_id=$1`, [interaction.guildId]);
  const req = reqRes.rows[0] || { bonus_per_game: 400, pay_period_days: 30 };
  const bonusPerGame = req.bonus_per_game || 400;
  const periodDays   = req.pay_period_days || 30;
  const periodStart  = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const staffRes = await query(`SELECT * FROM staff WHERE guild_id=$1 AND active=true ORDER BY role`, [interaction.guildId]);
  if (!staffRes.rows.length) return interaction.editReply({ content: 'No active staff.' });

  const embed = baseEmbed(`${e('payday')} TBP Payroll`, COLORS.tbppurple, interaction.guild?.name);
  let totalCrowns = 0, totalSins = 0, totalGoos = 0;

  for (const s of staffRes.rows) {
    const gamesRes = await query(
      `SELECT COUNT(*) FROM game_logs WHERE guild_id=$1 AND host_id=$2 AND started_at > $3`,
      [interaction.guildId, s.user_id, periodStart]
    );
    const gamesHosted = parseInt(gamesRes.rows[0].count);
    const gameBonus   = gamesHosted * bonusPerGame;
    const totalPay    = (s.pay_amount || 0) + gameBonus;
    const overdue     = s.next_pay_due_at && new Date(s.next_pay_due_at) < new Date();
    const status      = overdue ? `${e('atention')} OVERDUE` : `${e('checkmark')}`;

    if (s.pay_currency === 'Crowns') totalCrowns += totalPay;
    if (s.pay_currency === 'Sins')   totalSins   += totalPay;
    if (s.pay_currency === 'Goos')   totalGoos   += totalPay;

    embed.addFields({
      name: `${status} ${s.username} [${s.role}]`,
      value: `<@${s.user_id}> | Base: ${s.pay_amount} | Games: ${gamesHosted} × ${bonusPerGame} = ${gameBonus} | **Total: ${totalPay} ${s.pay_currency}**`,
    });
  }

  embed.addFields({
    name: `${e('payout')} Total Owed This Period`,
    value: `Crowns: ${totalCrowns} | Sins: ${totalSins} | Goos: ${totalGoos}\nBonus rate: ${bonusPerGame} per game`
  });
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
    min_games:      interaction.options.getInteger('min_games'),
    min_rumble:     interaction.options.getInteger('min_auto_games'),
    min_raffles:    interaction.options.getInteger('min_raffles'),
    min_giveaways:  interaction.options.getInteger('min_giveaways'),
    max_late_payouts: interaction.options.getInteger('max_late_payouts'),
    bonus_per_game: interaction.options.getInteger('bonus_per_game'),
    pay_period_days: 30,
  };

  const setClauses = [];
  const vals = [interaction.guildId];
  let idx = 2;
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null) { setClauses.push(`${k}=$${idx++}`); vals.push(v); }
  }

  if (setClauses.length <= 1) return interaction.editReply({ content: `${e('wrong')} No fields provided.` });

  await query(
    `INSERT INTO pay_requirements (guild_id) VALUES ($1)
     ON CONFLICT (guild_id) DO UPDATE SET ${setClauses.join(', ')}`,
    vals
  );

  const lines = [`${e('checkmark')} Requirements updated:`];
  if (fields.min_games !== null)      lines.push(`${e('controller')} Min Games: **${fields.min_games}**`);
  if (fields.min_rumble !== null)     lines.push(`${e('bullet')} Min Auto-Games: **${fields.min_rumble}**`);
  if (fields.min_raffles !== null)    lines.push(`${e('raffle')} Min Raffles: **${fields.min_raffles}**`);
  if (fields.min_giveaways !== null)  lines.push(`${e('gift')} Min Giveaways: **${fields.min_giveaways}**`);
  if (fields.max_late_payouts !== null) lines.push(`${e('atention')} Max Late Payouts: **${fields.max_late_payouts}**`);
  if (fields.bonus_per_game !== null) lines.push(`${e('payout')} Bonus per game: **${fields.bonus_per_game}**`);
  lines.push(`${e('RojasClock')} Pay period: **30 days** (fixed)`);

  await interaction.editReply({ content: lines.join('\n') });
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
