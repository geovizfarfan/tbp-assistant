const { query } = require('./database');

// MEE6-style formula: XP needed to go from `level` to `level + 1`
function xpForNextLevel(level) {
  return 5 * (level * level) + 50 * level + 100;
}

// Given total accumulated XP, compute the level it corresponds to
function levelFromXp(totalXp) {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= xpForNextLevel(level)) {
    remaining -= xpForNextLevel(level);
    level++;
  }
  return level;
}

function getTier(level) {
  if (level >= 26) return { name: 'Hard', emoji: '🔴' };
  if (level >= 11) return { name: 'Medium', emoji: '🟡' };
  return { name: 'Easy', emoji: '🟢' };
}

async function getLevelConfig(guildId) {
  const res = await query('SELECT * FROM level_config WHERE guild_id = $1', [guildId]);
  return res.rows[0] || { xp_min: 15, xp_max: 25, cooldown_seconds: 60, announce_levelup: true };
}

async function getUserLevel(guildId, userId) {
  const res = await query('SELECT * FROM levels WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return res.rows[0] || null;
}

async function isChannelExcluded(guildId, channelId) {
  const res = await query('SELECT 1 FROM level_excluded_channels WHERE guild_id = $1 AND channel_id = $2', [guildId, channelId]);
  return res.rows.length > 0;
}

module.exports = { xpForNextLevel, levelFromXp, getTier, getLevelConfig, getUserLevel, isChannelExcluded };
