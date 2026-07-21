const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Post a custom embed')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create and post a custom embed')
      .addStringOption(o => o.setName('description').setDescription('Body text (use \\n for new lines)').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post in (default: current channel)'))
      .addStringOption(o => o.setName('title').setDescription('Embed title'))
      .addStringOption(o => o.setName('color').setDescription('Hex color, e.g. #d6c2ee'))
      .addStringOption(o => o.setName('image').setDescription('Image URL (large, shown at the bottom)'))
      .addStringOption(o => o.setName('thumbnail').setDescription('Thumbnail URL (small, shown top-right)'))
      .addStringOption(o => o.setName('footer').setDescription('Footer text'))
      .addStringOption(o => o.setName('author').setDescription('Author name shown above the title')))

    .addSubcommand(sub => sub
      .setName('edit')
      .setDescription('Edit an embed Veloura already posted — opens a form pre-filled with the current text')
      .addStringOption(o => o.setName('message_id').setDescription('ID of the message to edit').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Channel the message is in (default: current channel)'))
      .addStringOption(o => o.setName('color').setDescription('New hex color, e.g. #d6c2ee'))
      .addStringOption(o => o.setName('image').setDescription('New image URL'))
      .addStringOption(o => o.setName('thumbnail').setDescription('New thumbnail URL')))

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List custom embeds Veloura has posted, with their IDs')
      .addIntegerOption(o => o.setName('page').setDescription('Page number (15 per page, default: 1)')))

    .addSubcommand(sub => sub
      .setName('repost')
      .setDescription('Repost an embed if its message was deleted (does nothing if it still exists)')
      .addIntegerOption(o => o.setName('id').setDescription('Embed ID (see /embed list)').setRequired(true))),

  async execute(interaction) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
      interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);
    if (!isAdmin) return interaction.reply({ content: '❌ You need Manage Messages permission to use this.', ephemeral: true });

    const sub = interaction.options.getSubcommand();
    if (sub === 'edit')   return editEmbed(interaction);
    if (sub === 'list')   return listEmbeds(interaction);
    if (sub === 'repost') return repostEmbed(interaction);

    const channel     = interaction.options.getChannel('channel') || interaction.channel;
    const title       = interaction.options.getString('title');
    const description = interaction.options.getString('description').replace(/\\n/g, '\n');
    const color       = interaction.options.getString('color') || '#d6c2ee';
    const image       = interaction.options.getString('image');
    const thumbnail   = interaction.options.getString('thumbnail');
    const footer      = interaction.options.getString('footer');
    const author      = interaction.options.getString('author');

    await interaction.deferReply({ ephemeral: true });

    const hexColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#d6c2ee';
    const embed = new EmbedBuilder().setColor(hexColor).setDescription(description);
    if (title) embed.setTitle(title);
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (footer) embed.setFooter({ text: footer });
    if (author) embed.setAuthor({ name: author });

    const msg = await channel.send({ embeds: [embed] }).catch((err) => {
      console.error('[Embed] Failed to send:', err.message);
      return null;
    });

    if (!msg) return interaction.editReply('❌ Failed to post — check the image/thumbnail URLs are valid, and that Veloura can post in that channel.');

    await query(`
      INSERT INTO custom_embeds (guild_id, channel_id, message_id, title, description, color, image, thumbnail, footer, author, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [interaction.guildId, channel.id, msg.id, title, description, hexColor, image, thumbnail, footer, author, interaction.user.id]);

    return interaction.editReply(`✅ Embed posted in <#${channel.id}>.`);
  },
};

async function editEmbed(interaction) {
  const channel   = interaction.options.getChannel('channel') || interaction.channel;
  const messageId = interaction.options.getString('message_id').trim();
  const color     = interaction.options.getString('color');
  const image     = interaction.options.getString('image');
  const thumbnail = interaction.options.getString('thumbnail');

  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) return interaction.reply({ content: `\u274c Couldn't find a message with that ID in <#${channel.id}>.`, ephemeral: true });
  if (msg.author.id !== interaction.client.user.id) {
    return interaction.reply({ content: `\u274c That message wasn't posted by Veloura \u2014 can't edit it.`, ephemeral: true });
  }
  if (!msg.embeds.length) return interaction.reply({ content: `\u274c That message doesn't have an embed to edit.`, ephemeral: true });

  if (color) {
    const hexColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : null;
    if (!hexColor) return interaction.reply({ content: `\u274c Invalid color \u2014 use a hex code like #d6c2ee.`, ephemeral: true });
  }

  const oldEmbed = msg.embeds[0];

  // Apply the quick-swap fields immediately (these don't need in-place editing)
  if (color || image || thumbnail) {
    const quickEmbed = EmbedBuilder.from(oldEmbed);
    if (color) quickEmbed.setColor(color);
    if (image) quickEmbed.setImage(image);
    if (thumbnail) quickEmbed.setThumbnail(thumbnail);
    await msg.edit({ embeds: [quickEmbed] }).catch(() => {});

    await query(`
      UPDATE custom_embeds SET
        color = COALESCE($1, color), image = COALESCE($2, image), thumbnail = COALESCE($3, thumbnail)
      WHERE message_id = $4
    `, [color, image, thumbnail, messageId]);
  }

  // Show a modal pre-filled with the current text so it can be edited in place
  const modal = new ModalBuilder()
    .setCustomId(`embededit_modal:${channel.id}:${messageId}`)
    .setTitle('Edit Embed Text');

  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Title')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setValue((oldEmbed.title || '').slice(0, 4000));

  const descInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setValue((oldEmbed.description || '').slice(0, 4000));

  const footerInput = new TextInputBuilder()
    .setCustomId('footer')
    .setLabel('Footer')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setValue((oldEmbed.footer?.text || '').slice(0, 4000));

  const authorInput = new TextInputBuilder()
    .setCustomId('author')
    .setLabel('Author')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setValue((oldEmbed.author?.name || '').slice(0, 4000));

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(descInput),
    new ActionRowBuilder().addComponents(footerInput),
    new ActionRowBuilder().addComponents(authorInput),
  );

  await interaction.showModal(modal);
}

