const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');

const E = {
  payout:   '<a:payout:1512913911953756291>',
  check:    '<:checkmark:1512916161493205165>',
  warn:     '<a:Warning:1512912830888673462>',
  wrong:    '<:wrong:1512916350375301160>',
  loading:  '<a:Loading:1512917508053536789>',
  receipt:  '<a:receipt:1512920756043124866>',
  money:    '<a:moneybag:1522373120147849226>',
  sparkle:  '<a:purplesparkle:1512912828489793626>',
  paypal:   '<:paypal:1523721653924659342>',
  venmo:    '<:venmo:1523721654994342008>',
  cashapp:  '<:cashapp:1523721652188352643>',
  applepay: '<:applepay:1523721651102154752>',
  zelle:    '<:zelle:1523721656076472320>',
};

function formatMethods(m) {
  if (!m) return 'Contact the seller directly.';
  const lines = [];
  if (m.paypal)   lines.push(`${E.paypal} **PayPal:** [Pay Here](${m.paypal})`);
  if (m.venmo)    lines.push(`${E.venmo} **Venmo:** [Pay Here](${m.venmo})`);
  if (m.cashapp)  lines.push(`${E.cashapp} **CashApp:** [Pay Here](${m.cashapp})`);
  if (m.applepay) lines.push(`${E.applepay} **Apple Pay:** ${m.applepay}`);
  if (m.zelle)    lines.push(`${E.zelle} **Zelle:** ${m.zelle}`);
  return lines.join('\n') || 'No payment methods set.';
}

async function getMethods(guildId, sellerId) {
  const res = await query('SELECT * FROM payment_methods WHERE guild_id=$1 AND seller_id=$2', [guildId, sellerId]);
  return res.rows[0] || null;
}

