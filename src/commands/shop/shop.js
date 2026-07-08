const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, PermissionFlagsBits,
} = require('discord.js');
const { query } = require('../../utils/database');
const { getBalance, adjustBalance } = require('../../utils/playAndRegretDb');

const TYPE_LABELS = { role: '<:role:1524456992683593979> Role', reaction: '<a:purplesparkle:1512912828489793626> Auto Reaction', custom: '<a:gift:1512915751458050268> Custom' };

function formatDuration(hours) {
  if (!hours) return null;
  return (hours % 24 === 0 && hours >= 24) ? `${hours / 24}d` : `${hours}h`;
}

async function getConfig(guildId) {
  const res = await query('SELECT * FROM shop_config WHERE guild_id = $1', [guildId]);
  return res.rows[0] || null;
}

async function getItems(guildId, activeOnly = true) {
  const res = await query(
    `SELECT * FROM shop_items WHERE guild_id = $1 ${activeOnly ? 'AND active = true' : ''} ORDER BY position ASC, id ASC`,
    [guildId]
  );
  return res.rows;
}

function buildShopEmbed(category, items) {
  const embed = new EmbedBuilder()
    .setColor('#d6c2ee')
    .setTitle(`<a:shop:1524457010714640464> ${category}`)
    .setDescription(items.length
      ? `Select an item below to purchase with <a:SINS:1522338148380704910> Sins!${items.length > 25 ? `\n*(showing first 25 of ${items.length} — consider splitting this category)*` : ''}`
      : '*No items in this category yet.*');

  for (const item of items.slice(0, 25)) {
    embed.addFields({
      name: `${item.name} — ${Number(item.price).toLocaleString()} <a:SINS:1522338148380704910> (sins)`,
      value: `${TYPE_LABELS[item.type] || item.type}${item.description ? `\n${item.description}` : ''}${item.limit_per_user ? `\n*Limit: ${item.limit_per_user} per user*` : ''}${item.duration_hours ? `\n*Lasts ${formatDuration(item.duration_hours)}*` : ''}`,
      inline: false,
    });
  }
  return embed;
}

function buildShopSelect(items) {
  if (!items.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('shop_select')
    .setPlaceholder('Choose an item to purchase...')
    .addOptions(items.slice(0, 25).map(i => ({
      label: `${i.name} — ${Number(i.price).toLocaleString()} Sins`.slice(0, 100),
      value: String(i.id),
      description: (i.description || TYPE_LABELS[i.type] || '').slice(0, 100),
    })));
  return new ActionRowBuilder().addComponents(menu);
}

async function renderAndPost(client, guildId) {
  const config = await getConfig(guildId);
  if (!config?.shop_channel_id) return null;
  const channel = await client.channels.fetch(config.shop_channel_id).catch(() => null);
  if (!channel) return null;

  const items = await getItems(guildId);

  // Group items by category, preserving the order categories first appear in
  const categoryOrder = [];
  const grouped = new Map();
  for (const item of items) {
    const cat = item.category || 'General';
    if (!grouped.has(cat)) { grouped.set(cat, []); categoryOrder.push(cat); }
    grouped.get(cat).push(item);
  }
  if (!categoryOrder.length) {
    categoryOrder.push('General');
    grouped.set('General', []);
  }

  const existingRes = await query('SELECT category, message_id FROM shop_panel_messages WHERE guild_id = $1', [guildId]);
  const existingMap = new Map(existingRes.rows.map(r => [r.category, r.message_id]));

  let firstMsg = null;
  for (const cat of categoryOrder) {
    const catItems = grouped.get(cat);
    const embed = buildShopEmbed(cat, catItems);
    const row = buildShopSelect(catItems);

    const oldMsgId = existingMap.get(cat);
    if (oldMsgId) {
      const oldMsg = await channel.messages.fetch(oldMsgId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});
      existingMap.delete(cat);
    }

    const newMsg = await channel.send({ embeds: [embed], components: row ? [row] : [] });
    await query(`
      INSERT INTO shop_panel_messages (guild_id, category, message_id)
      VALUES ($1,$2,$3)
      ON CONFLICT (guild_id, category) DO UPDATE SET message_id = EXCLUDED.message_id
    `, [guildId, cat, newMsg.id]);
    if (!firstMsg) firstMsg = newMsg;
  }

  // Clean up panel messages for categories that no longer have any items
  for (const [cat, msgId] of existingMap.entries()) {
    const oldMsg = await channel.messages.fetch(msgId).catch(() => null);
    if (oldMsg) await oldMsg.delete().catch(() => {});
    await query('DELETE FROM shop_panel_messages WHERE guild_id = $1 AND category = $2', [guildId, cat]);
  }

  return firstMsg;
}