async function handleEditModal(interaction) {
  const [, channelId, messageId] = interaction.customId.split(':');
  await interaction.deferReply({ ephemeral: true });

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  const msg = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;
  if (!msg || !msg.embeds.length) return interaction.editReply(`\u274c Couldn't find that embed anymore \u2014 it may have been deleted.`);

  const title       = interaction.fields.getTextInputValue('title');
  const description = interaction.fields.getTextInputValue('description');
  const footer      = interaction.fields.getTextInputValue('footer');
  const author      = interaction.fields.getTextInputValue('author');

  const embed = EmbedBuilder.from(msg.embeds[0]);
  embed.setTitle(title || null);
  embed.setDescription(description || null);
  if (footer) embed.setFooter({ text: footer }); else embed.setFooter(null);
  if (author) embed.setAuthor({ name: author }); else embed.setAuthor(null);

  await msg.edit({ embeds: [embed] }).catch((err) => {
    console.error('[Embed] Failed to edit:', err.message);
  });

  await query(`
    UPDATE custom_embeds SET title=$1, description=$2, footer=$3, author=$4 WHERE message_id = $5
  `, [title || null, description || null, footer || null, author || null, messageId]);

  return interaction.editReply(`\u2705 Embed updated in <#${channel.id}>.`);
}

async function listEmbeds(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const page = Math.max(1, interaction.options.getInteger('page') || 1);
  const perPage = 15;
  const offset = (page - 1) * perPage;

  const countRes = await query('SELECT COUNT(*) FROM custom_embeds WHERE guild_id = $1', [interaction.guildId]);
  const total = parseInt(countRes.rows[0].count);
  if (!total) return interaction.editReply('No custom embeds tracked yet — only ones posted after this update will show up here.');

  const totalPages = Math.ceil(total / perPage);
  if (page > totalPages) return interaction.editReply(`❌ Page ${page} doesn't exist — there ${totalPages === 1 ? 'is' : 'are'} only ${totalPages} page(s).`);

  const res = await query('SELECT * FROM custom_embeds WHERE guild_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [interaction.guildId, perPage, offset]);
  const lines = res.rows.map(r => `\`#${r.id}\` ${r.title ? `**${r.title}**` : '*(no title)*'} — <#${r.channel_id}>`).join('\n');

  return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
    .setTitle('📋 Recent Custom Embeds')
    .setDescription(lines)
    .setFooter({ text: `Page ${page}/${totalPages} • ${total} total • /embed list page:${page + 1} for more` })]});
}

async function repostEmbed(interaction) {
  const id = interaction.options.getInteger('id');
  await interaction.deferReply({ ephemeral: true });

  const res = await query('SELECT * FROM custom_embeds WHERE id = $1 AND guild_id = $2', [id, interaction.guildId]);
  if (!res.rows.length) return interaction.editReply(`❌ No embed #${id} found.`);
  const stored = res.rows[0];

  const channel = await interaction.client.channels.fetch(stored.channel_id).catch(() => null);
  if (!channel) return interaction.editReply(`❌ Couldn't find that embed's channel — it may have been deleted.`);

  if (stored.message_id) {
    const existing = await channel.messages.fetch(stored.message_id).catch(() => null);
    if (existing) return interaction.editReply(`✅ That embed's message still exists — no repost needed. ${existing.url}`);
  }

  const embed = new EmbedBuilder().setColor(stored.color || '#d6c2ee').setDescription(stored.description || '');
  if (stored.title) embed.setTitle(stored.title);
  if (stored.image) embed.setImage(stored.image);
  if (stored.thumbnail) embed.setThumbnail(stored.thumbnail);
  if (stored.footer) embed.setFooter({ text: stored.footer });
  if (stored.author) embed.setAuthor({ name: stored.author });

  const msg = await channel.send({ embeds: [embed] }).catch(() => null);
  if (!msg) return interaction.editReply(`❌ Failed to repost — Veloura may lack permission in <#${channel.id}>.`);

  await query('UPDATE custom_embeds SET message_id = $1 WHERE id = $2', [msg.id, id]);
  return interaction.editReply(`✅ Reposted embed #${id} in <#${channel.id}>. ${msg.url}`);
}

module.exports.handleEditModal = handleEditModal;
