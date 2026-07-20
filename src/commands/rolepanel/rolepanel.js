const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, PermissionFlagsBits,
} = require('discord.js');
const { query } = require('../../utils/database');

async function getPanel(guildId, name) {
  const res = await query('SELECT * FROM role_panels WHERE guild_id = $1 AND name = $2', [guildId, name]);
  return res.rows[0] || null;
}

async function getOptions(panelId) {
  const res = await query('SELECT * FROM role_panel_options WHERE panel_id = $1 ORDER BY position ASC, id ASC', [panelId]);
  return res.rows;
}

function buildEmbed(panel, options) {
  const lines = options.length
    ? options.map(o => `${o.emoji} - <@&${o.role_id}>`).join('\n')
    : '*No roles added yet — use `/rolepanel addrole`.*';

  const embed = new EmbedBuilder()
    .setColor(panel.color || '#d6c2ee')
    .setTitle(panel.title)
    .setDescription(`${panel.description ? panel.description + '\n\n' : ''}${lines}`);

  return embed;
}

function buildSelectRow(panel, options) {
  if (!options.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rolepanel_select:${panel.id}`)
    .setPlaceholder('Choose your roles...')
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options.slice(0, 25).map(o => ({
      label: o.label.slice(0, 100),
      value: o.role_id,
      emoji: /^\d+$/.test(o.emoji) ? undefined : o.emoji,
    })));
  return new ActionRowBuilder().addComponents(menu);
}

// Renders (or re-renders) a panel message: deletes old message if present, sends new one,
// reacts with each emoji if style is 'reaction', stores new message_id.
async function renderAndPost(client, panel) {
  const channel = await client.channels.fetch(panel.channel_id).catch(() => null);
  if (!channel) return null;

  const options = await getOptions(panel.id);
  const embed = buildEmbed(panel, options);

  const components = panel.style === 'dropdown'
    ? [buildSelectRow(panel, options)].filter(Boolean)
    : [];

  // Delete old message
  if (panel.message_id) {
    const oldMsg = await channel.messages.fetch(panel.message_id).catch(() => null);
    if (oldMsg) await oldMsg.delete().catch(() => {});
  }

  const newMsg = await channel.send({ embeds: [embed], components });

  if (panel.style === 'reaction') {
    for (const o of options) {
      await newMsg.react(o.emoji).catch(() => {});
    }
  }

  await query('UPDATE role_panels SET message_id = $1 WHERE id = $2', [newMsg.id, panel.id]);
  return newMsg;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolepanel')
    .setDescription('Self-assign role panels (dropdown or reaction based)')

    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a new role panel')
      .addStringOption(o => o.setName('name').setDescription('Unique short ID for this panel (e.g. game-pings)').setRequired(true))
      .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(true))
      .addStringOption(o => o.setName('style').setDescription('How members pick roles').setRequired(true).addChoices(
        { name: 'Dropdown (select menu)', value: 'dropdown' },
        { name: 'Reaction (react to emoji)', value: 'reaction' },
      ))
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post in (default: current channel)'))
      .addStringOption(o => o.setName('description').setDescription('Custom description (use \\n for new lines)'))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex (default: #d6c2ee)')))

    .addSubcommand(sub => sub
      .setName('addrole')
      .setDescription('Add a role option to a panel')
      .addStringOption(o => o.setName('name').setDescription('Panel ID').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to give/remove').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji for this role (unicode or custom)').setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Display label (default: role name)')))

    .addSubcommand(sub => sub
      .setName('removerole')
      .setDescription('Remove a role option from a panel')
      .addStringOption(o => o.setName('name').setDescription('Panel ID').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Delete a panel entirely')
      .addStringOption(o => o.setName('name').setDescription('Panel ID').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('repost')
      .setDescription('Repost a panel — rebuilds it fresh if the message was deleted or looks stale')
      .addStringOption(o => o.setName('name').setDescription('Panel ID').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all panels, or view one panel\'s roles')
      .addStringOption(o => o.setName('name').setDescription('Panel ID (leave empty to list all)'))),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const sub = interaction.options.getSubcommand();

    // ── create ─────────────────────────────────────────────────────────────
    if (sub === 'create') {
      const name        = interaction.options.getString('name').toLowerCase().trim();
      const title       = interaction.options.getString('title');
      const style       = interaction.options.getString('style');
      const channel     = interaction.options.getChannel('channel') || interaction.channel;
      const description = interaction.options.getString('description')?.replace(/\\n/g, '\n') || null;
      const color       = interaction.options.getString('color') || '#d6c2ee';

      const existing = await getPanel(interaction.guild.id, name);
      if (existing) {
        return interaction.editReply(`❌ A panel named \`${name}\` already exists. Use a different name or \`/rolepanel delete\` it first.`);
      }

      const res = await query(`
        INSERT INTO role_panels (guild_id, channel_id, name, title, description, color, style)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
      `, [interaction.guild.id, channel.id, name, title, description, color, style]);

      const panel = res.rows[0];
      await renderAndPost(interaction.client, panel);

      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(color)
        .setDescription(`✅ Panel \`${name}\` created in <#${channel.id}> (**${style}** style).\nUse \`/rolepanel addrole name:${name}\` to add roles.`)]});
    }

    // ── addrole ────────────────────────────────────────────────────────────
    if (sub === 'addrole') {
      const name  = interaction.options.getString('name').toLowerCase().trim();
      const role  = interaction.options.getRole('role');
      const emoji = interaction.options.getString('emoji');
      const label = interaction.options.getString('label') || role.name;

      const panel = await getPanel(interaction.guild.id, name);
      if (!panel) return interaction.editReply(`❌ No panel named \`${name}\`.`);

      const options = await getOptions(panel.id);
      if (panel.style === 'dropdown' && options.length >= 25) {
        return interaction.editReply('❌ Dropdown panels max out at 25 roles.');
      }

      await query(`
        INSERT INTO role_panel_options (panel_id, role_id, emoji, label, position)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (panel_id, role_id) DO UPDATE SET emoji = EXCLUDED.emoji, label = EXCLUDED.label
      `, [panel.id, role.id, emoji, label, options.length]);

      await renderAndPost(interaction.client, panel);

      return interaction.editReply(`✅ Added ${emoji} **${label}** (<@&${role.id}>) to \`${name}\`.`);
    }

    // ── removerole ─────────────────────────────────────────────────────────
    if (sub === 'removerole') {
      const name = interaction.options.getString('name').toLowerCase().trim();
      const role = interaction.options.getRole('role');

      const panel = await getPanel(interaction.guild.id, name);
      if (!panel) return interaction.editReply(`❌ No panel named \`${name}\`.`);

      const del = await query('DELETE FROM role_panel_options WHERE panel_id = $1 AND role_id = $2 RETURNING id', [panel.id, role.id]);
      if (!del.rows.length) return interaction.editReply(`❌ That role isn't on \`${name}\`.`);

      await renderAndPost(interaction.client, panel);
      return interaction.editReply(`✅ Removed <@&${role.id}> from \`${name}\`.`);
    }

    // ── delete ─────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      const name = interaction.options.getString('name').toLowerCase().trim();
      const panel = await getPanel(interaction.guild.id, name);
      if (!panel) return interaction.editReply(`❌ No panel named \`${name}\`.`);

      if (panel.message_id) {
        const channel = await interaction.client.channels.fetch(panel.channel_id).catch(() => null);
        const msg = channel ? await channel.messages.fetch(panel.message_id).catch(() => null) : null;
        if (msg) await msg.delete().catch(() => {});
      }

      await query('DELETE FROM role_panels WHERE id = $1', [panel.id]);
      return interaction.editReply(`✅ Panel \`${name}\` deleted.`);
    }

    // ── repost ────────────────────────────────────────────────────────────
    if (sub === 'repost') {
      const name = interaction.options.getString('name').toLowerCase().trim();
      const panel = await getPanel(interaction.guild.id, name);
      if (!panel) return interaction.editReply(`❌ No panel named \`${name}\`.`);

      const newMsg = await renderAndPost(interaction.client, panel);
      if (!newMsg) return interaction.editReply(`❌ Couldn't repost — the panel's channel may no longer exist or Veloura lacks access.`);

      return interaction.editReply(`✅ Panel \`${name}\` reposted in <#${panel.channel_id}>.`);
    }

    // ── list ───────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const name = interaction.options.getString('name');

      if (name) {
        const panel = await getPanel(interaction.guild.id, name.toLowerCase().trim());
        if (!panel) return interaction.editReply(`❌ No panel named \`${name}\`.`);
        const options = await getOptions(panel.id);
        const lines = options.length
          ? options.map(o => `${o.emoji} **${o.label}** — <@&${o.role_id}>`).join('\n')
          : 'No roles added yet.';

        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(panel.color)
          .setTitle(`Panel: ${panel.name}`)
          .addFields(
            { name: 'Channel', value: `<#${panel.channel_id}>`, inline: true },
            { name: 'Style', value: panel.style, inline: true },
          )
          .setDescription(lines)]});
      }

      const res = await query('SELECT name, channel_id, style FROM role_panels WHERE guild_id = $1 ORDER BY name', [interaction.guild.id]);
      if (!res.rows.length) return interaction.editReply('No panels created yet.');
      const lines = res.rows.map(r => `\`${r.name}\` — <#${r.channel_id}> (${r.style})`).join('\n');
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee')
        .setTitle('Role Panels')
        .setDescription(lines)]});
    }
  },

  // ── Dropdown select handler ────────────────────────────────────────────
  async handleSelect(interaction) {
    const [, panelId] = interaction.customId.split(':');
    const options = await getOptions(panelId);
    const allRoleIds = options.map(o => o.role_id);
    const selected = interaction.values; // role IDs chosen this time

    const toAdd = selected.filter(id => !interaction.member.roles.cache.has(id));
    const toRemove = allRoleIds.filter(id => !selected.includes(id) && interaction.member.roles.cache.has(id));

    for (const id of toAdd) await interaction.member.roles.add(id).catch(() => {});
    for (const id of toRemove) await interaction.member.roles.remove(id).catch(() => {});

    return interaction.reply({ content: '✅ Your roles have been updated!', ephemeral: true });
  },

  // ── Reaction handlers ──────────────────────────────────────────────────
  async handleReactionAdd(reaction, user) {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);

    const res = await query('SELECT * FROM role_panels WHERE message_id = $1 AND style = $2', [reaction.message.id, 'reaction']);
    const panel = res.rows[0];
    if (!panel) return;

    const emojiKey = reaction.emoji.id || reaction.emoji.name;
    const optRes = await query(
      'SELECT * FROM role_panel_options WHERE panel_id = $1 AND (emoji = $2 OR emoji LIKE $3)',
      [panel.id, reaction.emoji.name, `%${emojiKey}%`]
    );
    const opt = optRes.rows[0];
    if (!opt) return;

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member) await member.roles.add(opt.role_id).catch(() => {});
  },

  async handleReactionRemove(reaction, user) {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);

    const res = await query('SELECT * FROM role_panels WHERE message_id = $1 AND style = $2', [reaction.message.id, 'reaction']);
    const panel = res.rows[0];
    if (!panel) return;

    const emojiKey = reaction.emoji.id || reaction.emoji.name;
    const optRes = await query(
      'SELECT * FROM role_panel_options WHERE panel_id = $1 AND (emoji = $2 OR emoji LIKE $3)',
      [panel.id, reaction.emoji.name, `%${emojiKey}%`]
    );
    const opt = optRes.rows[0];
    if (!opt) return;

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (member) await member.roles.remove(opt.role_id).catch(() => {});
  },
};
