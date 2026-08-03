const { EmbedBuilder } = require('discord.js');
const { query } = require('../utils/database');

// Rumble Slaughter is a game mode posted by the Play & Regret bot itself,
// not a separate application.
const PLAY_AND_REGRET_BOT_ID = '1478589664116871300';

const processedMessages = new Set();
async function alreadyProcessed(messageId) {
  if (processedMessages.has(messageId)) return true;
  processedMessages.add(messageId);
  if (processedMessages.size > 2000) processedMessages.clear();

  const res = await query(
    'INSERT INTO rr_processed_messages (message_id) VALUES ($1) ON CONFLICT (message_id) DO NOTHING RETURNING message_id',
    [`slaughter:${messageId}`]
  ).catch((err) => { console.error('[RumbleSlaughter] dedup insert error:', err.message); return { rows: [{}] }; });

  return res.rows.length === 0;
}

function buildPings(cfg) {
  return [cfg.ping_role_id, cfg.ping_role2_id, cfg.ping_role3_id]
    .filter(Boolean).map(id => `<@&${id}>`).join(' ');
}

// Rebuilds the arena-open embed fresh from CURRENT config every time it's
// called — used both when the event first happens and by /rs repost, so a
// repost always reflects whatever settings are live right now, not a frozen
// snapshot from whenever it was originally posted.
function buildArenaEmbed(cfg, { hostId, hostName, entryFee, era, guildName, channelName }) {
  const descLines = [];
  if (!cfg.battle_title) descLines.push('⚔️ Rumble Slaughter — Arena Open!');
  if (cfg.description) {
    descLines.push('', cfg.description, '');
  } else {
    descLines.push('');
  }
  if (cfg.host_description) descLines.push('', cfg.host_description, '');
  if (cfg.winner_role_id) descLines.push(`<a:trophies:1512912823062364281> **Winner Role:** <@&${cfg.winner_role_id}>`);
  if (entryFee) descLines.push(`<a:moneybag:1522373120147849226> **Entry Fee:** ${entryFee} <a:SINS:1522338148380704910> (sins)`);
  if (cfg.other_reward) descLines.push(`<a:gift:1512915751458050268> **Bonus Reward:** ${cfg.other_reward}`);
  if (cfg.next_channel_id) descLines.push(`<a:rumblesword:1522372420894330921> **Next Room:** <#${cfg.next_channel_id}>`);

  const embed = new EmbedBuilder()
    .setColor(cfg.embed_color || '#d6c2ee')
    .setAuthor({ name: (channelName || '').slice(0, 256) })
    .setTitle((cfg.battle_title || '⚔️ Rumble Slaughter — Arena Open!').slice(0, 256))
    .setDescription(descLines.join('\n').slice(0, 4096))
    .setFooter({ text: `${guildName} • Hosted by: ${hostName}${era ? ` • Era: ${era}` : ''}` });
  if (cfg.image_url) embed.setImage(cfg.image_url);
  return embed;
}

// Same idea for the champion embed — always rebuilt fresh from current config.
function buildChampionEmbed(cfg, member, { pot, guildName, channelName, totalServerWins, memberWins }) {
  const descLines = [
    `<@${member.id}> has won Rumble Slaughter! <a:confetti:1512912825935335484>`,
    pot ? `<a:moneybag:1522373120147849226> **Pot Won:** ${pot} <a:SINS:1522338148380704910> (sins)` : null,
    cfg.other_reward ? `<a:gift:1512915751458050268> **Bonus Reward:** ${cfg.other_reward}` : null,
  ].filter(Boolean);

  if (cfg.winner_role_id) descLines.push(`<a:trophies:1512912823062364281> **Winner Role:** <@&${cfg.winner_role_id}>`);
  descLines.push(`<a:rumblesword:1522372420894330921> **Server Rumble Wins:** ${memberWins}`);
  if (cfg.next_channel_id) descLines.push(`\n**Next Channel:** <#${cfg.next_channel_id}>`);

  const embed = new EmbedBuilder()
    .setColor(cfg.embed_color || '#d6c2ee')
    .setTitle('<a:rumblesword:1522372420894330921> <a:trophies:1512912823062364281> CHAMPION!')
    .setDescription(descLines.join('\n'))
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `VELOURA has tracked ${Number(totalServerWins || 0)} Rumble Slaughter wins globally.` })
    .setTimestamp();
  return embed;
}

