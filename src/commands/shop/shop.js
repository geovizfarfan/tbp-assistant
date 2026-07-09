const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, PermissionFlagsBits, UserSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { query } = require('../../utils/database');
const { getBalance, adjustBalance } = require('../../utils/playAndRegretDb');

const TYPE_LABELS = { role: '<:role:1524456992683593979> Role', reaction: '<a:purplesparkle:1512912828489793626> Auto Reaction', custom: '<a:gift:1512915751458050268> Custom', nickname: '<:role:1524456992683593979> Nickname' };
const WRONG = '<:wrong:1512916350375301160>';
const CHECK = '<:checkmark:1512916161493205165>';
const SINS = '<a:SINS:1522338148380704910>';

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
      ? `Select an item below to add it to your inventory, then run \`/shop use\` to activate it!${items.length > 25 ? `\n*(showing first 25 of ${items.length} — consider splitting this category)*` : ''}`
      : '*No items in this category yet.*');

  for (const item of items.slice(0, 25)) {
    embed.addFields({
      name: `\`#${item.id}\` ${item.name} — ${Number(item.price).toLocaleString()} ${SINS} (sins)`,
      value: `${TYPE_LABELS[item.type] || item.type}${item.description ? `\n${item.description}` : ''}${item.limit_per_user ? `\n<:vertical_line:1520457297476845741> Limit: ${item.limit_per_user} per user` : ''}${item.duration_hours ? `\n<:vertical_line:1520457297476845741> Lasts: ${formatDuration(item.duration_hours)}` : ''}`,
      inline: false,
    });
  }
  return embed;
}

function buildShopSelect(items) {
  if (!items.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId('shop_select')
    .setPlaceholder('Choose an item to buy...')
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

  for (const [cat, msgId] of existingMap.entries()) {
    const oldMsg = await channel.messages.fetch(msgId).catch(() => null);
    if (oldMsg) await oldMsg.delete().catch(() => {});
    await query('DELETE FROM shop_panel_messages WHERE guild_id = $1 AND category = $2', [guildId, cat]);
  }

  return firstMsg;
}

// ── Expiry schedulers (run from the moment an item is USED) ────────────────
function scheduleRoleRemoval(guild, userId, roleId, ms, purchaseId) {
  setTimeout(async () => {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) await member.roles.remove(roleId).catch(() => {});
      await query('UPDATE shop_purchases SET expired = true WHERE id = $1', [purchaseId]).catch(() => {});
    } catch (e) { console.error('[Shop] role removal error:', e.message); }
  }, ms);
}

function scheduleReactionExpiry(purchaseId, ms) {
  setTimeout(async () => {
    await query('UPDATE shop_purchases SET expired = true WHERE id = $1', [purchaseId]).catch(() => {});
  }, ms);
}

function scheduleNicknameRevert(guild, targetId, originalNickname, ms, purchaseId) {
  setTimeout(async () => {
    try {
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (member) await member.setNickname(originalNickname || null).catch(() => {});
      await query('UPDATE shop_purchases SET expired = true WHERE id = $1', [purchaseId]).catch(() => {});
    } catch (e) { console.error('[Shop] nickname revert error:', e.message); }
  }, ms);
}

// ── Buy: charge + add to inventory (no activation yet) ─────────────────────
async function buyItem(interaction, item) {
  const newBalance = await adjustBalance(interaction.user.id, interaction.user.username, -item.price);

  const purchaseRes = await query(
    'INSERT INTO shop_purchases (guild_id, item_id, user_id, quantity) VALUES ($1,$2,$3,1) RETURNING id',
    [interaction.guildId, item.id, interaction.user.id]
  );

  // DM receipt — best effort, don't block on closed DMs
  await interaction.user.send({
    embeds: [new EmbedBuilder()
      .setColor('#d6c2ee')
      .setTitle(`<a:shop:1524457010714640464> Purchase Receipt`)
      .setDescription(
        `You bought **${item.name}** for **${Number(item.price).toLocaleString()}** ${SINS} (sins).\n` +
        `New balance: **${Number(newBalance).toLocaleString()}** ${SINS} (sins)\n\n` +
        `Run \`/shop use item_id:${item.id}\` whenever you're ready to activate it!`
      )
      .setFooter({ text: interaction.guild?.name || 'Shop' })
      .setTimestamp()],
  }).catch(() => {});

  return { newBalance, purchaseId: purchaseRes.rows[0].id };
}

