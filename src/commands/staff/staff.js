const { SlashCommandBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');
const { checkEligibility } = require('../../utils/eligibility');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Staff management')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a staff member')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addStringOption(o => o.setName('role').setDescription('Role').setRequired(true)
        .addChoices(
          { name: 'Owner', value: 'owner' },
          { name: 'Admin', value: 'admin' },
          { name: 'Staff', value: 'staff' },
          { name: 'Host',  value: 'host'  },
        ))
      .addStringOption(o => o.setName('currency').setDescription('Pay currency').setRequired(false)
        .addChoices(
          { name: 'Crowns (MEE6)', value: 'MEE6' },
          { name: 'Sins (Play & Regret)', value: 'SINS' },
          { name: 'Goos (Ghosty)', value: 'OOS'  },
        ))
      .addIntegerOption(o => o.setName('pay').setDescription('Pay amount per period').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a staff member')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all staff')
    )
    .addSubcommand(sub => sub
      .setName('report')
      .setDescription('Full staff report')
      .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add')    await addStaff(interaction);
    if (sub === 'remove') await removeStaff(interaction);
    if (sub === 'list')   await listStaff(interaction);
    if (sub === 'report') await staffReport(interaction);
  },
};

async function addStaff(interaction) {
  const user     = interaction.options.getUser('user');
  const role     = interaction.options.getString('role');
  const currency = interaction.options.getString('currency') || 'MEE6';
  const pay      = interaction.options.getInteger('pay') || 0;

  await interaction.deferReply({ ephemeral: true });

  const nextDue = new Date();
  nextDue.setDate(nextDue.getDate() + 30);

  await query(
    `INSERT INTO staff (user_id, username, role, pay_currency, pay_amount, next_pay_due_at, added_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id) DO UPDATE SET role=$3, pay_currency=$4, pay_amount=$5, active=true`,
    [user.id, user.username, role, currency, pay, nextDue, interaction.user.id]
  );

  const embed = baseEmbed('✅ Staff Added', COLORS.green)
    .addFields(
      { name: '👤 User',     value: `<@${user.id}>`, inline: true },
      { name: '🎖️ Role',    value: role, inline: true },
      { name: '💰 Pay',      value: `${pay} ${currency}`, inline: true },
      { name: '📅 Next Due', value: tsF(nextDue), inline: true },
      { name: '➕ Added by', value: `<@${interaction.user.id}>`, inline: true },
    );
  await interaction.editReply({ embeds: [embed] });
}

async function removeStaff(interaction) {
  const user = interaction.options.getUser('user');
  await interaction.deferReply({ ephemeral: true });
  await query(`UPDATE staff SET active=false WHERE user_id=$1`, [user.id]);
  await interaction.editReply({ content: `✅ <@${user.id}> removed from staff.` });
}

async function listStaff(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(
    `SELECT * FROM staff WHERE active=true ORDER BY 
      CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'staff' THEN 3 WHEN 'host' THEN 4 END`,
    []
  );
  if (!res.rows.length) return interaction.editReply({ content: 'No staff found.' });

  const embed = baseEmbed('👑 TBP Staff List', COLORS.crown);
  const grouped = { owner: [], admin: [], staff: [], host: [] };
  for (const s of res.rows) grouped[s.role]?.push(s);

  const roleLabels = { owner: '👑 Owner', admin: '⚔️ Admin', staff: '🛡️ Staff', host: '🎮 Host' };
  for (const [role, members] of Object.entries(grouped)) {
    if (members.length) {
      embed.addFields({
        name: roleLabels[role],
        value: members.map(m => `<@${m.user_id}> — ${m.pay_amount} ${m.pay_currency}`).join('\n'),
      });
    }
  }
  await interaction.editReply({ embeds: [embed] });
}

async function staffReport(interaction) {
  const user = interaction.options.getUser('user');
  await interaction.deferReply();

  const staffRes = await query(`SELECT * FROM staff WHERE user_id=$1`, [user.id]);
  if (!staffRes.rows.length) return interaction.editReply({ content: '❌ User not in staff database.' });
  const staff = staffRes.rows[0];

  const eligibility = await checkEligibility(interaction.guildId, user.id);

  const embed = baseEmbed(`📋 Staff Report — ${user.username}`, COLORS.blue)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: '🎖️ Role',        value: staff.role, inline: true },
      { name: '💰 Pay',          value: `${staff.pay_amount} ${staff.pay_currency}`, inline: true },
      { name: '📅 Last Paid',    value: staff.last_paid_at ? tsF(staff.last_paid_at) : 'Never', inline: true },
      { name: '⏰ Next Pay Due', value: staff.next_pay_due_at ? tsF(staff.next_pay_due_at) : 'N/A', inline: true },
      { name: '🎮 Games Hosted', value: `${eligibility.gamesHosted}`, inline: true },
      { name: '🎁 Giveaways',   value: `${eligibility.giveawaysHosted}`, inline: true },
      { name: '🎟️ Raffles',     value: `${eligibility.rafflesHosted}`, inline: true },
      { name: '🚨 Late Payouts', value: `${eligibility.latePayouts}`, inline: true },
      { name: '📅 Missed Shifts',value: `${eligibility.missedShifts}`, inline: true },
      { name: '🎫 Late Tickets', value: `${eligibility.lateTickets}`, inline: true },
      {
        name: '💸 Pay Eligibility',
        value: eligibility.eligible === 'full' ? '✅ Full Pay'
             : eligibility.eligible === 'partial' ? '⚠️ Partial Pay'
             : eligibility.eligible === 'review' ? '🔍 Admin Review'
             : '❌ Not Eligible',
        inline: true,
      },
    );

  if (eligibility.notes.length) {
    embed.addFields({ name: '📝 Notes', value: eligibility.notes.join('\n') });
  }

  await interaction.editReply({ embeds: [embed] });
}