async function handleMessage(message, client) {
  if (message.author.id !== PLAY_AND_REGRET_BOT_ID) return;
  if (!message.embeds?.length) return;

  const embed = message.embeds[0];
  if (!embed.title || !embed.title.includes('RUMBLE SLAUGHTER')) return;

  // Ignore anything not genuinely fresh — same protection RR uses against
  // old/edited messages being reprocessed as brand new events.
  const ageMs = Date.now() - message.createdTimestamp;
  if (ageMs > 15 * 60 * 1000) {
    console.log(`[RumbleSlaughter] Ignoring stale message ${message.id} — ${Math.round(ageMs / 60000)}m old.`);
    return;
  }

  if (embed.title.includes('CHAMPION')) return handleChampion(message, embed);
  return handleArenaOpen(message, embed);
}

async function handleArenaOpen(message, embed) {
  // Host is a direct mention at the start of the description — Play & Regret
  // uses randomized flavor text after it, so don't require specific wording.
  const match = embed.description?.match(/^\*{0,3}<@!?(\d+)>/);
  if (!match) {
    console.log('[RumbleSlaughter] Could not parse host mention from arena-open message:', embed.description?.slice(0, 80));
    return;
  }
  const hostId = match[1];

  if (await alreadyProcessed(message.id)) return;

  const config = await query('SELECT * FROM rumble_slaughter_config WHERE channel_id = $1', [message.channel.id]);
  if (!config.rows.length) return; // Not configured for this channel
  const cfg = config.rows[0];
  if (!cfg.announce) return;

  const pings = buildPings(cfg);

  if (cfg.announce_style === 'ping') {
    const nextLine = cfg.next_channel_id ? `➡️ Next Room: <#${cfg.next_channel_id}>` : '';
    await message.channel.send({ content: `${pings}\n${nextLine}`.trim() }).catch(() => {});
    return;
  }

  const entryMatch = embed.description?.match(/Entry fee:\s*\*{0,2}([\d,]+)\s*sins/i);
  const entryFee = entryMatch ? entryMatch[1] : null;
  const eraMatch = embed.description?.match(/Era:\s*\*{0,2}([^\n*]+)/i);
  const era = eraMatch ? eraMatch[1].trim() : null;

  const hostMember = await message.guild.members.fetch(hostId).catch(() => null);
  const hostName = hostMember?.user?.username || 'Unknown';

  const startEmbed = buildArenaEmbed(cfg, {
    hostId, hostName, entryFee, era,
    guildName: message.guild.name, channelName: message.channel.name,
  });

  const sentMsg = await message.channel.send({ content: pings || undefined, embeds: [startEmbed] }).catch(() => null);

  if (sentMsg) {
    // Store the raw facts, not a frozen embed — /rs repost rebuilds fresh from
    // current config using these, so config edits actually show up on repost.
    await query(`
      UPDATE rumble_slaughter_config SET
        last_message_id = $1, last_ping_content = $2,
        last_type = 'arena', last_host_id = $3, last_entry_fee = $4, last_era = $5, last_pot = NULL
      WHERE channel_id = $6
    `, [sentMsg.id, pings || null, hostId, entryFee, era, message.channel.id]).catch(() => {});
  }
}

