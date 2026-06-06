const { EmbedBuilder } = require('discord.js');

const COLORS = {
  gold:    0xFFD700,
  green:   0x2ECC71,
  red:     0xE74C3C,
  orange:  0xE67E22,
  blue:    0x3498DB,
  purple:  0x9B59B6,
  grey:    0x95A5A6,
  white:   0xFFFFFE,
  crown:   0xFFB800,
};

const CURRENCY_EMOJI = {
  MEE6: '<:mee6:1> MEE6',
  SINS: '💀 SINS',
  OOS:  '🌀 OOS',
};

function currencyLabel(c) {
  return CURRENCY_EMOJI[c] || c;
}

function ts(date, format = 'F') {
  const unix = Math.floor(new Date(date).getTime() / 1000);
  return `<t:${unix}:${format}>`;
}

function tsR(date) { return ts(date, 'R'); }
function tsF(date) { return ts(date, 'F'); }

function baseEmbed(title, color = COLORS.crown) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setFooter({ text: '𝚃𝙷𝙴 𝙱𝙾𝙰𝚁𝙳 𝙿𝚁𝙸𝙽𝙲𝙴𝚂𝚂' })
    .setTimestamp();
}

function eligibilityEmbed(staffUser, result) {
  const emoji = result.eligible === 'full' ? '✅' : result.eligible === 'partial' ? '⚠️' : result.eligible === 'review' ? '🔍' : '❌';
  const color = result.eligible === 'full' ? COLORS.green : result.eligible === 'partial' ? COLORS.orange : result.eligible === 'review' ? COLORS.purple : COLORS.red;
  const label = result.eligible === 'full' ? 'Eligible for Full Pay' : result.eligible === 'partial' ? 'Partial Pay' : result.eligible === 'review' ? 'Admin Review Needed' : 'Not Eligible';

  const embed = baseEmbed(`${emoji} Paycheck Check — ${staffUser.username}`, color);
  embed.addFields(
    { name: 'Status', value: `${emoji} **${label}**`, inline: false },
    { name: '🎮 Games Hosted', value: `${result.gamesHosted} / ${result.req.min_games_hosted} required`, inline: true },
    { name: '🎁 Giveaways', value: `${result.giveawaysHosted} / ${result.req.min_giveaways_hosted} required`, inline: true },
    { name: '🎟️ Raffles', value: `${result.rafflesHosted} / ${result.req.min_raffles_hosted} required`, inline: true },
    { name: '⏰ Late Payouts', value: `${result.latePayouts} / ${result.req.max_late_payouts} max`, inline: true },
    { name: '📅 Missed Shifts', value: `${result.missedShifts} / ${result.req.max_missed_shifts} max`, inline: true },
    { name: '🎫 Late Tickets', value: `${result.lateTickets}`, inline: true },
  );
  if (result.notes.length) {
    embed.addFields({ name: '📝 Notes', value: result.notes.join('\n') });
  }
  return embed;
}

module.exports = { COLORS, currencyLabel, ts, tsR, tsF, baseEmbed, eligibilityEmbed };
