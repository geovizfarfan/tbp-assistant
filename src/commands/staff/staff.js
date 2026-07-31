const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');
const { checkEligibility } = require('../../utils/eligibility');

const ROLE_LABELS = {
  owner: '👑 Owner',
  admin: '⚔️ Admin',
  staff: '🛡️ Mod',
  host: '🎮 Host',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Staff management')
    .addSubcommand(sub => sub
      .setName('report')
      .setDescription('Full staff report')
      .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('payhistory')
      .setDescription('View past payments for a staff member')
      .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('requirements')
      .setDescription('Set staff pay requirements — per role, or Default for anyone without an override')
      .addStringOption(o => o.setName('role').setDescription('Staff role').setRequired(true)
        .addChoices(
          { name: 'Default (fallback for any role without its own)', value: 'default' },
          { name: 'Owner',       value: 'owner'       },
          { name: 'Admin',       value: 'admin'       },
          { name: 'Mod',         value: 'staff'       },
          { name: 'Host',        value: 'host'        },
          { name: 'Rumble Host', value: 'rumble_host' },
        ))
      .addIntegerOption(o => o.setName('min_games').setDescription('Min games per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_auto_games').setDescription('Min auto-games per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_raffles').setDescription('Min raffles per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_giveaways').setDescription('Min giveaways per period').setRequired(false))
      .addIntegerOption(o => o.setName('bonus_per_game').setDescription('Bonus currency per game hosted').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('daily-goals')
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
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'report') await staffReport(interaction);
    if (sub === 'payhistory') await payHistory(interaction);
    if (sub === 'requirements') await setRequirements(interaction);
    if (sub === 'daily-goals') await setDailyGoals(interaction);
  },
  listStaff,
  staffReport,
  payHistory,
};

async function setRequirements(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const role = interaction.options.getString('role');
  const fields = {
    min_games_hosted:      interaction.options.getInteger('min_games'),
    min_rumble:            interaction.options.getInteger('min_auto_games'),
    min_raffles_hosted:    interaction.options.getInteger('min_raffles'),
    min_giveaways_hosted:  interaction.options.getInteger('min_giveaways'),
    bonus_per_game:        interaction.options.getInteger('bonus_per_game'),
  };
  if (Object.values(fields).every(v => v === null)) {
    return interaction.editReply({ content: e('wrong') + ' Please provide at least one field.' });
  }
  await query(
    `INSERT INTO pay_requirements (guild_id, role, min_games_hosted, min_rumble, min_raffles_hosted, min_giveaways_hosted, bonus_per_game)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (guild_id, role) DO UPDATE SET
       min_games_hosted     = COALESCE($3, pay_requirements.min_games_hosted),
       min_rumble           = COALESCE($4, pay_requirements.min_rumble),
       min_raffles_hosted   = COALESCE($5, pay_requirements.min_raffles_hosted),
       min_giveaways_hosted = COALESCE($6, pay_requirements.min_giveaways_hosted),
       bonus_per_game       = COALESCE($7, pay_requirements.bonus_per_game),
       updated_at = NOW()`,
    [interaction.guildId, role, fields.min_games_hosted, fields.min_rumble, fields.min_raffles_hosted, fields.min_giveaways_hosted, fields.bonus_per_game]
  );
  const roleLabels = { default: 'Default', owner: 'Owner', admin: 'Admin', staff: 'Mod', host: 'Host', rumble_host: 'Rumble Host' };
  await interaction.editReply({ content: e('checkmark') + ' Pay requirements updated for **' + (roleLabels[role] || role) + '**.' });
}

async function setDailyGoals(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const role      = interaction.options.getString('role');
  const games     = interaction.options.getInteger('games');
  const autogames = interaction.options.getInteger('autogames');
  const payouts   = interaction.options.getInteger('payouts');
  if (games === null && autogames === null && payouts === null) {
    return interaction.editReply({ content: e('wrong') + ' Please provide at least one goal.' });
  }
  await query(
    `INSERT INTO daily_goals (guild_id, role, games, autogames, payouts) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (guild_id, role) DO UPDATE SET games=COALESCE($3,daily_goals.games), autogames=COALESCE($4,daily_goals.autogames), payouts=COALESCE($5,daily_goals.payouts), updated_at=NOW()`,
    [interaction.guildId, role, games, autogames, payouts]
  );
  const roleLabels = { owner:'Owner', admin:'Admin', staff:'Mod', host:'Host', rumble_host:'Rumble Host' };
  await interaction.editReply({ content: e('checkmark') + ' Daily goals set for **' + (roleLabels[role]||role) + '**.' });
}

