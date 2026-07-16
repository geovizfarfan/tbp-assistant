// Only these servers (Geovanna's own) are allowed to use real Sins for the
// Rumble Royale reward system — that's the bot minting new Sins from nothing
// on every win, so it's restricted to trusted servers only.
//
// Wheel, Giveaway, and Raffle are different: those pay out of the HOST's own
// existing Sins balance (a real transfer, not free minting), so they're safe
// for any server and don't need this allowlist.
const SINS_ALLOWED_GUILDS = ['1359027847418740838', '1526277119410438364'];

function isGuildAllowedSins(guildId) {
  return SINS_ALLOWED_GUILDS.includes(guildId);
}

module.exports = { isGuildAllowedSins };
