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

function buildActionRow(ticketId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_claim:${ticketId}`).setLabel('Claim Ticket').setEmoji('<:staff:1523146914701512764>').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket_close_btn:${ticketId}`).setLabel('Close Ticket').setEmoji('<a:lock:1520456965245898903>').setStyle(ButtonStyle.Danger),
  );
}

async function generateTranscript(thread) {
  const messages = await thread.messages.fetch({ limit: 100 });
  const sorted = [...messages.values()].reverse();
  const lines = sorted.map(m => {
    const time = m.createdAt.toISOString().replace('T', ' ').slice(0, 19);
    const content = m.content || (m.embeds.length ? '[embed]' : '[attachment]');
    return `[${time}] ${m.author.tag}: ${content}`;
  });
  return lines.join('\n');
}

// Track sticky action row message IDs: ticketId -> messageId
const stickyMessages = new Map();

async function repostActionRow(thread, ticketId) {
  // Delete old sticky
  const oldMsgId = stickyMessages.get(ticketId);
  if (oldMsgId) {
    const oldMsg = await thread.messages.fetch(oldMsgId).catch(() => null);
    if (oldMsg) await oldMsg.delete().catch(() => {});
  }
  // Repost
  const msg = await thread.send({ components: [buildActionRow(ticketId)] }).catch(() => null);
  if (msg) stickyMessages.set(ticketId, msg.id);
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system management')

    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Configure the ticket system')
      .addRoleOption(o => o.setName('staff_role').setDescription('Staff role that can manage tickets').setRequired(true))
      .addChannelOption(o => o.setName('category').setDescription('Category to create ticket threads in'))
      .addChannelOption(o => o.setName('transcript').setDescription('Channel to send transcripts to'))
      .addChannelOption(o => o.setName('staff_channel').setDescription('Channel to post staff ticket notifications in'))
      .addIntegerOption(o => o.setName('max_open').setDescription('Max open tickets per member (default: 1)').setMinValue(1)))

    .addSubcommand(sub => sub
      .setName('panel')
      .setDescription('Post a ticket panel in the current channel')
      .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Panel description'))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex (default: #d6c2ee)'))
      .addStringOption(o => o.setName('open_message').setDescription('Default message shown when a ticket opens'))
      .addBooleanOption(o => o.setName('single_button').setDescription('Post a single Open Ticket button')))

    .addSubcommand(sub => sub
      .setName('addtype')
      .setDescription('Add a ticket type button to a panel')
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('Button label').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Button emoji'))
      .addStringOption(o => o.setName('description').setDescription('Shown in the modal'))
      .addStringOption(o => o.setName('questions').setDescription('Form questions separated by | (max 5)'))
      .addStringOption(o => o.setName('open_message').setDescription('Custom message when this ticket type opens')))

    .addSubcommand(sub => sub
      .setName('removetype')
      .setDescription('Remove a ticket type')
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('Ticket type name to remove').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('edit')
      .setDescription('Edit an existing ticket panel')
      .addStringOption(o => o.setName('panel_id').setDescription('Panel ID to edit').setRequired(true))
      .addStringOption(o => o.setName('title').setDescription('New title'))
      .addStringOption(o => o.setName('description').setDescription('New description'))
      .addStringOption(o => o.setName('color').setDescription('New embed color hex'))
      .addStringOption(o => o.setName('open_message').setDescription('New default open message')))

    .addSubcommand(sub => sub
      .setName('panels')
      .setDescription('List all ticket panels and their IDs'))

    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a user to the current ticket thread')
      .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a user from the current ticket thread')
      .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── /ticket setup ─────────────────────────────────────────────────────
    if (sub === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID)
        return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const staffRole    = interaction.options.getRole('staff_role');
      const category     = interaction.options.getChannel('category');
      const transcript   = interaction.options.getChannel('transcript');
      const staffChannel = interaction.options.getChannel('staff_channel');
      const maxOpen      = interaction.options.getInteger('max_open') || 1;

      await query(`
        INSERT INTO ticket_config (guild_id, staff_role_id, category_id, transcript_channel_id, staff_channel_id, max_open)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (guild_id) DO UPDATE SET
          staff_role_id         = EXCLUDED.staff_role_id,
          category_id           = EXCLUDED.category_id,
          transcript_channel_id = EXCLUDED.transcript_channel_id,
          staff_channel_id      = EXCLUDED.staff_channel_id,
          max_open              = EXCLUDED.max_open
      `, [interaction.guild.id, staffRole.id, category?.id||null, transcript?.id||null, staffChannel?.id||null, maxOpen]);

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('<:checkmark:1512916161493205165> Ticket System Configured!')
        .addFields(
          { name: 'Staff Role',        value: `<@&${staffRole.id}>`,                           inline: true },
          { name: 'Category',          value: category ? `<#${category.id}>` : '—',            inline: true },
          { name: 'Transcripts',       value: transcript ? `<#${transcript.id}>` : '—',        inline: true },
          { name: 'Staff Channel',     value: staffChannel ? `<#${staffChannel.id}>` : '—',    inline: true },
          { name: 'Max Open',          value: `${maxOpen} per member`,                          inline: true },
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
            .setEmoji('<a:tickets:1523139713278672996>')
            .setStyle(ButtonStyle.Secondary)
        )];
      }

      const msg = await interaction.channel.send({ embeds: [embed], components });
      await query('UPDATE ticket_panels SET message_id = $1 WHERE id = $2', [msg.id, panelId]);

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`✅ Panel posted! **Panel ID: \`${panelId}\`**\nUse \`/ticket addtype panel_id:${panelId}\` to add ticket type buttons.`)]});
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

      await query('INSERT INTO ticket_types (panel_id, guild_id, name, emoji, description, questions, open_message) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [panelId, interaction.guild.id, name, emoji, description, questions, openMessage]);

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

    // ── /ticket edit ──────────────────────────────────────────────────────
    if (sub === 'edit') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID)
        return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const panelId     = interaction.options.getString('panel_id');
      const title       = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const color       = interaction.options.getString('color');
      const openMsg     = interaction.options.getString('open_message');

      const panelRes = await query('SELECT * FROM ticket_panels WHERE id = $1 AND guild_id = $2', [panelId, interaction.guild.id]);
      if (!panelRes.rows.length) return interaction.editReply('❌ Panel not found.');
      const panel = panelRes.rows[0];

      const newTitle   = title       ?? panel.title;
      const newDesc    = description ?? panel.description;
      const newColor   = color       ?? panel.color;
      const newOpenMsg = openMsg     ?? panel.open_message;

      await query('UPDATE ticket_panels SET title=$1, description=$2, color=$3, open_message=$4 WHERE id=$5',
        [newTitle, newDesc, newColor, newOpenMsg, panelId]);

      const ch = interaction.client.channels.cache.get(panel.channel_id);
      if (ch && panel.message_id) {
        const msg = await ch.messages.fetch(panel.message_id).catch(() => null);
        if (msg) await msg.edit({ embeds: [new EmbedBuilder().setColor(newColor).setTitle(newTitle).setDescription(newDesc)] }).catch(() => {});
      }
      return interaction.editReply(`✅ Panel \`${panelId}\` updated!`);
    }

    // ── /ticket panels ────────────────────────────────────────────────────
    if (sub === 'panels') {
      await interaction.deferReply({ ephemeral: true });
      const res = await query('SELECT * FROM ticket_panels WHERE guild_id = $1 ORDER BY id', [interaction.guild.id]);
      if (!res.rows.length) return interaction.editReply('No ticket panels found.');
      const lines = res.rows.map(p => `**ID \`${p.id}\`** — ${p.title} in <#${p.channel_id}>`).join('\n');
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('<a:tickets:1523139713278672996> Ticket Panels')
        .setDescription(lines)]});
    }

    // ── /ticket add ───────────────────────────────────────────────────────
    if (sub === 'add') {
      const config = await getConfig(interaction.guild.id);
      if (!await isStaff(interaction.member, config))
        return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const user = interaction.options.getUser('user');
      const thread = interaction.channel;
      if (!thread.isThread()) return interaction.reply({ content: '❌ Not a ticket thread.', ephemeral: true });
      await thread.members.add(user.id);
      return interaction.reply({ content: `✅ <@${user.id}> added to ticket.`, ephemeral: true });
    }

    // ── /ticket remove ────────────────────────────────────────────────────
    if (sub === 'remove') {
      const config = await getConfig(interaction.guild.id);
      if (!await isStaff(interaction.member, config))
        return interaction.reply({ content: '❌ Staff only.', ephemeral: true });
      const user = interaction.options.getUser('user');
      const thread = interaction.channel;
      if (!thread.isThread()) return interaction.reply({ content: '❌ Not a ticket thread.', ephemeral: true });
      await thread.members.remove(user.id);
      return interaction.reply({ content: `✅ <@${user.id}> removed from ticket.`, ephemeral: true });
    }
  },

  // ── Button handler ────────────────────────────────────────────────────────
  async handleButton(interaction, client) {
    const [action, ...parts] = interaction.customId.split(':');

    // ── Open ticket (type) ─────────────────────────────────────────────────
    if (action === 'ticket_open' || action === 'ticket_open_single') {
      const id = parts[0];
      let type = null, panel = null;

      if (action === 'ticket_open') {
        const tRes = await query('SELECT * FROM ticket_types WHERE id = $1', [id]);
        if (!tRes.rows.length) return interaction.reply({ content: '❌ Ticket type not found.', ephemeral: true });
        type = tRes.rows[0];
        const pRes = await query('SELECT * FROM ticket_panels WHERE id = $1', [type.panel_id]);
        panel = pRes.rows[0];
      } else {
        const pRes = await query('SELECT * FROM ticket_panels WHERE id = $1', [id]);
        if (!pRes.rows.length) return interaction.reply({ content: '❌ Panel not found.', ephemeral: true });
        panel = pRes.rows[0];
      }

      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal:${action === 'ticket_open' ? type.id : id}:${action === 'ticket_open' ? 'type' : 'single'}`)
        .setTitle(`${type?.name || 'Open a Ticket'}`.slice(0, 45));

      const questions = type?.questions ? type.questions.split('|').slice(0, 5) : ['Please describe your issue'];
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

    // ── Join ticket (staff channel button) ─────────────────────────────────
    if (action === 'ticket_join') {
      const ticketId = parts[0];
      const ticketRes = await query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
      if (!ticketRes.rows.length) return interaction.reply({ content: '❌ Ticket not found.', ephemeral: true });

      const config = await getConfig(interaction.guild.id);
      if (!await isStaff(interaction.member, config))
        return interaction.reply({ content: '❌ Staff only.', ephemeral: true });

      const thread = interaction.guild.channels.cache.get(ticketRes.rows[0].channel_id);
      if (!thread) return interaction.reply({ content: '❌ Ticket thread not found.', ephemeral: true });

      await thread.members.add(interaction.user.id);
      return interaction.reply({ content: `✅ You've joined ticket <#${thread.id}>!`, ephemeral: true });
    }

    // ── Claim ticket ───────────────────────────────────────────────────────
    if (action === 'ticket_claim') {
      const ticketId = parts[0];
      const config = await getConfig(interaction.guild.id);
      if (!await isStaff(interaction.member, config))
        return interaction.reply({ content: '❌ Staff only.', ephemeral: true });

      const res = await query('UPDATE tickets SET claimed_by = $1 WHERE id = $2 AND claimed_by IS NULL RETURNING id', [interaction.user.id, ticketId]);
      if (!res.rows.length) {
        const existing = await query('SELECT claimed_by FROM tickets WHERE id = $1', [ticketId]);
        return interaction.reply({ content: `❌ Already claimed by <@${existing.rows[0]?.claimed_by}>.`, ephemeral: true });
      }

      await interaction.reply({ content: `<:checkmark:1512916161493205165> <@${interaction.user.id}> has claimed this ticket!` });

      // Update the button message to show claimed
      const newRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_claim:${ticketId}`).setLabel('Claimed').setEmoji('<:checkmark:1512916161493205165>').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`ticket_close_btn:${ticketId}`).setLabel('Close Ticket').setEmoji('<a:lock:1520456965245898903>').setStyle(ButtonStyle.Danger),
      );
      await interaction.message.edit({ components: [newRow] }).catch(() => {});

      // Update sticky
      const thread = interaction.channel;
      if (thread.isThread()) {
        stickyMessages.set(ticketId, interaction.message.id);
      }
      return;
    }

    // ── Close ticket button ────────────────────────────────────────────────
    if (action === 'ticket_close_btn') {
      const config = await getConfig(interaction.guild.id);
      if (!await isStaff(interaction.member, config))
        return interaction.reply({ content: '❌ Staff only.', ephemeral: true });

      const modal = new ModalBuilder()
        .setCustomId(`ticket_close_modal:${parts[0]}`)
        .setTitle('Close Ticket');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for closing')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder('e.g. Issue resolved, Oos given, No response...')
      ));
      return interaction.showModal(modal);
    }

    // ── Rating ─────────────────────────────────────────────────────────────
    if (action === 'ticket_rate') {
      const [ticketId, rating] = parts;
      await query('UPDATE tickets SET rating = $1 WHERE id = $2', [parseInt(rating), ticketId]);

      const ticketRes = await query('SELECT t.*, tc.transcript_channel_id FROM tickets t JOIN ticket_config tc ON tc.guild_id = t.guild_id WHERE t.id = $1', [ticketId]);
      if (ticketRes.rows.length && ticketRes.rows[0].transcript_channel_id) {
        const tCh = client.channels.cache.get(ticketRes.rows[0].transcript_channel_id);
        if (tCh) await tCh.send({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
          .setDescription(`<a:review:1523148059427471461> <@${interaction.user.id}> rated their ticket ${'<:star:1523150031698264104>'.repeat(parseInt(rating))} (${rating}/5)`)
        ]}).catch(() => {});
      }
      return interaction.update({ content: `Thank you for your rating: ${'<:star:1523150031698264104>'.repeat(parseInt(rating))}`, components: [], embeds: [] });
    }
  },

  // ── Modal handler ─────────────────────────────────────────────────────────
  async handleModal(interaction, client) {

    // ── Close modal ────────────────────────────────────────────────────────
    if (interaction.customId.startsWith('ticket_close_modal')) {
      await interaction.deferReply({ ephemeral: true });
      const ticketId = interaction.customId.split(':')[1];
      const reason   = interaction.fields.getTextInputValue('reason') || 'No reason provided';
      const config   = await getConfig(interaction.guild.id);

      const ticketRes = await query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
      if (!ticketRes.rows.length) return interaction.editReply('❌ Ticket not found.');
      const ticket = ticketRes.rows[0];

      const transcript = await generateTranscript(interaction.channel);
      const openTime   = new Date(ticket.created_at);

      const transcriptEmbed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle('Ticket Closed')
        .addFields(
          { name: '<a:tickets:1523139713278672996> Ticket ID',         value: `${ticket.id}`,                                    inline: true },
          { name: '<:member:1512912827424309278> Opened By',           value: `<@${ticket.user_id}>`,                            inline: true },
          { name: '<a:lock:1520456965245898903> Closed By',            value: `<@${interaction.user.id}>`,                       inline: true },
          { name: '<a:RojasClock:1512912822613446787> Open Time',      value: `<t:${Math.floor(openTime.getTime()/1000)}:F>`,    inline: true },
          { name: '<:staff:1523146914701512764> Claimed By',           value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'Not claimed', inline: true },
          { name: '<a:QuestionMark:1523147105772896426> Reason',       value: reason, inline: false },
          { name: '<a:review:1523148059427471461> Rating',             value: ticket.rating ? Array(ticket.rating).fill('<:star:1523150031698264104>').join('') + ` (${ticket.rating}/5)` : 'Not yet rated', inline: false },
        )
        .setTimestamp();

      const { AttachmentBuilder } = require('discord.js');
      const buffer = Buffer.from(transcript, 'utf-8');
      const attachment = new AttachmentBuilder(buffer, { name: `transcript-${interaction.channel.name}.txt` });

      if (config?.transcript_channel_id) {
        const tCh = client.channels.cache.get(config.transcript_channel_id);
        if (tCh) await tCh.send({ embeds: [transcriptEmbed], files: [attachment] }).catch(() => {});
      }

      const opener = await interaction.guild.members.fetch(ticket.user_id).catch(() => null);
      if (opener) {
        const buf2 = Buffer.from(transcript, 'utf-8');
        const att2 = new AttachmentBuilder(buf2, { name: `transcript-${interaction.channel.name}.txt` });
        await opener.send({
          embeds: [new EmbedBuilder().setColor('#d6c2ee')
            .setTitle('<a:tickets:1523139713278672996> Your Ticket Has Been Closed')
            .setDescription(`Your ticket in **${interaction.guild.name}** has been closed. Transcript attached.`)
            .setTimestamp()],
          files: [att2]
        }).catch(() => {});

        const ratingRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ticket_rate:${ticket.id}:1`).setEmoji('<:star:1523150031698264104>').setLabel('1').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`ticket_rate:${ticket.id}:2`).setEmoji('<:star:1523150031698264104>').setLabel('2').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`ticket_rate:${ticket.id}:3`).setEmoji('<:star:1523150031698264104>').setLabel('3').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`ticket_rate:${ticket.id}:4`).setEmoji('<:star:1523150031698264104>').setLabel('4').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`ticket_rate:${ticket.id}:5`).setEmoji('<:star:1523150031698264104>').setLabel('5').setStyle(ButtonStyle.Secondary),
        );
        await opener.send({
          embeds: [new EmbedBuilder().setColor('#d6c2ee')
            .setTitle('How was your experience?')
            .setDescription('Please rate your support experience.')],
          components: [ratingRow]
        }).catch(() => {});
      }

      await query('UPDATE tickets SET status=$1, closed_at=NOW(), closed_by=$2, close_reason=$3 WHERE id=$4',
        ['closed', interaction.user.id, reason, ticket.id]);

      stickyMessages.delete(String(ticket.id));
      await interaction.editReply('✅ Ticket closed. Transcript sent.');
      setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
      return;
    }

    // ── Open ticket modal ──────────────────────────────────────────────────
    if (!interaction.customId.startsWith('ticket_modal')) return;
    await interaction.deferReply({ ephemeral: true });

    const parts    = interaction.customId.split(':');
    const id       = parts[1];
    const isSingle = parts[2] === 'single';

    const config = await getConfig(interaction.guild.id);
    if (!config) return interaction.editReply('❌ Ticket system not configured. Ask an admin to run `/ticket setup`.');

    const openRes = await query(
      'SELECT COUNT(*) as c FROM tickets WHERE guild_id=$1 AND user_id=$2 AND status=$3',
      [interaction.guild.id, interaction.user.id, 'open']
    );
    if (Number(openRes.rows[0].c) >= config.max_open)
      return interaction.editReply(`❌ You already have ${config.max_open} open ticket(s).`);

    let type = null, panel = null;
    if (!isSingle) {
      const tRes = await query('SELECT * FROM ticket_types WHERE id=$1', [id]);
      type = tRes.rows[0];
      const pRes = await query('SELECT * FROM ticket_panels WHERE id=$1', [type.panel_id]);
      panel = pRes.rows[0];
    } else {
      const pRes = await query('SELECT * FROM ticket_panels WHERE id=$1', [id]);
      panel = pRes.rows[0];
    }

    const typeName    = type?.name || 'General';
    const threadName  = `ticket-${interaction.user.username}-${typeName}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 100);

    // Find panel channel to create thread under
    const panelChannel = interaction.guild.channels.cache.get(panel?.channel_id || interaction.channel.id);
    if (!panelChannel) return interaction.editReply('❌ Panel channel not found.');

    // Create private thread
    let thread;
    try {
      thread = await panelChannel.threads.create({
        name: threadName,
        type: ChannelType.PrivateThread,
        invitable: false,
      });
    } catch(e) {
      console.error('[Ticket] thread create error:', e.message);
      return interaction.editReply('❌ Failed to create ticket thread. Make sure the bot has permission to create private threads.');
    }

    // Add ticket opener to thread
    await thread.members.add(interaction.user.id);

    // Save to DB
    const ticketRes = await query(
      'INSERT INTO tickets (guild_id, channel_id, user_id, type_name, panel_id, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [interaction.guild.id, thread.id, interaction.user.id, typeName, panel?.id||null, 'open']
    );
    const ticketId = ticketRes.rows[0].id;

    // Build answers
    const questionsArr = type?.questions ? type.questions.split('|') : ['Issue'];
    const answers = [];
    interaction.fields.fields.forEach((field, key) => {
      if (field.value) {
        const qIndex = parseInt(key.slice(1));
        const qLabel = questionsArr[qIndex]?.trim() || key;
        answers.push(`**${qLabel}:** ${field.value}`);
      }
    });

    const openMsg = type?.open_message || panel?.open_message ||
      `Thank you for opening a ticket, <@${interaction.user.id}>! Our staff will be with you shortly. <a:purplesparkle:1512912828489793626>`;

    // Post ticket info embed in thread
    await thread.send({ embeds: [
      new EmbedBuilder().setColor(panel?.color || '#d6c2ee')
        .setTitle(`<a:tickets:1523139713278672996> ${typeName} Ticket`)
        .setDescription(openMsg)
        .addFields({ name: '<a:InfoSticker:1523152442437664879> Your Information', value: answers.join('\n') || '—' })
        .setFooter({ text: `Ticket #${ticketId}` })
        .setTimestamp()
    ]});

    // Post sticky action row
    const actionMsg = await thread.send({ components: [buildActionRow(ticketId)] });
    stickyMessages.set(String(ticketId), actionMsg.id);

    // Post to staff channel
    if (config.staff_channel_id) {
      const staffCh = interaction.client.channels.cache.get(config.staff_channel_id);
      if (staffCh) {
        const staffEmbed = new EmbedBuilder()
          .setColor(panel?.color || '#d6c2ee')
          .setTitle('<a:tickets:1523139713278672996> New Ticket Opened')
          .setDescription(`A new ticket has been opened by <@${interaction.user.id}>.`)
          .addFields(
            { name: '<:member:1512912827424309278> Opened By', value: `<@${interaction.user.id}>`,  inline: true },
            { name: '<a:tickets:1523139713278672996> Type',    value: typeName,                      inline: true },
            { name: '<a:InfoSticker:1523152442437664879> Info', value: answers.join('\n') || '—',   inline: false },
          )
          .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp();

        const joinRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket_join:${ticketId}`)
            .setLabel('Join Ticket')
            .setEmoji('<a:tickets:1523139713278672996>')
            .setStyle(ButtonStyle.Secondary)
        );

        if (config.staff_role_id) {
          await staffCh.send({ content: `<@&${config.staff_role_id}>`, embeds: [staffEmbed], components: [joinRow] });
        } else {
          await staffCh.send({ embeds: [staffEmbed], components: [joinRow] });
        }
      }
    }

    return interaction.editReply(`✅ Your ticket has been created: <#${thread.id}>`);
  },

  // ── Sticky action row handler (called from messageCreate) ─────────────────
  async handleStickyActionRow(message, client) {
    if (message.author.bot) return;
    if (!message.channel.isThread()) return;

    try {
      const ticketRes = await query('SELECT id FROM tickets WHERE channel_id=$1 AND status=$2', [message.channel.id, 'open']);
      if (!ticketRes.rows.length) return;

      const ticketId = String(ticketRes.rows[0].id);
      await repostActionRow(message.channel, ticketId);
    } catch(e) { /* ignore */ }
  },
};
