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

// Shows only the ONE method tied to this specific payment, instead of every
// method the seller has configured. Falls back to showing all of them if
// that specific method isn't set (or the payment was logged as "Other").
function formatSingleMethod(m, methodName) {
  if (!m) return 'Contact the seller directly.';
  const map = {
    'PayPal':    m.paypal   ? `${E.paypal} **PayPal:** [Pay Here](${m.paypal})`     : null,
    'Venmo':     m.venmo    ? `${E.venmo} **Venmo:** [Pay Here](${m.venmo})`         : null,
    'CashApp':   m.cashapp  ? `${E.cashapp} **CashApp:** [Pay Here](${m.cashapp})`   : null,
    'Apple Pay': m.applepay ? `${E.applepay} **Apple Pay:** ${m.applepay}`           : null,
    'Zelle':     m.zelle    ? `${E.zelle} **Zelle:** ${m.zelle}`                     : null,
  };
  return map[methodName] || formatMethods(m);
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
        .addStringOption(o => o.setName('zelle').setDescription('Zelle phone/email')))),

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

    // ── /pay methods set ─────────────────────────────────────────────────
    if (group === 'methods' && sub === 'set') {
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

    // ── Seller check for remaining commands ───────────────────────────────
    const sellerAllowed = await isSeller(interaction.guild.id, interaction.user.id) || isOwner;

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
  },
  E,
  formatMethods,
  formatSingleMethod,
  getMethods,
  isSeller,
};
