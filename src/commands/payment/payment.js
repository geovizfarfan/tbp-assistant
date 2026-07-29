const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { E, formatMethods, formatSingleMethod, getMethods, isSeller } = require('../pay/pay');

function isOwnerCaller(interaction) {
  return interaction.user.id === process.env.OWNER_ID ||
    interaction.member.permissions.has(PermissionFlagsBits.Administrator);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('payment')
    .setDescription('Your own payment methods, balance, and marking payments received')
    .addSubcommand(sub => sub
      .setName('methods')
      .setDescription('Show payment methods — yours by default')
      .addUserOption(o => o.setName('user').setDescription('Check someone else\'s (owner only)'))
      .addBooleanOption(o => o.setName('paypal').setDescription('Show PayPal (leave all blank to show everything set)'))
      .addBooleanOption(o => o.setName('venmo').setDescription('Show Venmo'))
      .addBooleanOption(o => o.setName('cashapp').setDescription('Show CashApp'))
      .addBooleanOption(o => o.setName('applepay').setDescription('Show Apple Pay'))
      .addBooleanOption(o => o.setName('zelle').setDescription('Show Zelle')))
    .addSubcommand(sub => sub
      .setName('mark')
      .setDescription('Mark a payment as fully paid — only the seller who logged it, or the owner')
      .addIntegerOption(o => o.setName('id').setDescription('Payment ID').setRequired(true))
      .addStringOption(o => o.setName('notes').setDescription('Optional notes')))
    .addSubcommand(sub => sub
      .setName('partial')
      .setDescription('Log a partial payment — only the seller who logged it, or the owner')
      .addIntegerOption(o => o.setName('id').setDescription('Payment ID').setRequired(true))
      .addNumberOption(o => o.setName('amount').setDescription('Amount paid now').setRequired(true).setMinValue(0.01))
      .addStringOption(o => o.setName('notes').setDescription('Optional notes')))
    .addSubcommand(sub => sub
      .setName('balance')
      .setDescription('Check your balance with a seller')
      .addUserOption(o => o.setName('seller').setDescription('Which seller to check').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Check a specific buyer\'s balance instead of your own (owner only)'))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isOwner = isOwnerCaller(interaction);

    if (sub === 'methods') {
      const targetUser = interaction.options.getUser('user');
      if (targetUser && !isOwner) {
        return interaction.reply({ content: `${E.wrong} Only the owner can check someone else's payment methods.`, ephemeral: true });
      }
      const target = targetUser || interaction.user;

      await interaction.deferReply();

      const m = await getMethods(interaction.guild.id, target.id);
      if (!m) return interaction.editReply(`No payment methods set for ${target.username}.`);

      const wantPaypal   = interaction.options.getBoolean('paypal');
      const wantVenmo    = interaction.options.getBoolean('venmo');
      const wantCashapp  = interaction.options.getBoolean('cashapp');
      const wantApplepay = interaction.options.getBoolean('applepay');
      const wantZelle    = interaction.options.getBoolean('zelle');
      const anySelected = [wantPaypal, wantVenmo, wantCashapp, wantApplepay, wantZelle].some(v => v === true);

      let description;
      if (anySelected) {
        const filtered = {
          paypal:   wantPaypal   ? m.paypal   : null,
          venmo:    wantVenmo    ? m.venmo    : null,
          cashapp:  wantCashapp  ? m.cashapp  : null,
          applepay: wantApplepay ? m.applepay : null,
          zelle:    wantZelle    ? m.zelle    : null,
        };
        description = formatMethods(filtered);
      } else {
        description = formatMethods(m);
      }

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle(`${E.payout} ${target.username}'s Payment Methods`)
        .setDescription(description)]});
    }

    if (sub === 'mark') {
      const sellerOk = isOwner || await isSeller(interaction.guildId, interaction.user.id);
      if (!sellerOk) return interaction.reply({ content: `${E.wrong} Approved sellers only.`, ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const id    = interaction.options.getInteger('id');
      const notes = interaction.options.getString('notes') || null;

      // Owner can mark any payment; sellers can only mark their own.
      const sql = isOwner
        ? 'UPDATE payments SET status=$1, amount_paid=amount, paid_at=NOW(), paid_notes=$2 WHERE id=$3 AND status != $1 RETURNING *'
        : 'UPDATE payments SET status=$1, amount_paid=amount, paid_at=NOW(), paid_notes=$2 WHERE id=$3 AND seller_id=$4 AND status != $1 RETURNING *';
      const params = isOwner ? ['paid', notes, id] : ['paid', notes, id, interaction.user.id];

      const res = await query(sql, params);
      if (!res.rows.length) return interaction.editReply(`${E.wrong} Payment not found, not yours, or already paid.`);
      const p = res.rows[0];

      const member = await interaction.guild.members.fetch(p.user_id).catch(() => null);
      if (member) {
        await member.send({ embeds: [new EmbedBuilder().setColor('#248046')
          .setTitle(`${E.check} Payment Received — Receipt`)
          .setDescription(`Your payment to **${interaction.user.username}** in **${interaction.guild.name}** has been received. Thank you!`)
          .addFields(
            { name: `${E.receipt} Service`, value: p.service, inline: true },
            { name: `${E.money} Amount`,    value: `$${Number(p.amount).toFixed(2)}`, inline: true },
            { name: `<a:status:1523726617850024006> Status`, value: 'Paid in full', inline: true },
            { name: '📝 Notes', value: notes || '—', inline: true },
          ).setFooter({ text: `${interaction.guild.name} • ID: #${id}` }).setTimestamp()
        ]}).catch(() => {});
      }

      return interaction.editReply(`${E.check} Payment #${id} marked as paid for <@${p.user_id}>.`);
    }

    if (sub === 'partial') {
      const sellerOk = isOwner || await isSeller(interaction.guildId, interaction.user.id);
      if (!sellerOk) return interaction.reply({ content: `${E.wrong} Approved sellers only.`, ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const id         = interaction.options.getInteger('id');
      const amountPaid = interaction.options.getNumber('amount');
      const notes      = interaction.options.getString('notes') || null;

      const sql = isOwner
        ? 'SELECT * FROM payments WHERE id=$1'
        : 'SELECT * FROM payments WHERE id=$1 AND seller_id=$2';
      const params = isOwner ? [id] : [id, interaction.user.id];

      const existing = await query(sql, params);
      if (!existing.rows.length) return interaction.editReply(`${E.wrong} Payment not found or not yours.`);
      const p = existing.rows[0];

      const newPaid   = Number(p.amount_paid) + amountPaid;
      const remaining = Number(p.amount) - newPaid;
      const newStatus = remaining <= 0 ? 'paid' : 'partial';

      await query('UPDATE payments SET amount_paid=$1, status=$2, paid_notes=$3, paid_at=NOW() WHERE id=$4',
        [newPaid, newStatus, notes, id]);

      const member = await interaction.guild.members.fetch(p.user_id).catch(() => null);
      if (member) {
        const m = await getMethods(interaction.guild.id, p.seller_id);
        await member.send({ embeds: [new EmbedBuilder().setColor(remaining <= 0 ? '#248046' : '#faa61a')
          .setTitle(remaining <= 0 ? `${E.check} Payment Complete!` : `${E.warn} Partial Payment Received`)
          .setDescription(`A payment in **${interaction.guild.name}** has been logged.`)
          .addFields(
            { name: `${E.receipt} Service`,   value: p.service, inline: true },
            { name: `${E.money} Paid Now`,    value: `$${amountPaid.toFixed(2)}`, inline: true },
            { name: `${E.loading} Remaining`, value: remaining > 0 ? `$${remaining.toFixed(2)}` : 'None — paid in full!', inline: true },
            ...(remaining > 0 ? [{ name: `${E.sparkle} How to Pay Remaining`, value: formatSingleMethod(m, p.method), inline: false }] : []),
          ).setFooter({ text: `${interaction.guild.name} • ID: #${id}` }).setTimestamp()
        ]}).catch(() => {});
      }

      return interaction.editReply(remaining <= 0
        ? `${E.check} Payment #${id} fully paid!`
        : `${E.check} Partial payment logged for #${id} — $${remaining.toFixed(2)} remaining.`);
    }

    if (sub === 'balance') {
      const seller = interaction.options.getUser('seller');
      const targetUser = interaction.options.getUser('user');
      if (targetUser && !isOwner) {
        return interaction.reply({ content: `${E.wrong} Only the owner can check another buyer's balance.`, ephemeral: true });
      }
      const buyer = targetUser || interaction.user;

      await interaction.deferReply({ ephemeral: true });

      if (!await isSeller(interaction.guild.id, seller.id)) {
        return interaction.editReply(`${E.wrong} That user is not an approved seller.`);
      }

      const res = await query(
        'SELECT * FROM payments WHERE seller_id=$1 AND user_id=$2 AND guild_id=$3 ORDER BY created_at DESC',
        [seller.id, buyer.id, interaction.guild.id]
      );

      const m = await getMethods(interaction.guild.id, seller.id);
      const unpaid  = res.rows.filter(r => r.status === 'unpaid');
      const partial = res.rows.filter(r => r.status === 'partial');
      const paid    = res.rows.filter(r => r.status === 'paid');
      const totalOwed = [...unpaid, ...partial].reduce((s, r) => s + (Number(r.amount) - Number(r.amount_paid)), 0);
      const totalPaid = res.rows.reduce((s, r) => s + Number(r.amount_paid), 0);

      const embed = new EmbedBuilder().setColor('#d6c2ee')
        .setTitle(`${E.payout} ${buyer.username}'s Balance with ${seller.username}`)
        .addFields(
          { name: `${E.wrong} Owed`,   value: `**$${totalOwed.toFixed(2)}**`, inline: true },
          { name: `${E.check} Paid`, value: `**$${totalPaid.toFixed(2)}**`, inline: true },
        );

      if (unpaid.length || partial.length) {
        const outstanding = [...unpaid, ...partial].map(r =>
          `${E.receipt} **${r.service}** — $${(Number(r.amount) - Number(r.amount_paid)).toFixed(2)} remaining — ${r.method}`
        ).join('\n');
        embed.addFields({ name: `${E.loading} Outstanding`, value: outstanding, inline: false });
        embed.addFields({ name: `${E.sparkle} How to Pay`, value: formatMethods(m), inline: false });
      }

      if (paid.length) {
        const paidList = paid.map(r => `${E.check} **${r.service}** — $${Number(r.amount).toFixed(2)} — <t:${Math.floor(new Date(r.paid_at).getTime()/1000)}:d>`).join('\n');
        embed.addFields({ name: `${E.check} Payment History`, value: paidList.slice(0,1024), inline: false });
      }

      if (!res.rows.length) embed.setDescription('No payment records found with this seller.');
      embed.setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }
  },
};
