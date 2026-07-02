/**
 * src/events/rumbleRoyale.js (tbp-assistant)
 * Monitors Rumble Royale bot messages and fires announcements + rewards
 */
const { EmbedBuilder } = require('discord.js');
const { query } = require('../utils/database');

const RUMBLE_ROYALE_BOT_ID = '693167035068317736';

async function getConfig(channelId) {
  const res = await query('SELECT * FROM rr_channel_config WHERE channel_id = $1', [channelId]);
  return res.rows[0] || null;
}

async function getServerWins(guildId, userId) {
  const res = await query('SELECT wins FROM rr_stats WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
  return res.rows[0] ? Number(res.rows[0].wins) : 0;
}

async function trackWin(guildId, channelId, userId, username) {
  await query(
    `INSERT INTO rr_stats (guild_id, channel_id, user_id, username, wins, losses, games)
     VALUES ($1,$2,$3,$4,1,0,1)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET wins = rr_stats.wins + 1, games = rr_stats.games + 1, username = $4`,
    [guildId, channelId, userId, username]
  );
}

function parseWinnerEmbed(message) {
  const embed = message.embeds[0];
  if (!embed) return null;
  if (!embed.title?.includes('WINNER')) return null;

  const desc = embed.description || '';
  const mentionMatch = message.content?.match(/<@!?(\d+)>/);
  const userId = mentionMatch ? mentionMatch[1] : null;

  const usernameMatch = desc.match(/^([^\n]+?)(?:\s+the\s+\w+)?(?:\n|$)/);
  const username = usernameMatch ? usernameMatch[1].trim() : null;

  // RR posts total players in a separate embed field or description line
  const playersMatch = desc.match(/Total Players:\s*(\d+)/i) ||
    embed.fields?.find(f => f.name?.includes('Player'))?.value?.match(/(\d+)/);
  const totalPlayers = playersMatch ? parseInt(playersMatch[1] || playersMatch[0]) : null;

  return { userId, username, totalPlayers };
}

function parseBattleStartEmbed(message) {
  const embed = message.embeds[0];
  if (!embed) return null;
  if (!embed.title?.toLowerCase().includes('rumble royale hosted by')) return null;

  const hostMatch = embed.title.match(/hosted by (.+)$/i);
  const host = hostMatch ? hostMatch[1].trim() : null;

  const eraMatch = (embed.description || '').match(/(?:Random\s+)?Era:\s*[^\s]*\s*(.+)/i);
  const era = eraMatch ? eraMatch[1].trim() : null;

  return { host, era };
}

async function handleMessage(message, client) {
  if (message.author.id !== RUMBLE_ROYALE_BOT_ID) return;
  if (!message.embeds?.length) return;

  const config = await getConfig(message.channel.id);
  if (!config) return;

  const title = message.embeds[0]?.title || '';

  // ── Battle Start ──────────────────────────────────────────────────────────
  if (title.toLowerCase().includes('rumble royale hosted by')) {
    const parsed = parseBattleStartEmbed(message);
    if (!parsed) return;

    // Store host for end-of-battle ping
    if (parsed.host) {
      const members = await message.guild.members.fetch({ query: parsed.host, limit: 1 }).catch(() => null);
      const hostMember = members?.first();
      if (hostMember) {
        await query('UPDATE rr_channel_config SET last_host = $1 WHERE channel_id = $2',
          [hostMember.id, message.channel.id]).catch(() => {});
      }
    }

    const descLines = [
      'Time to rumble! Good luck everyone <a:purplesparkle:1479210541691175054> — may the baddest win.',
      '',
      `<a:moneybag:1479268556687540345> **Reward:** ${config.reward_amount ? Number(config.reward_amount).toLocaleString() : '?'} sins <:sins:1522321533307981945>`,
    ];
    if (config.winner_role_id) descLines.push(`<a:trophies:1507765453299122387> **Winner Role:** <@&${config.winner_role_id}>`);
    if (config.next_channel_id) descLines.push(`<a:rumblesword:1522338907465842789> **Next Room:** <#${config.next_channel_id}>`);

    const battleEmbed = new EmbedBuilder()
      .setColor(config.embed_color || '#cab2fb')
      .setTitle('<:rumble:1522304913697280160> Rumble Royale — \uD835\uDE31\uD835\uDE22\uD835\uDE31\uD835\uDE31\uD835\uDE2D\uD835\uDE26 \uD835\uDE31\uD835\uDE24\uD835\uDE2C\uD835\uDE26!')
      .setDescription(descLines.join('\n'))
      .setFooter({ text: `${message.guild.name} • Hosted by: ${parsed.host}${parsed.era ? ` • Era: ${parsed.era}` : ''}` });

    if (config.battle_image) battleEmbed.setImage(config.battle_image);

    const pings = [config.ping_role1_id, config.ping_role2_id, config.ping_role3_id]
      .filter(Boolean).map(id => `<@&${id}>`).join(' ');

    await message.channel.send({ content: pings || '', embeds: [battleEmbed] });
    return;
  }

  // ── Battle End / Winner ───────────────────────────────────────────────────
  if (title.includes('WINNER')) {
    const parsed = parseWinnerEmbed(message);
    if (!parsed) return;

    const { userId, username, totalPlayers } = parsed;
    let serverWins = 0;

    if (userId) {
      await trackWin(message.guild.id, message.channel.id, userId, username || 'Unknown');
      serverWins = await getServerWins(message.guild.id, userId);
    }

    if (totalPlayers) {
      await query(
        'UPDATE rr_channel_config SET total_games = total_games + 1, total_players = total_players + $1 WHERE channel_id = $2',
        [totalPlayers, message.channel.id]
      ).catch(() => {});
    }

    // Give sins via Play & Regret DB if reward configured
    if (userId && config.reward_amount) {
      try {
        const { adjustBalance } = require('../utils/playAndRegretDb');
        await adjustBalance(userId, Number(config.reward_amount), 'Rumble Royale win');
      } catch (e) { console.error('[RumbleRoyale] sins reward error:', e.message); }
    }

    // Assign winner role
    if (userId && config.winner_role_id) {
      const member = await message.guild.members.fetch(userId).catch(() => null);
      if (member) await member.roles.add(config.winner_role_id).catch(() => {});
    }

    const winnerMention = userId ? `<@${userId}>` : `**${username}**`;

    const descLines = [
      `${winnerMention} has won Rumble Royale! <a:confetti:1495667283870089307>`,
      `<a:rumblesword:1522338907465842789> **Server Rumble Wins:** ${serverWins}`,
      `<:member:1495666085121491024> **Total Players:** ${totalPlayers || '?'}`,
      '',
      `<a:moneybag:1479268556687540345> **${config.reward_amount ? Number(config.reward_amount).toLocaleString() : '?'} sins** <:sins:1522321533307981945> added to their balance!`,
    ];
    if (config.winner_role_id) descLines.push(`<a:sparkle:1511506717584920696> **Role:** <@&${config.winner_role_id}>`);
    if (config.next_channel_id) descLines.push(`\n**NEXT:** <#${config.next_channel_id}>`);

    const winEmbed = new EmbedBuilder()
      .setColor('#5b209a')
      .setTitle('<a:trophies:1507765453299122387> WINNER!')
      .setDescription(descLines.join('\n'));

    if (userId) {
      const member = await message.guild.members.fetch(userId).catch(() => null);
      if (member?.user) winEmbed.setThumbnail(member.user.displayAvatarURL({ dynamic: true }));
    }

    await message.channel.send({ embeds: [winEmbed] });

    const hostPing = config.last_host ? `<@${config.last_host}>` : winnerMention;
    await message.channel.send(`${hostPing} Battle Finished! You can start a new \`/battle\` now!`);
  }
}

module.exports = { handleMessage };
