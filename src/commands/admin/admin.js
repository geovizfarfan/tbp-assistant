const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');
const { checkEligibility } = require('../../utils/eligibility');
const { eligibilityEmbed } = require('../../utils/embeds');



async function staffReport(interaction) {
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





async function pingGames(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const { refreshScheduleBoard } = require('../../utils/scheduleBoard');
  await refreshScheduleBoard(interaction.client, interaction.guildId, true);
  await interaction.editReply({ content: `${e('checkmark')} Game ping sent!` });
}







async function fixPayout(interaction) {
  const id     = interaction.options.getInteger('id');
  const type   = interaction.options.getString('type') || 'game';
  const status = interaction.options.getString('status');
  const winnerOverride = interaction.options.getUser('winner');
  await interaction.deferReply({ ephemeral: true });

  const staffRes = await query(`SELECT role FROM staff WHERE user_id=$1 AND active=true`, [interaction.user.id]);
  if (!staffRes.rows.length || !['admin','owner'].includes(staffRes.rows[0].role)) {
    return interaction.editReply({ content: `${e('wrong')} Only admins can fix payouts.` });
  }

  if (!status && !winnerOverride) {
    return interaction.editReply({ content: `${e('wrong')} Provide \`status\`, \`winner\`, or both.` });
  }

  const table = type === 'raffle' ? 'raffles' : 'game_logs';
  const label = type === 'raffle' ? 'Raffle' : 'Game';

  const gameRes = await query(`SELECT * FROM ${table} WHERE id=$1 AND guild_id=$2`, [id, interaction.guildId]);
  if (!gameRes.rows.length) return interaction.editReply({ content: `${e('wrong')} ${label} #${id} not found. (Wrong \`type\`? This defaults to Game — pass \`type: Raffle\` if that's what you meant.)` });
  const game = gameRes.rows[0];
  const now = new Date();

  // End it if it was never ended
  if (game.status === 'active') {
    await query(`UPDATE ${table} SET status='ended', ended_at=$1 WHERE id=$2`, [now, id]);
  }

  // Correct the winner, if provided
  if (winnerOverride) {
    await query(`UPDATE ${table} SET winner_id=$1 WHERE id=$2`, [winnerOverride.id, id]);
    await query(
      `UPDATE member_wins SET user_id=$1, username=$2 WHERE ref_id=$3 AND type=$4`,
      [winnerOverride.id, winnerOverride.username, id, type]
    );
  }

  if (status === 'claimed') {
    await query(`UPDATE ${table} SET payout_status='paid', payout_confirmed_at=$1 WHERE id=$2`, [now, id]);
    await query(`UPDATE member_wins SET payout_status='paid', paid_at=$1 WHERE ref_id=$2 AND type=$3`, [now, id, type]);
    await query(`UPDATE payout_reminders SET resolved=true WHERE type=$1 AND ref_id=$2`, [type, id]);
  } else if (status === 'not_claimed') {
    await query(`UPDATE ${table} SET payout_status='not_claimed' WHERE id=$1`, [id]);
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
        let fields = oldEmbed.fields;

        if (winnerOverride) {
          fields = fields.map(f =>
            f.name.includes('Winner') ? { name: f.name, value: `<@${winnerOverride.id}>`, inline: f.inline } : f
          );
        }

        let newColor = oldEmbed.color;
        if (status) {
          const isClaimed = status === 'claimed';
          newColor = isClaimed ? 0x7F36F5 : 0x00FFF9;
          const newStatus = isClaimed
            ? e('checkmark') + ' Claimed — confirmed by <@' + interaction.user.id + '>'
            : e('wrong') + ' Not Claimed — winner did not claim within 6hrs';
          fields = fields.map(f =>
            (f.name.includes('Status') || f.name.includes('Payout') || f.name.includes('payout'))
              ? { name: e('payout') + ' Status', value: newStatus, inline: false }
              : f
          );
        }

        const updatedEmbed = EmbedBuilder.from(oldEmbed).setColor(newColor).setFields(fields);
        await msg.edit({ embeds: [updatedEmbed], components: [] });
      }
    }
  } catch {}

  // Remove from schedule board
  try {
    const { removeFromBoard } = require('../../utils/scheduleBoard');
    if (game.board_message_id) await removeFromBoard(interaction.client, interaction.guildId, game.board_message_id);
  } catch {}

  const parts = [];
  if (winnerOverride) parts.push(`winner corrected to <@${winnerOverride.id}>`);
  if (status) parts.push(`marked as **${status === 'claimed' ? 'Claimed ✅' : 'Not Claimed ❌'}**`);
  const displayName = type === 'raffle' ? game.prize : game.game_name;
  await interaction.editReply({ content: `${e('checkmark')} ${label} #${id} (**${displayName}**) — ${parts.join(' and ')}.` });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin dashboard')
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
      .setName('staff-report')
      .setDescription('View staff progress toward daily/weekly/monthly goals — leave user blank to see everyone')
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
      .setName('ping-games')
      .setDescription('Manually send a game ping with Get Pings / Stop Pings buttons')
    )
    .addSubcommand(sub => sub
      .setName('fix-payout')
      .setDescription('Admin: manually update a game or raffle\'s payout status and/or correct its winner')
      .addIntegerOption(o => o.setName('id').setDescription('Game or Raffle ID').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Which log this ID belongs to (default: Game)')
        .addChoices(
          { name: 'Game', value: 'game' },
          { name: 'Raffle', value: 'raffle' },
        ))
      .addStringOption(o => o.setName('status').setDescription('Payout status (leave blank to only change winner)')
        .addChoices(
          { name: 'Claimed — winner was paid', value: 'claimed' },
          { name: 'Not Claimed — winner never claimed', value: 'not_claimed' },
        ))
      .addUserOption(o => o.setName('winner').setDescription('Correct the recorded winner, if it was wrong'))
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'pay-summary')     await paySummary(interaction);
    if (sub === 'paycheck-check')  await paycheckCheck(interaction);
    if (sub === 'staff-report')    await staffReport(interaction);
    if (sub === 'ping-games')      await pingGames(interaction);
    if (sub === 'fix-payout')      await fixPayout(interaction);
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

  const { getPayRequirements } = require('../../utils/eligibility');
  const defaultReq = await getPayRequirements(interaction.guildId, 'default');
  const periodDays  = defaultReq.pay_period_days || 30;
  const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  // Staff totals
  const staffRes = await query(`SELECT * FROM staff WHERE guild_id=$1 AND active=true ORDER BY role`, [interaction.guildId]);
  const staffTotals = {};
  const staffLines = [];

  for (const s of staffRes.rows) {
    const roleReq = await getPayRequirements(interaction.guildId, s.role);
    const bonusPerGame = roleReq.bonus_per_game || 400;
    const gamesRes = await query(`SELECT COUNT(*) FROM game_logs WHERE guild_id=$1 AND host_id=$2 AND started_at > $3`, [interaction.guildId, s.user_id, periodStart]);
    const gamesHosted = parseInt(gamesRes.rows[0].count);
    const gameBonus   = gamesHosted * bonusPerGame;
    const totalPay    = (s.pay_amount || 0) + gameBonus;
    staffTotals[s.pay_currency] = (staffTotals[s.pay_currency] || 0) + totalPay;
    const overdue = s.next_pay_due_at && new Date(s.next_pay_due_at) < new Date();
    staffLines.push(`${overdue ? e('atention') : e('checkmark')} ${s.username} — **${totalPay} ${s.pay_currency}** (base: ${s.pay_amount || 0} + ${gamesHosted} games × ${bonusPerGame})`);
  }

  // Booster totals
  const boosterRes = await query(`SELECT * FROM boosters WHERE guild_id=$1 AND active=true ORDER BY boost_tier`, [interaction.guildId]);
  const boosterTotals = {};
  const boosterLines = [];

  for (const b of boosterRes.rows) {
    const overdue = b.next_pay_due_at && new Date(b.next_pay_due_at) < new Date();
    const tierEmoji = { basic: e('purplesparkle'), standard: e('heart'), premium: e('diamond') }[b.boost_tier] || e('purplesparkle');
    boosterTotals[b.currency] = (boosterTotals[b.currency] || 0) + Number(b.amount_owed || 0);
    boosterLines.push(`${tierEmoji} ${b.username} — **${b.amount_owed} ${b.currency}** ${overdue ? e('atention') + ' OVERDUE' : ''}`);
  }

  const embed = baseEmbed(`${e('payday')} Pay Summary`, COLORS.tbppurple, interaction.guild?.name);

  const formatTotals = (totals) => Object.entries(totals).map(([currency, total]) => `${currency}: ${total}`).join(' | ') || 'N/A';
  const grandTotals = {};
  for (const [currency, total] of Object.entries(staffTotals)) grandTotals[currency] = (grandTotals[currency] || 0) + total;
  for (const [currency, total] of Object.entries(boosterTotals)) grandTotals[currency] = (grandTotals[currency] || 0) + total;

  const staffChunks = chunkLines(staffLines);
  staffChunks.forEach((chunk, i) => {
    embed.addFields({ name: `${e('members')} Staff Owed${staffChunks.length > 1 ? ` (${i+1}/${staffChunks.length})` : ''}`, value: chunk, inline: false });
  });
  embed.addFields({ name: `${e('purplesparkle')} Staff Total`, value: formatTotals(staffTotals), inline: false });

  const boosterChunks = chunkLines(boosterLines);
  boosterChunks.forEach((chunk, i) => {
    embed.addFields({ name: `${e('diamond')} Boosters Owed${boosterChunks.length > 1 ? ` (${i+1}/${boosterChunks.length})` : ''}`, value: chunk, inline: false });
  });
  embed.addFields(
    { name: `${e('purplesparkle')} Booster Total`, value: formatTotals(boosterTotals), inline: false },
    { name: `${e('payout')} Grand Total`, value: formatTotals(grandTotals), inline: false },
  );

  await interaction.editReply({ embeds: [embed] });
}

async function paycheckCheck(interaction) {
  const user = interaction.options.getUser('user');
  await interaction.deferReply({ ephemeral: true });

  const staffRes = await query(`SELECT * FROM staff WHERE user_id=$1`, [user.id]);
  if (!staffRes.rows.length) return interaction.editReply({ content: `${e('wrong')} Not in staff database.` });

  const result = await checkEligibility(interaction.guildId, user.id, staffRes.rows[0].role);
  const embed = eligibilityEmbed(staffRes.rows[0], result, e, interaction.guild?.name);
  await interaction.editReply({ embeds: [embed] });
}