// ── Log a used/fulfilled item to the fulfillment channel ───────────────────
async function logUsedItem(interaction, item, extraFields = [], isCustom = false) {
  const config = await getConfig(interaction.guildId);
  if (!config?.fulfillment_channel_id) return;
  const ch = await interaction.client.channels.fetch(config.fulfillment_channel_id).catch(() => null);
  if (!ch) return;

  const embed = new EmbedBuilder()
    .setColor(isCustom ? '#f0997b' : '#d6c2ee')
    .setTitle(isCustom ? '<a:gift:1512915751458050268> Custom Item Used' : '<a:shop:1524457010714640464> Item Used')
    .addFields(
      { name: 'Member', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Item', value: item.name, inline: true },
      { name: 'Type', value: TYPE_LABELS[item.type] || item.type, inline: true },
      ...extraFields,
    )
    .setTimestamp();
  if (isCustom) embed.setDescription('<a:Warning:1512912830888673462> *This item needs manual fulfillment by staff.*');

  await ch.send({ embeds: [embed] }).catch(() => {});
}

module.exports = {
  scheduleRoleRemoval,
  scheduleReactionExpiry,
  scheduleNicknameRevert,

  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Economy shop — spend Sins on roles, perks, and custom items')

    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Configure the shop channel and (optional) staff fulfillment channel')
      .addChannelOption(o => o.setName('shop_channel').setDescription('Where the shop panel posts').setRequired(true))
      .addChannelOption(o => o.setName('fulfillment_channel').setDescription('Where used/custom items get logged for staff')))

    .addSubcommand(sub => sub
      .setName('additem')
      .setDescription('Add an item to the shop')
      .addStringOption(o => o.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption(o => o.setName('price').setDescription('Price in Sins').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Item type').setRequired(true).addChoices(
        { name: 'Role', value: 'role' },
        { name: 'Auto Reaction', value: 'reaction' },
        { name: 'Custom (staff fulfills)', value: 'custom' },
        { name: 'Nickname (rename another member)', value: 'nickname' },
      ))
      .addRoleOption(o => o.setName('role').setDescription('Role to grant (required for Role type; optional tag role for Auto Reaction)'))
      .addStringOption(o => o.setName('description').setDescription('Shown in the shop listing'))
      .addStringOption(o => o.setName('category').setDescription('Category to group this item under (default: General)'))
      .addIntegerOption(o => o.setName('limit').setDescription('Max purchases per user (blank = unlimited/stackable)'))
      .addIntegerOption(o => o.setName('duration_amount').setDescription('How long the effect lasts once used (blank = permanent)'))
      .addStringOption(o => o.setName('duration_unit').setDescription('Unit for the duration above').addChoices(
        { name: 'Hours', value: 'hours' },
        { name: 'Days', value: 'days' },
      )))

    .addSubcommand(sub => sub
      .setName('removeitem')
      .setDescription('Remove an item from the shop')
      .addIntegerOption(o => o.setName('item_id').setDescription('Item ID (see /shop list)').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('edititem')
      .setDescription('Edit an existing shop item (only fills in fields you provide)')
      .addIntegerOption(o => o.setName('item_id').setDescription('Item ID (see /shop list)').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('New name'))
      .addIntegerOption(o => o.setName('price').setDescription('New price in Sins'))
      .addStringOption(o => o.setName('description').setDescription('New description'))
      .addStringOption(o => o.setName('category').setDescription('New category'))
      .addRoleOption(o => o.setName('role').setDescription('New role (Role/Auto Reaction types)'))
      .addIntegerOption(o => o.setName('limit').setDescription('New max purchases per user (0 = unlimited)'))
      .addIntegerOption(o => o.setName('duration_amount').setDescription('New duration amount (0 = permanent)'))
      .addStringOption(o => o.setName('duration_unit').setDescription('Unit for the duration above').addChoices(
        { name: 'Hours', value: 'hours' },
        { name: 'Days', value: 'days' },
      ))
      .addBooleanOption(o => o.setName('active').setDescription('Show/hide this item in the shop')))

    .addSubcommand(sub => sub
      .setName('revoke')
      .setDescription('Revoke a purchased item from a member (removes effect, marks expired)')
      .addUserOption(o => o.setName('user').setDescription('Member to revoke from').setRequired(true))
      .addIntegerOption(o => o.setName('item_id').setDescription('Item ID (see /shop list)').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('inventory')
      .setDescription('See what you (or someone else) currently own from the shop')
      .addUserOption(o => o.setName('user').setDescription('Member to check (defaults to you)')))

    .addSubcommand(sub => sub
      .setName('use')
      .setDescription('Activate an item from your inventory')
      .addIntegerOption(o => o.setName('item_id').setDescription('Item ID (see /shop inventory)').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all shop items with their IDs (admin)'))

    .addSubcommand(sub => sub
      .setName('repost')
      .setDescription('Repost the shop panel (e.g. if its message was deleted)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    const memberFacing = ['list', 'inventory', 'use'];

    if (!memberFacing.includes(sub) && !isAdmin) {
      return interaction.reply({ content: `${WRONG} Admin only.`, ephemeral: true });
    }

    // 'use' handles its own deferral, since Reaction/Nickname items need to
    // showModal() as the FIRST response — can't defer before that.
    if (sub !== 'use') {
      await interaction.deferReply({ ephemeral: true });
    }

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

      return interaction.editReply(`${CHECK} Shop configured in <#${shopChannel.id}>${fulfillChannel ? ` (used/custom items → <#${fulfillChannel.id}>)` : ''}.`);
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
        return interaction.editReply(`${WRONG} Duration only applies to Role, Auto Reaction, and Nickname items.`);
      }
      if (type === 'role' && !role) {
        return interaction.editReply(`${WRONG} \`role\` is required for Role items.`);
      }
      if (price < 0) return interaction.editReply(`${WRONG} Price can't be negative.`);

      const config = await getConfig(interaction.guild.id);
      if (!config?.shop_channel_id) {
        return interaction.editReply(`${WRONG} Run \`/shop setup\` first to set a shop channel.`);
      }

      const res = await query(`
        INSERT INTO shop_items (guild_id, name, description, price, type, role_id, limit_per_user, duration_hours, category, position)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
          (SELECT COALESCE(MAX(position),0)+1 FROM shop_items WHERE guild_id=$1))
        RETURNING id
      `, [interaction.guild.id, name, description, price, type, role?.id || null, limit, duration, category]);

      await renderAndPost(interaction.client, interaction.guild.id);

      const durLabel = formatDuration(duration);
      return interaction.editReply(`${CHECK} Added **${name}** (ID \`${res.rows[0].id}\`) to **${category}** — ${price.toLocaleString()} ${SINS} (sins), type: ${TYPE_LABELS[type]}${durLabel ? `, lasts ${durLabel} once used` : ''}.`);
    }

    if (sub === 'removeitem') {
      const itemId = interaction.options.getInteger('item_id');
      const del = await query('DELETE FROM shop_items WHERE id = $1 AND guild_id = $2 RETURNING name', [itemId, interaction.guild.id]);
      if (!del.rows.length) return interaction.editReply(`${WRONG} No item with that ID.`);

      await renderAndPost(interaction.client, interaction.guild.id);
      return interaction.editReply(`${CHECK} Removed **${del.rows[0].name}** from the shop.`);
    }

    if (sub === 'edititem') {
      const itemId = interaction.options.getInteger('item_id');
      const itemRes = await query('SELECT * FROM shop_items WHERE id = $1 AND guild_id = $2', [itemId, interaction.guild.id]);
      if (!itemRes.rows.length) return interaction.editReply(`${WRONG} No item with that ID.`);
      const item = itemRes.rows[0];

      const name         = interaction.options.getString('name');
      const price        = interaction.options.getInteger('price');
      const description  = interaction.options.getString('description');
      const category     = interaction.options.getString('category');
      const role         = interaction.options.getRole('role');
      const limitOpt     = interaction.options.getInteger('limit');
      const durationAmt  = interaction.options.getInteger('duration_amount');
      const durationUnit = interaction.options.getString('duration_unit') || 'hours';
      const activeOpt    = interaction.options.getBoolean('active');

      const newName        = name ?? item.name;
      const newPrice       = price !== null ? price : item.price;
      const newDescription = description !== null ? description : item.description;
      const newCategory    = category ? category.trim() : item.category;
      const newRoleId      = role ? role.id : item.role_id;
      const newLimit       = limitOpt !== null ? (limitOpt === 0 ? null : limitOpt) : item.limit_per_user;
      const newDuration    = durationAmt !== null
        ? (durationAmt === 0 ? null : (durationUnit === 'days' ? durationAmt * 24 : durationAmt))
        : item.duration_hours;
      const newActive      = activeOpt !== null ? activeOpt : item.active;

      if (newPrice < 0) return interaction.editReply(`${WRONG} Price can't be negative.`);

      await query(`
        UPDATE shop_items SET name=$1, price=$2, description=$3, category=$4, role_id=$5, limit_per_user=$6, duration_hours=$7, active=$8
        WHERE id=$9
      `, [newName, newPrice, newDescription, newCategory, newRoleId, newLimit, newDuration, newActive, itemId]);

      await renderAndPost(interaction.client, interaction.guild.id);

      return interaction.editReply(`${CHECK} Updated **${newName}** (ID \`${itemId}\`).`);
    }

    if (sub === 'revoke') {
      const target = interaction.options.getUser('user');
      const itemId = interaction.options.getInteger('item_id');

      const itemRes = await query('SELECT * FROM shop_items WHERE id = $1 AND guild_id = $2', [itemId, interaction.guild.id]);
      if (!itemRes.rows.length) return interaction.editReply(`${WRONG} No item with that ID.`);
      const item = itemRes.rows[0];

      const purchaseRes = await query(
        'SELECT * FROM shop_purchases WHERE item_id = $1 AND user_id = $2 AND expired = false ORDER BY purchased_at DESC LIMIT 1',
        [itemId, target.id]
      );
      if (!purchaseRes.rows.length) return interaction.editReply(`${WRONG} ${target.username} doesn't currently own **${item.name}**.`);
      const purchase = purchaseRes.rows[0];

      await query('UPDATE shop_purchases SET expired = true WHERE id = $1', [purchase.id]);

      if (purchase.used_at && (item.type === 'role' || item.type === 'reaction') && item.role_id) {
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (member) await member.roles.remove(item.role_id).catch(() => {});
      }
      if (purchase.used_at && item.type === 'nickname' && purchase.target_user_id) {
        const member = await interaction.guild.members.fetch(purchase.target_user_id).catch(() => null);
        if (member) await member.setNickname(purchase.original_nickname || null).catch(() => {});
      }

      return interaction.editReply(`${CHECK} Revoked **${item.name}** from ${target.username}.`);
    }

    if (sub === 'inventory') {
      const target = interaction.options.getUser('user') || interaction.user;
      const res = await query(`
        SELECT sp.*, si.id AS item_id, si.name, si.type
        FROM shop_purchases sp
        JOIN shop_items si ON si.id = sp.item_id
        WHERE sp.guild_id = $1 AND sp.user_id = $2 AND sp.expired = false
        ORDER BY sp.purchased_at DESC
      `, [interaction.guild.id, target.id]);

      if (!res.rows.length) return interaction.editReply(`${target.id === interaction.user.id ? 'You don\'t' : `${target.username} doesn't`} own anything from the shop yet.`);

      const unused = res.rows.filter(p => !p.used_at);
      const active = res.rows.filter(p => p.used_at);

      const lines = [];
      if (unused.length) {
        lines.push('**Unused — run `/shop use`:**');
        for (const p of unused) lines.push(`\`#${p.item_id}\` ${TYPE_LABELS[p.type] || p.type} **${p.name}**`);
      }
      if (active.length) {
        if (lines.length) lines.push('');
        lines.push('**Active:**');
        for (const p of active) {
          let line = `\`#${p.item_id}\` ${TYPE_LABELS[p.type] || p.type} **${p.name}**`;
          if (p.chosen_emoji) line += ` (${p.chosen_emoji})`;
          if (p.expires_at) line += ` — expires <t:${Math.floor(new Date(p.expires_at).getTime()/1000)}:R>`;
          lines.push(line);
        }
      }

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle(`<a:Backpack:1524458355156844633> ${target.id === interaction.user.id ? 'Your' : `${target.username}'s`} Inventory`)
        .setDescription(lines.join('\n'))] });
    }

    if (sub === 'use') return useItem(interaction);

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
          `\`${i.id}\` **${i.name}** — ${Number(i.price).toLocaleString()} ${SINS} (sins) (${TYPE_LABELS[i.type]})${i.active ? '' : ' *(inactive)*'}${i.limit_per_user ? ` — limit ${i.limit_per_user}/user` : ' — unlimited'}${i.duration_hours ? ` — lasts ${formatDuration(i.duration_hours)}` : ''}`
        ).join('\n');
        embed.addFields({ name: cat, value: lines });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'repost') {
      const msg = await renderAndPost(interaction.client, interaction.guild.id);
      if (!msg) return interaction.editReply(`${WRONG} No shop channel configured — run \`/shop setup\` first.`);
      return interaction.editReply(`${CHECK} Shop panel reposted.`);
    }
  },

  // ── Purchase flow (shop panel dropdown) — buy only, no activation ──────
  async handleSelect(interaction) {
    const itemId = interaction.values[0];
    const itemRes = await query('SELECT * FROM shop_items WHERE id = $1 AND active = true', [itemId]);
    if (!itemRes.rows.length) {
      return interaction.reply({ content: `${WRONG} This item is no longer available.`, ephemeral: true });
    }
    const item = itemRes.rows[0];

    if (item.limit_per_user) {
      const countRes = await query(
        'SELECT COALESCE(SUM(quantity),0) AS total FROM shop_purchases WHERE item_id = $1 AND user_id = $2',
        [item.id, interaction.user.id]
      );
      if (Number(countRes.rows[0].total) >= item.limit_per_user) {
        return interaction.reply({ content: `${WRONG} You've already reached the limit (${item.limit_per_user}) for **${item.name}**.`, ephemeral: true });
      }
    }

    const balance = await getBalance(interaction.user.id);
    if (balance === null || balance < item.price) {
      return interaction.reply({ content: `${WRONG} You don't have enough ${SINS} Sins for **${item.name}** (need ${Number(item.price).toLocaleString()}, you have ${Number(balance || 0).toLocaleString()}).`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const { newBalance } = await buyItem(interaction, item);

    return interaction.editReply({ embeds: [new EmbedBuilder()
      .setColor('#2ecc71')
      .setDescription(`${CHECK} You bought **${item.name}** for **${Number(item.price).toLocaleString()}** ${SINS} (sins)!\nNew balance: **${Number(newBalance).toLocaleString()}** ${SINS} (sins)\n\nRun \`/shop use item_id:${item.id}\` whenever you're ready to activate it! (A receipt was also sent to your DMs.)`)] });
  },

  // ── Emoji modal submit (for using Auto Reaction items) ──────────────────
  async handleEmojiModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const purchaseId = interaction.customId.split(':')[1];
    const emoji = interaction.fields.getTextInputValue('emoji').trim();
    if (!emoji) return interaction.editReply(`${WRONG} Please enter a valid emoji.`);

    const purchaseRes = await query(
      `SELECT sp.id AS purchase_id, sp.used_at, si.* FROM shop_purchases sp JOIN shop_items si ON si.id = sp.item_id WHERE sp.id = $1`,
      [purchaseId]
    );
    if (!purchaseRes.rows.length) return interaction.editReply(`${WRONG} That item could no longer be found.`);
    const row = purchaseRes.rows[0];
    if (row.used_at) return interaction.editReply(`${WRONG} That item was already used.`);

    let expiresAt = null;
    if (row.duration_hours) expiresAt = new Date(Date.now() + row.duration_hours * 60 * 60 * 1000);

    await query('UPDATE shop_purchases SET used_at = NOW(), chosen_emoji = $1, expires_at = $2 WHERE id = $3', [emoji, expiresAt, purchaseId]);

    if (row.role_id) {
      await interaction.member.roles.add(row.role_id).catch(() => {});
      if (expiresAt) scheduleRoleRemoval(interaction.guild, interaction.user.id, row.role_id, row.duration_hours * 60 * 60 * 1000, purchaseId);
    } else if (expiresAt) {
      scheduleReactionExpiry(purchaseId, row.duration_hours * 60 * 60 * 1000);
    }

    await logUsedItem(interaction, row, [
      { name: 'Chosen Emoji', value: emoji, inline: true },
      ...(expiresAt ? [{ name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime()/1000)}:R>`, inline: true }] : []),
    ]);

    return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#2ecc71')
      .setDescription(`${CHECK} Activated **${row.name}**! Veloura will now react to your messages with ${emoji}` +
        (expiresAt ? `\n*This expires <t:${Math.floor(expiresAt.getTime()/1000)}:R>*` : ''))] });
  },

  // ── Nickname modal submit (for using Nickname items) ─────────────────────
  async handleNicknameModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const [, purchaseId, targetId] = interaction.customId.split(':');
    const newNickname = interaction.fields.getTextInputValue('nickname').trim();
    if (!newNickname) return interaction.editReply(`${WRONG} Please enter a valid nickname.`);

    const purchaseRes = await query(
      `SELECT sp.id AS purchase_id, sp.used_at, si.* FROM shop_purchases sp JOIN shop_items si ON si.id = sp.item_id WHERE sp.id = $1`,
      [purchaseId]
    );
    if (!purchaseRes.rows.length) return interaction.editReply(`${WRONG} That item could no longer be found.`);
    const row = purchaseRes.rows[0];
    if (row.used_at) return interaction.editReply(`${WRONG} That item was already used.`);

    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!targetMember) return interaction.editReply(`${WRONG} Couldn't find that member anymore.`);

    const botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames) || targetMember.roles.highest.position >= botMember.roles.highest.position) {
      return interaction.editReply(`${WRONG} Veloura can no longer nickname that member.`);
    }

    const originalNickname = targetMember.nickname;
    const setResult = await targetMember.setNickname(newNickname).catch(() => null);
    if (!setResult) return interaction.editReply(`${WRONG} Failed to set that nickname.`);

    let expiresAt = null;
    if (row.duration_hours) expiresAt = new Date(Date.now() + row.duration_hours * 60 * 60 * 1000);

    await query(
      'UPDATE shop_purchases SET used_at = NOW(), target_user_id = $1, original_nickname = $2, expires_at = $3 WHERE id = $4',
      [targetId, originalNickname, expiresAt, purchaseId]
    );

    if (expiresAt) scheduleNicknameRevert(interaction.guild, targetId, originalNickname, row.duration_hours * 60 * 60 * 1000, purchaseId);

    await logUsedItem(interaction, row, [
      { name: 'Target', value: `<@${targetId}>`, inline: true },
      { name: 'New Nickname', value: newNickname, inline: true },
      ...(expiresAt ? [{ name: 'Reverts', value: `<t:${Math.floor(expiresAt.getTime()/1000)}:R>`, inline: true }] : []),
    ]);

    return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#2ecc71')
      .setDescription(`${CHECK} You nicknamed <@${targetId}> to **${newNickname}**!` +
        (expiresAt ? `\n*This reverts <t:${Math.floor(expiresAt.getTime()/1000)}:R>*` : ''))] });
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
        AND sp.used_at IS NOT NULL AND sp.expired = false AND sp.chosen_emoji IS NOT NULL
    `, [message.guild.id, message.author.id]);
    if (!res.rows.length) return;

    for (const row of res.rows) {
      await message.react(row.chosen_emoji).catch(() => {});
    }
  },
};

// ── Use: activate an unused inventory item, per type ────────────────────────
async function useItem(interaction) {
  const itemId = interaction.options.getInteger('item_id');

  const purchaseRes = await query(`
    SELECT sp.id AS purchase_id, sp.used_at, si.*
    FROM shop_purchases sp
    JOIN shop_items si ON si.id = sp.item_id
    WHERE si.id = $1 AND sp.user_id = $2 AND sp.guild_id = $3 AND sp.used_at IS NULL
    ORDER BY sp.purchased_at ASC LIMIT 1
  `, [itemId, interaction.user.id, interaction.guildId]);

  if (!purchaseRes.rows.length) {
    return interaction.reply({ content: `${WRONG} You don't have an unused copy of that item — check \`/shop inventory\`.`, ephemeral: true });
  }
  const row = purchaseRes.rows[0]; // has both the purchase (aliased) and item columns

  // ── Role: activate immediately ──────────────────────────────────────────
  if (row.type === 'role') {
    await interaction.deferReply({ ephemeral: true });
    if (interaction.member.roles.cache.has(row.role_id)) {
      return interaction.editReply(`${WRONG} You already have that role!`);
    }

    let expiresAt = null;
    if (row.duration_hours) expiresAt = new Date(Date.now() + row.duration_hours * 60 * 60 * 1000);

    await query('UPDATE shop_purchases SET used_at = NOW(), expires_at = $1 WHERE id = $2', [expiresAt, row.purchase_id]);
    await interaction.member.roles.add(row.role_id).catch(() => {});
    if (expiresAt) scheduleRoleRemoval(interaction.guild, interaction.user.id, row.role_id, row.duration_hours * 60 * 60 * 1000, row.purchase_id);

    await logUsedItem(interaction, row, expiresAt ? [{ name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime()/1000)}:R>`, inline: true }] : []);

    return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#2ecc71')
      .setDescription(`${CHECK} Activated **${row.name}**! You now have <@&${row.role_id}>.` +
        (expiresAt ? `\n*This expires <t:${Math.floor(expiresAt.getTime()/1000)}:R>*` : ''))] });
  }

  // ── Custom: notify staff immediately, mark used ─────────────────────────
  if (row.type === 'custom') {
    await interaction.deferReply({ ephemeral: true });
    await query('UPDATE shop_purchases SET used_at = NOW() WHERE id = $1', [row.purchase_id]);
    await logUsedItem(interaction, row, [], true);
    return interaction.editReply(`${CHECK} Used **${row.name}** — staff has been notified to fulfill your order.`);
  }

  // ── Auto Reaction: pick an emoji via modal ──────────────────────────────
  if (row.type === 'reaction') {
    const modal = new ModalBuilder()
      .setCustomId(`shop_emoji_modal:${row.purchase_id}`)
      .setTitle('Pick your emoji');
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

  // ── Nickname: pick a target, then type the nickname via modal ──────────
  if (row.type === 'nickname') {
    await interaction.deferReply({ ephemeral: true });

    const userSelect = new UserSelectMenuBuilder()
      .setCustomId('shop_nickname_target')
      .setPlaceholder('Who do you want to nickname?')
      .setMinValues(1)
      .setMaxValues(1);
    const selectRow = new ActionRowBuilder().addComponents(userSelect);

    const promptMsg = await interaction.editReply({
      content: '<:role:1524456992683593979> Choose who you want to nickname (60s to pick):',
      components: [selectRow],
    });

    let targetSelectInteraction;
    try {
      targetSelectInteraction = await promptMsg.awaitMessageComponent({ time: 60_000 });
    } catch {
      return interaction.editReply({ content: `${WRONG} Timed out — item was not used.`, components: [] });
    }

    const targetId = targetSelectInteraction.values[0];
    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);

    if (!targetMember) {
      return targetSelectInteraction.update({ content: `${WRONG} Couldn't find that member — item was not used.`, components: [] });
    }
    if (targetMember.user.bot) {
      return targetSelectInteraction.update({ content: `${WRONG} You can't nickname a bot — item was not used.`, components: [] });
    }
    if (targetMember.id === interaction.guild.ownerId) {
      return targetSelectInteraction.update({ content: `${WRONG} Can't nickname the server owner — item was not used.`, components: [] });
    }
    const botMember = interaction.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return targetSelectInteraction.update({ content: `${WRONG} Veloura is missing the Manage Nicknames permission — let staff know. Item was not used.`, components: [] });
    }
    if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
      return targetSelectInteraction.update({ content: `${WRONG} That member's role is too high for Veloura to nickname — item was not used.`, components: [] });
    }

    const modal = new ModalBuilder()
      .setCustomId(`shop_nickname_modal:${row.purchase_id}:${targetId}`)
      .setTitle('Set their new nickname');
    const input = new TextInputBuilder()
      .setCustomId('nickname')
      .setLabel('New nickname (max 32 characters)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(32);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return targetSelectInteraction.showModal(modal);
  }
}
