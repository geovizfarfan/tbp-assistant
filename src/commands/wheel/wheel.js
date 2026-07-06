const {
  SlashCommandBuilder, AttachmentBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { baseEmbed, COLORS } = require('../../utils/embeds');
const { spinWheel } = require('../../utils/wheelRenderer');
const { getPaletteColors, getPaletteChoices } = require('../../utils/wheelPalettes');
const { query } = require('../../utils/database');
const { adjustBalance } = require('../../utils/playAndRegretDb');


// Temporary wheel session store for re-roll/remove
const wheelSessions = new Map();

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

const DEFAULT_COLORS = ['#ff00c1', '#9600ff', '#4900ff', '#00b8ff', '#00fff9', '#fff200'];

async function handleWheelButton(interaction, client) {
  const [action, sessionId] = interaction.customId.split(':');
  const session = wheelSessions.get(sessionId);

  if (!session) {
    return interaction.reply({ content: 'Session expired. Please spin again.', ephemeral: true });
  }

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
    const embed = baseEmbed(e('reroll') + ' Re-roll', COLORS.tbppurple, null)
      .setImage('attachment://wheel.gif')
      .addFields({ name: e('trophies') + ' Winner', value: winnerDisplay, inline: false })
      .setFooter({ text: entries.length + ' entries remaining' });

    await interaction.editReply({ embeds: [embed], files: [attachment], components: [buildWheelButtons(sessionId, entries.length)] });
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
    wheelSessions.set(sessionId, session);

    if (session.entries.length === 0) {
      return interaction.editReply({ content: 'No entries remaining!', components: [] });
    }

    // Last man standing — only 1 left
    if (session.entries.length === 1) {
      const last = session.entries[0];
      const lastDisplay = formatWinnerMention(last);
      const embed = baseEmbed(e('purplesparkle') + ' Last Man Standing', COLORS.tbppurple, null)
        .addFields(
          { name: '🏆 WINNER', value: lastDisplay, inline: false },
          { name: e('xemoji') + ' Eliminated', value: session.eliminated.join(', ').slice(0, 1024), inline: false },
        )
        .setFooter({ text: 'Last one standing!' });
      wheelSessions.delete(sessionId);
      return interaction.editReply({ embeds: [embed], files: [], components: [] });
    }

    const textEntries = session.entries.map(o => o.text);
    let result;
    try { result = await spinWheel(textEntries, session.colors); }
    catch(err) { return interaction.followUp({ content: 'Spin failed: ' + err.message, ephemeral: true }); }

    const winnerEntry = session.entries[result.winnerIndex];
    const winnerDisplay = formatWinnerMention(winnerEntry);

    const attachment = new AttachmentBuilder(result.buffer, { name: 'wheel.gif' });
    const embed = baseEmbed(e('xemoji') + ' Remove & Spin', COLORS.tbppurple, null)
      .setImage('attachment://wheel.gif')
      .addFields(
        { name: e('trophies') + ' Eliminated Next', value: winnerDisplay, inline: false },
        { name: e('xemoji') + ' Eliminated So Far', value: session.eliminated.join(', ').slice(0, 1024), inline: false },
      )
      .setFooter({ text: session.entries.length + ' entries remaining' });

    await interaction.editReply({ embeds: [embed], files: [attachment], components: [buildWheelButtons(sessionId, session.entries.length)] });
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
      .setName('role-bonus-add')
      .setDescription('Add or update a role\'s bonus wheel entries')
      .addRoleOption(o => o.setName('role').setDescription('Role to configure').setRequired(true))
      .addIntegerOption(o => o.setName('bonus').setDescription('Extra entries per member with this role').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('role-bonus-list')
      .setDescription('View all configured role bonuses for the wheel')
    )
    .addSubcommand(sub => sub
      .setName('role-bonus-remove')
      .setDescription('Remove a role\'s bonus wheel entries')
      .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true))
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
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
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


function buildWheelButtons(sessionId, remaining) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wheel_reroll:${sessionId}`)
      .setLabel('Re-roll')
      .setEmoji('<a:reroll:1523784999877349577>')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(remaining < 1),
    new ButtonBuilder()
      .setCustomId(`wheel_remove:${sessionId}`)
      .setLabel('Remove & Spin')
      .setEmoji('1523784948685733960')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(remaining <= 1),
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
  const sessionId = `wheel_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  wheelSessions.set(sessionId, {
    entries: entryObjects,
    colors,
    eliminated: [],
    guildId: interaction.guild?.id,
  });
  setTimeout(() => wheelSessions.delete(sessionId), 30 * 60 * 1000);

  const attachment = new AttachmentBuilder(result.buffer, { name: 'wheel.gif' });
  const embed = baseEmbed(e('wheelspin') + ' Wheel Spin \u2014 Members', COLORS.tbppurple, interaction.guild ? interaction.guild.name : null)
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
    embed.addFields({ name: '<@&' + row.role_id + '>', value: '+' + row.bonus_entries + ' entries', inline: true });
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
    e('purplesparkle') + ' Prize Wheel \u2014 ' + winner.username,
    e('trophies') + ' Prize Won',
    [{ name: e('members') + ' Winner', value: '<@' + winner.id + '>', inline: true }]
  );

  const sinsAmount = parseSinsAmount(prizeWon);
  if (sinsAmount) {
    try {
      const newBalance = await adjustBalance(winner.id, winner.username, sinsAmount);
      await interaction.followUp({ content: e('checkmark') + ' Awarded **' + sinsAmount + '** Sins to <@' + winner.id + '>! New balance: **' + newBalance.toLocaleString() + '**' });
    } catch (err) {
      console.error('[Wheel] Sins award failed:', err.message);
      await interaction.followUp({ content: e('wrong') + ' Wheel landed on Sins but the award failed to process. Please award manually with /sins give.' });
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
  const prizeEmbed = baseEmbed(e('purplesparkle') + ' Step 2 \u2014 ' + winnerPlainText + '\u2019s Prize', COLORS.tbppurple, interaction.guild ? interaction.guild.name : null)
    .setImage('attachment://wheel-prize.gif')
    .addFields(
      { name: e('members') + ' Winner', value: winnerDisplay, inline: true },
      { name: e('trophies') + ' Prize', value: prizeName, inline: true },
    );

  await interaction.followUp({ embeds: [prizeEmbed], files: [prizeAttachment] });

  const sinsAmount = parseSinsAmount(prizeName);
  if (sinsAmount) {
    if (winnerEntry && winnerEntry.userId) {
      try {
        const newBalance = await adjustBalance(winnerEntry.userId, winnerEntry.text, sinsAmount);
        await interaction.followUp({ content: e('checkmark') + ' Awarded **' + sinsAmount + '** Sins to ' + winnerDisplay + '! New balance: **' + newBalance.toLocaleString() + '**' });
      } catch (err) {
        console.error('[Wheel] Sins award failed:', err.message);
        await interaction.followUp({ content: e('wrong') + ' Wheel landed on Sins but the award failed to process. Please award manually with /sins give.' });
      }
    } else {
      await interaction.followUp({ content: e('atention') + ' Wheel landed on Sins, but the winner wasn\u2019t a recognized Discord member \u2014 please award manually with /sins give.' });
    }
  }
}
