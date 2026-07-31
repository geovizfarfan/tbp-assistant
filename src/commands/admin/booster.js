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
  listBoosters,
};

async function listBoosters(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `SELECT * FROM boosters WHERE guild_id=$1 AND active=true ORDER BY next_pay_due_at ASC`,
    [interaction.guildId]
  );

  if (!res.rows.length) return interaction.editReply({ content: 'No boosters tracked yet. Use /booster add to start.' });

  const now = new Date();
  const embed = baseEmbed(`${e('payday')} Booster Payment Tracker`, COLORS.tbppink, interaction.guild?.name);

  // Servers now use a single unified currency, so total by whatever currency
  // name is actually on each record rather than assuming a fixed set.
  const totals = {};

  for (const b of res.rows) {
    const overdue  = b.next_pay_due_at && new Date(b.next_pay_due_at) < now;
    const status   = overdue ? `${e('atention')} OVERDUE` : `${e('checkmark')} On track`;
    const tierEmoji = { basic: e('purplesparkle'), standard: e('heart'), premium: e('diamond') }[b.boost_tier] || e('purplesparkle');
    totals[b.currency] = (totals[b.currency] || 0) + Number(b.amount_owed || 0);

    embed.addFields({
      name: `${tierEmoji} ${b.username}`,
      value: `<@${b.user_id}> | ${status} | **${b.amount_owed} ${b.currency}/mo** | Due: ${b.next_pay_due_at ? tsF(b.next_pay_due_at) : 'N/A'} | Last paid: ${b.last_paid_at ? tsF(b.last_paid_at) : 'Never'}`,
    });
  }

  embed.addFields({
    name: `${e('payout')} Monthly Total`,
    value: Object.entries(totals).map(([currency, total]) => `${total} ${currency}`).join(' | ') || 'N/A',
  });

  await interaction.editReply({ embeds: [embed] });
}
