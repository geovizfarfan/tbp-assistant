const {
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Run a live giveaway — members react to enter, winner(s) picked automatically')

    .addSubcommand(sub => sub
      .setName('start')
      .setDescription('Start a live giveaway')
      .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
      .addIntegerOption(o => o.setName('duration_amount').setDescription('How long the giveaway runs').setRequired(true))
      .addStringOption(o => o.setName('duration_unit').setDescription('Unit for duration').setRequired(true).addChoices(
        { name: 'Minutes', value: 'minutes' },
        { name: 'Hours', value: 'hours' },
        { name: 'Days', value: 'days' },
      ))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners (default 1)'))
      .addAttachmentOption(o => o.setName('thumbnail').setDescription('Thumbnail image for the giveaway embed'))
      .addStringOption(o => o.setName('entry_emoji').setDescription('Emoji members react with to enter (default: 🎉)'))
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post in (default: current channel)'))
      .addIntegerOption(o => o.setName('claim_hours').setDescription('Hours winner has to open a ticket and claim (default: server setting)'))
      .addChannelOption(o => o.setName('ticket_channel').setDescription('Channel winner should open a ticket in to claim')))

    .addSubcommand(sub => sub
      .setName('end')
      .setDescription('End a live giveaway early and pick winner(s) now')
      .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('cancel')
      .setDescription('Cancel a live giveaway with no winner picked')
      .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('edit')
      .setDescription('Edit a live giveaway (host only) — only fills in fields you provide')
      .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true))
      .addStringOption(o => o.setName('prize').setDescription('New prize text'))
      .addIntegerOption(o => o.setName('winners').setDescription('New number of winners'))
      .addIntegerOption(o => o.setName('duration_amount').setDescription('New duration FROM NOW — replaces the current end time'))
      .addStringOption(o => o.setName('duration_unit').setDescription('Unit for duration_amount').addChoices(
        { name: 'Minutes', value: 'minutes' }, { name: 'Hours', value: 'hours' }, { name: 'Days', value: 'days' },
      ))
      .addAttachmentOption(o => o.setName('thumbnail').setDescription('New thumbnail image')))

    .addSubcommand(sub => sub
      .setName('reroll')
      .setDescription('Pick new winner(s) for an ended giveaway')
      .addIntegerOption(o => o.setName('id').setDescription('Giveaway ID').setRequired(true))
      .addIntegerOption(o => o.setName('count').setDescription('How many new winners to pick (default: same as original)')))

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List active live giveaways'))

    .addSubcommandGroup(group => group
      .setName('bonusrole')
      .setDescription('Manage the reusable bonus-entry role library')
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Add (or update) a role that grants bonus entries')
        .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))
        .addIntegerOption(o => o.setName('entries').setDescription('Extra entries this role grants').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Remove a role from the bonus-entry library')
        .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('list')
        .setDescription('List all configured bonus-entry roles')))

    .addSubcommandGroup(group => group
      .setName('requiredrole')
      .setDescription('Manage the reusable entry-requirement role library')
      .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Add one or more roles to the entry-requirement library')
        .addStringOption(o => o.setName('roles').setDescription('Type @ to mention roles — add as many as you want, e.g. @Role1 @Role2 @Role3').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Remove a role from the entry-requirement library')
        .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
      .addSubcommand(sub => sub
        .setName('list')
        .setDescription('List all configured entry-requirement roles'))),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === 'bonusrole') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
      }
      if (sub === 'add')    return bonusRoleAdd(interaction);
      if (sub === 'remove') return bonusRoleRemove(interaction);
      if (sub === 'list')   return bonusRoleList(interaction);
      return;
    }

    if (group === 'requiredrole') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
      }
      if (sub === 'add')    return requiredRoleAdd(interaction);
      if (sub === 'remove') return requiredRoleRemove(interaction);
      if (sub === 'list')   return requiredRoleList(interaction);
      return;
    }

    if (sub === 'start')  return startGiveaway(interaction);
    if (sub === 'end')    return endGiveawayLive(interaction);
    if (sub === 'cancel') return cancelGiveaway(interaction);
    if (sub === 'edit')   return editGiveaway(interaction);
    if (sub === 'reroll') return rerollGiveaway(interaction);
    if (sub === 'list')   return listLiveGiveaways(interaction);
  },

  scheduleGiveawayEnd,
  finishGiveaway,
  handleCheckEntriesButton,
};

