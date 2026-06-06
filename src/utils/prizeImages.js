const { query } = require('./database');
const path = require('path');

// Built-in prize keys → local asset filenames
// These are served as file attachments on the embed.
// Keys must match the choices in raffle.js exactly.
const BUILT_IN_ASSETS = {
  'accessory':     'raffle_accesory.png',
  'nitro_basic':   'raffle_nitro_basic.png',
  'nitro':         'raffle_nitro_basic.png',
  'nitro_premium': 'raffle_nitro_basic.png', // same image until premium art ready
  'carry':         'raffle_carry.png',
  'goos':          'raffle_goos.png',
  'sins':          'raffle_sins.png',
  'crowns':        'raffle_crowns.png',
  'gift_card':     'raffle_gift_card.png',
  'gift':          'raffle_gift.png',
  'sticker':       'raffle_sticker.png',
};

const ASSETS_DIR = path.join(__dirname, '../../assets');

/**
 * Returns { attachment, thumbnailName } for a prize key.
 * Falls back to checking the DB for custom guild overrides.
 * Falls back to gift.png for 'other' prizes.
 */
async function getPrizeImage(guildId, prizeKey) {
  const key = (prizeKey || 'gift').toLowerCase();

  // Check DB for guild-specific override first
  try {
    const res = await query(
      `SELECT image_url FROM raffle_images WHERE guild_id=$1 AND prize_key=$2`,
      [guildId, key]
    );
    if (res.rows.length) {
      return { type: 'url', url: res.rows[0].image_url };
    }
  } catch {}

  // Fall back to built-in local asset
  const filename = BUILT_IN_ASSETS[key] || BUILT_IN_ASSETS['gift'];
  const filepath = path.join(ASSETS_DIR, filename);
  return { type: 'attachment', filepath, filename };
}

/**
 * Prize key → human-readable label
 */
const PRIZE_LABELS = {
  'accessory':   'Discord Profile Accessory',
  'nitro_basic': 'Discord Nitro Basic',
  'nitro':       'Discord Nitro',
  'nitro_premium': 'Discord Nitro',
  'carry':       'Partner Carry',
  'goos':        'Goos',
  'sins':        'Sins',
  'crowns':      'Crowns',
  'gift_card':   'Gift Card',
  'gift':        'Other Gift',
  'sticker':     'Sticker Pack',
};

function getPrizeLabel(key, customName) {
  if (key === 'gift' && customName) return customName;
  return PRIZE_LABELS[key] || key;
}

module.exports = { getPrizeImage, getPrizeLabel, BUILT_IN_ASSETS, ASSETS_DIR };
