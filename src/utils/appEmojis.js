const { REST, Routes } = require('discord.js');

// Global emoji map: name -> formatted string e.g. <:controller:123>
const emojiMap = {};

/**
 * Fetches all application emojis from Discord API and stores them in emojiMap.
 * Call this once on bot ready.
 */
async function loadAppEmojis(clientId, token) {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    const data = await rest.get(Routes.applicationEmojis(clientId));
    const emojis = data.items || [];
    for (const emoji of emojis) {
      const formatted = emoji.animated
        ? `<a:${emoji.name}:${emoji.id}>`
        : `<:${emoji.name}:${emoji.id}>`;
      emojiMap[emoji.name] = formatted;
    }
    console.log(`[Emojis] Loaded ${emojis.length} application emojis.`);
  } catch (err) {
    console.error('[Emojis] Failed to load application emojis:', err.message);
  }
}

/**
 * Get a formatted emoji string by name.
 * Falls back to empty string if not found.
 */
function e(name) {
  return emojiMap[name] || '';
}

module.exports = { loadAppEmojis, e, emojiMap };
