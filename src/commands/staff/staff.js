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
      .setName('add')
      .setDescription('Add a staff member')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addStringOption(o => o.setName('role').setDescription('Role').setRequired(true)
        .addChoices(
          { name: 'Owner', value: 'owner' },
          { name: 'Admin', value: 'admin' },
          { name: 'Mod',   value: 'staff' },
          { name: 'Host',         value: 'host'        },
          { name: 'Rumble Host', value: 'rumble_host' },
        ))
      .addStringOption(o => o.setName('currency').setDescription('Pay currency').setRequired(false)
        .addChoices(
          { name: 'Crowns (MEE6)',        value: 'Crowns' },
          { name: 'Sins (Play & Regret)', value: 'Sins'   },
          { name: 'Goos (Ghosty)',        value: 'Goos'   },
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
  const currency = interaction.options.getString('currency') || 'Crowns';
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

  const embed = baseEmbed(`${e('checkmark')} Staff Added`, COLORS.softgreen, interaction.guild?.name)
    .addFields(
      { name: `${e('members')} User`,                value: `<@${user.id}>`, inline: true },
      { name: `${e('trophies')} Role`,               value: ROLE_LABELS[role] || role, inline: true },
      { name: `${e('payday')} Pay`,                  value: `${pay} ${currency}`, inline: true },
      { name: `${e('calender')} Next Due`,           value: tsF(nextDue), inline: true },
      { name: `+ Added by`,                          value: `<@${interaction.user.id}>`, inline: true },
    );
  await interaction.editReply({ embeds: [embed] });
}

async function removeStaff(interaction) {
  const user = interaction.options.getUser('user');
  await interaction.deferReply({ ephemeral: true });
  await query(`UPDATE staff SET active=false WHERE user_id=$1`, [user.id]);
  await interaction.editReply({ content: `${e('checkmark')} <@${user.id}> removed from staff.` });
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

async function staffReport(interaction) {
  const user = interaction.options.getUser('user');
  await interaction.deferReply();

  const staffRes = await query(`SELECT * FROM staff WHERE user_id=$1`, [user.id]);
  if (!staffRes.rows.length) return interaction.editReply({ content: `${e('wrong')} User not in staff database.` });
  const staff = staffRes.rows[0];

  const eligibility = await checkEligibility(interaction.guildId, user.id);

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
      { name: `${e('atention')} Late Payouts`,   value: `${eligibility.latePayouts}`, inline: true },
      { name: `${e('calender')} Missed Shifts`,  value: `${eligibility.missedShifts}`, inline: true },
      { name: `${e('rules')} Late Tickets`,      value: `${eligibility.lateTickets}`, inline: true },
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

  await interaction.editReply({ embeds: [embed] });
}
