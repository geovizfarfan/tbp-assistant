/**
 * src/events/rumbleRoyale.js (tbp-assistant / Veloura)
 * Monitors Rumble Royale bot messages — announcements, wins, reactions, achievement logs
 */
const { EmbedBuilder } = require('discord.js');
const { query } = require('../utils/database');

const RUMBLE_ROYALE_BOT_ID = '693167035068317736';

// Prevents the same message from being processed twice (once via messageCreate,
// once via messageUpdate) — Discord.js can hand back a "partial" old message on
// edits, which makes the old embed-check unreliable on its own.
// Prevents the same message from being processed twice (once via messageCreate,
// once via messageUpdate, or across a bot restart). The in-memory Set is a fast
// first-pass check; the DB insert is the real, restart-proof guarantee.
const processedMessages = new Set();
async function alreadyProcessed(messageId) {
  if (processedMessages.has(messageId)) return true;
  processedMessages.add(messageId);
  if (processedMessages.size > 2000) processedMessages.clear(); // simple unbounded-growth guard

  const res = await query(
    'INSERT INTO rr_processed_messages (message_id) VALUES ($1) ON CONFLICT (message_id) DO NOTHING RETURNING message_id',
    [messageId]
  ).catch((err) => { console.error('[RumbleRoyale] dedup insert error:', err.message); return { rows: [{}] }; }); // fail open on DB errors so a hiccup doesn't block real wins

  return res.rows.length === 0; // if nothing was inserted, it was already there
}

async function getConfig(channelId) {
  const res = await query('SELECT * FROM rr_channel_config WHERE channel_id = $1', [channelId]);
  return res.rows[0] || null;
}

async function getGuildConfig(guildId) {
  const res = await query('SELECT * FROM rr_guild_config WHERE guild_id = $1', [guildId]);
  return res.rows[0] || null;
}

