const { EmbedBuilder } = require('discord.js');
const { query } = require('../utils/database');
const { xpForNextLevel, levelFromXp, getTier, getLevelConfig, getUserLevel, isChannelExcluded } = require('../utils/levelSystem');

async function handleMessageXp(message, client) {
  if (message.author.bot || !message.guild) return;

  const guildId = message.guild.id;
  if (await isChannelExcluded(guildId, message.channel.id)) return;

  const config = await getLevelConfig(guildId);
  if (!config.enabled) return;

  const existing = await getUserLevel(guildId, message.author.id);

  // Cooldown check
  if (existing?.last_xp_at) {
    const secondsSince = (Date.now() - new Date(existing.last_xp_at).getTime()) / 1000;
    if (secondsSince < config.cooldown_seconds) return;
  }

  const gainedXp = Math.floor(Math.random() * (config.xp_max - config.xp_min + 1)) + config.xp_min;
  const oldLevel = existing?.level || 0;
  const newTotalXp = (existing ? Number(existing.xp) : 0) + gainedXp;
  const newLevel = levelFromXp(newTotalXp);

  await query(`
    INSERT INTO levels (guild_id, user_id, username, xp, level, last_xp_at)
    VALUES ($1,$2,$3,$4,$5,NOW())
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      xp = $4, level = $5, username = $3, last_xp_at = NOW()
  `, [guildId, message.author.id, message.author.username, newTotalXp, newLevel]);

  if (newLevel > oldLevel && config.announce_levelup) {
    const tier = getTier(newLevel);
    const embed = new EmbedBuilder()
      .setColor('#d6c2ee')
      .setDescription(`🎉 <@${message.author.id}> leveled up to **Level ${newLevel}**! ${tier.emoji} *${tier.name}*`);

    const targetChannel = config.levelup_channel_id
      ? await client.channels.fetch(config.levelup_channel_id).catch(() => null)
      : message.channel;

    if (targetChannel) await targetChannel.send({ embeds: [embed] }).catch(() => {});
  }
}

module.exports = { handleMessageXp };
