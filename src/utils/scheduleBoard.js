const { query } = require('./database');
const { e } = require('./appEmojis');
const { baseEmbed, tsF, tsR, COLORS } = require('./embeds');

async function refreshScheduleBoard(client, guildId) {
  // Check guild_config first, fall back to game_schedule_board
  let channelId, messageId;
  const configRes = await query(`SELECT schedule_channel_id FROM guild_config WHERE guild_id=$1`, [guildId]);
  if (configRes.rows.length && configRes.rows[0].schedule_channel_id) {
    channelId = configRes.rows[0].schedule_channel_id;
    const boardRes = await query(`SELECT message_id FROM game_schedule_board WHERE guild_id=$1`, [guildId]);
    messageId = boardRes.rows[0]?.message_id;
  } else {
    const boardRes = await query(`SELECT * FROM game_schedule_board WHERE guild_id=$1`, [guildId]);
    if (!boardRes.rows.length) return;
    channelId = boardRes.rows[0].channel_id;
    messageId = boardRes.rows[0].message_id;
  }
  const board = { channel_id: channelId, message_id: messageId };

  const gamesRes = await query(
    `SELECT * FROM game_logs WHERE guild_id=$1 AND status='active' ORDER BY started_at ASC`,
    [guildId]
  );

  const rafflesRes = await query(
    `SELECT * FROM raffles WHERE guild_id=$1 AND status='active' ORDER BY created_at ASC`,
    [guildId]
  );

  const totalItems = gamesRes.rows.length + rafflesRes.rows.length;

  const embed = baseEmbed(`${e('controller')} Live Game Schedule`, COLORS.lightpurple)
    .setDescription(
      totalItems > 0
        ? 'Active games and raffles happening right now!'
        : '*No active games or raffles right now. Check back soon!*'
    );

  for (const game of gamesRes.rows) {
    const prizeText = game.prize_amount ? `${game.prize_amount} ${game.currency}` : game.prize || 'No prize';
    embed.addFields({
      name: `${e('bullet')} ${game.game_name}`,
      value: [
        `**Host:** <@${game.host_id}>`,
        `**Prize:** ${prizeText}`,
        `**Started:** ${tsF(game.started_at)} (${tsR(game.started_at)})`,
        game.message_link ? `**[Jump to Game](${game.message_link})**` : '',
      ].filter(Boolean).join('\n'),
    });
  }

  for (const raffle of rafflesRes.rows) {
    const prizeText = raffle.prize_amount ? `${raffle.prize_amount} ${raffle.currency}` : raffle.prize || 'No prize';
    const jumpLink = raffle.message_id && raffle.channel_id
      ? `https://discord.com/channels/${raffle.guild_id}/${raffle.channel_id}/${raffle.message_id}`
      : null;
    embed.addFields({
      name: `${e('raffle')} ${prizeText} Raffle`,
      value: [
        `**Host:** <@${raffle.host_id}>`,
        `**Prize:** ${prizeText}`,
        `**Ends:** ${tsF(raffle.ends_at)} (${tsR(raffle.ends_at)})`,
        jumpLink ? `**[Jump to Raffle](${jumpLink})**` : '',
      ].filter(Boolean).join('\n'),
    });
  }

  embed.setTimestamp();

  // Ping game role if new content
  try {
    const cfgRes = await query(`SELECT game_ping_role_id, schedule_channel_id FROM guild_config WHERE guild_id=$1`, [guildId]);
    if (cfgRes.rows.length && cfgRes.rows[0].game_ping_role_id && cfgRes.rows[0].schedule_channel_id) {
      const schedCh = await client.channels.fetch(cfgRes.rows[0].schedule_channel_id);
      await schedCh.send(`<@&${cfgRes.rows[0].game_ping_role_id}> A new game or raffle is now live!`);
    }
  } catch {}

  try {
    const guild   = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(board.channel_id);
    embed.setFooter({ text: `${guild.name} • Last updated` }).setTimestamp();

    if (board.message_id) {
      try {
        const msg = await channel.messages.fetch(board.message_id);
        await msg.edit({ embeds: [embed] });
        await query(`UPDATE game_schedule_board SET updated_at=NOW() WHERE guild_id=$1`, [guildId]);
        return;
      } catch {}
    }

    const msg = await channel.send({ embeds: [embed] });
    try { await msg.pin(); } catch {}
    await query(
      `UPDATE game_schedule_board SET message_id=$1, updated_at=NOW() WHERE guild_id=$2`,
      [msg.id, guildId]
    );
    } catch (err) {
    console.error('[ScheduleBoard] Failed to refresh:', err.message);
  }
}

module.exports = { refreshScheduleBoard };
