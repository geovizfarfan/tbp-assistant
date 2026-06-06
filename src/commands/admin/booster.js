const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('booster')
    .setDescription('Booster payment tracking')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a booster to tracking')
      .addUserOption(o => o.setName('user').setDescription('Booster').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Monthly payment amount').setRequired(true))
      .addStringOption(o => o.setName('currency').setDescription('Currency').setRequired(false)
        .addChoices(
          { name: 'Crowns (MEE6)',        value: 'Crowns' },
          { name: 'Sins (Play & Regret)', value: 'Sins'   },
          { name: 'Goos (Ghosty)',        value: 'Goos'   },
        ))
      .addStringOption(o => o.setName('tier').setDescription('Boost tier').setRequired(false)
        .addChoices(
          { name: 'Basic',    value: 'basic'    },
          { name: 'Standard', value: 'standard' },
          { name: 'Premium',  value: 'premium'  },
        ))
      .addStringOption(o => o.setName('notes').setDescription('Notes').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a booster from tracking')
      .addUserOption(o => o.setName('user').setDescription('Booster').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('paid')
      .setDescription('Mark a booster as paid this month')
      .addUserOption(o => o.setName('user').setDescription('Booster').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount paid (leave blank to use default)').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all boosters and payment status')
    )
    .addSubcommand(sub => sub
      .setName('overdue')
      .setDescription('Show boosters with overdue payments')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add')     await addBooster(interaction);
    if (sub === 'remove')  await removeBooster(interaction);
    if (sub === 'paid')    await markPaid(interaction);
    if (sub === 'list')    await listBoosters(interaction);
    if (sub === 'overdue') await overdueBoosters(interaction);
  },
};

async function addBooster(interaction) {
  const user     = interaction.options.getUser('user');
  const amount   = interaction.options.getInteger('amount');
  const currency = interaction.options.getString('currency') || 'Crowns';
  const tier     = interaction.options.getString('tier') || 'basic';
  const notes    = interaction.options.getString('notes') || null;

  await interaction.deferReply({ ephemeral: true });

  const nextDue = new Date();
  nextDue.setDate(nextDue.getDate() + 30);

  await query(
    `INSERT INTO boosters (guild_id, user_id, username, boost_tier, amount_owed, currency, next_pay_due_at, added_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET boost_tier=$4, amount_owed=$5, currency=$6, active=true, notes=$9`,
    [interaction.guildId, user.id, user.username, tier, amount, currency, nextDue, interaction.user.id, notes]
  );

  const tierEmoji = { basic: e('purplesparkle'), standard: e('heart'), premium: e('diamond') }[tier] || e('purplesparkle');

  const embed = baseEmbed(`${e('checkmark')} Booster Added`, COLORS.lightpurple, interaction.guild?.name)
    .addFields(
      { name: `${e('members')} Booster`,  value: `<@${user.id}>`, inline: true },
      { name: `${tierEmoji} Tier`,         value: tier.charAt(0).toUpperCase() + tier.slice(1), inline: true },
      { name: `${e('payday')} Monthly`,    value: `${amount} ${currency}`, inline: true },
      { name: `${e('calender')} Next Due`, value: tsF(nextDue), inline: true },
      { name: `+ Added by`,               value: `<@${interaction.user.id}>`, inline: true },
    );

  if (notes) embed.addFields({ name: `${e('receipt')} Notes`, value: notes });
  await interaction.editReply({ embeds: [embed] });
}

async function removeBooster(interaction) {
  const user = interaction.options.getUser('user');
  await interaction.deferReply({ ephemeral: true });
  await query(`UPDATE boosters SET active=false WHERE guild_id=$1 AND user_id=$2`, [interaction.guildId, user.id]);
  await interaction.editReply({ content: `${e('checkmark')} <@${user.id}> removed from booster tracking.` });
}

async function markPaid(interaction) {
  const user   = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');
  const now    = new Date();
  const nextDue = new Date();
  nextDue.setDate(nextDue.getDate() + 30);

  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `UPDATE boosters SET last_paid_at=$1, next_pay_due_at=$2 WHERE guild_id=$3 AND user_id=$4 RETURNING *`,
    [now, nextDue, interaction.guildId, user.id]
  );

  if (!res.rows.length) return interaction.editReply({ content: `${e('wrong')} Booster not found. Add them first with /booster add.` });
  const b = res.rows[0];

  const embed = baseEmbed(`${e('payout')} Booster Paid`, COLORS.softgreen, interaction.guild?.name)
    .addFields(
      { name: `${e('members')} Booster`,  value: `<@${user.id}>`, inline: true },
      { name: `${e('payday')} Amount`,    value: `${amount || b.amount_owed} ${b.currency}`, inline: true },
      { name: `${e('RojasClock')} Paid`,  value: tsF(now), inline: true },
      { name: `${e('calender')} Next Due`,value: tsF(nextDue), inline: true },
    );

  await interaction.editReply({ embeds: [embed] });
}

