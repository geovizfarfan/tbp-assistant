const {
  SlashCommandBuilder, AttachmentBuilder, EmbedBuilder,
} = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { baseEmbed, COLORS } = require('../../utils/embeds');
const { spinWheel } = require('../../utils/wheelApi');
const { getPaletteColors, getPaletteChoices } = require('../../utils/wheelPalettes');

function buildPaletteOption(opt) {
  return opt.setName('palette').setDescription('Wheel color theme').setRequired(false).addChoices(...getPaletteChoices());
}

function parseManualEntries(raw) {
  return raw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

async function resolveMentionsToNames(interaction, rawEntries) {
  const resolved = [];
  for (const entry of rawEntries) {
    const match = entry.match(/<@!?(\d+)>/);
    if (match) {
      try {
        const member = await interaction.guild.members.fetch(match[1]);
        resolved.push(member.displayName || member.user.username);
      } catch {
        resolved.push(entry);
      }
    } else {
      resolved.push(entry);
    }
  }
  return resolved;
}

module.exports = {
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
      .setDescription('Spin a wheel with bonus entries for a specific role')
      .addStringOption(o => o.setName('entries').setDescription('Comma-separated: @usera, @userb, @userc').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role that gets bonus entries').setRequired(true))
      .addIntegerOption(o => o.setName('bonus').setDescription('Extra entries added per member with that role').setRequired(true))
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
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'members') return spinMembers(interaction);
    if (sub === 'reactions') return spinReactions(interaction);
    if (sub === 'boosted') return spinBoosted(interaction);
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

  const attachment = new AttachmentBuilder(result.animation, { name: 'wheel.' + result.imageFormat });
  const winnerText = result.winner && result.winner.text ? result.winner.text : 'Unknown';

  const embed = baseEmbed(embedTitle, COLORS.tbppurple, interaction.guild ? interaction.guild.name : null)
    .setImage('attachment://wheel.' + result.imageFormat)
    .addFields({ name: fieldLabel, value: winnerText, inline: false });

  for (const f of extraFields) embed.addFields(f);

  await interaction.editReply({ embeds: [embed], files: [attachment] });
  return winnerText;
}

async function spinMembers(interaction) {
  const raw = interaction.options.getString('entries');
  const paletteKey = interaction.options.getString('palette');
  const colors = paletteKey ? getPaletteColors(paletteKey) : null;

  const rawEntries = parseManualEntries(raw);
  if (!rawEntries.length) {
    return interaction.reply({ content: e('wrong') + ' No entries provided.', ephemeral: true });
  }
  const entries = await resolveMentionsToNames(interaction, rawEntries);

  await sendWheelResult(
    interaction, entries, colors,
    e('controller') + ' Wheel Spin \u2014 Members',
    e('trophies') + ' Winner'
  );
}

async function spinReactions(interaction) {
  const link = interaction.options.getString('link');
  const emojiFilter = interaction.options.getString('emoji');
  const paletteKey = interaction.options.getString('palette');
  const colors = paletteKey ? getPaletteColors(paletteKey) : null;

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

  const entries = [];
  for (const userId of uniqueUserIds) {
    try {
      const member = await interaction.guild.members.fetch(userId);
      entries.push(member.displayName || member.user.username);
    } catch {
      entries.push(userId);
    }
  }

  let result;
  try {
    result = await spinWheel(entries, colors);
  } catch (err) {
    console.error('[Wheel] Spin failed:', err.message);
    return interaction.editReply({ content: e('wrong') + ' Wheel spin failed: ' + err.message });
  }

  const attachment = new AttachmentBuilder(result.animation, { name: 'wheel.' + result.imageFormat });
  const winnerText = result.winner && result.winner.text ? result.winner.text : 'Unknown';

  const embed = baseEmbed(e('confetti') + ' Wheel Spin \u2014 Reactions', COLORS.tbppurple, interaction.guild ? interaction.guild.name : null)
    .setImage('attachment://wheel.' + result.imageFormat)
    .addFields(
      { name: e('trophies') + ' Winner', value: winnerText, inline: false },
      { name: e('member') + ' Total Entries', value: String(entries.length), inline: true },
    );

  await interaction.editReply({ embeds: [embed], files: [attachment] });
}

async function spinBoosted(interaction) {
  const raw = interaction.options.getString('entries');
  const role = interaction.options.getRole('role');
  const bonus = interaction.options.getInteger('bonus');
  const paletteKey = interaction.options.getString('palette');
  const colors = paletteKey ? getPaletteColors(paletteKey) : null;

  await interaction.deferReply();

  const rawEntries = parseManualEntries(raw);
  if (!rawEntries.length) {
    return interaction.editReply({ content: e('wrong') + ' No entries provided.' });
  }

  const entries = [];
  for (const rawEntry of rawEntries) {
    const match = rawEntry.match(/<@!?(\d+)>/);
    let displayName = rawEntry;
    let hasRole = false;

    if (match) {
      try {
        const member = await interaction.guild.members.fetch(match[1]);
        displayName = member.displayName || member.user.username;
        hasRole = member.roles.cache.has(role.id);
      } catch {
      }
    }

    entries.push(displayName);
    if (hasRole && bonus > 0) {
      for (let i = 0; i < bonus; i++) entries.push(displayName);
    }
  }

  await sendWheelResult(
    interaction, entries, colors,
    e('diamond') + ' Wheel Spin \u2014 Bonus Entries',
    e('trophies') + ' Winner',
    [{ name: e('diamond') + ' Bonus Role', value: '<@&' + role.id + '> (+' + bonus + ' entries each)', inline: true }]
  );
}

async function spinPrizes(interaction) {
  const rawPrizes = interaction.options.getString('prizes');
  const winner = interaction.options.getUser('winner');
  const paletteKey = interaction.options.getString('palette');
  const colors = paletteKey ? getPaletteColors(paletteKey) : null;

  const prizes = parseManualEntries(rawPrizes);
  if (!prizes.length) {
    return interaction.reply({ content: e('wrong') + ' No prizes provided.', ephemeral: true });
  }

  await sendWheelResult(
    interaction, prizes, colors,
    e('purplesparkle') + ' Prize Wheel \u2014 ' + winner.username,
    e('trophies') + ' Prize Won',
    [{ name: e('members') + ' Winner', value: '<@' + winner.id + '>', inline: true }]
  );
}

async function spinCombo(interaction) {
  const rawEntries = interaction.options.getString('entries');
  const rawPrizes = interaction.options.getString('prizes');
  const paletteKey = interaction.options.getString('palette');
  const colors = paletteKey ? getPaletteColors(paletteKey) : null;

  await interaction.deferReply();

  const entryList = parseManualEntries(rawEntries);
  const prizeList = parseManualEntries(rawPrizes);
  if (!entryList.length || !prizeList.length) {
    return interaction.editReply({ content: e('wrong') + ' Need both entries and prizes.' });
  }
  const resolvedEntries = await resolveMentionsToNames(interaction, entryList);

  let winnerResult;
  try {
    winnerResult = await spinWheel(resolvedEntries, colors);
  } catch (err) {
    console.error('[Wheel] Winner spin failed:', err.message);
    return interaction.editReply({ content: e('wrong') + ' Winner spin failed: ' + err.message });
  }
  const winnerName = winnerResult.winner && winnerResult.winner.text ? winnerResult.winner.text : 'Unknown';

  const winnerAttachment = new AttachmentBuilder(winnerResult.animation, { name: 'wheel-winner.' + winnerResult.imageFormat });
  const winnerEmbed = baseEmbed(e('confetti') + ' Step 1 \u2014 Picking the Winner', COLORS.tbppurple, interaction.guild ? interaction.guild.name : null)
    .setImage('attachment://wheel-winner.' + winnerResult.imageFormat)
    .addFields({ name: e('trophies') + ' Winner', value: winnerName, inline: false });

  await interaction.editReply({ embeds: [winnerEmbed], files: [winnerAttachment] });

  let prizeResult;
  try {
    prizeResult = await spinWheel(prizeList, colors);
  } catch (err) {
    console.error('[Wheel] Prize spin failed:', err.message);
    return interaction.followUp({ content: e('wrong') + ' Prize spin failed: ' + err.message });
  }
  const prizeName = prizeResult.winner && prizeResult.winner.text ? prizeResult.winner.text : 'Unknown';

  const prizeAttachment = new AttachmentBuilder(prizeResult.animation, { name: 'wheel-prize.' + prizeResult.imageFormat });
  const prizeEmbed = baseEmbed(e('purplesparkle') + ' Step 2 \u2014 ' + winnerName + '\u2019s Prize', COLORS.tbppurple, interaction.guild ? interaction.guild.name : null)
    .setImage('attachment://wheel-prize.' + prizeResult.imageFormat)
    .addFields(
      { name: e('members') + ' Winner', value: winnerName, inline: true },
      { name: e('trophies') + ' Prize', value: prizeName, inline: true },
    );

  await interaction.followUp({ embeds: [prizeEmbed], files: [prizeAttachment] });
}
