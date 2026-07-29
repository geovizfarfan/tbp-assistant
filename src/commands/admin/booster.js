const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('booster')
    .setDescription('Booster payment tracking')
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all boosters and payment status')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list')    await listBoosters(interaction);
  },
  addBooster,
  removeBooster,
  listBoosters,
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
      name: `${tierEmoji} ${b.username}`,
      value: `<@${b.user_id}> | ${status} | **${b.amount_owed} ${b.currency}/mo** | Due: ${b.next_pay_due_at ? tsF(b.next_pay_due_at) : 'N/A'} | Last paid: ${b.last_paid_at ? tsF(b.last_paid_at) : 'Never'}`,
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