async function listStaff(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(
    `SELECT * FROM staff WHERE active=true ORDER BY
      CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'staff' THEN 3 WHEN 'host' THEN 4 END`,
    []
  );
  if (!res.rows.length) return interaction.editReply({ content: 'No staff found.' });

  const embed = baseEmbed('👑 TBP Staff List', COLORS.tbppurple, interaction.guild?.name);
  const grouped = { owner: [], admin: [], staff: [], host: [] };
  for (const s of res.rows) grouped[s.role]?.push(s);

  for (const [role, members] of Object.entries(grouped)) {
    if (members.length) {
      embed.addFields({
        name: ROLE_LABELS[role],
        value: members.map(m => `<@${m.user_id}> — ${m.pay_amount} ${m.pay_currency}`).join('\n'),
      });
    }
  }
  await interaction.editReply({ embeds: [embed] });
}

async function staffReport(interaction, userOverride) {
  const user = userOverride || interaction.options.getUser('user');
  await interaction.deferReply();

  const staffRes = await query(`SELECT * FROM staff WHERE user_id=$1`, [user.id]);
  if (!staffRes.rows.length) return interaction.editReply({ content: `${e('wrong')} User not in staff database.` });
  const staff = staffRes.rows[0];

  const eligibility = await checkEligibility(interaction.guildId, user.id, staff.role);

  const embed = baseEmbed(`📋 Staff Report — ${user.username}`, COLORS.lightpurple, interaction.guild?.name)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: `${e('trophies')} Role`,          value: ROLE_LABELS[staff.role] || staff.role, inline: true },
      { name: `${e('payday')} Pay`,              value: `${staff.pay_amount} ${staff.pay_currency}`, inline: true },
      { name: `${e('calender')} Last Paid`,      value: staff.last_paid_at ? tsF(staff.last_paid_at) : 'Never', inline: true },
      { name: `${e('RojasClock')} Next Pay Due`, value: staff.next_pay_due_at ? tsF(staff.next_pay_due_at) : 'N/A', inline: true },
      { name: `${e('controller')} Games Hosted`, value: `${eligibility.gamesHosted}`, inline: true },
      { name: `${e('gift')} Giveaways`,          value: `${eligibility.giveawaysHosted}`, inline: true },
      { name: `${e('raffle')} Raffles`,          value: `${eligibility.rafflesHosted}`, inline: true },
      {
        name: `${e('payout')} Pay Eligibility`,
        value: eligibility.eligible === 'full'    ? `${e('checkmark')} Full Pay`
             : eligibility.eligible === 'partial' ? `${e('moneyfly')} Partial Pay`
             : eligibility.eligible === 'review'  ? `${e('search')} Admin Review`
             : `${e('wrong')} Not Eligible`,
        inline: true,
      },
    );

  if (eligibility.notes.length) {
    embed.addFields({ name: `${e('receipt')} Notes`, value: eligibility.notes.join('\n') });
  }

  const boosterRes = await query(`SELECT * FROM boosters WHERE guild_id=$1 AND user_id=$2 AND active=true`, [interaction.guildId, user.id]);
  if (boosterRes.rows.length) {
    const b = boosterRes.rows[0];
    const overdue = b.next_pay_due_at && new Date(b.next_pay_due_at) < new Date();
    embed.addFields({
      name: `${e('payday')} Also an Active Booster`,
      value: `Monthly: **${b.amount_owed} ${b.currency}**\nLast Paid: ${b.last_paid_at ? tsF(b.last_paid_at) : 'Never'}\nNext Due: ${b.next_pay_due_at ? tsF(b.next_pay_due_at) : 'N/A'}${overdue ? ` ${e('atention')} OVERDUE` : ''}`,
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function payHistory(interaction, userOverride) {
  const user = userOverride || interaction.options.getUser('user');
  await interaction.deferReply();

  const staffRes = await query(`SELECT * FROM staff WHERE user_id=$1`, [user.id]);
  if (!staffRes.rows.length) return interaction.editReply({ content: `${e('wrong')} User not in staff database.` });
  const staff = staffRes.rows[0];

  const res = await query(
    `SELECT * FROM staff_payments WHERE user_id=$1 AND guild_id=$2 ORDER BY paid_at DESC LIMIT 15`,
    [user.id, interaction.guildId]
  );

  const embed = baseEmbed(`${e('payday')} Payment History — ${user.username}`, COLORS.lightpurple, interaction.guild?.name)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: `${e('calender')} Last Paid`,      value: staff.last_paid_at ? tsF(staff.last_paid_at) : 'Never', inline: true },
      { name: `${e('RojasClock')} Next Pay Due`, value: staff.next_pay_due_at ? tsF(staff.next_pay_due_at) : 'N/A', inline: true },
    );

  if (res.rows.length) {
    const lines = res.rows.map(p =>
      `${tsF(p.paid_at)} — **${p.amount ? `${p.amount} ${p.currency}` : `Logged (${p.currency})`}** — approved by <@${p.approved_by}>`
    ).join('\n');
    embed.addFields({ name: `${e('receipt')} Past Payments (most recent ${res.rows.length})`, value: lines.slice(0, 1024) });
  } else {
    embed.addFields({ name: `${e('receipt')} Past Payments`, value: 'No payment history recorded yet.' });
  }

  await interaction.editReply({ embeds: [embed] });
}
