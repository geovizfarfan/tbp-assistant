const {
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  StringSelectMenuBuilder, ActionRowBuilder,
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
    if (sub === 'reroll') return rerollGiveaway(interaction);
    if (sub === 'list')   return listLiveGiveaways(interaction);
  },

  scheduleGiveawayEnd,
  finishGiveaway,
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

function buildGiveawayEmbed(gw, bonusRoles = [], ended = false, winnerIds = null) {
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

  if (gw.thumbnail_url) embed.setThumbnail(gw.thumbnail_url);
  if (!ended) embed.setTimestamp(new Date(gw.ends_at));

  return embed;
}

async function fetchAllReactors(message, entryEmoji) {
  const reaction = message.reactions.cache.get(entryEmoji);
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
      await message.reactions.cache.get(gw.entry_emoji)?.users.remove(userId).catch(() => {});
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
    await message.edit({ embeds: [buildGiveawayEmbed(gw, [], true, winners)] }).catch(() => {});
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

function scheduleGiveawayEnd(client, giveawayId, ms) {
  setTimeout(() => {
    finishGiveaway(client, giveawayId).catch(err => console.error('[Giveaway] finish error:', err.message));
  }, ms);
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
      .addOptions(libraryRes.rows.slice(0, 25).map(r => ({
        label: `+${r.bonus_entries} entries`.slice(0, 100),
        value: r.role_id,
        description: `Role ID ${r.role_id}`.slice(0, 100),
      })));
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
        label: `Role ID ${r.role_id}`.slice(0, 100),
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

  const msg = await channel.send({ embeds: [buildGiveawayEmbed(gw, bonusRolesInfo)] });
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

  await query('UPDATE giveaway_events SET status=$1, ended_at=NOW() WHERE id=$2', ['cancelled', id]);

  const channel = await interaction.client.channels.fetch(gw.channel_id).catch(() => null);
  const message = channel ? await channel.messages.fetch(gw.message_id).catch(() => null) : null;
  if (message) {
    await message.edit({ embeds: [new EmbedBuilder()
      .setColor(0x5B2C8C)
      .setTitle(`${e('gift')} Giveaway Cancelled`)
      .setDescription(`-# Giveaway ID: ${gw.id}\n# ${gw.prize}\n\n${e('wrong')} This giveaway was cancelled — no winner was picked.`)]
    }).catch(() => {});
    await message.reactions.removeAll().catch(() => {});
  }

  return interaction.editReply(`${e('checkmark')} Giveaway #${id} cancelled — no winner was picked.`);
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
