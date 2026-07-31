const {
  SlashCommandBuilder, AttachmentBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits,
} = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { baseEmbed, COLORS } = require('../../utils/embeds');
const { spinWheel } = require('../../utils/wheelRenderer');
const { getPaletteColors, getPaletteChoices, WHEEL_PALETTES } = require('../../utils/wheelPalettes');
const { query } = require('../../utils/database');
const { adjustBalance, getBalance } = require('../../utils/playAndRegretDb');


// Temporary wheel session store for re-roll/remove

function buildPaletteOption(opt) {
  return opt.setName('palette').setDescription('Wheel color theme').setRequired(false).addChoices(...getPaletteChoices());
}

function parseManualEntries(raw) {
  return raw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

// Detects prize text like "50 Sins" or "50 sin" and returns the amount, or null if it's not a Sins prize.
function parseSinsAmount(text) {
  if (!text) return null;
  const match = text.trim().match(/^(\d+)\s*sins?$/i);
  return match ? parseInt(match[1], 10) : null;
}

async function resolveMentionsToEntries(interaction, rawEntries) {
  const resolved = [];
  for (const entry of rawEntries) {
    const match = entry.match(/<@!?(\d+)>/);
    if (match) {
      try {
        const member = await interaction.guild.members.fetch(match[1]);
        resolved.push({ text: member.user.username, userId: match[1] });
      } catch {
        resolved.push({ text: entry, userId: null });
      }
    } else {
      resolved.push({ text: entry, userId: null });
    }
  }
  return resolved;
}

function formatWinnerMention(winnerEntry) {
  if (winnerEntry && winnerEntry.userId) return '<@' + winnerEntry.userId + '>';
  return winnerEntry ? winnerEntry.text : 'Unknown';
}

const DEFAULT_COLORS = ['#efbbff', '#d896ff', '#be29ec', '#800080', '#660066'];

async function handleWheelButton(interaction, client) {
  const [action, sessionId] = interaction.customId.split(':');
  const sessionRes = await query('SELECT * FROM wheel_sessions WHERE session_id=$1', [sessionId]).catch(() => null);
  const sessionRow = sessionRes?.rows?.[0];
  if (!sessionRow) {
    return interaction.reply({ content: 'Session expired — please spin again.', ephemeral: true });
  }
  const session = {
    entries: sessionRow.entries,
    colors: sessionRow.colors,
    embedColor: sessionRow.embed_color,
    eliminated: sessionRow.eliminated,
    guildId: sessionRow.guild_id,
  };

  await interaction.deferUpdate();

  // Reroll — keep same pool, just respin
  if (action === 'wheel_reroll') {
    const entries = session.entries;
    const textEntries = entries.map(o => o.text);

    let result;
    try { result = await spinWheel(textEntries, session.colors); }
    catch(err) { return interaction.followUp({ content: 'Spin failed: ' + err.message, ephemeral: true }); }

    const winnerEntry = entries[result.winnerIndex];
    const winnerDisplay = formatWinnerMention(winnerEntry);

    const attachment = new AttachmentBuilder(result.buffer, { name: 'wheel.gif' });
    const embed = baseEmbed('<a:reroll:1523809294867234886>' + ' Re-roll', session.embedColor || COLORS.tbppurple, null)
      .setImage('attachment://wheel.gif')
      .addFields({ name: e('trophies') + ' Winner', value: winnerDisplay, inline: false })
      .setFooter({ text: entries.length + ' entries remaining' });

    await interaction.editReply({ embeds: [embed], files: [attachment], components: [buildWheelButtons(sessionId, entries.length, 'rerolled')] });
  }

  // Remove & Spin — remove winner from pool, respin
  if (action === 'wheel_remove') {
    // Get current winner from last message embed
    const lastEmbed = interaction.message.embeds[0];
    const winnerField = lastEmbed?.fields?.find(f => f.name.includes('Winner') || f.name.includes('Standing') || f.name.includes('Eliminated Next'));
    const winnerText = winnerField?.value || '';

    // Remove winner from entries
    const beforeCount = session.entries.length;
    const userIdMatch = winnerText.match(/<@!?(\d+)>/);
    if (userIdMatch) {
      session.entries = session.entries.filter(en => en.userId !== userIdMatch[1]);
    } else {
      session.entries = session.entries.filter(en => en.text !== winnerText.trim());
    }
    session.eliminated.push(winnerText);
    await query('UPDATE wheel_sessions SET entries=$1, eliminated=$2 WHERE session_id=$3',
      [JSON.stringify(session.entries), JSON.stringify(session.eliminated), sessionId]).catch(() => {});

    if (session.entries.length === 0) {
      return interaction.editReply({ content: 'No entries remaining!', components: [] });
    }

    // Last man standing — only 1 left
    if (session.entries.length === 1) {
      const last = session.entries[0];
      const lastDisplay = formatWinnerMention(last);
      const embed = baseEmbed('<a:purplesparkle:1512912828489793626>' + ' Last Man Standing', session.embedColor || COLORS.tbppurple, null)
        .addFields(
          { name: '🏆 WINNER', value: lastDisplay, inline: false },
          { name: '<a:x_:1523809293756010517>' + ' Eliminated', value: session.eliminated.join(', ').slice(0, 1024), inline: false },
        )
        .setFooter({ text: 'Last one standing!' });
      await query('DELETE FROM wheel_sessions WHERE session_id=$1', [sessionId]).catch(() => {});
      return interaction.editReply({ embeds: [embed], files: [], components: [] });
    }

    const textEntries = session.entries.map(o => o.text);
    let result;
    try { result = await spinWheel(textEntries, session.colors); }
    catch(err) { return interaction.followUp({ content: 'Spin failed: ' + err.message, ephemeral: true }); }

    const winnerEntry = session.entries[result.winnerIndex];
    const winnerDisplay = formatWinnerMention(winnerEntry);

    const attachment = new AttachmentBuilder(result.buffer, { name: 'wheel.gif' });
    const embed = baseEmbed('<a:wheelspin:1523809296465526824>' + ' Remove & Spin', session.embedColor || COLORS.tbppurple, null)
      .setImage('attachment://wheel.gif')
      .addFields(
        { name: e('trophies') + ' Eliminated Next', value: winnerDisplay, inline: false },
        { name: '<a:x_:1523809293756010517>' + ' Eliminated So Far', value: session.eliminated.join(', ').slice(0, 1024), inline: false },
      )
      .setFooter({ text: session.entries.length + ' entries remaining' });

    await interaction.editReply({ embeds: [embed], files: [attachment], components: [buildWheelButtons(sessionId, session.entries.length, 'removed')] });
  }
}

module.exports = {
  handleButton: handleWheelButton,
  data: new SlashCommandBuilder()
    .setName('wheel')
    .setDescription('Spin a wheel to pick a winner or prize')
    .addSubcommand(sub => sub
      .setName('members')
      .setDescription('Spin a wheel with manually added members (repeat a user for more chances)')
      .addStringOption(o => o.setName('entries').setDescription('Comma-separated: @usera, @usera, @userb').setRequired(true))
      .addStringOption(buildPaletteOption)
    )
    .addSubcommand(sub => sub
      .setName('reactions')
      .setDescription('Spin a wheel using reactors on a message (one entry per unique user)')
      .addStringOption(o => o.setName('link').setDescription('Message link to pull reactions from').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Only count reactions with this emoji (optional)').setRequired(false))
      .addStringOption(buildPaletteOption)
    )
    .addSubcommand(sub => sub
      .setName('boosted')
      .setDescription('Spin a wheel with bonus entries based on configured roles (see /wheel role-bonus)')
      .addStringOption(o => o.setName('entries').setDescription('Comma-separated: @usera, @userb, @userc').setRequired(true))
      .addStringOption(buildPaletteOption)
    )
    .addSubcommand(sub => sub
      .setName('prizes')
      .setDescription('Spin a wheel of prizes for a winner you already picked')
      .addStringOption(o => o.setName('prizes').setDescription('Comma-separated prize list').setRequired(true))
      .addUserOption(o => o.setName('winner').setDescription('Who gets whatever the wheel lands on').setRequired(true))
      .addStringOption(buildPaletteOption)
    )
    .addSubcommand(sub => sub
      .setName('combo')
      .setDescription('Spin once for a winner, then spin again for their prize')
      .addStringOption(o => o.setName('entries').setDescription('Comma-separated: @usera, @userb, @userc').setRequired(true))
      .addStringOption(o => o.setName('prizes').setDescription('Comma-separated prize list').setRequired(true))
      .addStringOption(buildPaletteOption)
    )
    .addSubcommandGroup(group => group
      .setName('roles')
      .setDescription('Wheel Roles campaigns — collect entries from members with certain roles')
      .addSubcommand(sub => sub
        .setName('create')
        .setDescription('Create a new Wheel Roles campaign')
        .addStringOption(o => o.setName('name').setDescription('Campaign name').setRequired(true))
        .addStringOption(o => o.setName('season').setDescription('Pull qualifying roles from a season\'s winner roles').setAutocomplete(true))
        .addBooleanOption(o => o.setName('require_all_season_roles').setDescription('Must have EVERY winner role from the season(s), not just one (default: False)'))
        .addStringOption(o => o.setName('additional_seasons').setDescription('More seasons (comma-separated names) - qualifies by completing ANY one of them'))
        .addStringOption(o => o.setName('roles').setDescription('Or type @ to mention roles manually (skip if using season)'))
        .addBooleanOption(o => o.setName('auto_signup').setDescription('Auto-enter members who have any of these roles (default: True)'))
        .addBooleanOption(o => o.setName('extra_entries').setDescription('Stack an extra entry per additional qualifying role (default: False)')))
      .addSubcommand(sub => sub
        .setName('list')
        .setDescription('List all campaigns, or view one campaign\'s entries')
        .addStringOption(o => o.setName('name').setDescription('Campaign name (blank = list all)').setAutocomplete(true)))
      .addSubcommand(sub => sub
        .setName('spin')
        .setDescription('Spin the wheel using a campaign\'s current entries')
        .addStringOption(o => o.setName('name').setDescription('Campaign name').setRequired(true).setAutocomplete(true))
        .addStringOption(buildPaletteOption))
      .addSubcommand(sub => sub
        .setName('end')
        .setDescription('End a campaign — stops new auto-signups, keeps entries for spinning')
        .addStringOption(o => o.setName('name').setDescription('Campaign name').setRequired(true).setAutocomplete(true)))
      .addSubcommand(sub => sub
        .setName('delete')
        .setDescription('Delete a campaign and all its entries permanently')
        .addStringOption(o => o.setName('name').setDescription('Campaign name').setRequired(true).setAutocomplete(true)))
      .addSubcommand(sub => sub
        .setName('post')
        .setDescription('Post a message members can react to, to enter a campaign directly')
        .addStringOption(o => o.setName('name').setDescription('Campaign name').setRequired(true).setAutocomplete(true))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to post in').setRequired(true)))
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'name') {
      const res = await query(
        `SELECT name FROM wheel_role_campaigns WHERE guild_id=$1 AND name ILIKE $2 ORDER BY created_at DESC LIMIT 25`,
        [interaction.guild.id, `%${focused.value}%`]
      );
      return interaction.respond(res.rows.map(r => ({ name: r.name, value: r.name })));
    }
    if (focused.name === 'season') {
      const res = await query(
        `SELECT name FROM rr_seasons WHERE guild_id=$1 AND status='active' AND name ILIKE $2 ORDER BY started_at DESC LIMIT 25`,
        [interaction.guild.id, `%${focused.value}%`]
      );
      return interaction.respond(res.rows.map(r => ({ name: r.name, value: r.name })));
    }
    return interaction.respond([]);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);

    if ((['role-bonus-add', 'role-bonus-list', 'role-bonus-remove'].includes(sub) || group === 'roles') &&
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
    }

    if (group === 'roles') {
      if (sub === 'create') return campaignCreate(interaction);
      if (sub === 'list') return campaignList(interaction);
      if (sub === 'spin') return campaignSpin(interaction);
      if (sub === 'end') return campaignEnd(interaction);
      if (sub === 'delete') return campaignDelete(interaction);
      if (sub === 'post') return campaignPost(interaction);
    }

    if (sub === 'members') return spinMembers(interaction);
    if (sub === 'reactions') return spinReactions(interaction);
    if (sub === 'boosted') return spinBoosted(interaction);
    if (sub === 'role-bonus-add') return roleBonusAdd(interaction);
    if (sub === 'role-bonus-list') return roleBonusList(interaction);
    if (sub === 'role-bonus-remove') return roleBonusRemove(interaction);
    if (sub === 'prizes') return spinPrizes(interaction);
    if (sub === 'combo') return spinCombo(interaction);
  },
};

async function sendWheelResult(interaction, entries, colors, embedTitle, fieldLabel, extraFields) {
  extraFields = extraFields || [];
  await interaction.deferReply();

  let result;
  try {
    result = await spinWheel(entries, colors);
  } catch (err) {
    console.error('[Wheel] Spin failed:', err.message);
    return interaction.editReply({ content: e('wrong') + ' Wheel spin failed: ' + err.message });
  }

  const attachment = new AttachmentBuilder(result.buffer, { name: 'wheel.gif' });

  const embed = baseEmbed(embedTitle, COLORS.tbppurple, interaction.guild ? interaction.guild.name : null)
    .setImage('attachment://wheel.gif')
    .addFields({ name: fieldLabel, value: result.winner, inline: false });

  for (const f of extraFields) embed.addFields(f);

  await interaction.editReply({ embeds: [embed], files: [attachment] });
  return result.winner;
}


function buildWheelButtons(sessionId, remaining, mode = 'normal') {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wheel_reroll:${sessionId}`)
      .setLabel('Re-roll')
      .setEmoji({ id: '1523809294867234886', name: 'reroll', animated: true })
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(remaining < 1 || mode === 'removed'),
    new ButtonBuilder()
      .setCustomId(`wheel_remove:${sessionId}`)
      .setLabel('Remove & Spin')
      .setEmoji({ id: '1523809293756010517', name: 'x_', animated: true })
      .setStyle(ButtonStyle.Danger)
      .setDisabled(remaining <= 1 || mode === 'rerolled'),
  );
  return row;
}

async function spinMembers(interaction) {
  const raw = interaction.options.getString('entries');
  const paletteKey = interaction.options.getString('palette');
  const colors = paletteKey ? getPaletteColors(paletteKey) : DEFAULT_COLORS;

  const rawEntries = parseManualEntries(raw);
  if (!rawEntries.length) {
    return interaction.reply({ content: e('wrong') + ' No entries provided.', ephemeral: true });
  }
  const entryObjects = await resolveMentionsToEntries(interaction, rawEntries);
  const textEntries = entryObjects.map(function(o) { return o.text; });

  await interaction.deferReply();
  let result;
  try {
    result = await spinWheel(textEntries, colors);
  } catch (err) {
    console.error('[Wheel] Spin failed:', err.message);
    return interaction.editReply({ content: e('wrong') + ' Wheel spin failed: ' + err.message });
  }

  const winnerEntry = entryObjects[result.winnerIndex];
  const winnerDisplay = formatWinnerMention(winnerEntry);

  // Store session temporarily
  const embedColor = (paletteKey && WHEEL_PALETTES[paletteKey]?.embedColor) || (colors && colors[0]) || COLORS.tbppurple;
  const sessionId = `wheel_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  await query('INSERT INTO wheel_sessions (session_id, guild_id, entries, colors, embed_color, eliminated) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (session_id) DO UPDATE SET entries=$3, colors=$4, embed_color=$5, eliminated=$6',
    [sessionId, interaction.guild?.id || null, JSON.stringify(entryObjects), JSON.stringify(colors), embedColor, JSON.stringify([])]).catch(() => {});

  const attachment = new AttachmentBuilder(result.buffer, { name: 'wheel.gif' });
  const embed = baseEmbed('<a:wheelspin:1523809296465526824>' + ' Wheel Spin \u2014 Members', embedColor, interaction.guild ? interaction.guild.name : null)
    .setImage('attachment://wheel.gif')
    .addFields({ name: e('trophies') + ' Winner', value: winnerDisplay, inline: false })
    .setFooter({ text: (interaction.guild?.name || '') + ' • ' + entryObjects.length + ' entries' });

  await interaction.editReply({ embeds: [embed], files: [attachment], components: [buildWheelButtons(sessionId, entryObjects.length)] });
}

async function spinReactions(interaction) {
  const link = interaction.options.getString('link');
  const emojiFilter = interaction.options.getString('emoji');
  const paletteKey = interaction.options.getString('palette');
  const colors = paletteKey ? getPaletteColors(paletteKey) : DEFAULT_COLORS;

  await interaction.deferReply();

  const parts = link.match(/channels\/([^/]+)\/([^/]+)\/([^/]+)/);
  if (!parts) {
    return interaction.editReply({ content: e('wrong') + ' Invalid message link.' });
  }

  let message;
  try {
    const channel = await interaction.client.channels.fetch(parts[2]);
    message = await channel.messages.fetch(parts[3]);
  } catch (err) {
    return interaction.editReply({ content: e('wrong') + ' Could not fetch that message.' });
  }

  const uniqueUserIds = new Set();
  for (const [emojiKey, reaction] of message.reactions.cache) {
    if (emojiFilter && reaction.emoji.name !== emojiFilter && reaction.emoji.toString() !== emojiFilter) continue;
    const users = await reaction.users.fetch();
    for (const [userId, user] of users) {
      if (!user.bot) uniqueUserIds.add(userId);
    }
  }

  if (!uniqueUserIds.size) {
    return interaction.editReply({ content: e('wrong') + ' No reactions found on that message.' });
  }

  const entryObjects = [];
  for (const userId of uniqueUserIds) {
    try {
      const member = await interaction.guild.members.fetch(userId);
      entryObjects.push({ text: member.user.username, userId: userId });
    } catch {
      entryObjects.push({ text: userId, userId: userId });
    }
  }
  const textEntries = entryObjects.map(function(o) { return o.text; });

  let result;
  try {
    result = await spinWheel(textEntries, colors);
  } catch (err) {
    console.error('[Wheel] Spin failed:', err.message);
    return interaction.editReply({ content: e('wrong') + ' Wheel spin failed: ' + err.message });
  }

  const winnerEntry = entryObjects[result.winnerIndex];
  const winnerDisplay = formatWinnerMention(winnerEntry);

  const attachment = new AttachmentBuilder(result.buffer, { name: 'wheel.gif' });

  const embed = baseEmbed(e('confetti') + ' Wheel Spin \u2014 Reactions', COLORS.tbppurple, interaction.guild ? interaction.guild.name : null)
    .setImage('attachment://wheel.gif')
    .addFields(
      { name: e('trophies') + ' Winner', value: winnerDisplay, inline: false },
      { name: e('member') + ' Total Entries', value: String(entryObjects.length), inline: true },
    );

  await interaction.editReply({ embeds: [embed], files: [attachment] });
}

async function spinBoosted(interaction) {
  const raw = interaction.options.getString('entries');
  const paletteKey = interaction.options.getString('palette');
  const colors = paletteKey ? getPaletteColors(paletteKey) : DEFAULT_COLORS;

  await interaction.deferReply();

  const rawEntries = parseManualEntries(raw);
  if (!rawEntries.length) {
    return interaction.editReply({ content: e('wrong') + ' No entries provided.' });
  }

  const bonusRes = await query('SELECT role_id, role_name, bonus_entries FROM wheel_role_bonuses WHERE guild_id=$1', [interaction.guildId]);
  const roleBonuses = bonusRes.rows;

  if (!roleBonuses.length) {
    return interaction.editReply({ content: e('wrong') + ' No role bonuses configured yet. Use /wheel role-bonus-add first.' });
  }

  const entryObjects = [];
  const appliedBonusLines = [];

  for (const rawEntry of rawEntries) {
    const match = rawEntry.match(/<@!?(\d+)>/);
    let displayName = rawEntry;
    let userId = null;
    let totalBonus = 0;
    const matchedRoleNames = [];

    if (match) {
      userId = match[1];
      try {
        const member = await interaction.guild.members.fetch(match[1]);
        displayName = member.user.username;
        for (const rb of roleBonuses) {
          if (member.roles.cache.has(rb.role_id)) {
            totalBonus += rb.bonus_entries;
            matchedRoleNames.push((rb.role_name || rb.role_id) + ' +' + rb.bonus_entries);
          }
        }
      } catch {
      }
    }

    entryObjects.push({ text: displayName, userId: userId });
    if (totalBonus > 0) {
      for (let i = 0; i < totalBonus; i++) entryObjects.push({ text: displayName, userId: userId });
      appliedBonusLines.push(displayName + ': ' + matchedRoleNames.join(', ') + ' (total +' + totalBonus + ')');
    }
  }
  const textEntries = entryObjects.map(function(o) { return o.text; });

  let result;
  try {
    result = await spinWheel(textEntries, colors);
  } catch (err) {
    console.error('[Wheel] Spin failed:', err.message);
    return interaction.editReply({ content: e('wrong') + ' Wheel spin failed: ' + err.message });
  }

  const winnerEntry = entryObjects[result.winnerIndex];
  const winnerDisplay = formatWinnerMention(winnerEntry);

  const attachment = new AttachmentBuilder(result.buffer, { name: 'wheel.gif' });
  const embed = baseEmbed(e('diamond') + ' Wheel Spin \u2014 Bonus Entries', COLORS.tbppurple, interaction.guild ? interaction.guild.name : null)
    .setImage('attachment://wheel.gif')
    .addFields({ name: e('trophies') + ' Winner', value: winnerDisplay, inline: false });

  if (appliedBonusLines.length) {
    embed.addFields({ name: e('diamond') + ' Bonuses Applied', value: appliedBonusLines.join('\n').slice(0, 1024), inline: false });
  }

  await interaction.editReply({ embeds: [embed], files: [attachment] });
}

async function campaignCreate(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const name = interaction.options.getString('name');
  const seasonName = interaction.options.getString('season');
  const requireAll = interaction.options.getBoolean('require_all_season_roles') ?? false;
  const additionalSeasonsRaw = interaction.options.getString('additional_seasons');
  const rolesRaw = interaction.options.getString('roles');
  const autoSignup = interaction.options.getBoolean('auto_signup') ?? true;
  const extraEntries = interaction.options.getBoolean('extra_entries') ?? false;

  if (!seasonName && !rolesRaw) {
    return interaction.editReply(`${e('wrong')} Pick a \`season\` to pull roles from, or type \`roles\` manually.`);
  }
  if (additionalSeasonsRaw && !seasonName) {
    return interaction.editReply(`${e('wrong')} \`additional_seasons\` needs a primary \`season\` picked too.`);
  }
  if (additionalSeasonsRaw && !requireAll) {
    return interaction.editReply(`${e('wrong')} \`additional_seasons\` only applies when \`require_all_season_roles\` is True.`);
  }

  let roleIds = [];
  let qualifySeasonIds = null;
  let qualifyMode = 'any_role';

  if (seasonName) {
    const seasonNames = [seasonName, ...(additionalSeasonsRaw ? additionalSeasonsRaw.split(',').map(s => s.trim()).filter(Boolean) : [])];
    const seasons = [];

    for (const sName of seasonNames) {
      const seasonRes = await query(`SELECT id FROM rr_seasons WHERE guild_id=$1 AND name=$2 AND status='active'`, [interaction.guildId, sName]);
      if (!seasonRes.rows.length) return interaction.editReply(`${e('wrong')} No active season named **${sName}**.`);
      seasons.push({ id: seasonRes.rows[0].id, name: sName });
    }

    const allRoleIds = new Set();
    for (const season of seasons) {
      const roleRes = await query(
        `SELECT DISTINCT rc.winner_role_id FROM rr_season_channels sc JOIN rr_channel_config rc ON rc.channel_id = sc.channel_id
         WHERE sc.season_id = $1 AND rc.winner_role_id IS NOT NULL
         UNION
         SELECT DISTINCT rs.winner_role_id FROM rr_season_channels sc JOIN rumble_slaughter_config rs ON rs.channel_id = sc.channel_id
         WHERE sc.season_id = $1 AND rs.winner_role_id IS NOT NULL`,
        [season.id]
      );
      if (!roleRes.rows.length) return interaction.editReply(`${e('wrong')} **${season.name}** has no channels with a winner role configured yet.`);
      roleRes.rows.forEach(r => allRoleIds.add(r.winner_role_id));
    }
    roleIds = [...allRoleIds];

    if (requireAll) {
      qualifyMode = 'full_season';
      qualifySeasonIds = seasons.map(s => s.id);
    }
  } else {
    roleIds = [...rolesRaw.matchAll(/<@&(\d+)>/g)].map(m => m[1]);
    if (!roleIds.length) return interaction.editReply(`${e('wrong')} Couldn't find any role mentions — type @ to mention roles.`);
  }

  const existing = await query(`SELECT id FROM wheel_role_campaigns WHERE guild_id=$1 AND name=$2 AND status='active'`, [interaction.guildId, name]);
  if (existing.rows.length) return interaction.editReply(`${e('wrong')} A campaign named **${name}** already exists.`);

  await query(
    `INSERT INTO wheel_role_campaigns (guild_id, name, role_ids, auto_signup, extra_entries_allowed, created_by, qualify_mode, qualify_season_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [interaction.guildId, name, roleIds, autoSignup, extraEntries, interaction.user.id, qualifyMode, qualifySeasonIds]
  );

  const roleLines = roleIds.map(id => `<@&${id}>`).join(', ');
  const qualifyExplainer = qualifyMode === 'full_season'
    ? `Must have **ALL** winner roles from ${qualifySeasonIds.length > 1 ? 'ANY ONE of the selected seasons' : 'this season'} to qualify.`
    : 'Qualifies with any ONE of these roles.';

  return interaction.editReply(
    `${e('checkmark')} Campaign **${name}** created${seasonName ? ` from season${qualifySeasonIds?.length > 1 ? 's' : ''} **${seasonName}${additionalSeasonsRaw ? `, ${additionalSeasonsRaw}` : ''}**` : ''} — roles involved: ${roleLines}\n` +
    `${qualifyExplainer}\n` +
    `Auto-signup: **${autoSignup ? 'On' : 'Off'}** — Extra entries per extra role: **${extraEntries ? 'On' : 'Off'}**\n` +
    (autoSignup ? 'Qualifying members will be entered automatically going forward.' : 'Auto-signup is off — entries only happen through linked Rumble seasons.')
  );
}

async function campaignList(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const name = interaction.options.getString('name');

  if (!name) {
    const res = await query(
      `SELECT c.*, COUNT(e.id) AS entry_count
       FROM wheel_role_campaigns c LEFT JOIN wheel_role_campaign_entries e ON e.campaign_id = c.id
       WHERE c.guild_id=$1 GROUP BY c.id ORDER BY c.created_at DESC`,
      [interaction.guildId]
    );
    if (!res.rows.length) return interaction.editReply('No Wheel Roles campaigns yet. Create one with `/wheel roles create`.');

    const lines = res.rows.map(c => `**${c.name}** ${c.status === 'active' ? '🟢' : '⚪'} — ${c.entry_count} entrant(s) — auto-signup: ${c.auto_signup ? 'on' : 'off'}`).join('\n');
    return interaction.editReply({ embeds: [baseEmbed(e('diamond') + ' Wheel Roles Campaigns', COLORS.tbppurple, interaction.guild?.name)
      .setDescription(lines)] });
  }

  const campRes = await query(`SELECT * FROM wheel_role_campaigns WHERE guild_id=$1 AND name=$2`, [interaction.guildId, name]);
  const camp = campRes.rows[0];
  if (!camp) return interaction.editReply(`${e('wrong')} No campaign named **${name}**.`);

  const entRes = await query(
    `SELECT * FROM wheel_role_campaign_entries WHERE campaign_id=$1 ORDER BY quantity DESC, entered_at ASC LIMIT 25`,
    [camp.id]
  );
  const roleLines = camp.role_ids.map(id => `<@&${id}>`).join(', ');
  const qualifyLine = camp.qualify_mode === 'full_season'
    ? `Must have **ALL** of these roles (from ${camp.qualify_season_ids?.length > 1 ? 'any one season' : 'the season'}) to qualify.`
    : 'Qualifies with any ONE of these roles.';
  const entryLines = entRes.rows.length
    ? entRes.rows.map(en => `<@${en.user_id}> — ${en.quantity} entr${en.quantity === 1 ? 'y' : 'ies'}${en.currently_qualified ? '' : ' *(no longer qualified)*'}`).join('\n')
    : 'No entries yet.';

  return interaction.editReply({ embeds: [baseEmbed(`${e('diamond')} Campaign: ${camp.name}`, COLORS.tbppurple, interaction.guild?.name)
    .setDescription(`Status: **${camp.status}** — Auto-signup: **${camp.auto_signup ? 'On' : 'Off'}** — Extra entries: **${camp.extra_entries_allowed ? 'On' : 'Off'}**\nRoles: ${roleLines}\n${qualifyLine}`)
    .addFields({ name: `Entrants (showing up to 25)`, value: entryLines })] });
}

async function campaignSpin(interaction) {
  const name = interaction.options.getString('name');
  const paletteKey = interaction.options.getString('palette');
  const colors = paletteKey ? getPaletteColors(paletteKey) : DEFAULT_COLORS;

  await interaction.deferReply();

  const campRes = await query(`SELECT * FROM wheel_role_campaigns WHERE guild_id=$1 AND name=$2`, [interaction.guildId, name]);
  const camp = campRes.rows[0];
  if (!camp) return interaction.editReply(`${e('wrong')} No campaign named **${name}**.`);

  const entRes = await query(`SELECT * FROM wheel_role_campaign_entries WHERE campaign_id=$1 AND currently_qualified=true`, [camp.id]);
  if (!entRes.rows.length) return interaction.editReply(`${e('wrong')} **${name}** has no qualified entrants to spin for.`);

  const entryObjects = [];
  for (const en of entRes.rows) {
    const member = await interaction.guild.members.fetch(en.user_id).catch(() => null);
    const displayName = member ? member.user.username : `<@${en.user_id}>`;
    for (let i = 0; i < en.quantity; i++) entryObjects.push({ text: displayName, userId: en.user_id });
  }
  const textEntries = entryObjects.map(o => o.text);

  let result;
  try {
    result = await spinWheel(textEntries, colors);
  } catch (err) {
    console.error('[Wheel] Campaign spin failed:', err.message);
    return interaction.editReply({ content: `${e('wrong')} Wheel spin failed: ${err.message}` });
  }

  const winner = entryObjects[result.winnerIndex];
  const embedColor = (paletteKey && WHEEL_PALETTES[paletteKey]?.embedColor) || (colors && colors[0]) || COLORS.tbppurple;
  const attachment = new AttachmentBuilder(result.buffer, { name: 'wheel.gif' });
  const embed = baseEmbed(`${e('diamond')} Wheel Spin — ${camp.name}`, embedColor, interaction.guild?.name)
    .setImage('attachment://wheel.gif')
    .addFields({ name: e('trophies') + ' Winner', value: winner.userId ? `<@${winner.userId}>` : winner.text, inline: false })
    .setFooter({ text: `${entRes.rows.length} qualified entrant(s), ${entryObjects.length} total entries` });

  return interaction.editReply({ embeds: [embed], files: [attachment] });
}

async function campaignEnd(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const name = interaction.options.getString('name');
  const res = await query(`UPDATE wheel_role_campaigns SET status='ended' WHERE guild_id=$1 AND name=$2 RETURNING id`, [interaction.guildId, name]);
  if (!res.rows.length) return interaction.editReply(`${e('wrong')} No campaign named **${name}**.`);
  return interaction.editReply(`${e('checkmark')} **${name}** ended — auto-signups stopped, existing entries kept for spinning.`);
}

async function campaignDelete(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const name = interaction.options.getString('name');
  const res = await query(`DELETE FROM wheel_role_campaigns WHERE guild_id=$1 AND name=$2 RETURNING id`, [interaction.guildId, name]);
  if (!res.rows.length) return interaction.editReply(`${e('wrong')} No campaign named **${name}**.`);
  return interaction.editReply(`${e('checkmark')} **${name}** and all its entries deleted.`);
}

async function campaignPost(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const name = interaction.options.getString('name');
  const channel = interaction.options.getChannel('channel');

  const campRes = await query(`SELECT * FROM wheel_role_campaigns WHERE guild_id=$1 AND name=$2 AND status='active'`, [interaction.guildId, name]);
  const camp = campRes.rows[0];
  if (!camp) return interaction.editReply(`${e('wrong')} No active campaign named **${name}**.`);

  const roleLines = camp.role_ids.map(id => `<@&${id}>`).join(', ');
  const qualifyLine = camp.qualify_mode === 'full_season'
    ? `You must have **ALL** of these roles to qualify: ${roleLines}`
    : `You need at least ONE of these roles to qualify: ${roleLines}`;

  const embed = baseEmbed(`${e('diamond')} ${camp.name}`, COLORS.tbppurple, interaction.guild?.name)
    .setDescription(`React with 🎉 to enter!\n${qualifyLine}`);

  const msg = await channel.send({ embeds: [embed] });
  await msg.react('🎉').catch(() => {});

  await query(`UPDATE wheel_role_campaigns SET entry_channel_id=$1, entry_message_id=$2 WHERE id=$3`, [channel.id, msg.id, camp.id]);

  return interaction.editReply(`${e('checkmark')} Posted **${name}** in <#${channel.id}> — members can react with 🎉 to enter.`);
}

// Reaction-to-enter for a posted campaign — validates the reactor and either
// registers their entry or removes the reaction with a temporary rejection
// notice (not a DM, per how the giveaway version works).
async function handleCampaignReactionAdd(reaction, user) {
  if (user.bot) return;
  if (reaction.emoji.name !== '🎉') return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
  if (!reaction.message.guild) return;

  const campRes = await query(
    `SELECT * FROM wheel_role_campaigns WHERE guild_id=$1 AND entry_message_id=$2 AND status='active'`,
    [reaction.message.guild.id, reaction.message.id]
  );
  const camp = campRes.rows[0];
  if (!camp) return;

  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  const { qualifies, quantity } = await checkCampaignQualification(camp, member);

  if (qualifies) {
    await query(
      `INSERT INTO wheel_role_campaign_entries (campaign_id, user_id, quantity, currently_qualified, last_qualified_at)
       VALUES ($1,$2,$3,true,NOW())
       ON CONFLICT (campaign_id, user_id) DO UPDATE SET
         quantity = $3, currently_qualified = true, last_qualified_at = NOW()`,
      [camp.id, user.id, quantity]
    ).catch(() => {});
    return;
  }

  await reaction.users.remove(user.id).catch(() => {});
  const notice = await reaction.message.channel.send({
    content: `${e('wrong')} <@${user.id}> you don't qualify for **${camp.name}** yet — check the roles listed above.`,
  }).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 8000);
}

// Called from index.js on guildMemberUpdate — checks role changes against
// every active auto-signup campaign in that guild and updates entries.
// Shared by auto-signup (guildMemberUpdate) and reaction-to-enter — returns
// whether this member currently qualifies for the campaign, and how many
// entries that's worth.
async function checkCampaignQualification(camp, member) {
  let qualifies = false;
  let quantity = 1;

  if (camp.qualify_mode === 'full_season') {
    // Must hold EVERY winner role from at least one of the listed seasons.
    for (const seasonId of camp.qualify_season_ids || []) {
      const roleRes = await query(
        `SELECT DISTINCT rc.winner_role_id FROM rr_season_channels sc JOIN rr_channel_config rc ON rc.channel_id = sc.channel_id
         WHERE sc.season_id = $1 AND rc.winner_role_id IS NOT NULL
         UNION
         SELECT DISTINCT rs.winner_role_id FROM rr_season_channels sc JOIN rumble_slaughter_config rs ON rs.channel_id = sc.channel_id
         WHERE sc.season_id = $1 AND rs.winner_role_id IS NOT NULL`,
        [seasonId]
      );
      const seasonRoleIds = roleRes.rows.map(r => r.winner_role_id);
      if (seasonRoleIds.length && seasonRoleIds.every(rid => member.roles.cache.has(rid))) {
        qualifies = true;
        break;
      }
    }
  } else {
    const matchedRoles = camp.role_ids.filter(rid => member.roles.cache.has(rid));
    qualifies = matchedRoles.length > 0;
    quantity = camp.extra_entries_allowed ? Math.max(matchedRoles.length, 1) : 1;
  }

  return { qualifies, quantity };
}

async function checkAutoSignupCampaigns(client, oldMember, newMember) {
  // Skip entirely if roles didn't actually change (nickname/boost/etc updates
  // also fire guildMemberUpdate) — avoids a DB round-trip on every unrelated update.
  const oldIds = oldMember.roles.cache;
  const newIds = newMember.roles.cache;
  if (oldIds.size === newIds.size && oldIds.every((_, id) => newIds.has(id))) return;

  const campRes = await query(
    `SELECT * FROM wheel_role_campaigns WHERE guild_id=$1 AND status='active' AND auto_signup=true`,
    [newMember.guild.id]
  );
  if (!campRes.rows.length) return;

  for (const camp of campRes.rows) {
    const { qualifies, quantity } = await checkCampaignQualification(camp, newMember);

    if (qualifies) {
      await query(
        `INSERT INTO wheel_role_campaign_entries (campaign_id, user_id, quantity, currently_qualified, last_qualified_at)
         VALUES ($1,$2,$3,true,NOW())
         ON CONFLICT (campaign_id, user_id) DO UPDATE SET
           quantity = $3, currently_qualified = true, last_qualified_at = NOW()`,
        [camp.id, newMember.id, quantity]
      ).catch(() => {});
    } else {
      await query(
        `UPDATE wheel_role_campaign_entries SET currently_qualified=false WHERE campaign_id=$1 AND user_id=$2`,
        [camp.id, newMember.id]
      ).catch(() => {});
    }
  }
}

async function roleBonusAdd(interaction) {
  const role = interaction.options.getRole('role');
  const bonus = interaction.options.getInteger('bonus');

  if (bonus <= 0) {
    return interaction.reply({ content: e('wrong') + ' Bonus must be a positive number.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  await query(
    'INSERT INTO wheel_role_bonuses (guild_id, role_id, role_name, bonus_entries, added_by) VALUES ($1,$2,$3,$4,$5) ' +
    'ON CONFLICT (guild_id, role_id) DO UPDATE SET bonus_entries=$4, role_name=$3',
    [interaction.guildId, role.id, role.name, bonus, interaction.user.id]
  );

  await interaction.editReply({ content: e('checkmark') + ' Set ' + role.toString() + ' to give +' + bonus + ' bonus wheel entries.' });
}

async function roleBonusList(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const res = await query('SELECT role_id, role_name, bonus_entries FROM wheel_role_bonuses WHERE guild_id=$1 ORDER BY bonus_entries DESC', [interaction.guildId]);

  if (!res.rows.length) {
    return interaction.editReply({ content: 'No role bonuses configured yet. Use /wheel role-bonus-add to set one up.' });
  }

  const embed = baseEmbed(e('diamond') + ' Wheel Role Bonuses', COLORS.tbppurple, interaction.guild ? interaction.guild.name : null);
  for (const row of res.rows) {
    const liveRole = await interaction.guild.roles.fetch(row.role_id).catch(() => null);
    const displayName = liveRole ? liveRole.name : `${row.role_name} (deleted role)`;
    embed.addFields({ name: displayName, value: '+' + row.bonus_entries + ' entries', inline: true });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function roleBonusRemove(interaction) {
  const role = interaction.options.getRole('role');
  await interaction.deferReply({ ephemeral: true });

  const res = await query('DELETE FROM wheel_role_bonuses WHERE guild_id=$1 AND role_id=$2 RETURNING role_name', [interaction.guildId, role.id]);

  if (!res.rows.length) {
    return interaction.editReply({ content: e('wrong') + ' That role had no bonus configured.' });
  }

  await interaction.editReply({ content: e('checkmark') + ' Removed bonus entries for ' + role.toString() + '.' });
}

async function spinPrizes(interaction) {
  const rawPrizes = interaction.options.getString('prizes');
  const winner = interaction.options.getUser('winner');
  const paletteKey = interaction.options.getString('palette');
  const colors = paletteKey ? getPaletteColors(paletteKey) : DEFAULT_COLORS;

  const prizes = parseManualEntries(rawPrizes);
  if (!prizes.length) {
    return interaction.reply({ content: e('wrong') + ' No prizes provided.', ephemeral: true });
  }

  const prizeWon = await sendWheelResult(
    interaction, prizes, colors,
    '<a:purplesparkle:1512912828489793626>' + ' Prize Wheel \u2014 ' + winner.username,
    e('trophies') + ' Prize Won',
    [{ name: e('members') + ' Winner', value: '<@' + winner.id + '>', inline: true }]
  );

  const sinsAmount = parseSinsAmount(prizeWon);
  if (sinsAmount) {
    const hostBalance = await getBalance(interaction.user.id);
    if (hostBalance === null || Number(hostBalance) < sinsAmount) {
      await interaction.followUp({ content: e('wrong') + ' Wheel landed on ' + sinsAmount + ' Sins, but you don\'t have enough to cover it (need ' + sinsAmount.toLocaleString() + ', you have ' + Number(hostBalance || 0).toLocaleString() + '). No Sins were awarded — this comes out of your own wallet.' });
    } else {
      try {
        await adjustBalance(interaction.user.id, interaction.user.username, -sinsAmount);
        const newBalance = await adjustBalance(winner.id, winner.username, sinsAmount);
        await interaction.followUp({ content: e('checkmark') + ' Awarded **' + sinsAmount + '** Sins to <@' + winner.id + '> from your wallet! Their new balance: **' + newBalance.toLocaleString() + '**' });
      } catch (err) {
        console.error('[Wheel] Sins award failed:', err.message);
        await interaction.followUp({ content: e('wrong') + ' Wheel landed on Sins but the award failed to process. Please award manually with /sins give.' });
      }
    }
  }
}

async function spinCombo(interaction) {
  const rawEntries = interaction.options.getString('entries');
  const rawPrizes = interaction.options.getString('prizes');
  const paletteKey = interaction.options.getString('palette');
  const colors = paletteKey ? getPaletteColors(paletteKey) : DEFAULT_COLORS;

  await interaction.deferReply();

  const entryList = parseManualEntries(rawEntries);
  const prizeList = parseManualEntries(rawPrizes);
  if (!entryList.length || !prizeList.length) {
    return interaction.editReply({ content: e('wrong') + ' Need both entries and prizes.' });
  }
  const entryObjects = await resolveMentionsToEntries(interaction, entryList);
  const textEntries = entryObjects.map(function(o) { return o.text; });

  let winnerResult;
  try {
    winnerResult = await spinWheel(textEntries, colors);
  } catch (err) {
    console.error('[Wheel] Winner spin failed:', err.message);
    return interaction.editReply({ content: e('wrong') + ' Winner spin failed: ' + err.message });
  }
  const winnerEntry = entryObjects[winnerResult.winnerIndex];
  const winnerDisplay = formatWinnerMention(winnerEntry);
  const winnerPlainText = winnerEntry ? winnerEntry.text : 'Unknown';

  const winnerAttachment = new AttachmentBuilder(winnerResult.buffer, { name: 'wheel-winner.gif' });
  const winnerEmbed = baseEmbed(e('confetti') + ' Step 1 \u2014 Picking the Winner', COLORS.tbppurple, interaction.guild ? interaction.guild.name : null)
    .setImage('attachment://wheel-winner.gif')
    .addFields({ name: e('trophies') + ' Winner', value: winnerDisplay, inline: false });

  await interaction.editReply({ embeds: [winnerEmbed], files: [winnerAttachment] });

  let prizeResult;
  try {
    prizeResult = await spinWheel(prizeList, colors);
  } catch (err) {
    console.error('[Wheel] Prize spin failed:', err.message);
    return interaction.followUp({ content: e('wrong') + ' Prize spin failed: ' + err.message });
  }
  const prizeName = prizeResult.winner;

  const prizeAttachment = new AttachmentBuilder(prizeResult.buffer, { name: 'wheel-prize.gif' });
  const prizeEmbed = baseEmbed('<a:purplesparkle:1512912828489793626>' + ' Step 2 \u2014 ' + winnerPlainText + '\u2019s Prize', COLORS.tbppurple, interaction.guild ? interaction.guild.name : null)
    .setImage('attachment://wheel-prize.gif')
    .addFields(
      { name: e('members') + ' Winner', value: winnerDisplay, inline: true },
      { name: e('trophies') + ' Prize', value: prizeName, inline: true },
    );

  await interaction.followUp({ embeds: [prizeEmbed], files: [prizeAttachment] });

  const sinsAmount = parseSinsAmount(prizeName);
  if (sinsAmount) {
    if (winnerEntry && winnerEntry.userId) {
      const hostBalance = await getBalance(interaction.user.id);
      if (hostBalance === null || Number(hostBalance) < sinsAmount) {
        await interaction.followUp({ content: e('wrong') + ' Wheel landed on ' + sinsAmount + ' Sins, but you don\u2019t have enough to cover it (need ' + sinsAmount.toLocaleString() + ', you have ' + Number(hostBalance || 0).toLocaleString() + '). No Sins were awarded \u2014 this comes out of your own wallet.' });
      } else {
        try {
          await adjustBalance(interaction.user.id, interaction.user.username, -sinsAmount);
          const newBalance = await adjustBalance(winnerEntry.userId, winnerEntry.text, sinsAmount);
          await interaction.followUp({ content: e('checkmark') + ' Awarded **' + sinsAmount + '** Sins to ' + winnerDisplay + ' from your wallet! Their new balance: **' + newBalance.toLocaleString() + '**' });
        } catch (err) {
          console.error('[Wheel] Sins award failed:', err.message);
          await interaction.followUp({ content: e('wrong') + ' Wheel landed on Sins but the award failed to process. Please award manually with /sins give.' });
        }
      }
    } else {
      await interaction.followUp({ content: e('atention') + ' Wheel landed on Sins, but the winner wasn\u2019t a recognized Discord member \u2014 please award manually with /sins give.' });
    }
  }
}

module.exports.checkAutoSignupCampaigns = checkAutoSignupCampaigns;
module.exports.handleCampaignReactionAdd = handleCampaignReactionAdd;
