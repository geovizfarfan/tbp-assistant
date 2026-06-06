const { SlashCommandBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, currencyLabel, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaway management')
    .addSubcommand(sub => sub
      .setName('log')
      .setDescription('Log a giveaway')
      .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
      .addStringOption(o => o.setName('ends').setDescription('End timestamp <t:UNIX:F> or unix').setRequired(true))
      .addStringOption(o => o.setName('link').setDescription('Message link').setRequired(false))
      .addIntegerOption(o => o.setName('amount').setDescription('Prize amount').setRequired(false))
      .addStringOption(o => o.setName('currency').setDescription('Currency').setRequired(false)
        .addChoices(
          { name: 'MEE6', value: 'MEE6' },
          { name: 'SINS', value: 'SINS' },
          { name: 'OOS',  value: 'OOS'  },
        ))
    )
    .addSubcommand(sub => sub
      .setName('end')
      .setDescription('Mark a giveaway ended and log winner')
      .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true))
      .addUserOption(o => o.setName('winner').setDescription('Winner').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('payout')
      .setDescription('Mark giveaway payout as paid')
      .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List recent giveaways')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'log')    await logGiveaway(interaction);
    if (sub === 'end')    await endGiveaway(interaction);
    if (sub === 'payout') await payoutGiveaway(interaction);
    if (sub === 'list')   await listGiveaways(interaction);
  },
};

async function logGiveaway(interaction) {
  const prize    = interaction.options.getString('prize');
  const amount   = interaction.options.getInteger('amount') || null;
  const currency = interaction.options.getString('currency') || 'MEE6';
  const link     = interaction.options.getString('link') || null;
  const endsRaw  = interaction.options.getString('ends');

  const unixMatch = endsRaw.match(/<t:(\d+)/);
  const unix = unixMatch ? parseInt(unixMatch[1]) : parseInt(endsRaw);
  if (isNaN(unix)) return interaction.reply({ content: '❌ Invalid timestamp.', ephemeral: true });
  const endsAt = new Date(unix * 1000);

  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `INSERT INTO giveaways (guild_id, channel_id, message_link, host_id, prize, prize_amount, currency, ends_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [interaction.guildId, interaction.channelId, link, interaction.user.id, prize, amount, currency, endsAt]
  );

  await interaction.editReply({
    content: `✅ Giveaway #${res.rows[0].id} logged.\nPrize: **${prize}** | Ends: ${tsF(endsAt)}`,
  });
}

async function endGiveaway(interaction) {
  const id     = interaction.options.getInteger('id');
  const winner = interaction.options.getUser('winner');
  const now    = new Date();
  await interaction.deferReply();

  const gwRes = await query(`SELECT * FROM giveaways WHERE id=$1 AND guild_id=$2`, [id, interaction.guildId]);
  if (!gwRes.rows.length) return interaction.editReply({ content: '❌ Giveaway not found.' });
  const gw = gwRes.rows[0];

  await query(
    `UPDATE giveaways SET status='ended', ended_at=$1, winner_id=$2 WHERE id=$3`,
    [now, winner.id, id]
  );

  // Log win
  await query(
    `INSERT INTO member_wins (guild_id, user_id, username, type, ref_id, prize, prize_amount, currency, host_id, won_at)
     VALUES ($1,$2,$3,'giveaway',$4,$5,$6,$7,$8,$9)`,
    [interaction.guildId, winner.id, winner.username, id, gw.prize, gw.prize_amount, gw.currency, gw.host_id, now]
  );

  // Payout reminder
  await query(
    `INSERT INTO payout_reminders (type, ref_id, host_id, winner_id, prize, guild_id, channel_id)
     VALUES ('giveaway',$1,$2,$3,$4,$5,$6)`,
    [id, gw.host_id, winner.id, `${gw.prize_amount || gw.prize} ${gw.currency}`, interaction.guildId, interaction.channelId]
  );

  const embed = baseEmbed('🎁 Giveaway Ended', COLORS.gold)
    .addFields(
      { name: '🏆 Winner',  value: `<@${winner.id}>`, inline: true },
      { name: '🎁 Prize',   value: `${gw.prize_amount ? `${gw.prize_amount} ${gw.currency}` : gw.prize}`, inline: true },
      { name: '👤 Host',    value: `<@${gw.host_id}>`, inline: true },
      { name: '🕐 Ended',   value: tsF(now), inline: true },
      { name: '💸 Payout',  value: 'Pending', inline: true },
    );

  await interaction.editReply({ embeds: [embed] });
}

async function payoutGiveaway(interaction) {
  const id  = interaction.options.getInteger('id');
  const now = new Date();
  await interaction.deferReply({ ephemeral: true });

  await query(
    `UPDATE giveaways SET payout_status='paid', payout_confirmed_at=$1, payout_confirmed_by=$2 WHERE id=$3`,
    [now, interaction.user.id, id]
  );
  await query(
    `UPDATE member_wins SET payout_status='paid', paid_at=$1 WHERE ref_id=$2 AND type='giveaway'`,
    [now, id]
  );
  await query(
    `UPDATE payout_reminders SET resolved=true WHERE type='giveaway' AND ref_id=$1`,
    [id]
  );

  await interaction.editReply({ content: `✅ Giveaway #${id} marked as paid. ${tsF(now)}` });
}

async function listGiveaways(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(
    `SELECT * FROM giveaways WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 10`,
    [interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: 'No giveaways found.' });

  const embed = baseEmbed('🎁 Giveaway List', COLORS.blue);
  for (const g of res.rows) {
    const status = g.status === 'active' ? '🟢 Active' : '🔴 Ended';
    const payout = g.payout_status === 'paid' ? '✅ Paid' : g.payout_status === 'late' ? '🚨 Late' : '⏳ Pending';
    embed.addFields({
      name: `#${g.id} — ${g.prize}`,
      value: `${status} | Host: <@${g.host_id}> | Payout: ${payout}${g.winner_id ? ` | Winner: <@${g.winner_id}>` : ''}`,
    });
  }
  await interaction.editReply({ embeds: [embed] });
}