async function isSeller(guildId, userId) {
  const res = await query('SELECT 1 FROM pay_sellers WHERE guild_id=$1 AND user_id=$2', [guildId, userId]);
  return res.rows.length > 0;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Payment tracking system')

    .addSubcommand(sub => sub
      .setName('log')
      .setDescription('Log a payment entry (sellers only)')
      .addUserOption(o => o.setName('user').setDescription('Member who owes or paid').setRequired(true))
      .addNumberOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(0.01))
      .addStringOption(o => o.setName('service').setDescription('Service description').setRequired(true))
      .addStringOption(o => o.setName('method').setDescription('Payment method').setRequired(true).addChoices(
        { name: 'PayPal', value: 'PayPal' },
        { name: 'Venmo', value: 'Venmo' },
        { name: 'CashApp', value: 'CashApp' },
        { name: 'Apple Pay', value: 'Apple Pay' },
        { name: 'Zelle', value: 'Zelle' },
        { name: 'Other', value: 'Other' },
      ))
      .addBooleanOption(o => o.setName('paid').setDescription('Already paid?').setRequired(true))
      .addStringOption(o => o.setName('notes').setDescription('Optional notes')))

    .addSubcommand(sub => sub
      .setName('mark')
      .setDescription('Mark a payment as fully paid (sellers only)')
      .addIntegerOption(o => o.setName('id').setDescription('Payment ID').setRequired(true))
      .addStringOption(o => o.setName('notes').setDescription('Optional notes')))

    .addSubcommand(sub => sub
      .setName('partial')
      .setDescription('Log a partial payment (sellers only)')
      .addIntegerOption(o => o.setName('id').setDescription('Payment ID').setRequired(true))
      .addNumberOption(o => o.setName('amount').setDescription('Amount paid now').setRequired(true).setMinValue(0.01))
      .addStringOption(o => o.setName('notes').setDescription('Optional notes')))

    .addSubcommand(sub => sub
      .setName('edit')
      .setDescription('Edit a payment entry (sellers only)')
      .addIntegerOption(o => o.setName('id').setDescription('Payment ID').setRequired(true))
      .addNumberOption(o => o.setName('amount').setDescription('New amount'))
      .addStringOption(o => o.setName('service').setDescription('New service description'))
      .addStringOption(o => o.setName('method').setDescription('New payment method').addChoices(
        { name: 'PayPal', value: 'PayPal' },
        { name: 'Venmo', value: 'Venmo' },
        { name: 'CashApp', value: 'CashApp' },
        { name: 'Apple Pay', value: 'Apple Pay' },
        { name: 'Zelle', value: 'Zelle' },
        { name: 'Other', value: 'Other' },
      ))
      .addStringOption(o => o.setName('notes').setDescription('New notes')))

    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a payment entry (sellers only)')
      .addIntegerOption(o => o.setName('id').setDescription('Payment ID').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('View your payment records (sellers only)')
      .addStringOption(o => o.setName('status').setDescription('Filter by status').addChoices(
        { name: 'All', value: 'all' },
        { name: 'Unpaid', value: 'unpaid' },
        { name: 'Partial', value: 'partial' },
        { name: 'Paid', value: 'paid' },
      )))

    .addSubcommand(sub => sub
      .setName('balance')
      .setDescription('Check your balance with a seller')
      .addUserOption(o => o.setName('seller').setDescription('Which seller to check').setRequired(true)))

    .addSubcommandGroup(group => group
      .setName('methods')
      .setDescription('Manage your payment methods')
      .addSubcommand(sub => sub
        .setName('set')
        .setDescription('Set your payment links (sellers only)')
        .addStringOption(o => o.setName('paypal').setDescription('PayPal URL (e.g. https://paypal.me/you)'))
        .addStringOption(o => o.setName('venmo').setDescription('Venmo URL (e.g. https://venmo.com/you)'))
        .addStringOption(o => o.setName('cashapp').setDescription('CashApp URL (e.g. https://cash.app/$you)'))
        .addStringOption(o => o.setName('applepay').setDescription('Apple Pay phone/email'))
        .addStringOption(o => o.setName('zelle').setDescription('Zelle phone/email')))
      .addSubcommand(sub => sub
        .setName('show')
        .setDescription('Show your payment methods')))

    .addSubcommandGroup(group => group
      .setName('seller')
      .setDescription('Manage approved sellers (owner only)')
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Approve a seller')
        .addUserOption(o => o.setName('user').setDescription('User to approve').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Remove a seller')
        .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('list')
        .setDescription('List all approved sellers'))),

  async execute(interaction) {
    const sub   = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    const isOwner = interaction.user.id === process.env.OWNER_ID ||
                    interaction.member.permissions.has('Administrator');

    // ── /pay seller ───────────────────────────────────────────────────────
    if (group === 'seller') {
      if (!isOwner) return interaction.reply({ content: '❌ Owner only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      if (sub === 'add') {
        const user = interaction.options.getUser('user');
        await query('INSERT INTO pay_sellers (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [interaction.guild.id, user.id]);
        return interaction.editReply(`${E.check} <@${user.id}> is now an approved seller.`);
      }
      if (sub === 'remove') {
        const user = interaction.options.getUser('user');
        await query('DELETE FROM pay_sellers WHERE guild_id=$1 AND user_id=$2', [interaction.guild.id, user.id]);
        return interaction.editReply(`${E.check} <@${user.id}> removed from sellers.`);
      }
      if (sub === 'list') {
        const res = await query('SELECT user_id FROM pay_sellers WHERE guild_id=$1', [interaction.guild.id]);
        if (!res.rows.length) return interaction.editReply('No approved sellers.');
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
          .setTitle(`${E.payout} Approved Sellers`)
          .setDescription(res.rows.map(r => `<@${r.user_id}>`).join('\n'))]});
      }
    }

    // ── /pay methods ──────────────────────────────────────────────────────
    if (group === 'methods') {
      if (sub === 'set') {
        if (!await isSeller(interaction.guild.id, interaction.user.id) && !isOwner)
          return interaction.reply({ content: '❌ Approved sellers only.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });

        const paypal   = interaction.options.getString('paypal');
        const venmo    = interaction.options.getString('venmo');
        const cashapp  = interaction.options.getString('cashapp');
        const applepay = interaction.options.getString('applepay');
        const zelle    = interaction.options.getString('zelle');

        await query(`
          INSERT INTO payment_methods (guild_id, seller_id, paypal, venmo, cashapp, applepay, zelle)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (guild_id, seller_id) DO UPDATE SET
            paypal   = COALESCE($3, payment_methods.paypal),
            venmo    = COALESCE($4, payment_methods.venmo),
            cashapp  = COALESCE($5, payment_methods.cashapp),
            applepay = COALESCE($6, payment_methods.applepay),
            zelle    = COALESCE($7, payment_methods.zelle)
        `, [interaction.guild.id, interaction.user.id, paypal||null, venmo||null, cashapp||null, applepay||null, zelle||null]);

        return interaction.editReply(`${E.check} Payment methods updated!`);
      }

      if (sub === 'show') {
        await interaction.deferReply({ ephemeral: true });
        const m = await getMethods(interaction.guild.id, interaction.user.id);
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
          .setTitle(`${E.payout} Your Payment Methods`)
          .setDescription(formatMethods(m))]});
      }
    }

    // ── Seller check for remaining commands ───────────────────────────────
    const sellerAllowed = await isSeller(interaction.guild.id, interaction.user.id) || isOwner;

    // ── /pay log ──────────────────────────────────────────────────────────
    if (sub === 'log') {
      if (!sellerAllowed) return interaction.reply({ content: '❌ Approved sellers only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const user    = interaction.options.getUser('user');
      const amount  = interaction.options.getNumber('amount');
      const service = interaction.options.getString('service');
      const method  = interaction.options.getString('method');
      const paid    = interaction.options.getBoolean('paid');
      const notes   = interaction.options.getString('notes') || null;
      const status  = paid ? 'paid' : 'unpaid';

      const res = await query(
        'INSERT INTO payments (guild_id, seller_id, user_id, amount, amount_paid, service, method, notes, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        [interaction.guild.id, interaction.user.id, user.id, amount, paid ? amount : 0, service, method, notes, status]
      );
      const payId = res.rows[0].id;
      const m = await getMethods(interaction.guild.id, interaction.user.id);

      // DM member
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member) {
        const dmEmbed = paid
          ? new EmbedBuilder().setColor('#248046')
              .setTitle(`${E.check} Payment Receipt`)
              .setDescription(`Your payment to **${interaction.user.username}** in **${interaction.guild.name}** has been logged as paid. Thank you!`)
              .addFields(
                { name: `${E.receipt} Service`,     value: service,              inline: true },
                { name: `${E.money} Amount`,        value: `$${amount.toFixed(2)}`, inline: true },
                { name: `${E.sparkle} Method`,      value: method,               inline: true },
                { name: `<a:status:1523726617850024006> Status`,        value: 'Paid in full',        inline: true },
              ).setFooter({ text: `${interaction.guild.name} • ID: #${payId}` }).setTimestamp()
          : new EmbedBuilder().setColor('#ff4444')
              .setTitle(`${E.payout} Payment Due`)
              .setDescription(`You have a pending payment to **${interaction.user.username}** in **${interaction.guild.name}**.`)
              .addFields(
                { name: `${E.receipt} Service`,         value: service,                 inline: true },
                { name: `${E.money} Amount Due`,        value: `$${amount.toFixed(2)}`, inline: true },
                { name: `${E.sparkle} Method`,          value: method,                  inline: true },
                { name: `${E.sparkle} How to Pay`,      value: formatMethods(m),        inline: false },
              ).setFooter({ text: `${interaction.guild.name} • ID: #${payId}` }).setTimestamp();

        await member.send({ embeds: [dmEmbed] }).catch(() => {});
      }

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setDescription(`${E.check} Payment logged for <@${user.id}>\n${E.receipt} **Service:** ${service}\n${E.money} **Amount:** $${amount.toFixed(2)}\n**Status:** ${paid ? '✅ Paid' : '❌ Unpaid'}\n**ID:** #${payId}`)]});
    }

    // ── /pay mark ─────────────────────────────────────────────────────────
    if (sub === 'mark') {
      if (!sellerAllowed) return interaction.reply({ content: '❌ Approved sellers only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const id    = interaction.options.getInteger('id');
      const notes = interaction.options.getString('notes') || null;

      const res = await query(
        'UPDATE payments SET status=$1, amount_paid=amount, paid_at=NOW(), paid_notes=$2 WHERE id=$3 AND seller_id=$4 AND status != $1 RETURNING *',
        ['paid', notes, id, interaction.user.id]
      );
      if (!res.rows.length) return interaction.editReply('❌ Payment not found or already paid.');
      const p = res.rows[0];

      // DM member
      const member = await interaction.guild.members.fetch(p.user_id).catch(() => null);
      if (member) {
        await member.send({ embeds: [new EmbedBuilder().setColor('#248046')
          .setTitle(`${E.check} Payment Received — Receipt`)
          .setDescription(`Your payment to **${interaction.user.username}** in **${interaction.guild.name}** has been received. Thank you!`)
          .addFields(
            { name: `${E.receipt} Service`,  value: p.service,                    inline: true },
            { name: `${E.money} Amount`,     value: `$${Number(p.amount).toFixed(2)}`, inline: true },
            { name: `<a:status:1523726617850024006> Status`,     value: 'Paid in full',                inline: true },
            { name: '📝 Notes',             value: notes || '—',                  inline: true },
          ).setFooter({ text: `${interaction.guild.name} • ID: #${id}` }).setTimestamp()
        ]}).catch(() => {});
      }

      return interaction.editReply(`${E.check} Payment #${id} marked as paid for <@${p.user_id}>.`);
    }

    // ── /pay partial ──────────────────────────────────────────────────────
    if (sub === 'partial') {
      if (!sellerAllowed) return interaction.reply({ content: '❌ Approved sellers only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const id         = interaction.options.getInteger('id');
      const amountPaid = interaction.options.getNumber('amount');
      const notes      = interaction.options.getString('notes') || null;

      const existing = await query('SELECT * FROM payments WHERE id=$1 AND seller_id=$2', [id, interaction.user.id]);
      if (!existing.rows.length) return interaction.editReply('❌ Payment not found.');
      const p = existing.rows[0];

      const newPaid      = Number(p.amount_paid) + amountPaid;
      const remaining    = Number(p.amount) - newPaid;
      const newStatus    = remaining <= 0 ? 'paid' : 'partial';

      await query('UPDATE payments SET amount_paid=$1, status=$2, paid_notes=$3, paid_at=NOW() WHERE id=$4',
        [newPaid, newStatus, notes, id]);

      // DM member
      const member = await interaction.guild.members.fetch(p.user_id).catch(() => null);
      if (member) {
        const m = await getMethods(interaction.guild.id, interaction.user.id);
        await member.send({ embeds: [new EmbedBuilder().setColor(remaining <= 0 ? '#248046' : '#faa61a')
          .setTitle(remaining <= 0 ? `${E.check} Payment Complete!` : `${E.warn} Partial Payment Received`)
          .setDescription(`A payment to **${interaction.user.username}** in **${interaction.guild.name}** has been logged.`)
          .addFields(
            { name: `${E.receipt} Service`,   value: p.service,                       inline: true },
            { name: `${E.money} Paid Now`,    value: `$${amountPaid.toFixed(2)}`,     inline: true },
            { name: `${E.loading} Remaining`, value: remaining > 0 ? `$${remaining.toFixed(2)}` : 'None — paid in full!', inline: true },
            ...(remaining > 0 ? [{ name: `${E.sparkle} How to Pay Remaining`, value: formatMethods(m), inline: false }] : []),
          ).setFooter({ text: `${interaction.guild.name} • ID: #${id}` }).setTimestamp()
        ]}).catch(() => {});
      }

      return interaction.editReply(`${E.check} Partial payment of $${amountPaid.toFixed(2)} logged for #${id}. Remaining: $${Math.max(0, remaining).toFixed(2)}`);
    }

    // ── /pay edit ─────────────────────────────────────────────────────────
    if (sub === 'edit') {
      if (!sellerAllowed) return interaction.reply({ content: '❌ Approved sellers only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const id      = interaction.options.getInteger('id');
      const amount  = interaction.options.getNumber('amount');
      const service = interaction.options.getString('service');
      const method  = interaction.options.getString('method');
      const notes   = interaction.options.getString('notes');

      const existing = await query('SELECT * FROM payments WHERE id=$1 AND seller_id=$2', [id, interaction.user.id]);
      if (!existing.rows.length) return interaction.editReply('❌ Payment not found.');
      const p = existing.rows[0];

      await query(`UPDATE payments SET
        amount  = COALESCE($1, amount),
        service = COALESCE($2, service),
        method  = COALESCE($3, method),
        notes   = COALESCE($4, notes)
        WHERE id=$5`,
        [amount||null, service||null, method||null, notes||null, id]);

      // DM member about edit
      const member = await interaction.guild.members.fetch(p.user_id).catch(() => null);
      if (member) {
        const changes = [];
        if (amount)  changes.push(`${E.money} **Amount:** $${p.amount} → $${amount.toFixed(2)}`);
        if (service) changes.push(`${E.receipt} **Service:** ${p.service} → ${service}`);
        if (method)  changes.push(`${E.sparkle} **Method:** ${p.method} → ${method}`);
        if (notes)   changes.push(`📝 **Notes:** ${notes}`);

        if (changes.length) {
          await member.send({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
            .setTitle(`${E.payout} Payment Updated`)
            .setDescription(`Your payment record #${id} with **${interaction.user.username}** in **${interaction.guild.name}** has been updated.`)
            .addFields({ name: 'Changes', value: changes.join('\n') })
            .setTimestamp()]
          }).catch(() => {});
        }
      }

      return interaction.editReply(`${E.check} Payment #${id} updated.`);
    }

    // ── /pay remove ───────────────────────────────────────────────────────
    if (sub === 'remove') {
      if (!sellerAllowed) return interaction.reply({ content: '❌ Approved sellers only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const id = interaction.options.getInteger('id');
      const res = await query('DELETE FROM payments WHERE id=$1 AND seller_id=$2 RETURNING *', [id, interaction.user.id]);
      if (!res.rows.length) return interaction.editReply('❌ Payment not found.');
      return interaction.editReply(`${E.check} Payment #${id} removed.`);
    }

    // ── /pay list ─────────────────────────────────────────────────────────
    if (sub === 'list') {
      if (!sellerAllowed) return interaction.reply({ content: '❌ Approved sellers only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const statusFilter = interaction.options.getString('status') || 'all';
      let q = 'SELECT * FROM payments WHERE seller_id=$1 AND guild_id=$2';
      const params = [interaction.user.id, interaction.guild.id];
      if (statusFilter !== 'all') { q += ` AND status=$${params.length+1}`; params.push(statusFilter); }
      q += ' ORDER BY created_at DESC';

      const res = await query(q, params);
      if (!res.rows.length) return interaction.editReply('No payment records found.');

      const unpaid  = res.rows.filter(r => r.status === 'unpaid');
      const partial = res.rows.filter(r => r.status === 'partial');
      const paid    = res.rows.filter(r => r.status === 'paid');

      const totalOwed = [...unpaid, ...partial].reduce((s, r) => s + (Number(r.amount) - Number(r.amount_paid)), 0);
      const totalPaid = res.rows.reduce((s, r) => s + Number(r.amount_paid), 0);

      const fmt = r => `\`#${r.id}\` <@${r.user_id}> — **${r.service}** — $${Number(r.amount).toFixed(2)}${Number(r.amount_paid) > 0 && r.status !== 'paid' ? ` (paid $${Number(r.amount_paid).toFixed(2)})` : ''} — ${r.method} • <t:${Math.floor(new Date(r.created_at).getTime()/1000)}:d>`;

      const embed = new EmbedBuilder().setColor('#d6c2ee')
        .setTitle(`${E.payout} Your Payment Records`)
        .addFields(
          { name: `${E.wrong} Total Owed`, value: `**$${totalOwed.toFixed(2)}**`, inline: true },
          { name: `${E.check} Total Paid`, value: `**$${totalPaid.toFixed(2)}**`, inline: true },
        );

      if (unpaid.length)  embed.addFields({ name: `${E.wrong} Unpaid (${unpaid.length})`,   value: unpaid.map(fmt).join('\n').slice(0,1024),   inline: false });
      if (partial.length) embed.addFields({ name: `${E.loading} Partial (${partial.length})`, value: partial.map(fmt).join('\n').slice(0,1024), inline: false });
      if (paid.length)    embed.addFields({ name: `${E.check} Paid (${paid.length})`,        value: paid.map(fmt).join('\n').slice(0,1024),     inline: false });

      embed.setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    // ── /pay balance ──────────────────────────────────────────────────────
    if (sub === 'balance') {
      await interaction.deferReply({ ephemeral: true });

      const seller = interaction.options.getUser('seller');
      if (!await isSeller(interaction.guild.id, seller.id))
        return interaction.editReply('❌ That user is not an approved seller.');

      const res = await query(
        'SELECT * FROM payments WHERE seller_id=$1 AND user_id=$2 AND guild_id=$3 ORDER BY created_at DESC',
        [seller.id, interaction.user.id, interaction.guild.id]
      );

      const m = await getMethods(interaction.guild.id, seller.id);
      const unpaid  = res.rows.filter(r => r.status === 'unpaid');
      const partial = res.rows.filter(r => r.status === 'partial');
      const paid    = res.rows.filter(r => r.status === 'paid');
      const totalOwed = [...unpaid, ...partial].reduce((s, r) => s + (Number(r.amount) - Number(r.amount_paid)), 0);
      const totalPaid = res.rows.reduce((s, r) => s + Number(r.amount_paid), 0);

      const embed = new EmbedBuilder().setColor('#d6c2ee')
        .setTitle(`${E.payout} Your Balance with ${seller.username}`)
        .addFields(
          { name: `${E.wrong} You Owe`,   value: `**$${totalOwed.toFixed(2)}**`, inline: true },
          { name: `${E.check} You've Paid`, value: `**$${totalPaid.toFixed(2)}**`, inline: true },
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