async function scheduleRoleRemoval(guild, userId, roleId, ms, purchaseId) {
  setTimeout(async () => {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) await member.roles.remove(roleId).catch(() => {});
      await query('UPDATE shop_purchases SET expired = true WHERE id = $1', [purchaseId]).catch(() => {});
    } catch (e) { console.error('[Shop] role removal error:', e.message); }
  }, ms);
}

async function scheduleReactionExpiry(purchaseId, ms) {
  setTimeout(async () => {
    await query('UPDATE shop_purchases SET expired = true WHERE id = $1', [purchaseId]).catch(() => {});
  }, ms);
}

async function finalizePurchase(interaction, item, chosenEmoji) {
  const newBalance = await adjustBalance(interaction.user.id, interaction.user.username, -item.price);

  let expiresAt = null;
  if (item.duration_hours) {
    expiresAt = new Date(Date.now() + item.duration_hours * 60 * 60 * 1000);
  }
  const purchaseRes = await query(
    'INSERT INTO shop_purchases (guild_id, item_id, user_id, quantity, expires_at, chosen_emoji) VALUES ($1,$2,$3,1,$4,$5) RETURNING id',
    [interaction.guild.id, item.id, interaction.user.id, expiresAt, chosenEmoji]
  );
  const purchaseId = purchaseRes.rows[0].id;
  const ms = item.duration_hours ? item.duration_hours * 60 * 60 * 1000 : null;

  if ((item.type === 'role' || item.type === 'reaction') && item.role_id) {
    await interaction.member.roles.add(item.role_id).catch(() => {});
    if (ms) await scheduleRoleRemoval(interaction.guild, interaction.user.id, item.role_id, ms, purchaseId);
  } else if (item.type === 'reaction' && ms) {
    // No role tied to this reaction perk — just expire the purchase record itself
    await scheduleReactionExpiry(purchaseId, ms);
  }

  // Log every purchase to the fulfillment channel, custom items get an extra highlight
  const config = await getConfig(interaction.guild.id);
  if (config?.fulfillment_channel_id) {
    const ch = await interaction.client.channels.fetch(config.fulfillment_channel_id).catch(() => null);
    if (ch) {
      const logEmbed = new EmbedBuilder()
        .setColor(item.type === 'custom' ? '#f0997b' : '#d6c2ee')
        .setTitle(item.type === 'custom' ? '<a:gift:1512915751458050268> New Custom Order' : '<a:shop:1524457010714640464> New Purchase')
        .addFields(
          { name: 'Buyer', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Item', value: item.name, inline: true },
          { name: 'Type', value: TYPE_LABELS[item.type] || item.type, inline: true },
          { name: 'Price', value: `${Number(item.price).toLocaleString()} <a:SINS:1522338148380704910> (sins)`, inline: true },
        );
      if (chosenEmoji) logEmbed.addFields({ name: 'Chosen Emoji', value: chosenEmoji, inline: true });
      if (expiresAt) logEmbed.addFields({ name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime()/1000)}:R>`, inline: true });
      if (item.type === 'custom') logEmbed.setDescription('<a:Warning:1512912830888673462> *This item needs manual fulfillment by staff.*');
      logEmbed.setTimestamp();

      await ch.send({ embeds: [logEmbed] }).catch(() => {});
    }
  }

  const embed = new EmbedBuilder()
    .setColor('#2ecc71')
    .setDescription(`<:checkmark:1512916161493205165> You purchased **${item.name}** for **${Number(item.price).toLocaleString()}** <a:SINS:1522338148380704910> (sins)!\nNew balance: **${Number(newBalance).toLocaleString()}** <a:SINS:1522338148380704910> (sins)` +
      (chosenEmoji ? `\n*Veloura will now react to your messages with ${chosenEmoji}*` : '') +
      (expiresAt ? `\n*This expires <t:${Math.floor(expiresAt.getTime()/1000)}:R>*` : '') +
      (item.type === 'custom' ? '\n\n*Staff has been notified to fulfill your order.*' : ''));

  return interaction.editReply({ embeds: [embed] });
}

module.exports = {
  scheduleRoleRemoval,
  scheduleReactionExpiry,
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Economy shop — spend Sins on roles, perks, and custom items')

    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Configure the shop channel and (optional) staff fulfillment channel')
      .addChannelOption(o => o.setName('shop_channel').setDescription('Where the shop panel posts').setRequired(true))
      .addChannelOption(o => o.setName('fulfillment_channel').setDescription('Where custom-item orders go for staff to fulfill')))

    .addSubcommand(sub => sub
      .setName('additem')
      .setDescription('Add an item to the shop')
      .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption(o => o.setName('price').setDescription('Price in Sins').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Item type').setRequired(true).addChoices(
        { name: 'Role', value: 'role' },
        { name: 'Auto Reaction', value: 'reaction' },
        { name: 'Custom (staff fulfills)', value: 'custom' },
      ))
      .addRoleOption(o => o.setName('role').setDescription('Role to grant (required for Role type; optional tag role for Auto Reaction)'))
      .addStringOption(o => o.setName('description').setDescription('Shown in the shop listing'))
      .addStringOption(o => o.setName('category').setDescription('Category to group this item under (default: General)'))
      .addIntegerOption(o => o.setName('limit').setDescription('Max purchases per user (blank = unlimited/stackable)'))
      .addIntegerOption(o => o.setName('duration_amount').setDescription('Expires after this amount (blank = permanent)'))
      .addStringOption(o => o.setName('duration_unit').setDescription('Unit for the duration above').addChoices(
        { name: 'Hours', value: 'hours' },
        { name: 'Days', value: 'days' },
      )))

    .addSubcommand(sub => sub
      .setName('removeitem')
      .setDescription('Remove an item from the shop')
      .addIntegerOption(o => o.setName('item_id').setDescription('Item ID (see /shop list)').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('revoke')
      .setDescription('Revoke a purchased item from a member (removes role, marks expired)')
      .addUserOption(o => o.setName('user').setDescription('Member to revoke from').setRequired(true))
      .addIntegerOption(o => o.setName('item_id').setDescription('Item ID (see /shop list)').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('inventory')
      .setDescription('See what you (or someone else) currently own from the shop')
      .addUserOption(o => o.setName('user').setDescription('Member to check (defaults to you)')))

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all shop items with their IDs (admin)'))

    .addSubcommand(sub => sub
      .setName('repost')
      .setDescription('Repost the shop panel (e.g. if its message was deleted)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!['list', 'inventory'].includes(sub) && !isAdmin) {
      return interaction.reply({ content: '<:wrong:1512916350375301160> Admin only.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    if (sub === 'setup') {
      const shopChannel = interaction.options.getChannel('shop_channel');
      const fulfillChannel = interaction.options.getChannel('fulfillment_channel');

      await query(`
        INSERT INTO shop_config (guild_id, shop_channel_id, fulfillment_channel_id)
        VALUES ($1,$2,$3)
        ON CONFLICT (guild_id) DO UPDATE SET
          shop_channel_id = EXCLUDED.shop_channel_id,
          fulfillment_channel_id = COALESCE(EXCLUDED.fulfillment_channel_id, shop_config.fulfillment_channel_id)
      `, [interaction.guild.id, shopChannel.id, fulfillChannel?.id || null]);

      await renderAndPost(interaction.client, interaction.guild.id);

      return interaction.editReply(`<:checkmark:1512916161493205165> Shop configured in <#${shopChannel.id}>${fulfillChannel ? ` (custom-item orders → <#${fulfillChannel.id}>)` : ''}.`);
    }

    if (sub === 'additem') {
      const name          = interaction.options.getString('name');
      const price         = interaction.options.getInteger('price');
      const type          = interaction.options.getString('type');
      const role          = interaction.options.getRole('role');
      const description   = interaction.options.getString('description') || null;
      const category      = interaction.options.getString('category')?.trim() || 'General';
      const limit         = interaction.options.getInteger('limit') || null;
      const durationAmt   = interaction.options.getInteger('duration_amount');
      const durationUnit  = interaction.options.getString('duration_unit') || 'hours';
      const duration      = durationAmt ? (durationUnit === 'days' ? durationAmt * 24 : durationAmt) : null;

      if (durationAmt && type === 'custom') {
        return interaction.editReply('<:wrong:1512916350375301160> Duration only applies to Role and Auto Reaction items.');
      }
      if (type === 'role' && !role) {
        return interaction.editReply('<:wrong:1512916350375301160> `role` is required for Role items.');
      }
      if (price < 0) return interaction.editReply('<:wrong:1512916350375301160> Price can\'t be negative.');

      const config = await getConfig(interaction.guild.id);
      if (!config?.shop_channel_id) {
        return interaction.editReply('<:wrong:1512916350375301160> Run `/shop setup` first to set a shop channel.');
      }

      const res = await query(`
        INSERT INTO shop_items (guild_id, name, description, price, type, role_id, limit_per_user, duration_hours, category, position)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
          (SELECT COALESCE(MAX(position),0)+1 FROM shop_items WHERE guild_id=$1))
        RETURNING id
      `, [interaction.guild.id, name, description, price, type, role?.id || null, limit, duration, category]);

      await renderAndPost(interaction.client, interaction.guild.id);

      const durLabel = formatDuration(duration);
      return interaction.editReply(`<:checkmark:1512916161493205165> Added **${name}** (ID \`${res.rows[0].id}\`) to **${category}** — ${price.toLocaleString()} <a:SINS:1522338148380704910> (sins), type: ${TYPE_LABELS[type]}${durLabel ? `, expires after ${durLabel}` : ''}${type === 'reaction' ? '\n*Buyers will be asked to pick their own emoji at purchase time.*' : ''}.`);
    }

    if (sub === 'removeitem') {
      const itemId = interaction.options.getInteger('item_id');
      const del = await query('DELETE FROM shop_items WHERE id = $1 AND guild_id = $2 RETURNING name', [itemId, interaction.guild.id]);
      if (!del.rows.length) return interaction.editReply('<:wrong:1512916350375301160> No item with that ID.');

      await renderAndPost(interaction.client, interaction.guild.id);
      return interaction.editReply(`<:checkmark:1512916161493205165> Removed **${del.rows[0].name}** from the shop.`);
    }

    if (sub === 'revoke') {
      const target = interaction.options.getUser('user');
      const itemId = interaction.options.getInteger('item_id');

      const itemRes = await query('SELECT * FROM shop_items WHERE id = $1 AND guild_id = $2', [itemId, interaction.guild.id]);
      if (!itemRes.rows.length) return interaction.editReply('<:wrong:1512916350375301160> No item with that ID.');
      const item = itemRes.rows[0];

      const purchaseRes = await query(
        'SELECT * FROM shop_purchases WHERE item_id = $1 AND user_id = $2 AND expired = false ORDER BY purchased_at DESC LIMIT 1',
        [itemId, target.id]
      );
      if (!purchaseRes.rows.length) return interaction.editReply(`<:wrong:1512916350375301160> ${target.username} doesn't currently own **${item.name}**.`);

      await query('UPDATE shop_purchases SET expired = true WHERE id = $1', [purchaseRes.rows[0].id]);

      if ((item.type === 'role' || item.type === 'reaction') && item.role_id) {
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (member) await member.roles.remove(item.role_id).catch(() => {});
      }

      return interaction.editReply(`<:checkmark:1512916161493205165> Revoked **${item.name}** from ${target.username}.`);
    }

    if (sub === 'inventory') {
      const target = interaction.options.getUser('user') || interaction.user;
      const res = await query(`
        SELECT sp.*, si.name, si.type, si.description
        FROM shop_purchases sp
        JOIN shop_items si ON si.id = sp.item_id
        WHERE sp.guild_id = $1 AND sp.user_id = $2 AND sp.expired = false
        ORDER BY sp.purchased_at DESC
      `, [interaction.guild.id, target.id]);

      if (!res.rows.length) return interaction.editReply(`${target.id === interaction.user.id ? 'You don\'t' : `${target.username} doesn't`} own anything from the shop yet.`);

      const lines = res.rows.map(p => {
        let line = `${TYPE_LABELS[p.type] || p.type} **${p.name}**`;
        if (p.chosen_emoji) line += ` (${p.chosen_emoji})`;
        if (p.expires_at) line += ` — expires <t:${Math.floor(new Date(p.expires_at).getTime()/1000)}:R>`;
        return line;
      }).join('\n');

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle(`<a:Backpack:1524458355156844633> ${target.id === interaction.user.id ? 'Your' : `${target.username}'s`} Inventory`)
        .setDescription(lines)] });
    }

    if (sub === 'list') {
      const items = await getItems(interaction.guild.id, false);
      if (!items.length) return interaction.editReply('No shop items yet.');

      const byCategory = new Map();
      for (const i of items) {
        const cat = i.category || 'General';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(i);
      }

      const embed = new EmbedBuilder().setColor('#d6c2ee').setTitle('Shop Items');
      for (const [cat, catItems] of byCategory) {
        const lines = catItems.map(i =>
          `\`${i.id}\` **${i.name}** — ${Number(i.price).toLocaleString()} <a:SINS:1522338148380704910> (sins) (${TYPE_LABELS[i.type]})${i.active ? '' : ' *(inactive)*'}${i.limit_per_user ? ` — limit ${i.limit_per_user}/user` : ' — unlimited'}${i.duration_hours ? ` — expires ${formatDuration(i.duration_hours)}` : ''}`
        ).join('\n');
        embed.addFields({ name: cat, value: lines });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'repost') {
      const msg = await renderAndPost(interaction.client, interaction.guild.id);
      if (!msg) return interaction.editReply('<:wrong:1512916350375301160> No shop channel configured — run `/shop setup` first.');
      return interaction.editReply('<:checkmark:1512916161493205165> Shop panel reposted.');
    }
  },

  // ── Purchase flow (dropdown select) ────────────────────────────────────
  async handleSelect(interaction) {
    const itemId = interaction.values[0];
    const itemRes = await query('SELECT * FROM shop_items WHERE id = $1 AND active = true', [itemId]);
    if (!itemRes.rows.length) {
      return interaction.reply({ content: '<:wrong:1512916350375301160> This item is no longer available.', ephemeral: true });
    }
    const item = itemRes.rows[0];

    // Enforce per-user purchase limit
    if (item.limit_per_user) {
      const countRes = await query(
        'SELECT COALESCE(SUM(quantity),0) AS total FROM shop_purchases WHERE item_id = $1 AND user_id = $2',
        [item.id, interaction.user.id]
      );
      if (Number(countRes.rows[0].total) >= item.limit_per_user) {
        return interaction.reply({ content: `<:wrong:1512916350375301160> You've already reached the limit (${item.limit_per_user}) for **${item.name}**.`, ephemeral: true });
      }
    }

    // Role items: don't allow buying a role the member already has
    if (item.type === 'role' && interaction.member.roles.cache.has(item.role_id)) {
      return interaction.reply({ content: '<:wrong:1512916350375301160> You already have that role!', ephemeral: true });
    }

    const balance = await getBalance(interaction.user.id);
    if (balance === null || balance < item.price) {
      return interaction.reply({ content: `<:wrong:1512916350375301160> You don't have enough <a:SINS:1522338148380704910> Sins for **${item.name}** (need ${Number(item.price).toLocaleString()}, you have ${Number(balance || 0).toLocaleString()}).`, ephemeral: true });
    }

    // Auto Reaction items: buyer picks their own emoji before we charge them
    if (item.type === 'reaction') {
      const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
      const modal = new ModalBuilder()
        .setCustomId(`shop_emoji_modal:${item.id}`)
        .setTitle(`Pick your emoji`.slice(0, 45));
      const input = new TextInputBuilder()
        .setCustomId('emoji')
        .setLabel('Emoji to react with')
        .setPlaceholder('🔥  or a custom server emoji like <:name:id>')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(60);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    // Role & Custom items: purchase immediately
    await interaction.deferReply({ ephemeral: true });
    return finalizePurchase(interaction, item, null);
  },

  // ── Emoji modal submit (for Auto Reaction purchases) ───────────────────
  async handleEmojiModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const itemId = interaction.customId.split(':')[1];
    const emoji  = interaction.fields.getTextInputValue('emoji').trim();
    if (!emoji) return interaction.editReply('<:wrong:1512916350375301160> Please enter a valid emoji.');

    const itemRes = await query('SELECT * FROM shop_items WHERE id = $1 AND active = true', [itemId]);
    if (!itemRes.rows.length) return interaction.editReply('<:wrong:1512916350375301160> This item is no longer available.');
    const item = itemRes.rows[0];

    // Re-check limit & balance since some time may have passed since the dropdown
    if (item.limit_per_user) {
      const countRes = await query(
        'SELECT COALESCE(SUM(quantity),0) AS total FROM shop_purchases WHERE item_id = $1 AND user_id = $2',
        [item.id, interaction.user.id]
      );
      if (Number(countRes.rows[0].total) >= item.limit_per_user) {
        return interaction.editReply(`<:wrong:1512916350375301160> You've already reached the limit (${item.limit_per_user}) for **${item.name}**.`);
      }
    }
    const balance = await getBalance(interaction.user.id);
    if (balance === null || balance < item.price) {
      return interaction.editReply(`<:wrong:1512916350375301160> You don't have enough <a:SINS:1522338148380704910> Sins for **${item.name}**.`);
    }

    return finalizePurchase(interaction, item, emoji);
  },

  // ── Auto-react perk (called from messageCreate) ────────────────────────
  async handleAutoReact(message, client) {
    if (message.author.bot || !message.guild) return;
    const res = await query(`
      SELECT DISTINCT sp.chosen_emoji
      FROM shop_purchases sp
      JOIN shop_items si ON si.id = sp.item_id
      WHERE sp.guild_id = $1 AND sp.user_id = $2
        AND si.type = 'reaction' AND si.active = true
        AND sp.expired = false AND sp.chosen_emoji IS NOT NULL
    `, [message.guild.id, message.author.id]);
    if (!res.rows.length) return;

    for (const row of res.rows) {
      await message.react(row.chosen_emoji).catch(() => {});
    }
  },
};
