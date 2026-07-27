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
  // Host is a direct mention: "<@123456789> opened the arena."
  const match = embed.description?.match(/^<@!?(\d+)>\s+opened the arena/i);
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

  const descLines = [];
  if (!cfg.battle_title) descLines.push('⚔️ Rumble Slaughter — Arena Open!');
  if (cfg.description) {
    descLines.push('', cfg.description, '');
  } else {
    descLines.push('');
  }
  if (cfg.host_description) descLines.push('', cfg.host_description, '');
  if (entryFee) descLines.push(`<a:moneybag:1522373120147849226> **Entry Fee:** ${entryFee} <a:SINS:1522338148380704910> (sins)`);
  if (cfg.other_reward) descLines.push(`<a:gift:1512915751458050268> **Bonus Reward:** ${cfg.other_reward}`);
  if (cfg.next_channel_id) descLines.push(`<a:rumblesword:1522372420894330921> **Next Room:** <#${cfg.next_channel_id}>`);

  const startEmbed = new EmbedBuilder()
    .setColor(cfg.embed_color || '#d6c2ee')
    .setAuthor({ name: (message.channel.name || '').slice(0, 256) })
    .setTitle((cfg.battle_title || '⚔️ Rumble Slaughter — Arena Open!').slice(0, 256))
    .setDescription(descLines.join('\n').slice(0, 4096))
    .setFooter({ text: `${message.guild.name} • Hosted by: ${hostName}${era ? ` • Era: ${era}` : ''}` });
  if (cfg.image_url) startEmbed.setImage(cfg.image_url);

  const sentMsg = await message.channel.send({ content: pings || undefined, embeds: [startEmbed] }).catch(() => null);

  if (sentMsg) {
    await query(`
      UPDATE rumble_slaughter_config SET last_message_id = $1, last_embed_json = $2, last_ping_content = $3
      WHERE channel_id = $4
    `, [sentMsg.id, JSON.stringify(startEmbed.toJSON()), pings || null, message.channel.id]).catch(() => {});
  }
}

async function handleChampion(message, embed) {
  if (await alreadyProcessed(message.id)) return;

  // Winner is a direct mention: "<@123456789> wins..."
  const match = embed.description?.match(/^<@!?(\d+)>\s+wins/i);
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

  if (!cfg.announce) return;

  const pings = buildPings(cfg);

  if (cfg.announce_style === 'ping') {
    await message.channel.send({ content: `${pings}\n<@${member.id}> is the champion!`.trim() }).catch(() => {});
    if (cfg.other_reward || cfg.host_description) {
      await query('UPDATE rumble_slaughter_config SET other_reward = NULL, host_description = NULL WHERE channel_id = $1', [message.channel.id]).catch(() => {});
    }
    return;
  }

  const descLines = [];
  descLines.push(`<@${member.id}> has been crowned champion and awarded <@&${cfg.winner_role_id}>!`);
  if (pot) descLines.push(`<a:moneybag:1522373120147849226> **Pot Won:** ${pot} <a:SINS:1522338148380704910> (sins)`);
  if (cfg.other_reward) descLines.push(`<a:gift:1512915751458050268> **Bonus Reward:** ${cfg.other_reward}`);
  if (cfg.host_description) descLines.push(cfg.host_description);
  if (cfg.description) descLines.push(cfg.description);
  if (cfg.next_channel_id) descLines.push(`<a:rumblesword:1522372420894330921> **Next Game:** <#${cfg.next_channel_id}>`);

  const roleEmbed = new EmbedBuilder()
    .setColor(cfg.embed_color || '#d6c2ee')
    .setAuthor({ name: (message.channel.name || '').slice(0, 256) })
    .setTitle(cfg.battle_title || '💀 Rumble Slaughter — Champion!')
    .setDescription(descLines.join('\n'))
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `${message.guild.name} • Rumble Slaughter Champion` })
    .setTimestamp();
  if (cfg.image_url) roleEmbed.setImage(cfg.image_url);

  const sentMsg = await message.channel.send({ embeds: [roleEmbed] }).catch(() => null);

  if (sentMsg) {
    await query(`
      UPDATE rumble_slaughter_config SET last_message_id = $1, last_embed_json = $2, last_ping_content = NULL
      WHERE channel_id = $3
    `, [sentMsg.id, JSON.stringify(roleEmbed.toJSON()), message.channel.id]).catch(() => {});
  }

  // Ping to get a new game going
  if (pings) {
    await message.channel.send({ content: `${pings} ready to run another round of Rumble Slaughter?` }).catch(() => {});
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

module.exports = { handleMessage, handleReaction };