// ═══════════════════════════════════════════════════════════════════════
// Bonus role library (admin config)
// ═══════════════════════════════════════════════════════════════════════

async function bonusRoleAdd(interaction) {
  const role = interaction.options.getRole('role');
  const entries = interaction.options.getInteger('entries');
  if (entries <= 0) return interaction.reply({ content: `${e('wrong')} Entries must be greater than 0.`, ephemeral: true });

  await query(`
    INSERT INTO giveaway_bonus_roles (guild_id, role_id, bonus_entries)
    VALUES ($1,$2,$3)
    ON CONFLICT (guild_id, role_id) DO UPDATE SET bonus_entries = EXCLUDED.bonus_entries
  `, [interaction.guildId, role.id, entries]);

  return interaction.reply({ content: `${e('checkmark')} <@&${role.id}> now grants **+${entries}** bonus ${entries === 1 ? 'entry' : 'entries'} when selected for a giveaway.`, ephemeral: true });
}

async function bonusRoleRemove(interaction) {
  const role = interaction.options.getRole('role');
  const del = await query('DELETE FROM giveaway_bonus_roles WHERE guild_id=$1 AND role_id=$2 RETURNING id', [interaction.guildId, role.id]);
  if (!del.rows.length) return interaction.reply({ content: `${e('wrong')} That role isn't in the bonus-entry library.`, ephemeral: true });
  return interaction.reply({ content: `${e('checkmark')} Removed <@&${role.id}> from the bonus-entry library.`, ephemeral: true });
}

async function bonusRoleList(interaction) {
  const res = await query('SELECT * FROM giveaway_bonus_roles WHERE guild_id=$1 ORDER BY bonus_entries DESC', [interaction.guildId]);
  if (!res.rows.length) return interaction.reply({ content: 'No bonus-entry roles configured yet.', ephemeral: true });

  const lines = res.rows.map(r => `<@&${r.role_id}> — +${r.bonus_entries} ${r.bonus_entries === 1 ? 'entry' : 'entries'}`).join('\n');
  return interaction.reply({ embeds: [baseEmbed(`${e('trophies')} Bonus Entry Roles`, COLORS.tbppurple, interaction.guild?.name).setDescription(lines)], ephemeral: true });
}

// ═══════════════════════════════════════════════════════════════════════
// Required role library (admin config) — members must have ALL selected
// ═══════════════════════════════════════════════════════════════════════

async function requiredRoleAdd(interaction) {
  const rolesText = interaction.options.getString('roles');
  const roleIds = [...new Set([...rolesText.matchAll(/<@&(\d+)>/g)].map(m => m[1]))];

  if (!roleIds.length) {
    return interaction.reply({ content: `${e('wrong')} No role mentions found — type \`@\` and pick roles from Discord's suggestions.`, ephemeral: true });
  }

  const added = [];
  const invalid = [];
  for (const roleId of roleIds) {
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) { invalid.push(roleId); continue; }
    await query(`
      INSERT INTO giveaway_required_roles (guild_id, role_id) VALUES ($1,$2)
      ON CONFLICT (guild_id, role_id) DO NOTHING
    `, [interaction.guildId, roleId]);
    added.push(role.id);
  }

  const lines = [];
  if (added.length) lines.push(`${e('checkmark')} Added ${added.map(id => `<@&${id}>`).join(', ')} to the entry-requirement library.`);
  if (invalid.length) lines.push(`${e('wrong')} Couldn't find ${invalid.length} of the mentioned role(s) — skipped.`);

  return interaction.reply({ content: lines.join('\n') || `${e('wrong')} Nothing added.`, ephemeral: true });
}

async function requiredRoleRemove(interaction) {
  const role = interaction.options.getRole('role');
  const del = await query('DELETE FROM giveaway_required_roles WHERE guild_id=$1 AND role_id=$2 RETURNING id', [interaction.guildId, role.id]);
  if (!del.rows.length) return interaction.reply({ content: `${e('wrong')} That role isn't in the entry-requirement library.`, ephemeral: true });
  return interaction.reply({ content: `${e('checkmark')} Removed <@&${role.id}> from the entry-requirement library.`, ephemeral: true });
}