async function handleChampion(message, embed) {
  if (await alreadyProcessed(message.id)) return;

  // Winner is a direct mention at the start of the description — Play &
  // Regret uses randomized flavor text after it (e.g. "did that and will
  // absolutely bring it up forever"), so don't require specific wording.
  const match = embed.description?.match(/^\*{0,3}<@!?(\d+)>/);
  if (!match) {
    console.log('[RumbleSlaughter] Could not parse winner mention from champion message:', embed.description?.slice(0, 80));
    return;
  }
  const winnerId = match[1];

  // Pull the pot they actually won, straight from Play & Regret's own message —
  // Veloura never awards this itself, just summarizes what they already got.
  const potMatch = embed.description?.match(/\+([\d,]+)\s*sins/i);
  const pot = potMatch ? potMatch[1] : null;

  const config = await query('SELECT * FROM rumble_slaughter_config WHERE channel_id = $1', [message.channel.id]);
  if (!config.rows.length || !config.rows[0].winner_role_id) return; // Not configured for this channel

  const cfg = config.rows[0];

  const member = await message.guild.members.fetch(winnerId).catch(() => null);
  if (!member) {
    console.log(`[RumbleSlaughter] Champion mention <@${winnerId}> — couldn't fetch that member, skipping role assignment.`);
    return;
  }

  const added = await member.roles.add(cfg.winner_role_id).catch((err) => {
    console.error('[RumbleSlaughter] Failed to add winner role:', err.message);
    return null;
  });

  if (added === null) return;
  console.log(`[RumbleSlaughter] Assigned winner role to ${member.user.username}`);

  // Track wins unconditionally, same pattern as Rumble Royale's rr_stats —
  // this happens regardless of announce settings below.
  const statsRes = await query(`
    INSERT INTO rs_stats (guild_id, channel_id, user_id, username, wins, games)
    VALUES ($1,$2,$3,$4,1,1)
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET wins = rs_stats.wins + 1, games = rs_stats.games + 1, username = $4
    RETURNING wins
  `, [message.guild.id, message.channel.id, member.id, member.user.username]).catch(err => {
    console.error('[RumbleSlaughter] stats tracking error:', err.message);
    return null;
  });
  const memberWins = statsRes?.rows[0]?.wins || 1;

  if (!cfg.announce) return;

  const pings = buildPings(cfg);

  if (cfg.announce_style === 'ping') {
    await message.channel.send({ content: `${pings}\n<@${member.id}> is the champion!`.trim() }).catch(() => {});
    if (cfg.other_reward || cfg.host_description) {
      await query('UPDATE rumble_slaughter_config SET other_reward = NULL, host_description = NULL WHERE channel_id = $1', [message.channel.id]).catch(() => {});
    }
    return;
  }

  const totalWinsRes = await query('SELECT SUM(wins) as total FROM rs_stats WHERE guild_id = $1', [message.guild.id]).catch(() => null);
  const totalServerWins = totalWinsRes?.rows[0]?.total || 0;

  const roleEmbed = buildChampionEmbed(cfg, member, {
    pot, guildName: message.guild.name, channelName: message.channel.name, totalServerWins, memberWins,
  });

  const sentMsg = await message.channel.send({ embeds: [roleEmbed] }).catch(() => null);

  // Same "battle finished" follow-up as Rumble Royale, adapted for whether
  // the next battle starts on its own or needs someone to run the command.
  console.log(`[RumbleSlaughter] auto_battle for channel ${message.channel.id}: ${JSON.stringify(cfg.auto_battle)} (type: ${typeof cfg.auto_battle})`);
  if (cfg.auto_battle) {
    await message.channel.send('Battle Finished! New auto battle will start soon!').catch(() => {});
  } else {
    const hostPing = cfg.last_host_id ? `<@${cfg.last_host_id}>` : `<@${member.id}>`;
    await message.channel.send(`${hostPing} Battle Finished! You can start a new \`/rumbleslaughter\` now!`).catch(() => {});
  }

  if (sentMsg) {
    await query(`
      UPDATE rumble_slaughter_config SET
        last_message_id = $1, last_ping_content = NULL,
        last_type = 'champion', last_winner_id = $2, last_pot = $3
      WHERE channel_id = $4
    `, [sentMsg.id, member.id, pot, message.channel.id]).catch(() => {});
  }

  // Clear the one-time reward/description now that it's been used
  if (cfg.other_reward || cfg.host_description) {
    await query('UPDATE rumble_slaughter_config SET other_reward = NULL, host_description = NULL WHERE channel_id = $1', [message.channel.id]).catch(() => {});
  }
}

// Auto-react to chat messages posted by members holding an RS winner role —
// mirrors Rumble Royale's "flex your win" reaction, unrelated to the
// announcements themselves. Fires on every guild message, same as RR's version.
const reactedMessages = new Set();
async function handleReaction(message) {
  if (message.author.bot) return;
  if (reactedMessages.has(message.id)) return;
  reactedMessages.add(message.id);
  if (reactedMessages.size > 2000) reactedMessages.clear();

  try {
    const res = await query(
      'SELECT winner_role_id, reaction_emoji FROM rumble_slaughter_config WHERE guild_id = $1 AND winner_role_id IS NOT NULL AND reaction_emoji IS NOT NULL',
      [message.guild.id]
    );
    if (!res.rows.length) return;

    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;

    for (const row of res.rows) {
      if (member.roles.cache.has(row.winner_role_id)) {
        await message.react(row.reaction_emoji).catch((e) => {
          console.error('[RumbleSlaughter] react error:', e.message);
        });
      }
    }
  } catch (e) { console.error('[RumbleSlaughter] handleReaction error:', e.message); }
}

module.exports = { handleMessage, handleReaction, buildArenaEmbed, buildChampionEmbed, buildPings };
