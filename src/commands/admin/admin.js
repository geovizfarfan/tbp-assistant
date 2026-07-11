const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');
const { checkEligibility } = require('../../utils/eligibility');
const { eligibilityEmbed } = require('../../utils/embeds');



async function dailyReport(interaction) {
  const period     = interaction.options.getString('period');
  const roleFilter = interaction.options.getString('role') || 'all';
  const userFilter = interaction.options.getUser('user');
  await interaction.deferReply({ ephemeral: true });

  const tzRes = await query(`SELECT timezone FROM guild_config WHERE guild_id=$1`, [interaction.guildId]);
  const tz = tzRes.rows[0]?.timezone || 'America/New_York';
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);

  let dateFilter, periodLabel;
  if (period === 'today') {
    dateFilter = `date = '${today}'`;
    periodLabel = `Today — ${today}`;
  } else if (period === 'weekly') {
    const weekAgo = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now.getTime() - 7*24*60*60*1000));
    dateFilter = `date >= '${weekAgo}'`;
    periodLabel = `This Week`;
  } else {
    const monthAgo = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now.getTime() - 30*24*60*60*1000));
    dateFilter = `date >= '${monthAgo}'`;
    periodLabel = `This Month`;
  }

  let staffQuery, staffParams;
  if (userFilter) {
    staffQuery = `SELECT user_id, username, role FROM staff WHERE guild_id=$1 AND user_id=$2 AND active=true`;
    staffParams = [interaction.guildId, userFilter.id];
  } else if (roleFilter === 'all') {
    staffQuery = `SELECT user_id, username, role FROM staff WHERE guild_id=$1 AND active=true ORDER BY role, username`;
    staffParams = [interaction.guildId];
  } else {
    staffQuery = `SELECT user_id, username, role FROM staff WHERE guild_id=$1 AND active=true AND role=$2 ORDER BY username`;
    staffParams = [interaction.guildId, roleFilter];
  }

  const staffRes = await query(staffQuery, staffParams);
  if (!staffRes.rows.length) return interaction.editReply({ content: `${e('wrong')} No staff found.` });

  const { baseEmbed } = require('../../utils/embeds');
  const embed = baseEmbed(`${e('receipt')} Staff Progress — ${periodLabel}`, 0xCBC3E3, interaction.guild?.name);

  const multiplier = period === 'today' ? 1 : period === 'weekly' ? 7 : 30;

  for (const s of staffRes.rows) {
    const progressRes = await query(
      `SELECT COALESCE(SUM(games),0) as games, COALESCE(SUM(autogames),0) as autogames, COALESCE(SUM(payouts),0) as payouts FROM daily_progress WHERE guild_id=$1 AND user_id=$2 AND ${dateFilter}`,
      [interaction.guildId, s.user_id]
    );
    const p = progressRes.rows[0];
    const games     = parseInt(p.games);
    const autogames = parseInt(p.autogames);
    const payouts   = parseInt(p.payouts);

    const goalRes = await query(`SELECT * FROM daily_goals WHERE guild_id=$1 AND role=$2`, [interaction.guildId, s.role]);
    const goal = goalRes.rows[0];
    const gGoal = goal ? goal.games * multiplier : '?';
    const aGoal = goal ? goal.autogames * multiplier : '?';
    const pGoal = goal ? goal.payouts * multiplier : '?';

    const allMet = goal && games >= gGoal && autogames >= aGoal && payouts >= pGoal;
    const status = allMet ? e('checkmark') : e('Loading');
    const roleLabel = { admin:'Admin', staff:'Mod', host:'Host', rumble_host:'Rumble Host', owner:'Owner' }[s.role] || s.role;

    embed.addFields({
      name: `${status} ${s.username} [${roleLabel}]`,
      value: `${e('controller')} ${games}/${gGoal} · ${'<a:sword:1516443055157416069>'} ${autogames}/${aGoal} · ${e('payout')} ${payouts}/${pGoal}`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function setDailyGoals(interaction) {
  const role      = interaction.options.getString('role');
  const games     = interaction.options.getInteger('games');
  const autogames = interaction.options.getInteger('autogames');
  const payouts   = interaction.options.getInteger('payouts');
  await interaction.deferReply({ ephemeral: true });
  if (games === null && autogames === null && payouts === null) return interaction.editReply({ content: `${e('wrong')} Please provide at least one goal.` });
  await query(
    `INSERT INTO daily_goals (guild_id, role, games, autogames, payouts) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (guild_id, role) DO UPDATE SET games=COALESCE($3,daily_goals.games), autogames=COALESCE($4,daily_goals.autogames), payouts=COALESCE($5,daily_goals.payouts), updated_at=NOW()`,
    [interaction.guildId, role, games, autogames, payouts]
  );
  const roleLabel = { owner:'Owner', admin:'Admin', staff:'Mod', host:'Host', rumble_host:'Rumble Host' }[role] || role;
  const lines = [`${e('checkmark')} Daily goals set for **${roleLabel}**:`];
  if (games !== null)     lines.push(`${e('controller')} Games: **${games}**/day`);
  if (autogames !== null) lines.push(`${e('bullet')} Auto-Games: **${autogames}**/day`);
  if (payouts !== null)   lines.push(`${e('payout')} Payouts: **${payouts}**/day`);
  await interaction.editReply({ content: lines.join('\n') });
}



async function settingsSummary(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const reqRes = await query('SELECT * FROM pay_requirements WHERE guild_id=$1', [interaction.guildId]);
  const goalsRes = await query('SELECT * FROM daily_goals WHERE guild_id=$1 ORDER BY role', [interaction.guildId]);

  const embed = baseEmbed(`${e('payday')} Server Settings Summary`, COLORS.tbppurple, interaction.guild?.name);

  if (reqRes.rows.length) {
    const r = reqRes.rows[0];
    embed.addFields({
      name: `${e('controller')} Pay Requirements`,
      value:
        `Min Games (period): **${r.min_games_hosted ?? r.min_games ?? 'N/A'}**\n` +
        `Min Raffles (period): **${r.min_raffles_hosted ?? r.min_raffles ?? 'N/A'}**\n` +
        `Min Giveaways (period): **${r.min_giveaways_hosted ?? r.min_giveaways ?? 'N/A'}**\n` +
        `Min Rumble: **${r.min_rumble ?? 'N/A'}**\n` +
        `Max Late Payouts: **${r.max_late_payouts ?? 'N/A'}**\n` +
        `Max Missed Shifts: **${r.max_missed_shifts ?? 'N/A'}**\n` +
        `Ticket Response Limit: **${r.ticket_response_limit_minutes ?? 'N/A'} min**\n` +
        `Pay Period: **${r.pay_period_days ?? 'N/A'} days**\n` +
        `Bonus Per Game: **${r.bonus_per_game ?? 'N/A'}**`,
      inline: false,
    });
  } else {
    embed.addFields({ name: `${e('controller')} Pay Requirements`, value: 'Not set yet — use /admin set-requirements', inline: false });
  }

  if (goalsRes.rows.length) {
    const roleLabels = { owner: 'Owner', admin: 'Admin', staff: 'Mod', host: 'Host', rumble_host: 'Rumble Host' };
    for (const g of goalsRes.rows) {
      const label = roleLabels[g.role] || g.role;
      embed.addFields({
        name: `${e('confetti')} Daily Goals — ${label}`,
        value: `Games: **${g.games ?? 0}**/day | Auto-Games: **${g.autogames ?? 0}**/day | Payouts: **${g.payouts ?? 0}**/day`,
        inline: false,
      });
    }
  } else {
    embed.addFields({ name: `${e('confetti')} Daily Goals`, value: 'No roles configured yet — use /admin set-daily-goals', inline: false });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function pingGames(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const { refreshScheduleBoard } = require('../../utils/scheduleBoard');
  await refreshScheduleBoard(interaction.client, interaction.guildId, true);
  await interaction.editReply({ content: `${e('checkmark')} Game ping sent!` });
}

async function setTimezone(interaction) {
  const timezone = interaction.options.getString('timezone');
  await interaction.deferReply({ ephemeral: true });
  await query(
    `INSERT INTO guild_config (guild_id, timezone) VALUES ($1,$2)
     ON CONFLICT (guild_id) DO UPDATE SET timezone=$2, updated_at=NOW()`,
    [interaction.guildId, timezone]
  );
  await interaction.editReply({ content: `${e('checkmark')} Timezone set to **${timezone}**. Daily goals will reset at midnight in this timezone.` });
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
  const status = interaction.options.getString('status');
  await interaction.deferReply({ ephemeral: true });

  const staffRes = await query(`SELECT role FROM staff WHERE user_id=$1 AND active=true`, [interaction.user.id]);
  if (!staffRes.rows.length || !['admin','owner'].includes(staffRes.rows[0].role)) {
    return interaction.editReply({ content: `${e('wrong')} Only admins can fix payouts.` });
  }

  const gameRes = await query(`SELECT * FROM game_logs WHERE id=$1 AND guild_id=$2`, [id, interaction.guildId]);
  if (!gameRes.rows.length) return interaction.editReply({ content: `${e('wrong')} Game #${id} not found.` });
  const game = gameRes.rows[0];
  const now = new Date();

  // End the game if it was never ended
  if (game.status === 'active') {
    await query(`UPDATE game_logs SET status='ended', ended_at=$1 WHERE id=$2`, [now, id]);
  }

  if (status === 'claimed') {
    await query(`UPDATE game_logs SET payout_status='paid', payout_confirmed_at=$1 WHERE id=$2`, [now, id]);
    await query(`UPDATE member_wins SET payout_status='paid', paid_at=$1 WHERE ref_id=$2 AND type='game'`, [now, id]);
    await query(`UPDATE payout_reminders SET resolved=true WHERE type='game' AND ref_id=$1`, [id]);
  } else {
    await query(`UPDATE game_logs SET payout_status='not_claimed' WHERE id=$1`, [id]);
    await query(`UPDATE winner_announcements SET status='not_claimed' WHERE game_id=$1 AND guild_id=$2`, [id, interaction.guildId]);
  }

  // Update winner announcement embed
  try {
    const { EmbedBuilder } = require('discord.js');
    const annRes = await query(`SELECT * FROM winner_announcements WHERE game_id=$1 AND guild_id=$2`, [id, interaction.guildId]);
    if (annRes.rows.length) {
      const ann = annRes.rows[0];
      const winnerCh = await interaction.client.channels.fetch(ann.channel_id);
      const msg = await winnerCh.messages.fetch(ann.message_id);
      if (msg.embeds[0]) {
        const oldEmbed = msg.embeds[0];
        const isClaimed = status === 'claimed';
        const newColor  = isClaimed ? 0x7F36F5 : 0x00FFF9;
        const newStatus = isClaimed
          ? e('checkmark') + ' Claimed — confirmed by <@' + interaction.user.id + '>'
          : e('wrong') + ' Not Claimed — winner did not claim within 6hrs';
        const fields = oldEmbed.fields.map(f => {
          if (f.name.includes('Status') || f.name.includes('Payout') || f.name.includes('payout')) {
            return { name: e('payout') + ' Status', value: newStatus, inline: false };
          }
          return { name: f.name, value: f.value, inline: f.inline };
        });
        const updatedEmbed = EmbedBuilder.from(oldEmbed).setColor(newColor).setFields(fields);
        await msg.edit({ embeds: [updatedEmbed] });
      }
    }
  } catch {}

  // Remove from schedule board
  try {
    const { removeFromBoard } = require('../../utils/scheduleBoard');
    if (game.board_message_id) await removeFromBoard(interaction.client, interaction.guildId, game.board_message_id);
  } catch {}

  const label = status === 'claimed' ? 'Claimed ✅' : 'Not Claimed ❌';
  await interaction.editReply({ content: `${e('checkmark')} Game #${id} (**${game.game_name}**) marked as **${label}**. #winners updated.` });
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
      .addUserOption(o => o.setName('user').setDescription('View a specific staff member or booster').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('pay-summary')
      .setDescription('See total owed to staff and boosters this period')
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
      .setName('daily-report')
      .setDescription('View staff progress toward daily/weekly/monthly goals')
      .addStringOption(o => o.setName('period').setDescription('Time period').setRequired(true)
        .addChoices(
          { name: 'Today',   value: 'today'   },
          { name: 'Weekly',  value: 'weekly'  },
          { name: 'Monthly', value: 'monthly' },
        ))
      .addUserOption(o => o.setName('user').setDescription('View a specific staff member').setRequired(false))
      .addStringOption(o => o.setName('role').setDescription('Filter by role').setRequired(false)
        .addChoices(
          { name: 'All Roles',   value: 'all'         },
          { name: 'Admin',       value: 'admin'       },
          { name: 'Mod',         value: 'staff'       },
          { name: 'Host',        value: 'host'        },
          { name: 'Rumble Host', value: 'rumble_host' },
        ))
    )
    .addSubcommand(sub => sub
      .setName('set-daily-goals')
      .setDescription('Set daily goals per staff role')
      .addStringOption(o => o.setName('role').setDescription('Staff role').setRequired(true)
        .addChoices(
          { name: 'Owner',       value: 'owner'       },
          { name: 'Admin',       value: 'admin'       },
          { name: 'Mod',         value: 'staff'       },
          { name: 'Host',        value: 'host'        },
          { name: 'Rumble Host', value: 'rumble_host' },
        ))
      .addIntegerOption(o => o.setName('games').setDescription('Daily games goal').setRequired(false))
      .addIntegerOption(o => o.setName('autogames').setDescription('Daily auto-games goal').setRequired(false))
      .addIntegerOption(o => o.setName('payouts').setDescription('Daily payouts goal').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('ping-games')
      .setDescription('Manually send a game ping with Get Pings / Stop Pings buttons')
    )
    .addSubcommand(sub => sub
      .setName('set-timezone')
      .setDescription('Set server timezone for daily goal reset')
      .addStringOption(o => o.setName('timezone').setDescription('Server timezone').setRequired(true)
        .addChoices(
          { name: 'ET — Eastern',           value: 'America/New_York'    },
          { name: 'CT — Central',           value: 'America/Chicago'     },
          { name: 'MT — Mountain',          value: 'America/Denver'      },
          { name: 'PT — Pacific',           value: 'America/Los_Angeles' },
          { name: 'GMT',                    value: 'Europe/London'       },
          { name: 'CET — Central European', value: 'Europe/Paris'        },
        ))
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
      .setDescription('Admin: manually update a game payout status')
      .addIntegerOption(o => o.setName('id').setDescription('Game ID').setRequired(true))
      .addStringOption(o => o.setName('status').setDescription('Payout status').setRequired(true)
        .addChoices(
          { name: 'Claimed — winner was paid', value: 'claimed' },
          { name: 'Not Claimed — winner never claimed', value: 'not_claimed' },
        ))
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
    )
    .addSubcommand(sub => sub
      .setName('settings-summary')
      .setDescription('View current pay requirements and daily goals for all roles')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'payroll')         await payroll(interaction);
    if (sub === 'pay-summary')     await paySummary(interaction);
    if (sub === 'paycheck-check')  await paycheckCheck(interaction);
    if (sub === 'late-payouts')    await latePayouts(interaction);
    if (sub === 'missed-schedules')await missedSchedules(interaction);
    if (sub === 'daily-report')    await dailyReport(interaction);
    if (sub === 'ping-games')      await pingGames(interaction);
    if (sub === 'fix-payout')      await fixPayout(interaction);
    if (sub === 'stop-reminder')   await stopReminder(interaction);
    if (sub === 'mark-paid')       await markPaid(interaction);
  },
};


// Splits an array of lines into embed-field-safe chunks (Discord's field value limit is 1024 chars)
function chunkLines(lines, limit = 1000) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if ((current + '\n' + line).length > limit) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : ['None'];
}

async function paySummary(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const reqRes = await query(`SELECT * FROM pay_requirements WHERE guild_id=$1`, [interaction.guildId]);
  const req = reqRes.rows[0] || { bonus_per_game: 400, pay_period_days: 30 };
  const bonusPerGame = req.bonus_per_game || 400;
  const periodDays   = req.pay_period_days || 30;
  const periodStart  = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  // Staff totals
  const staffRes = await query(`SELECT * FROM staff WHERE guild_id=$1 AND active=true ORDER BY role`, [interaction.guildId]);
  let totalCrowns = 0, totalSins = 0, totalGoos = 0;
  const staffLines = [];

  for (const s of staffRes.rows) {
    const gamesRes = await query(`SELECT COUNT(*) FROM game_logs WHERE guild_id=$1 AND host_id=$2 AND started_at > $3`, [interaction.guildId, s.user_id, periodStart]);
    const gamesHosted = parseInt(gamesRes.rows[0].count);
    const gameBonus   = gamesHosted * bonusPerGame;
    const totalPay    = (s.pay_amount || 0) + gameBonus;
    if (s.pay_currency === 'Crowns') totalCrowns += totalPay;
    if (s.pay_currency === 'Sins')   totalSins   += totalPay;
    if (s.pay_currency === 'Goos')   totalGoos   += totalPay;
    const overdue = s.next_pay_due_at && new Date(s.next_pay_due_at) < new Date();
    staffLines.push(`${overdue ? e('atention') : e('checkmark')} ${s.username} — **${totalPay} ${s.pay_currency}** (base: ${s.pay_amount || 0} + ${gamesHosted} games × ${bonusPerGame})`);
  }

  // Booster totals
  const boosterRes = await query(`SELECT * FROM boosters WHERE guild_id=$1 AND active=true ORDER BY boost_tier`, [interaction.guildId]);
  let boosterCrowns = 0, boosterSins = 0, boosterGoos = 0;
  const boosterLines = [];

  for (const b of boosterRes.rows) {
    const overdue = b.next_pay_due_at && new Date(b.next_pay_due_at) < new Date();
    const tierEmoji = { basic: e('purplesparkle'), standard: e('heart'), premium: e('diamond') }[b.boost_tier] || e('purplesparkle');
    if (b.currency === 'Crowns') boosterCrowns += b.amount_owed;
    if (b.currency === 'Sins')   boosterSins   += b.amount_owed;
    if (b.currency === 'Goos')   boosterGoos   += b.amount_owed;
    boosterLines.push(`${tierEmoji} ${b.username} — **${b.amount_owed} ${b.currency}** ${overdue ? e('atention') + ' OVERDUE' : ''}`);
  }

  const embed = baseEmbed(`${e('payday')} Pay Summary`, COLORS.tbppurple, interaction.guild?.name);

  const staffChunks = chunkLines(staffLines);
  staffChunks.forEach((chunk, i) => {
    embed.addFields({ name: `${e('members')} Staff Owed${staffChunks.length > 1 ? ` (${i+1}/${staffChunks.length})` : ''}`, value: chunk, inline: false });
  });
  embed.addFields({ name: `${e('purplesparkle')} Staff Total`, value: `Crowns: ${totalCrowns} | Sins: ${totalSins} | Goos: ${totalGoos}`, inline: false });

  const boosterChunks = chunkLines(boosterLines);
  boosterChunks.forEach((chunk, i) => {
    embed.addFields({ name: `${e('diamond')} Boosters Owed${boosterChunks.length > 1 ? ` (${i+1}/${boosterChunks.length})` : ''}`, value: chunk, inline: false });
  });
  embed.addFields(
    { name: `${e('purplesparkle')} Booster Total`, value: `Crowns: ${boosterCrowns} | Sins: ${boosterSins} | Goos: ${boosterGoos}`, inline: false },
    { name: `${e('payout')} Grand Total`, value: `Crowns: ${totalCrowns + boosterCrowns} | Sins: ${totalSins + boosterSins} | Goos: ${totalGoos + boosterGoos}`, inline: false },
  );

  await interaction.editReply({ embeds: [embed] });
}

async function payroll(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const userFilter = interaction.options.getUser('user');

  const reqRes = await query(`SELECT * FROM pay_requirements WHERE guild_id=$1`, [interaction.guildId]);
  const req = reqRes.rows[0] || { bonus_per_game: 400, pay_period_days: 30 };
  const bonusPerGame = req.bonus_per_game || 400;
  const periodDays   = req.pay_period_days || 30;
  const periodStart  = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const staffQuery  = userFilter
    ? `SELECT * FROM staff WHERE guild_id=$1 AND user_id=$2 AND active=true`
    : `SELECT * FROM staff WHERE guild_id=$1 AND active=true ORDER BY role`;
  const staffParams = userFilter ? [interaction.guildId, userFilter.id] : [interaction.guildId];
  const staffRes    = await query(staffQuery, staffParams);

  const boosterQuery  = userFilter
    ? `SELECT * FROM boosters WHERE guild_id=$1 AND user_id=$2 AND active=true`
    : `SELECT * FROM boosters WHERE guild_id=$1 AND active=true ORDER BY username`;
  const boosterParams = userFilter ? [interaction.guildId, userFilter.id] : [interaction.guildId];
  const boosterRes    = await query(boosterQuery, boosterParams);

  if (!staffRes.rows.length && !boosterRes.rows.length) {
    return interaction.editReply({ content: `${e('wrong')} No staff or boosters found.` });
  }

  const title = userFilter ? `${e('payday')} Payroll — ${userFilter.username}` : `${e('payday')} TBP Payroll`;
  const embed = baseEmbed(title, COLORS.tbppurple, interaction.guild?.name);
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
    const roleLabel   = { admin:'Admin', staff:'Mod', host:'Host', rumble_host:'Rumble Host', owner:'Owner' }[s.role] || s.role;
    const due         = s.next_pay_due_at ? tsF(s.next_pay_due_at) : 'N/A';
    const lastPaid    = s.last_paid_at ? tsF(s.last_paid_at) : 'Never';

    if (s.pay_currency === 'Crowns') totalCrowns += totalPay;
    if (s.pay_currency === 'Sins')   totalSins   += totalPay;
    if (s.pay_currency === 'Goos')   totalGoos   += totalPay;

    embed.addFields({
      name: `${status} ${s.username} [${roleLabel}]`,
      value: `Base: **${s.pay_amount || 0} ${s.pay_currency}** | Games: ${gamesHosted} × ${bonusPerGame} = ${gameBonus} | Total: **${totalPay} ${s.pay_currency}**\nDue: ${due} | Last Paid: ${lastPaid}`,
    });
  }

  for (const b of boosterRes.rows) {
    const overdue  = b.next_pay_due_at && new Date(b.next_pay_due_at) < new Date();
    const status   = overdue ? `${e('atention')} OVERDUE` : `${e('checkmark')}`;
    const due      = b.next_pay_due_at ? tsF(b.next_pay_due_at) : 'N/A';
    const lastPaid = b.last_paid_at ? tsF(b.last_paid_at) : 'Never';

    if (b.currency === 'Crowns') totalCrowns += b.amount_owed;
    if (b.currency === 'Sins')   totalSins   += b.amount_owed;
    if (b.currency === 'Goos')   totalGoos   += b.amount_owed;

    embed.addFields({
      name: `${status} ${b.username} [Booster]`,
      value: `Base: **${b.amount_owed} ${b.currency}** | Due: ${due} | Last Paid: ${lastPaid}`,
    });
  }

  if (!userFilter) {
    embed.addFields({
      name: `${e('payout')} Total Owed`,
      value: `Crowns: ${totalCrowns} | Sins: ${totalSins} | Goos: ${totalGoos}\n${e('bullet')} Bonus: ${bonusPerGame} per game`
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function paycheckCheck(interaction) {
  const user = interaction.options.getUser('user');
  await interaction.deferReply({ ephemeral: true });

  const staffRes = await query(`SELECT * FROM staff WHERE user_id=$1`, [user.id]);
  if (!staffRes.rows.length) return interaction.editReply({ content: `${e('wrong')} Not in staff database.` });

  const result = await checkEligibility(interaction.guildId, user.id);
  const embed = eligibilityEmbed(staffRes.rows[0], result, e);
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
  const period = interaction.options.getString('period');
  await interaction.deferReply({ ephemeral: true });

  const tzRes = await query(`SELECT timezone FROM guild_config WHERE guild_id=$1`, [interaction.guildId]);
  const tz = tzRes.rows[0]?.timezone || 'America/New_York';
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);

  let dateFilter, periodLabel, multiplier;
  if (period === 'today') {
    dateFilter = `date = '${today}'`;
    periodLabel = `Today — ${today}`;
    multiplier = 1;
  } else if (period === 'weekly') {
    const weekAgo = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now.getTime() - 7*24*60*60*1000));
    dateFilter = `date >= '${weekAgo}'`;
    periodLabel = `This Week`;
    multiplier = 7;
  } else {
    const monthAgo = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now.getTime() - 30*24*60*60*1000));
    dateFilter = `date >= '${monthAgo}'`;
    periodLabel = `This Month`;
    multiplier = 30;
  }

  const staffRes = await query(`SELECT user_id, username, role FROM staff WHERE guild_id=$1 AND active=true ORDER BY role, username`, [interaction.guildId]);
  if (!staffRes.rows.length) return interaction.editReply({ content: `${e('wrong')} No staff found.` });

  const embed = baseEmbed(`${e('atention')} Goals Not Met — ${periodLabel}`, COLORS.softred, interaction.guild?.name);
  let anyMissed = false;

  for (const s of staffRes.rows) {
    const goalRes = await query(`SELECT * FROM daily_goals WHERE guild_id=$1 AND role=$2`, [interaction.guildId, s.role]);
    if (!goalRes.rows.length) continue;
    const goal = goalRes.rows[0];

    const progressRes = await query(
      `SELECT COALESCE(SUM(games),0) as games, COALESCE(SUM(autogames),0) as autogames, COALESCE(SUM(payouts),0) as payouts FROM daily_progress WHERE guild_id=$1 AND user_id=$2 AND ${dateFilter}`,
      [interaction.guildId, s.user_id]
    );
    const p = progressRes.rows[0];
    const games     = parseInt(p.games);
    const autogames = parseInt(p.autogames);
    const payouts   = parseInt(p.payouts);

    const gGoal = goal.games * multiplier;
    const aGoal = goal.autogames * multiplier;
    const pGoal = goal.payouts * multiplier;

    const gameMet    = games >= gGoal;
    const autoMet    = autogames >= aGoal;
    const payoutMet  = payouts >= pGoal;
    const allMet     = gameMet && autoMet && payoutMet;

    if (!allMet) {
      anyMissed = true;
      const roleLabel = { admin:'Admin', staff:'Mod', host:'Host', rumble_host:'Rumble Host', owner:'Owner' }[s.role] || s.role;
      const missing = [];
      if (!gameMet)   missing.push(`${e('controller')} Games: ${games}/${gGoal}`);
      if (!autoMet)   missing.push(`${'<a:sword:1516443055157416069>'} Auto: ${autogames}/${aGoal}`);
      if (!payoutMet) missing.push(`${e('payout')} Payouts: ${payouts}/${pGoal}`);
      embed.addFields({
        name: `${e('wrong')} ${s.username} [${roleLabel}]`,
        value: missing.join(' · '),
      });
    }
  }

  if (!anyMissed) {
    embed.setDescription(`${e('checkmark')} All staff have met their goals for ${periodLabel}!`);
    embed.setColor(COLORS.softgreen);
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

  const staffRes = await query('SELECT pay_currency FROM staff WHERE user_id=$1', [user.id]);
  const currency = staffRes.rows[0]?.pay_currency || 'MEE6';

  await query(
    `UPDATE staff SET last_paid_at=$1, next_pay_due_at=$2 WHERE user_id=$3`,
    [now, nextDue, user.id]
  );

  await query(
    `INSERT INTO staff_payments (user_id, guild_id, amount, currency, paid_at, approved_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [user.id, interaction.guildId, amount, currency, now, interaction.user.id]
  );

  // DM receipt — best effort, don't block on closed DMs
  const dmMember = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (dmMember) {
    await dmMember.send({
      embeds: [baseEmbed(`${e('payday')} Payment Receipt`, COLORS.softgreen, interaction.guild?.name)
        .addFields(
          { name: `${e('payday')} Amount`,      value: amount ? `${amount} ${currency}` : `Logged (${currency})`, inline: true },
          { name: `${e('RojasClock')} Paid At`, value: tsF(now), inline: true },
          { name: `${e('calender')} Next Due`,  value: tsF(nextDue), inline: true },
          { name: '✍️ Approved by',             value: `<@${interaction.user.id}>`, inline: true },
        )]
    }).catch(() => {});
  }

  const embed = baseEmbed(`${e('checkmark')} Staff Paid`, COLORS.softgreen, interaction.guild?.name)
    .addFields(
      { name: `${e('members')} Staff`,      value: `<@${user.id}>`, inline: true },
      { name: `${e('payday')} Amount`,     value: amount ? `${amount} ${currency}` : 'Logged', inline: true },
      { name: `${e('RojasClock')} Paid At`,    value: tsF(now), inline: true },
      { name: `${e('calender')} Next Due`,   value: tsF(nextDue), inline: true },
      { name: '✍️ Approved by',value: `<@${interaction.user.id}>`, inline: true },
    );
  await interaction.editReply({ embeds: [embed] });
}