async function getServerWins(guildId, userId) {
  const res = await query('SELECT wins FROM rr_stats WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return res.rows[0] ? Number(res.rows[0].wins) : 0;
}

async function trackWin(guildId, channelId, userId, username) {
  await query(
    `INSERT INTO rr_stats (guild_id, channel_id, user_id, username, wins, losses, games)
     VALUES ($1,$2,$3,$4,1,0,1)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET wins = rr_stats.wins + 1, games = rr_stats.games + 1, username = $4`,
    [guildId, channelId, userId, username]
  );
}

function parseWinnerEmbed(message) {
  const embed = message.embeds[0];
  if (!embed) return null;
  if (!embed.title?.includes('WINNER')) return null;
  const desc = embed.description || '';
  const mentionMatch = message.content?.match(/<@!?(\d+)>/);
  const userId = mentionMatch ? mentionMatch[1] : null;
  const usernameMatch = desc.match(/^([^\n]+?)(?:\s+the\s+\w+)?(?:\n|$)/);
  const username = usernameMatch ? usernameMatch[1].trim() : null;
  const playersMatch = desc.match(/Total Players:\s*(\d+)/i) ||
    embed.fields?.find(f => f.name?.includes('Player'))?.value?.match(/(\d+)/);
  const totalPlayers = playersMatch ? parseInt(playersMatch[1] || playersMatch[0]) : null;
  return { userId, username, totalPlayers };
}

function parseBattleStartEmbed(message) {
  const embed = message.embeds[0];
  if (!embed) return null;
  if (!embed.title?.toLowerCase().includes('rumble royale hosted by')) return null;
  const hostMatch = embed.title.match(/hosted by (.+)$/i);
  const host = hostMatch ? hostMatch[1].trim() : null;
  const eraLines = (embed.description || '').split('\n');
  const eraLine = eraLines.find(l => /era:/i.test(l));
  const eraMatch = eraLine?.match(/Era:\s*[^\s]*\s*(.+)/i);
  const era = eraMatch ? eraMatch[1].trim() : null;
  return { host, era };
}

async function checkAllRolesAchievement(guild, member, client, guildConfig) {
  // Get active season for this guild
  const seasonRes = await query('SELECT id FROM rr_seasons WHERE guild_id = $1 AND status = $2', [guild.id, 'active']);
  const season = seasonRes.rows[0];
  if (!season) return; // No active season — no achievement tracking

  // Get channels defined in this season that have both role+reaction
  const res = await query(
    `SELECT rc.winner_role_id, rc.reaction_emoji
     FROM rr_season_channels sc
     JOIN rr_channel_config rc ON rc.channel_id = sc.channel_id
     WHERE sc.season_id = $1 AND rc.winner_role_id IS NOT NULL AND rc.reaction_emoji IS NOT NULL`,
    [season.id]
  );
  if (!res.rows.length) return; // No channels in season

  const allWinnerRoles = res.rows.map(r => r.winner_role_id);
  const hasAll = allWinnerRoles.every(roleId => member.roles.cache.has(roleId));
  if (!hasAll) return;

  // No early return — we always fire and increment completions

  // Increment completion count (or insert first time)
  await query(
    `INSERT INTO rr_achievements (guild_id, user_id, completions)
     VALUES ($1, $2, 1)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET completions = rr_achievements.completions + 1, achieved_at = NOW()`,
    [guild.id, member.id]
  );

  const countRes = await query(
    'SELECT completions FROM rr_achievements WHERE guild_id = $1 AND user_id = $2',
    [guild.id, member.id]
  );
  const completions = countRes.rows[0]?.completions || 1;

  const allEmojis = res.rows.map(r => r.reaction_emoji).filter(Boolean).join(' ');
  const ordinal = completions === 1 ? '1st' : completions === 2 ? '2nd' : completions === 3 ? '3rd' : `${completions}th`;

  // Remove all winner roles (prestige reset)
  for (const roleId of allWinnerRoles) {
    await member.roles.remove(roleId).catch(() => {});
  }

  const achieveEmbed = new EmbedBuilder()
    .setColor('#d6c2ee')
    .setTitle('<:rumble:1522372419338375299> ALL RUMBLE ROLES COLLECTED!')
    .setDescription(`<@${member.id}> has collected all ${allWinnerRoles.length} Rumble Royale winner roles for the **${ordinal} time**! <a:confetti:1512912825935335484> <a:rumblesword:1522372420894330921>\n\nAll roles have been reset — the hunt begins again! <a:again:1522458630795034694>`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .addFields({ name: `Total Completions <a:purplesparkle:1512912828489793626>`, value: `**${completions}**`, inline: true })
    .setFooter({ text: `${guild.name}` })
    .setTimestamp();

  // Post to log channel
  const achieveLogId = guildConfig?.achievement_log_channel_id || guildConfig?.log_channel_id;
  if (achieveLogId) {
    const logChannel = client.channels.cache.get(achieveLogId);
    if (logChannel) await logChannel.send({ embeds: [achieveEmbed] }).catch(() => {});
  }

  // DM the member
  await member.send({
    embeds: [new EmbedBuilder()
      .setColor('#d6c2ee')
      .setTitle('<a:trophies:1512912823062364281> You collected all Rumble Royale roles!')
      .setDescription(`Congratulations! You've collected all reaction roles for the **${ordinal} time** in **${guild.name}**! <a:rumblesword:1522372420894330921> <a:purplesparkle:1512912828489793626>\n\nYour roles have been reset — can you collect them all again? <a:again:1522458630795034694>`)
      .addFields({ name: 'Your Completions', value: `**${completions}**`, inline: true })
      .setFooter({ text: `${guild.name} • Receipt` })
      .setTimestamp()]
  }).catch(() => {}); // DM might be closed
}

// Builds the battle-start announcement (or ping-only content) for a channel's
// current config. Used both by automatic detection and by manual /rr repost.
function buildBattleAnnouncement(config, channel, hostName, era = null) {
  const pings = [config.ping_role1_id, config.ping_role2_id, config.ping_role3_id]
    .filter(Boolean).map(id => `<@&${id}>`).join(' ');

  if (config.announce_style === 'ping') {
    const nextLine = config.next_channel_id
      ? `<a:rumblesword:1522372420894330921> Next Channel: <#${config.next_channel_id}>`
      : `<a:rumblesword:1522372420894330921> Next Channel: —`;
    return { content: `${pings}\n${nextLine}`, embeds: [] };
  }

  const descLines = [];
  if (!config.battle_title) descLines.push(`<:rumble:1522372419338375299> Rumble Royale — BATTLE TIME!`);
  if (config.battle_description) {
    descLines.push('', config.battle_description, '');
  } else {
    descLines.push('');
  }
  if (config.host_description) descLines.push('', config.host_description, '');
  if (config.reward_amount) descLines.push(`<a:moneybag:1522373120147849226> **Reward:** ${Number(config.reward_amount).toLocaleString()} <:sins:1522291331672703100> (sins)`);
  if (config.other_reward) descLines.push(`<a:gift:1512915751458050268> **Bonus Reward:** ${config.other_reward}`);
  if (config.winner_role_id) descLines.push(`<a:trophies:1512912823062364281> **Winner Role:** <@&${config.winner_role_id}>`);
  if (config.next_channel_id) descLines.push(`<a:rumblesword:1522372420894330921> **Next Room:** <#${config.next_channel_id}>`);

  const channelName = channel.name || '';

  const battleEmbed = new EmbedBuilder()
    .setColor(config.embed_color || '#d6c2ee')
    .setAuthor({ name: channelName.slice(0, 256) })
    .setTitle((config.battle_title || 'Rumble Royale — BATTLE TIME!').slice(0, 256))
    .setDescription(descLines.join('\n').slice(0, 4096))
    .setFooter({ text: `${channel.guild.name} • Hosted by: ${hostName}${era ? ` • Era: ${era}` : ''}` });

  if (config.battle_image) battleEmbed.setImage(config.battle_image);

  return { content: pings || '', embeds: [battleEmbed] };
}

async function handleMessage(message, client) {
  if (message.author.id !== RUMBLE_ROYALE_BOT_ID) return;
  if (!message.embeds?.length) return;
  if (await alreadyProcessed(message.id)) return;

  // Check if battle started in a personal grind channel
  const grindChRes = await query(
    'SELECT gc.user_id, cfg.role_id, cfg.embed_color FROM grind_channels gc JOIN grind_config cfg ON cfg.guild_id = gc.guild_id WHERE gc.channel_id = $1',
    [message.channel.id]
  );
  if (grindChRes.rows.length) {
    const title = message.embeds[0]?.title || '';
    if (title.toLowerCase().includes('rumble royale hosted by')) {
      const g = grindChRes.rows[0];
      const rolePing = g.role_id ? `<@&${g.role_id}>` : '';
      await message.channel.send({
        content: rolePing,
        embeds: [new EmbedBuilder()
          .setColor(g.embed_color || '#d6c2ee')
          .setTitle('<:rumble:1522372419338375299> New Battle!')
          .setDescription(`A Rumble Royale grind battle <a:rumblesword:1522372420894330921> has started! ${rolePing}`)
        ]
      }).catch(() => {});
    }
    return;
  }

  const config = await getConfig(message.channel.id);
  if (!config) return;

  const title = message.embeds[0]?.title || '';

  // ── Battle Start ──────────────────────────────────────────────────────────
  if (title.toLowerCase().includes('rumble royale hosted by')) {
    const parsed = parseBattleStartEmbed(message);
    if (!parsed) return;

    // Store host from interaction metadata
    const hostId = message.interaction?.user?.id || message.interactionMetadata?.user?.id || null;
    if (hostId) {
      await query('UPDATE rr_channel_config SET last_host = $1 WHERE channel_id = $2',
        [hostId, message.channel.id]).catch(() => {});
    } else if (parsed.host) {
      const members = await message.guild.members.search({ query: parsed.host, limit: 5 }).catch(() => null);
      const hostMember = members?.find(m =>
        m.displayName.toLowerCase() === parsed.host.toLowerCase() ||
        m.user.username.toLowerCase() === parsed.host.toLowerCase()
      );
      if (hostMember) {
        await query('UPDATE rr_channel_config SET last_host = $1 WHERE channel_id = $2',
          [hostMember.id, message.channel.id]).catch(() => {});
      }
    }

    // ── Battle announcement (embed or ping-only) ────────────────────────────
    const announcement = buildBattleAnnouncement(config, message.channel, parsed.host, parsed.era);

    if (config.announce_style === 'ping') {
      const sentMsg = await message.channel.send({ content: announcement.content });
      await query('UPDATE rr_channel_config SET last_battle_message_id = $1 WHERE channel_id = $2', [sentMsg.id, message.channel.id]).catch(() => {});
      // Clear one-time host description and other reward after posting
      if (config.host_description || config.other_reward) {
        await query('UPDATE rr_channel_config SET host_description = NULL, other_reward = NULL WHERE channel_id = $1', [message.channel.id]).catch(() => {});
      }
      return;
    }

    const sentMsg = await message.channel.send({ content: announcement.content, embeds: announcement.embeds });
    await query('UPDATE rr_channel_config SET last_battle_message_id = $1 WHERE channel_id = $2', [sentMsg.id, message.channel.id]).catch(() => {});

    // Clear one-time host description and other reward after posting
    if (config.host_description || config.other_reward) {
      await query('UPDATE rr_channel_config SET host_description = NULL, other_reward = NULL WHERE channel_id = $1', [message.channel.id]).catch(() => {});
    }
    return;
  }

  // ── Battle End / Winner ───────────────────────────────────────────────────
  if (title.includes('WINNER')) {
    const parsed = parseWinnerEmbed(message);
    if (!parsed) return;

    const { userId, username, totalPlayers } = parsed;
    let serverWins = 0;

    if (userId) {
      await trackWin(message.guild.id, message.channel.id, userId, username || 'Unknown');
      serverWins = await getServerWins(message.guild.id, userId);
    }

    if (totalPlayers) {
      await query(
        'UPDATE rr_channel_config SET total_games = total_games + 1, total_players = total_players + $1 WHERE channel_id = $2',
        [totalPlayers, message.channel.id]
      ).catch(() => {});
    }

    const winnerMention = userId ? `<@${userId}>` : `**${username}**`;

    // Give sins and get updated balance
    let walletBalance = null;
    if (userId && config.reward_amount) {
      try {
        const { adjustBalance } = require('../utils/playAndRegretDb');
        walletBalance = await adjustBalance(userId, username || 'Unknown', Number(config.reward_amount));
      } catch (e) { console.error('[RumbleRoyale] sins error:', e.message); }
    }

    // Check if winner already had the role, then assign
    let alreadyHadRole = false;
    let member = null;
    if (userId) {
      member = await message.guild.members.fetch(userId).catch(() => null);
      if (member && config.winner_role_id) {
        alreadyHadRole = member.roles.cache.has(config.winner_role_id);
        console.log('[RumbleRoyale] Role assign - userId:', userId, 'roleId:', config.winner_role_id, 'alreadyHad:', alreadyHadRole);
        if (!alreadyHadRole) {
          const roleResult = await member.roles.add(config.winner_role_id).catch(e => {
            console.error('[RumbleRoyale] role add error:', e.message);
            return null;
          });
          console.log('[RumbleRoyale] Role add result:', roleResult ? 'SUCCESS' : 'FAILED');
        }
      } else {
        console.log('[RumbleRoyale] Skipping role - member:', !!member, 'winner_role_id:', config.winner_role_id);
      }
    }

    // Get total server-wide RR wins
    const totalWinsRes = await query(
      'SELECT SUM(wins) as total FROM rr_stats WHERE guild_id = $1',
      [message.guild.id]
    ).catch(() => null);
    const totalServerWins = totalWinsRes?.rows[0]?.total || 0;

    const descLines = [
      `${winnerMention} has won Rumble Royale! <a:confetti:1512912825935335484>`,
      config.reward_amount ? `<a:moneybag:1522373120147849226> **Reward:** ${Number(config.reward_amount).toLocaleString()} <a:SINS:1522338148380704910> (sins)` : null,
      walletBalance !== null ? `<a:atm:1522656210439114902> **Wallet:** ${Number(walletBalance).toLocaleString()} <a:SINS:1522338148380704910> (sins)` : null,
    ].filter(Boolean);

    if (config.winner_role_id) {
      descLines.push(`<a:trophies:1512912823062364281> **Winner Role:** <@&${config.winner_role_id}>${alreadyHadRole ? ' — already had this role' : ''}`);
    }

    descLines.push(`<a:rumblesword:1522372420894330921> **Server Rumble Wins:** ${serverWins}`);
    if (config.next_channel_id) descLines.push(`\n**Next Channel:** <#${config.next_channel_id}>`);

    const winEmbed = new EmbedBuilder()
      .setColor('#d6c2ee')
      .setTitle('<:rumble:1522372419338375299> <a:trophies:1512912823062364281> WINNER!')
      .setDescription(descLines.join('\n'))
      .setFooter({ text: `VELOURA has tracked ${Number(totalServerWins)} Rumble Royale wins globally.` });

    if (member?.user) winEmbed.setThumbnail(member.user.displayAvatarURL({ dynamic: true }));

    await message.channel.send({ embeds: [winEmbed] });

    const hostPing = config.last_host ? `<@${config.last_host}>` : winnerMention;
    await message.channel.send(`${hostPing} Battle Finished! You can start a new \`/battle\` now!`);

    // Check all-roles achievement after role assignment
    if (member) {
      // Re-fetch member to get updated roles
      await member.fetch().catch(() => {});
      const guildConfig = await getGuildConfig(message.guild.id);
      await checkAllRolesAchievement(message.guild, member, client, guildConfig);
    }
  }
}

// Auto-react to messages from members who have winner roles
async function handleReaction(message, client) {
  if (message.author.bot) return;
  if (!message.guild) return;

  try {
    const res = await query(
      'SELECT winner_role_id, reaction_emoji FROM rr_channel_config WHERE guild_id = $1 AND winner_role_id IS NOT NULL AND reaction_emoji IS NOT NULL',
      [message.guild.id]
    );
    if (!res.rows.length) return;

    // Force fetch member to get fresh role cache
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;

    for (const row of res.rows) {
      const hasRole = member.roles.cache.has(row.winner_role_id);
      if (hasRole) {
        console.log('[RumbleRoyale] Reacting to message from', message.author.username, 'with', row.reaction_emoji);
        await message.react(row.reaction_emoji).catch(e => {
          console.error('[RumbleRoyale] react error:', e.message);
        });
      }
    }
  } catch (e) { console.error('[RumbleRoyale] handleReaction error:', e.message); }
}

module.exports = { handleMessage, handleReaction, buildBattleAnnouncement };
