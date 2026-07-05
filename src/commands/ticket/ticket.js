const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, ChannelType,
} = require('discord.js');
const { query } = require('../../utils/database');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getConfig(guildId) {
  const res = await query('SELECT * FROM ticket_config WHERE guild_id = $1', [guildId]);
  return res.rows[0] || null;
}

async function isStaff(member, config) {
  if (!config?.staff_role_id) return member.permissions.has(PermissionFlagsBits.Administrator);
  return member.roles.cache.has(config.staff_role_id) || member.permissions.has(PermissionFlagsBits.Administrator);
}

function buildPanelComponents(types) {
  const rows = [];
  const chunks = [];
  for (let i = 0; i < types.length; i += 5) chunks.push(types.slice(i, i + 5));
  for (const chunk of chunks) {
    const row = new ActionRowBuilder();
    for (const t of chunk) {
      const btn = new ButtonBuilder()
        .setCustomId(`ticket_open:${t.id}`)
        .setLabel(t.name)
        .setStyle(ButtonStyle.Secondary);
      if (t.emoji) btn.setEmoji(t.emoji);
      row.addComponents(btn);
    }
    rows.push(row);
  }
  return rows;
}

async function generateTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = [...messages.values()].reverse();
  const lines = sorted.map(m => {
    const time = m.createdAt.toISOString().replace('T', ' ').slice(0, 19);
    const content = m.content || (m.embeds.length ? '[embed]' : '[attachment]');
    return `[${time}] ${m.author.tag}: ${content}`;
  });
  return lines.join('\n');
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system management')

    // setup
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Configure the ticket system')
      .addRoleOption(o => o.setName('staff_role').setDescription('Staff role that can manage tickets').setRequired(true))
      .addChannelOption(o => o.setName('category').setDescription('Category to create ticket channels in'))
      .addChannelOption(o => o.setName('transcript').setDescription('Channel to send transcripts to'))
      .addIntegerOption(o => o.setName('max_open').setDescription('Max open tickets per member (default: 1)').setMinValue(1)))

    // panel
    .addSubcommand(sub => sub
      .setName('panel')
      .setDescription('Post a ticket panel in the current channel')
      .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Panel description'))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex (default: #d6c2ee)'))
      .addStringOption(o => o.setName('open_message').setDescription('Default message shown when a ticket opens'))
      .addBooleanOption(o => o.setName('single_button').setDescription('Post a single Open Ticket button instead of type buttons')))

    // addtype
    .addSubcommand(sub => sub
      .setName('addtype')
      .setDescription('Add a ticket type button to a panel')
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID (shown after /ticket panel)').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('Button label').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Button emoji'))
      .addStringOption(o => o.setName('description').setDescription('Shown in the modal'))
      .addStringOption(o => o.setName('questions').setDescription('Form questions separated by | (max 5)'))
      .addStringOption(o => o.setName('open_message').setDescription('Custom message when this ticket type opens')))

    // removetype
    .addSubcommand(sub => sub
      .setName('removetype')
      .setDescription('Remove a ticket type')
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('Ticket type name to remove').setRequired(true)))

    // close
    .addSubcommand(sub => sub
      .setName('close')
      .setDescription('Close a ticket (staff only)'))

    // add user
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a user to the current ticket')
      .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true)))

    // remove user
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a user from the current ticket')
      .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true)))

    // list panels
    .addSubcommand(sub => sub
      .setName('panels')
      .setDescription('List all ticket panels and their IDs')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── /ticket setup ─────────────────────────────────────────────────────
    if (sub === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID)
        return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const staffRole   = interaction.options.getRole('staff_role');
      const category    = interaction.options.getChannel('category');
      const transcript  = interaction.options.getChannel('transcript');
      const maxOpen     = interaction.options.getInteger('max_open') || 1;

      await query(`
        INSERT INTO ticket_config (guild_id, staff_role_id, category_id, transcript_channel_id, max_open)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (guild_id) DO UPDATE SET
          staff_role_id         = EXCLUDED.staff_role_id,
          category_id           = EXCLUDED.category_id,
          transcript_channel_id = EXCLUDED.transcript_channel_id,
          max_open              = EXCLUDED.max_open
      `, [interaction.guild.id, staffRole.id, category?.id||null, transcript?.id||null, maxOpen]);

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('✅ Ticket System Configured!')
        .addFields(
          { name: 'Staff Role',       value: `<@&${staffRole.id}>`,                          inline: true },
          { name: 'Category',         value: category ? `<#${category.id}>` : '—',           inline: true },
          { name: 'Transcripts',      value: transcript ? `<#${transcript.id}>` : '—',       inline: true },
          { name: 'Max Open',         value: `${maxOpen} per member`,                         inline: true },
        )]});
    }

    // ── /ticket panel ─────────────────────────────────────────────────────
    if (sub === 'panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID)
        return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const title        = interaction.options.getString('title');
      const description  = interaction.options.getString('description') || 'Select <a:click:1512912824500748448> the type of ticket you\'d like to open below. <:down:1523102907937984512>';
      const color        = interaction.options.getString('color') || '#d6c2ee';
      const openMessage  = interaction.options.getString('open_message') || null;
      const singleButton = interaction.options.getBoolean('single_button') || false;

      // Create panel record
      const res = await query(
        'INSERT INTO ticket_panels (guild_id, channel_id, title, description, color, open_message, single_button) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [interaction.guild.id, interaction.channel.id, title, description, color, openMessage, singleButton]
      );
      const panelId = res.rows[0].id;

      const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);

      let components = [];
      if (singleButton) {
        components = [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket_open_single:${panelId}`)
            .setLabel('Open Ticket')
            .setEmoji('🎫')
            .setStyle(ButtonStyle.Secondary)
        )];
      }

      const msg = await interaction.channel.send({ embeds: [embed], components });
      await query('UPDATE ticket_panels SET message_id = $1 WHERE id = $2', [msg.id, panelId]);

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`✅ Panel posted! **Panel ID: \`${panelId}\`**\n\nUse \`/ticket addtype panel_id:${panelId}\` to add ticket type buttons.`)]});
    }

    // ── /ticket addtype ───────────────────────────────────────────────────
    if (sub === 'addtype') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID)
        return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const panelId     = interaction.options.getString('panel_id');
      const name        = interaction.options.getString('name');
      const emoji       = interaction.options.getString('emoji') || null;
      const description = interaction.options.getString('description') || null;
      const questions   = interaction.options.getString('questions') || null;
      const openMessage = interaction.options.getString('open_message') || null;

      const panelRes = await query('SELECT * FROM ticket_panels WHERE id = $1 AND guild_id = $2', [panelId, interaction.guild.id]);
      if (!panelRes.rows.length) return interaction.editReply('❌ Panel not found.');
      const panel = panelRes.rows[0];

      await query(
        'INSERT INTO ticket_types (panel_id, guild_id, name, emoji, description, questions, open_message) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [panelId, interaction.guild.id, name, emoji, description, questions, openMessage]
      );

      // Rebuild panel buttons
      const typesRes = await query('SELECT * FROM ticket_types WHERE panel_id = $1 ORDER BY id', [panelId]);
      const components = buildPanelComponents(typesRes.rows);

      const ch = interaction.client.channels.cache.get(panel.channel_id);
      if (ch && panel.message_id) {
        const msg = await ch.messages.fetch(panel.message_id).catch(() => null);
        if (msg) await msg.edit({ components }).catch(() => {});
      }

      return interaction.editReply(`✅ Ticket type **${name}** added to panel \`${panelId}\`.`);
    }

    // ── /ticket removetype ────────────────────────────────────────────────
    if (sub === 'removetype') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID)
        return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const panelId = interaction.options.getString('panel_id');
      const name    = interaction.options.getString('name');

      await query('DELETE FROM ticket_types WHERE panel_id = $1 AND guild_id = $2 AND name = $3', [panelId, interaction.guild.id, name]);

      const panelRes = await query('SELECT * FROM ticket_panels WHERE id = $1', [panelId]);
      if (panelRes.rows.length) {
        const panel = panelRes.rows[0];
        const typesRes = await query('SELECT * FROM ticket_types WHERE panel_id = $1 ORDER BY id', [panelId]);
        const components = buildPanelComponents(typesRes.rows);
        const ch = interaction.client.channels.cache.get(panel.channel_id);
        if (ch && panel.message_id) {
          const msg = await ch.messages.fetch(panel.message_id).catch(() => null);
          if (msg) await msg.edit({ components }).catch(() => {});
        }
      }

      return interaction.editReply(`✅ Ticket type **${name}** removed.`);
    }

    // ── /ticket panels ────────────────────────────────────────────────────
    if (sub === 'panels') {
      await interaction.deferReply({ ephemeral: true });
      const res = await query('SELECT * FROM ticket_panels WHERE guild_id = $1 ORDER BY id', [interaction.guild.id]);
      if (!res.rows.length) return interaction.editReply('No ticket panels found. Run `/ticket panel` to create one.');
      const lines = res.rows.map(p => `**ID \`${p.id}\`** — ${p.title} in <#${p.channel_id}>`).join('\n');
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('🎫 Ticket Panels')
        .setDescription(lines)]});
    }

    // ── /ticket close ─────────────────────────────────────────────────────
    if (sub === 'close') {
      await interaction.deferReply({ ephemeral: true });
      const config = await getConfig(interaction.guild.id);
      if (!await isStaff(interaction.member, config))
        return interaction.editReply('❌ Staff only.');

      const ticketRes = await query('SELECT * FROM tickets WHERE channel_id = $1', [interaction.channel.id]);
      if (!ticketRes.rows.length) return interaction.editReply('❌ This is not a ticket channel.');
      const ticket = ticketRes.rows[0];

      // Generate transcript
      const transcript = await generateTranscript(interaction.channel);
      const transcriptEmbed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle(`🎫 Ticket Transcript — #${interaction.channel.name}`)
        .setDescription(`**Opened by:** <@${ticket.user_id}>\n**Closed by:** <@${interaction.user.id}>\n**Type:** ${ticket.type_name || 'General'}`)
        .setTimestamp();

      // Send transcript to transcript channel
      if (config?.transcript_channel_id) {
        const tCh = interaction.client.channels.cache.get(config.transcript_channel_id);
        if (tCh) {
          const { AttachmentBuilder } = require('discord.js');
          const buffer = Buffer.from(transcript, 'utf-8');
          const attachment = new AttachmentBuilder(buffer, { name: `transcript-${interaction.channel.name}.txt` });
          await tCh.send({ embeds: [transcriptEmbed], files: [attachment] }).catch(() => {});
        }
      }

      // DM the ticket opener
      const opener = await interaction.guild.members.fetch(ticket.user_id).catch(() => null);
      if (opener) {
        const { AttachmentBuilder } = require('discord.js');
        const buffer = Buffer.from(transcript, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: `transcript-${interaction.channel.name}.txt` });

        // Send transcript DM
        await opener.send({
          embeds: [new EmbedBuilder().setColor('#d6c2ee')
            .setTitle('🎫 Your Ticket Has Been Closed')
            .setDescription(`Your ticket in **${interaction.guild.name}** has been closed.\nPlease find your transcript attached.`)
            .setTimestamp()],
          files: [attachment]
        }).catch(() => {});

        // Send rating prompt
        const ratingRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ticket_rate:${ticket.id}:1`).setLabel('⭐').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`ticket_rate:${ticket.id}:2`).setLabel('⭐⭐').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`ticket_rate:${ticket.id}:3`).setLabel('⭐⭐⭐').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`ticket_rate:${ticket.id}:4`).setLabel('⭐⭐⭐⭐').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`ticket_rate:${ticket.id}:5`).setLabel('⭐⭐⭐⭐⭐').setStyle(ButtonStyle.Secondary),
        );
        await opener.send({
          embeds: [new EmbedBuilder().setColor('#d6c2ee')
            .setTitle('How was your experience?')
            .setDescription('Please rate your support experience by clicking a star rating below.')],
          components: [ratingRow]
        }).catch(() => {});
      }

      // Update ticket status and delete channel
      await query('UPDATE tickets SET status = $1, closed_at = NOW(), closed_by = $2 WHERE id = $3',
        ['closed', interaction.user.id, ticket.id]);

      await interaction.editReply('✅ Ticket closed. Transcript sent.');
      setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
    }

    // ── /ticket add ───────────────────────────────────────────────────────
    if (sub === 'add') {
      const config = await getConfig(interaction.guild.id);
      if (!await isStaff(interaction.member, config))
        return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const user = interaction.options.getUser('user');
      await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true });
      return interaction.reply({ content: `✅ <@${user.id}> added to ticket.`, ephemeral: true });
    }

    // ── /ticket remove ────────────────────────────────────────────────────
    if (sub === 'remove') {
      const config = await getConfig(interaction.guild.id);
      if (!await isStaff(interaction.member, config))
        return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const user = interaction.options.getUser('user');
      await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: false });
      return interaction.reply({ content: `✅ <@${user.id}> removed from ticket.`, ephemeral: true });
    }
  },

  // ── Button & Modal handler ────────────────────────────────────────────────
  async handleButton(interaction, client) {
    const [action, ...parts] = interaction.customId.split(':');

    // ── Open ticket (type button) ──────────────────────────────────────────
    if (action === 'ticket_open') {
      const typeId = parts[0];
      const typeRes = await query('SELECT * FROM ticket_types WHERE id = $1', [typeId]);
      if (!typeRes.rows.length) return interaction.reply({ content: '❌ Ticket type not found.', ephemeral: true });
      const type = typeRes.rows[0];

      const panelRes = await query('SELECT * FROM ticket_panels WHERE id = $1', [type.panel_id]);
      const panel = panelRes.rows[0];

      // Show modal with questions
      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal:${typeId}`)
        .setTitle(`${type.name} Ticket`);

      const questions = type.questions ? type.questions.split('|').slice(0, 5) : ['Please describe your issue'];
      for (let i = 0; i < questions.length; i++) {
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(`q${i}`)
            .setLabel(questions[i].trim().slice(0, 45))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(i === 0)
        ));
      }
      return interaction.showModal(modal);
    }

    // ── Open ticket (single button) ────────────────────────────────────────
    if (action === 'ticket_open_single') {
      const panelId = parts[0];
      const panelRes = await query('SELECT * FROM ticket_panels WHERE id = $1', [panelId]);
      if (!panelRes.rows.length) return interaction.reply({ content: '❌ Panel not found.', ephemeral: true });

      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal_single:${panelId}`)
        .setTitle('Open a Ticket');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('q0').setLabel('Please describe your issue').setStyle(TextInputStyle.Paragraph).setRequired(true)
      ));
      return interaction.showModal(modal);
    }

    // ── Rating ─────────────────────────────────────────────────────────────
    if (action === 'ticket_rate') {
      const [ticketId, rating] = parts;
      await query('UPDATE tickets SET rating = $1 WHERE id = $2', [parseInt(rating), ticketId]);

      // Log rating to transcript channel
      const ticketRes = await query('SELECT t.*, tc.transcript_channel_id FROM tickets t JOIN ticket_config tc ON tc.guild_id = t.guild_id WHERE t.id = $1', [ticketId]);
      if (ticketRes.rows.length && ticketRes.rows[0].transcript_channel_id) {
        const tCh = client.channels.cache.get(ticketRes.rows[0].transcript_channel_id);
        if (tCh) await tCh.send({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
          .setDescription(`⭐ <@${interaction.user.id}> rated their ticket **${'⭐'.repeat(parseInt(rating))}** (${rating}/5)`)
        ]}).catch(() => {});
      }

      return interaction.update({ content: `Thank you for your rating: ${'⭐'.repeat(parseInt(rating))}`, components: [], embeds: [] });
    }
  },

  // ── Modal submit handler ──────────────────────────────────────────────────
  async handleModal(interaction, client) {
    if (!interaction.customId.startsWith('ticket_modal')) return;
    await interaction.deferReply({ ephemeral: true });

    const [action, id] = interaction.customId.split(':');
    const isSingle = action === 'ticket_modal_single';

    const config = await getConfig(interaction.guild.id);
    if (!config) return interaction.editReply('❌ Ticket system not configured. Ask an admin to run `/ticket setup`.');

    // Check open ticket limit
    const openRes = await query(
      'SELECT COUNT(*) as c FROM tickets WHERE guild_id = $1 AND user_id = $2 AND status = $3',
      [interaction.guild.id, interaction.user.id, 'open']
    );
    if (Number(openRes.rows[0].c) >= config.max_open)
      return interaction.editReply(`❌ You already have ${config.max_open} open ticket(s). Please wait for it to be resolved.`);

    // Get type or panel info
    let type = null, panel = null;
    if (isSingle) {
      const pRes = await query('SELECT * FROM ticket_panels WHERE id = $1', [id]);
      panel = pRes.rows[0];
    } else {
      const tRes = await query('SELECT * FROM ticket_types WHERE id = $1', [id]);
      type = tRes.rows[0];
      const pRes = await query('SELECT * FROM ticket_panels WHERE id = $1', [type.panel_id]);
      panel = pRes.rows[0];
    }

    const typeName = type?.name || 'General';
    const channelName = `ticket-${interaction.user.username}-${typeName}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 100);

    // Create ticket channel
    const ticketChannel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: config.category_id || null,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone, deny: ['ViewChannel'] },
        { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
        { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels', 'ReadMessageHistory'] },
        ...(config.staff_role_id ? [{ id: config.staff_role_id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }] : []),
      ],
    });

    // Save ticket to DB
    const ticketRes = await query(
      'INSERT INTO tickets (guild_id, channel_id, user_id, type_name, panel_id, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [interaction.guild.id, ticketChannel.id, interaction.user.id, typeName, panel?.id || null, 'open']
    );
    const ticketId = ticketRes.rows[0].id;

    // Build answers embed
    const answers = [];
    const fields = interaction.fields.fields;
    fields.forEach((field, key) => { if (field.value) answers.push(`**${field.customId === 'q0' && !type?.questions ? 'Issue' : (type?.questions?.split('|')[parseInt(key.slice(1))]?.trim() || key)}:** ${field.value}`); });

    const openMsg = type?.open_message || panel?.open_message || `Thank you for opening a ticket, <@${interaction.user.id}>! Our staff will be with you shortly. <a:purplesparkle:1512912828489793626>`;

    await ticketChannel.send({ embeds: [
      new EmbedBuilder().setColor(panel?.color || '#d6c2ee')
        .setTitle(`🎫 ${typeName} Ticket`)
        .setDescription(openMsg)
        .addFields(
          { name: '📋 Your Information', value: answers.join('\n') || '—' },
        )
        .setFooter({ text: `Ticket #${ticketId} • Staff: /ticket close` })
        .setTimestamp()
    ]});

    // Ping staff
    if (config.staff_role_id) {
      await ticketChannel.send(`<@&${config.staff_role_id}> — New ticket opened by <@${interaction.user.id}>`);
    }

    return interaction.editReply(`✅ Your ticket has been created: <#${ticketChannel.id}>`);
  },
};