async function requiredRoleList(interaction) {
  const res = await query('SELECT * FROM giveaway_required_roles WHERE guild_id=$1', [interaction.guildId]);
  if (!res.rows.length) return interaction.reply({ content: 'No entry-requirement roles configured yet.', ephemeral: true });

  const lines = res.rows.map(r => `<@&${r.role_id}>`).join('\n');
  return interaction.reply({ embeds: [baseEmbed(`${e('rules')} Entry-Requirement Roles`, COLORS.tbppurple, interaction.guild?.name).setDescription(lines)], ephemeral: true });
}

// ═══════════════════════════════════════════════════════════════════════
// Live giveaway system
// ═══════════════════════════════════════════════════════════════════════

function buildGiveawayEmbed(gw, bonusRoles = [], ended = false, winnerIds = null, guildName = '', hostName = '') {
  const lines = [];

  lines.push(`-# Giveaway ID: ${gw.id}`);
  lines.push(`# ${gw.prize}`);

  if (ended) {
    lines.push(winnerIds?.length
      ? `${e('trophies')} Winner${winnerIds.length > 1 ? 's' : ''}: ${winnerIds.map(id => `<@${id}>`).join(', ')}`
      : `${e('wrong')} Not enough eligible entries — no winner could be picked.`);
  } else {
    lines.push(`React with ${gw.entry_emoji} to enter!`);
    lines.push('');
    lines.push(`${e('trophies')} **Winners:** ${gw.winners_count}`);
    lines.push(`${e('member')} **Hosted by:** <@${gw.host_id}>`);
    lines.push(`${e('role')} **Ends:** ${tsF(gw.ends_at)} (${tsR(gw.ends_at)})`);
    if (gw.required_role_ids?.length) lines.push(`${e('rules')} **Requirement:** Must have all of ${gw.required_role_ids.map(id => `<@&${id}>`).join(', ')}`);
    if (bonusRoles.length) {
      lines.push(`${e('purplesparkle')} **Bonus Entries:**`);
      for (const r of bonusRoles) lines.push(`-# ・<@&${r.role_id}> (+${r.bonus_entries})`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(ended ? 0x5B2C8C : 0xB57EDC)
    .setTitle(`${e('gift')} ${ended ? 'Giveaway Ended' : 'Giveaway'}`)
    .setDescription(lines.join('\n'));

  if (guildName || hostName) {
    embed.setFooter({ text: [guildName, hostName].filter(Boolean).join('・') });
  }

  if (gw.thumbnail_url) embed.setThumbnail(gw.thumbnail_url);

  return embed;
}

// Discord.js keys the reactions cache by just the numeric ID for custom emojis
// (not the full <name:id> text), but by the raw character for unicode emojis.
// entry_emoji is stored as whatever the host typed, so this bridges the gap.
function reactionCacheKey(entryEmoji) {
  const customMatch = entryEmoji?.match(/^<a?:\w+:(\d+)>$/);
  return customMatch ? customMatch[1] : entryEmoji;
}

async function fetchAllReactors(message, entryEmoji) {
  const reaction = message.reactions.cache.get(reactionCacheKey(entryEmoji));
  if (!reaction) return [];

  let allUsers = [];
  let after = undefined;
  while (true) {
    const batch = await reaction.users.fetch({ limit: 100, after }).catch(() => null);
    if (!batch || !batch.size) break;
    allUsers.push(...batch.values());
    if (batch.size < 100) break;
    after = [...batch.values()].pop().id;
  }
  return allUsers.filter(u => !u.bot);
}

async function handleCheckEntriesButton(interaction) {
  const id = parseInt(interaction.customId.split(':')[1], 10);
  await interaction.deferReply({ ephemeral: true });

  const gwRes = await query('SELECT * FROM giveaway_events WHERE id = $1', [id]);
  if (!gwRes.rows.length) return interaction.editReply(`${e('wrong')} That giveaway no longer exists.`);
  const gw = gwRes.rows[0];

  if (gw.status !== 'active') return interaction.editReply(`${e('wrong')} That giveaway has already ended.`);

  const channel = await interaction.client.channels.fetch(gw.channel_id).catch(() => null);
  const message = channel ? await channel.messages.fetch(gw.message_id).catch(() => null) : null;
  if (!message) return interaction.editReply(`${e('wrong')} Couldn't find the giveaway message.`);

  const reaction = message.reactions.cache.get(reactionCacheKey(gw.entry_emoji));
  const reactedUsers = reaction ? await reaction.users.fetch().catch(() => null) : null;
  const hasReacted = reactedUsers?.has(interaction.user.id) || false;

  if (!hasReacted) {
    return interaction.editReply(`${e('wrong')} You haven't entered yet! React with ${gw.entry_emoji} to join.`);
  }

  if (gw.required_role_ids?.length && !gw.required_role_ids.every(rid => interaction.member.roles.cache.has(rid))) {
    const missing = gw.required_role_ids.filter(rid => !interaction.member.roles.cache.has(rid));
    return interaction.editReply(`${e('wrong')} You've reacted, but you're missing required role(s): ${missing.map(rid => `<@&${rid}>`).join(', ')} — you won't be included in the draw.`);
  }

  let tickets = 1;
  const bonusLines = [];
  if (gw.bonus_role_ids?.length) {
    const bonusRes = await query('SELECT role_id, bonus_entries FROM giveaway_bonus_roles WHERE guild_id=$1 AND role_id = ANY($2)', [gw.guild_id, gw.bonus_role_ids]);
    for (const r of bonusRes.rows) {
      if (interaction.member.roles.cache.has(r.role_id)) {
        tickets += r.bonus_entries;
        bonusLines.push(`-# ・<@&${r.role_id}> (+${r.bonus_entries})`);
      }
    }
  }

  const lines = [`${e('checkmark')} You're entered! You have **${tickets}** ${tickets === 1 ? 'entry' : 'entries'} in this giveaway.`];
  if (bonusLines.length) {
    lines.push('', `${e('purplesparkle')} **From your roles:**`, ...bonusLines);
  }

  return interaction.editReply(lines.join('\n'));
}

async function buildWeightedEntrants(guild, users, gw) {
  // Load this giveaway's configured bonus roles (id -> entries)
  let bonusMap = new Map();
  if (gw.bonus_role_ids?.length) {
    const res = await query(
      'SELECT role_id, bonus_entries FROM giveaway_bonus_roles WHERE guild_id=$1 AND role_id = ANY($2)',
      [gw.guild_id, gw.bonus_role_ids]
    );
    bonusMap = new Map(res.rows.map(r => [r.role_id, r.bonus_entries]));
  }

  const weighted = [];
  const ineligible = [];

  for (const user of users) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) continue;

    if (gw.required_role_ids?.length && !gw.required_role_ids.every(id => member.roles.cache.has(id))) {
      ineligible.push(user.id);
      continue;
    }

    let tickets = 1;
    for (const [roleId, bonus] of bonusMap) {
      if (member.roles.cache.has(roleId)) tickets += bonus;
    }
    for (let i = 0; i < tickets; i++) weighted.push(user.id);
  }

  return { weighted, ineligible };
}

function pickUniqueWinners(weightedPool, count) {
  const shuffled = [...weightedPool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const winners = [];
  for (const id of shuffled) {
    if (!winners.includes(id)) winners.push(id);
    if (winners.length >= count) break;
  }
  return winners;
}

async function finishGiveaway(client, giveawayId) {
  const gwRes = await query('SELECT * FROM giveaway_events WHERE id = $1', [giveawayId]);
  if (!gwRes.rows.length) return;
  const gw = gwRes.rows[0];
  if (gw.status !== 'active') return; // already finished — avoid double-processing

  const channel = await client.channels.fetch(gw.channel_id).catch(() => null);
  if (!channel) {
    await query('UPDATE giveaway_events SET status=$1, ended_at=NOW() WHERE id=$2', ['ended', giveawayId]);
    return;
  }

  const message = await channel.messages.fetch(gw.message_id).catch(() => null);
  let winners = [];

  if (message) {
    const reactors = await fetchAllReactors(message, gw.entry_emoji);
    const { weighted, ineligible } = await buildWeightedEntrants(channel.guild, reactors, gw);
    winners = pickUniqueWinners(weighted, gw.winners_count);

    // Clean up reactions from anyone who didn't meet the role requirement
    for (const userId of ineligible) {
      await message.reactions.cache.get(reactionCacheKey(gw.entry_emoji))?.users.remove(userId).catch(() => {});
    }
  }

  await query('UPDATE giveaway_events SET status=$1, ended_at=NOW(), winner_ids=$2 WHERE id=$3',
    ['ended', winners, giveawayId]);

  // Record wins + payout reminders for each winner, same as /raffle does
  for (const winnerId of winners) {
    const winnerMember = await channel.guild.members.fetch(winnerId).catch(() => null);
    const username = winnerMember?.user?.username || 'Unknown';
    const hostWonOwnGiveaway = gw.host_id === winnerId;

    await query(
      `INSERT INTO member_wins (guild_id, user_id, username, type, ref_id, prize, prize_amount, currency, host_id, won_at)
       VALUES ($1,$2,$3,'giveaway',$4,$5,$6,$7,$8,NOW())`,
      [gw.guild_id, winnerId, username, gw.id, gw.prize, null, null, gw.host_id]
    );

    if (!hostWonOwnGiveaway) {
      await query(
        `INSERT INTO payout_reminders (type, ref_id, host_id, winner_id, prize, guild_id, channel_id)
         VALUES ('giveaway',$1,$2,$3,$4,$5,$6)`,
        [gw.id, gw.host_id, winnerId, gw.prize, gw.guild_id, gw.channel_id]
      );
    }
  }

  if (message) {
    const hostMember = await channel.guild.members.fetch(gw.host_id).catch(() => null);
    await message.edit({ embeds: [buildGiveawayEmbed(gw, [], true, winners, channel.guild.name, hostMember?.user?.username || '')], components: [] }).catch(() => {});
    await message.reactions.removeAll().catch(() => {});
  }

  if (winners.length) {
    const claimLine = gw.ticket_channel_id
      ? `-# Claim time: ${gw.claim_hours || 6} hrs. Open a ticket to claim prize <#${gw.ticket_channel_id}>.`
      : `-# Claim time: ${gw.claim_hours || 6} hrs. Open a ticket to claim your prize.`;

    await channel.send({
      content: `<a:purplesparkle:1512912828489793626> Congratulations ${winners.map(id => `<@${id}>`).join(', ')}! You won **${gw.prize}**!\n**Hosted by:** <@${gw.host_id}>\n${claimLine}`,
    }).catch(() => {});
  } else {
    await channel.send({
      content: `${e('wrong')} Giveaway for **${gw.prize}** ended with no eligible entries.`,
    }).catch(() => {});
  }
}

const activeGiveawayTimers = new Map();

function scheduleGiveawayEnd(client, giveawayId, ms) {
  const handle = setTimeout(() => {
    activeGiveawayTimers.delete(giveawayId);
    finishGiveaway(client, giveawayId).catch(err => console.error('[Giveaway] finish error:', err.message));
  }, ms);
  activeGiveawayTimers.set(giveawayId, handle);
}

async function startGiveaway(interaction) {
  const prize        = interaction.options.getString('prize');
  const durationAmt  = interaction.options.getInteger('duration_amount');
  const durationUnit = interaction.options.getString('duration_unit');
  const winnersCount = interaction.options.getInteger('winners') || 1;
  const thumbnail    = interaction.options.getAttachment('thumbnail');
  const entryEmoji   = interaction.options.getString('entry_emoji') || '🎉';
  const ticketChannel = interaction.options.getChannel('ticket_channel');
  let claimHours      = interaction.options.getInteger('claim_hours');
  const channel       = interaction.options.getChannel('channel') || interaction.channel;

  if (durationAmt <= 0) return interaction.reply({ content: `${e('wrong')} Duration must be greater than 0.`, ephemeral: true });
  if (winnersCount <= 0) return interaction.reply({ content: `${e('wrong')} Winners must be at least 1.`, ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  if (!claimHours) {
    const cfgRes = await query('SELECT claim_hours_default FROM guild_config WHERE guild_id=$1', [interaction.guildId]);
    claimHours = cfgRes.rows[0]?.claim_hours_default || 6;
  }

  // If there's a bonus-role library, let the host pick which apply to THIS giveaway
  const libraryRes = await query('SELECT * FROM giveaway_bonus_roles WHERE guild_id=$1 ORDER BY bonus_entries DESC', [interaction.guildId]);
  let chosenBonusRoles = [];

  if (libraryRes.rows.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('giveaway_bonusrole_pick')
      .setPlaceholder('Select bonus-entry roles to apply (optional)')
      .setMinValues(0)
      .setMaxValues(Math.min(libraryRes.rows.length, 25))
      .addOptions(libraryRes.rows.slice(0, 25).map(r => {
        const roleName = interaction.guild.roles.cache.get(r.role_id)?.name || `Deleted role (${r.role_id})`;
        return {
          label: roleName.slice(0, 100),
          value: r.role_id,
          description: `+${r.bonus_entries} ${r.bonus_entries === 1 ? 'entry' : 'entries'}`.slice(0, 100),
        };
      }));
    const row = new ActionRowBuilder().addComponents(menu);

    const promptMsg = await interaction.editReply({
      content: `${e('purplesparkle')} You have bonus-entry roles configured. Select which ones apply to this giveaway (or wait 60s to skip):`,
      components: [row],
    });

    try {
      const selectInteraction = await promptMsg.awaitMessageComponent({ time: 60_000 });
      chosenBonusRoles = selectInteraction.values;
      await selectInteraction.deferUpdate();
    } catch {
      // Timed out — proceed with no bonus roles selected
    }
  }

  // If there's a required-role library, let the host pick which apply to THIS
  // giveaway — a member must have ALL selected roles to be eligible to enter
  const requiredLibraryRes = await query('SELECT * FROM giveaway_required_roles WHERE guild_id=$1', [interaction.guildId]);
  let requiredRoleIds = [];

  if (requiredLibraryRes.rows.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('giveaway_requiredrole_pick')
      .setPlaceholder('Select required roles for this giveaway (optional)')
      .setMinValues(0)
      .setMaxValues(Math.min(requiredLibraryRes.rows.length, 25))
      .addOptions(requiredLibraryRes.rows.slice(0, 25).map(r => ({
        label: (interaction.guild.roles.cache.get(r.role_id)?.name || `Deleted role (${r.role_id})`).slice(0, 100),
        value: r.role_id,
      })));
    const row = new ActionRowBuilder().addComponents(menu);

    const promptMsg = await interaction.editReply({
      content: `${e('rules')} You have entry-requirement roles configured. Select which ones a member must ALL have to enter this giveaway (or wait 60s to skip — no requirement):`,
      components: [row],
    });

    try {
      const selectInteraction = await promptMsg.awaitMessageComponent({ time: 60_000 });
      requiredRoleIds = selectInteraction.values;
      await selectInteraction.deferUpdate();
    } catch {
      // Timed out — proceed with no requirement
    }
  }

  const msMap = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };
  const ms = durationAmt * msMap[durationUnit];
  const endsAt = new Date(Date.now() + ms);

  const res = await query(
    `INSERT INTO giveaway_events (guild_id, channel_id, host_id, prize, winners_count, thumbnail_url, required_role_ids, bonus_role_ids, entry_emoji, claim_hours, ticket_channel_id, ends_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [interaction.guildId, channel.id, interaction.user.id, prize, winnersCount,
      thumbnail?.url || null, requiredRoleIds, chosenBonusRoles, entryEmoji, claimHours, ticketChannel?.id || null, endsAt]
  );
  const gw = res.rows[0];

  const bonusRolesInfo = chosenBonusRoles.length
    ? libraryRes.rows.filter(r => chosenBonusRoles.includes(r.role_id))
    : [];

  const checkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway_checkentries:${gw.id}`)
      .setLabel('Check My Entries')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Secondary)
  );

  const msg = await channel.send({
    embeds: [buildGiveawayEmbed(gw, bonusRolesInfo, false, null, interaction.guild.name, interaction.user.username)],
    components: [checkRow],
  });
  await msg.react(entryEmoji).catch(() => {});
  await query('UPDATE giveaway_events SET message_id = $1 WHERE id = $2', [msg.id, gw.id]);

  scheduleGiveawayEnd(interaction.client, gw.id, ms);

  await interaction.editReply({ content: `${e('checkmark')} Giveaway #${gw.id} started in <#${channel.id}> — ends ${tsR(endsAt)}.`, components: [] });
}

async function endGiveawayLive(interaction) {
  const id = interaction.options.getInteger('id');
  await interaction.deferReply({ ephemeral: true });

  const gwRes = await query('SELECT * FROM giveaway_events WHERE id=$1 AND guild_id=$2', [id, interaction.guildId]);
  if (!gwRes.rows.length) return interaction.editReply(`${e('wrong')} Giveaway not found.`);
  if (gwRes.rows[0].status !== 'active') return interaction.editReply(`${e('wrong')} That giveaway has already ended.`);

  if (activeGiveawayTimers.has(id)) {
    clearTimeout(activeGiveawayTimers.get(id));
    activeGiveawayTimers.delete(id);
  }
  await finishGiveaway(interaction.client, id);
  await interaction.editReply(`${e('checkmark')} Giveaway #${id} ended early.`);
}

async function cancelGiveaway(interaction) {
  const id = interaction.options.getInteger('id');
  await interaction.deferReply({ ephemeral: true });

  const gwRes = await query('SELECT * FROM giveaway_events WHERE id=$1 AND guild_id=$2', [id, interaction.guildId]);
  if (!gwRes.rows.length) return interaction.editReply(`${e('wrong')} Giveaway not found.`);
  const gw = gwRes.rows[0];

  if (interaction.user.id !== gw.host_id) {
    return interaction.editReply(`${e('wrong')} Only the host of this giveaway (<@${gw.host_id}>) can cancel it.`);
  }

  if (gw.status !== 'active') return interaction.editReply(`${e('wrong')} That giveaway isn't active — can't cancel it.`);

  if (activeGiveawayTimers.has(id)) {
    clearTimeout(activeGiveawayTimers.get(id));
    activeGiveawayTimers.delete(id);
  }

  await query('UPDATE giveaway_events SET status=$1, ended_at=NOW() WHERE id=$2', ['cancelled', id]);

  const channel = await interaction.client.channels.fetch(gw.channel_id).catch(() => null);
  const message = channel ? await channel.messages.fetch(gw.message_id).catch(() => null) : null;
  if (message) {
    const hostMember = channel ? await channel.guild.members.fetch(gw.host_id).catch(() => null) : null;
    await message.edit({ embeds: [new EmbedBuilder()
      .setColor(0x5B2C8C)
      .setTitle(`${e('gift')} Giveaway Cancelled`)
      .setDescription(`-# Giveaway ID: ${gw.id}\n# ${gw.prize}\n\n${e('wrong')} This giveaway was cancelled — no winner was picked.`)
      .setFooter({ text: [channel?.guild?.name, hostMember?.user?.username].filter(Boolean).join('・') })],
      components: [],
    }).catch(() => {});
    await message.reactions.removeAll().catch(() => {});
  }

  return interaction.editReply(`${e('checkmark')} Giveaway #${id} cancelled — no winner was picked.`);
}

async function editGiveaway(interaction) {
  const id = interaction.options.getInteger('id');
  await interaction.deferReply({ ephemeral: true });

  const gwRes = await query('SELECT * FROM giveaway_events WHERE id=$1 AND guild_id=$2', [id, interaction.guildId]);
  if (!gwRes.rows.length) return interaction.editReply(`${e('wrong')} Giveaway not found.`);
  const gw = gwRes.rows[0];

  if (interaction.user.id !== gw.host_id) {
    return interaction.editReply(`${e('wrong')} Only the host of this giveaway (<@${gw.host_id}>) can edit it.`);
  }
  if (gw.status !== 'active') return interaction.editReply(`${e('wrong')} That giveaway isn't active — can't edit it.`);

  const prize        = interaction.options.getString('prize');
  const winners       = interaction.options.getInteger('winners');
  const durationAmt   = interaction.options.getInteger('duration_amount');
  const durationUnit  = interaction.options.getString('duration_unit');
  const thumbnail     = interaction.options.getAttachment('thumbnail');

  if (!prize && !winners && !durationAmt && !thumbnail) {
    return interaction.editReply(`${e('wrong')} Provide at least one field to change.`);
  }
  if (durationAmt && !durationUnit) {
    return interaction.editReply(`${e('wrong')} \`duration_unit\` is required when setting \`duration_amount\`.`);
  }

  let newEndsAt = null;
  if (durationAmt) {
    const msMap = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };
    newEndsAt = new Date(Date.now() + durationAmt * msMap[durationUnit]);
  }

  await query(`
    UPDATE giveaway_events SET
      prize = COALESCE($1, prize),
      winners_count = COALESCE($2, winners_count),
      thumbnail_url = COALESCE($3, thumbnail_url),
      ends_at = COALESCE($4, ends_at)
    WHERE id = $5
  `, [prize, winners, thumbnail?.url || null, newEndsAt, id]);

  // If the end time changed, actually reschedule the auto-end timer — not just the display
  if (newEndsAt) {
    if (activeGiveawayTimers.has(id)) {
      clearTimeout(activeGiveawayTimers.get(id));
      activeGiveawayTimers.delete(id);
    }
    const msRemaining = newEndsAt.getTime() - Date.now();
    if (msRemaining > 0) scheduleGiveawayEnd(interaction.client, id, msRemaining);
    else await finishGiveaway(interaction.client, id).catch(() => {}); // new time is already in the past
  }

  // Re-render the live message with updated info
  const updatedRes = await query('SELECT * FROM giveaway_events WHERE id=$1', [id]);
  const updatedGw = updatedRes.rows[0];
  const channel = await interaction.client.channels.fetch(updatedGw.channel_id).catch(() => null);
  const message = channel ? await channel.messages.fetch(updatedGw.message_id).catch(() => null) : null;
  if (message && updatedGw.status === 'active') {
    const bonusRolesInfo = updatedGw.bonus_role_ids?.length
      ? (await query('SELECT * FROM giveaway_bonus_roles WHERE guild_id=$1 AND role_id = ANY($2)', [interaction.guildId, updatedGw.bonus_role_ids])).rows
      : [];
    await message.edit({ embeds: [buildGiveawayEmbed(updatedGw, bonusRolesInfo, false, null, channel.guild.name, (await channel.guild.members.fetch(updatedGw.host_id).catch(() => null))?.user?.username || '')] }).catch(() => {});
  }

  return interaction.editReply(`${e('checkmark')} Giveaway #${id} updated.`);
}