async function listBoosters(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `SELECT * FROM boosters WHERE guild_id=$1 AND active=true ORDER BY next_pay_due_at ASC`,
    [interaction.guildId]
  );

  if (!res.rows.length) return interaction.editReply({ content: 'No boosters tracked yet. Use /booster add to start.' });

  const now = new Date();
  const embed = baseEmbed(`${e('payday')} Booster Payment Tracker`, COLORS.tbppink, interaction.guild?.name);

  let totalCrowns = 0, totalSins = 0, totalGoos = 0;

  for (const b of res.rows) {
    const overdue  = b.next_pay_due_at && new Date(b.next_pay_due_at) < now;
    const status   = overdue ? `${e('atention')} OVERDUE` : `${e('checkmark')} On track`;
    const tierEmoji = { basic: e('purplesparkle'), standard: e('heart'), premium: e('diamond') }[b.boost_tier] || e('purplesparkle');
    if (b.currency === 'Crowns') totalCrowns += b.amount_owed;
    if (b.currency === 'Sins')   totalSins   += b.amount_owed;
    if (b.currency === 'Goos')   totalGoos   += b.amount_owed;

    embed.addFields({
      name: `${tierEmoji} <@${b.user_id}>`,
      value: `${status} | **${b.amount_owed} ${b.currency}/mo** | Due: ${b.next_pay_due_at ? tsF(b.next_pay_due_at) : 'N/A'} | Last paid: ${b.last_paid_at ? tsF(b.last_paid_at) : 'Never'}`,
    });
  }

  embed.addFields({
    name: `${e('payout')} Monthly Total`,
    value: [
      totalCrowns ? `${totalCrowns} Crowns` : '',
      totalSins   ? `${totalSins} Sins`     : '',
      totalGoos   ? `${totalGoos} Goos`     : '',
    ].filter(Boolean).join(' | ') || 'N/A',
  });

  await interaction.editReply({ embeds: [embed] });
}

async function overdueBoosters(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `SELECT * FROM boosters WHERE guild_id=$1 AND active=true AND next_pay_due_at < NOW() ORDER BY next_pay_due_at ASC`,
    [interaction.guildId]
  );

  if (!res.rows.length) return interaction.editReply({ content: `${e('checkmark')} No overdue booster payments!` });

  const embed = baseEmbed(`${e('atention')} Overdue Booster Payments`, COLORS.softred, interaction.guild?.name);
  for (const b of res.rows) {
    const daysOverdue = Math.floor((new Date() - new Date(b.next_pay_due_at)) / 86400000);
    embed.addFields({
      name: `<@${b.user_id}> — ${b.amount_owed} ${b.currency}`,
      value: `Due: ${tsF(b.next_pay_due_at)} | ${daysOverdue} days overdue | Last paid: ${b.last_paid_at ? tsF(b.last_paid_at) : 'Never'}`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
