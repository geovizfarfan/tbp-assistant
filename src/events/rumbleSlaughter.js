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

async function handleMessage(message, client) {
  if (message.author.id !== PLAY_AND_REGRET_BOT_ID) return;
  if (!message.embeds?.length) return;

  const embed = message.embeds[0];
  if (!embed.title || !embed.title.includes('RUMBLE SLAUGHTER') || !embed.title.includes('CHAMPION')) return;

  // Ignore anything not genuinely fresh — same protection RR uses against
  // old/edited messages being reprocessed as brand new events.
  const ageMs = Date.now() - message.createdTimestamp;
  if (ageMs > 15 * 60 * 1000) {
    console.log(`[RumbleSlaughter] Ignoring stale message ${message.id} — ${Math.round(ageMs / 60000)}m old.`);
    return;
  }

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

  const descLines = [];
  descLines.push(`<@${member.id}> has been crowned champion and awarded <@&${cfg.winner_role_id}>!`);
  if (pot) descLines.push(`🪙 **Pot Won:** ${pot} Sins`);
  if (cfg.other_reward) descLines.push(`🎁 **Bonus Reward:** ${cfg.other_reward}`);
  if (cfg.host_description) descLines.push(cfg.host_description);
  if (cfg.description) descLines.push(cfg.description);
  if (cfg.next_channel_id) descLines.push(`➡️ **Next Game:** <#${cfg.next_channel_id}>`);

  const roleEmbed = new EmbedBuilder()
    .setColor('#d6c2ee')
    .setTitle(cfg.battle_title || '💀 Rumble Slaughter — Champion!')
    .setDescription(descLines.join('\n'))
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();

  await message.channel.send({ embeds: [roleEmbed] }).catch(() => {});

  // Ping to get a new game going
  if (cfg.ping_role_id) {
    await message.channel.send({
      content: `<@&${cfg.ping_role_id}> ready to run another round of Rumble Slaughter?`,
    }).catch(() => {});
  }

  // Clear the one-time reward/description now that it's been used
  if (cfg.other_reward || cfg.host_description) {
    await query('UPDATE rumble_slaughter_config SET other_reward = NULL, host_description = NULL WHERE channel_id = $1', [message.channel.id]).catch(() => {});
  }
}

module.exports = { handleMessage };