async function rerollGiveaway(interaction) {
  const id    = interaction.options.getInteger('id');
  const count = interaction.options.getInteger('count');
  await interaction.deferReply({ ephemeral: true });

  const gwRes = await query('SELECT * FROM giveaway_events WHERE id=$1 AND guild_id=$2', [id, interaction.guildId]);
  if (!gwRes.rows.length) return interaction.editReply(`${e('wrong')} Giveaway not found.`);
  const gw = gwRes.rows[0];
  if (gw.status !== 'ended') return interaction.editReply(`${e('wrong')} That giveaway hasn't ended yet.`);

  const channel = await interaction.client.channels.fetch(gw.channel_id).catch(() => null);
  if (!channel) return interaction.editReply(`${e('wrong')} Couldn't find that giveaway's channel.`);
  const message = await channel.messages.fetch(gw.message_id).catch(() => null);
  if (!message) return interaction.editReply(`${e('wrong')} Couldn't find the giveaway message.`);

  const reactors = await fetchAllReactors(message, gw.entry_emoji);
  const { weighted } = await buildWeightedEntrants(channel.guild, reactors, gw);
  const excludeSet = new Set(gw.winner_ids || []);
  const pool = weighted.filter(id => !excludeSet.has(id));

  const rerollCount = count || gw.winners_count || 1;
  const winners = pickUniqueWinners(pool, rerollCount);

  if (!winners.length) {
    return interaction.editReply(`${e('wrong')} No eligible entrants left to reroll from.`);
  }

  await query('UPDATE giveaway_events SET winner_ids = $1 WHERE id = $2', [winners, gw.id]);

  await channel.send({
    content: `<:tbp:1524560965872652449> New winner${winners.length > 1 ? 's' : ''} for **${gw.prize}**: ${winners.map(id => `<@${id}>`).join(', ')}!`,
  }).catch(() => {});

  await interaction.editReply(`${e('checkmark')} Rerolled giveaway #${id}.`);
}

async function listLiveGiveaways(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(
    `SELECT * FROM giveaway_events WHERE guild_id=$1 AND status='active' ORDER BY ends_at ASC`,
    [interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply('No active giveaways right now.');

  const embed = baseEmbed(`${e('gift')} Active Giveaways`, COLORS.tbppurple, interaction.guild?.name);
  for (const gw of res.rows) {
    embed.addFields({
      name: `#${gw.id} — ${gw.prize}`,
      value: `${e('trophies')} ${gw.winners_count} winner${gw.winners_count > 1 ? 's' : ''} | Ends ${tsR(gw.ends_at)} | <#${gw.channel_id}>`,
    });
  }
  await interaction.editReply({ embeds: [embed] });
}
