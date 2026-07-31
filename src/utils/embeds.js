const { EmbedBuilder } = require('discord.js');

const COLORS = {
  gold:        0xFFD700,
  green:       0x2ECC71,
  red:         0xE74C3C,
  orange:      0xE67E22,
  blue:        0x3498DB,
  purple:      0x9B59B6,
  grey:        0x95A5A6,
  white:       0xFFFFFE,
  crown:       0xFFB800,
  lightpurple: 0xCBC3E3,
  tbppurple:   0x7F36F5,
  softgreen:   0xB6D7A8,
  softpeach:   0xF9CB9C,
  softred:     0xE06666,
  tbppink:     0xFF1889,
  pastelyellow: 0xFFF2B2,
  pastelblue:   0xB2D8F0,
  lavender:     0xC8A8E9,
};

function ts(date, format = 'F') {
  const unix = Math.floor(new Date(date).getTime() / 1000);
  return `<t:${unix}:${format}>`;
}

function tsR(date) { return ts(date, 'R'); }
function tsF(date) { return ts(date, 'F'); }

function baseEmbed(title, color = COLORS.crown, guildName = null) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setFooter({ text: guildName || '👑 Royal Ops' })
    .setTimestamp();
}

function eligibilityEmbed(staffUser, result, e, guildName = null) {
  const emoji  = result.eligible === 'full' ? e('checkmark') : result.eligible === 'partial' ? e('moneyfly') : result.eligible === 'review' ? e('search') : e('wrong');
  const color  = result.eligible === 'full' ? COLORS.green : result.eligible === 'partial' ? COLORS.orange : result.eligible === 'review' ? COLORS.lightpurple : COLORS.softred;
  const label  = result.eligible === 'full' ? 'Eligible for Full Pay' : result.eligible === 'partial' ? 'Partial Pay' : result.eligible === 'review' ? 'Admin Review Needed' : 'Not Eligible';

  const embed = baseEmbed(`${emoji} Paycheck Check — ${staffUser.username}`, color, guildName);
  embed.addFields(
    { name: 'Status',                       value: `${emoji} **${label}**`, inline: false },
    { name: `${e('controller')} Games`,     value: `${result.gamesHosted} / ${result.req.min_games_hosted} required`, inline: true },
    { name: `${e('gift')} Giveaways`,       value: `${result.giveawaysHosted} / ${result.req.min_giveaways_hosted} required`, inline: true },
    { name: `${e('raffle')} Raffles`,       value: `${result.rafflesHosted} / ${result.req.min_raffles_hosted} required`, inline: true },
  );
  if (result.notes.length) {
    embed.addFields({ name: `${e('receipt')} Notes`, value: result.notes.join('\n') });
  }
  return embed;
}

module.exports = { COLORS, ts, tsR, tsF, baseEmbed, eligibilityEmbed };
