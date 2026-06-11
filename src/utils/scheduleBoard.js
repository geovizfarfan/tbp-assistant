const { query } = require('./database');
const { e } = require('./appEmojis');
const { baseEmbed, tsF, tsR, COLORS } = require('./embeds');

async function refreshScheduleBoard(client, guildId, pingRole = false) {
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

  const embeds = [];

  if (totalItems === 0) {
    embeds.push(
      baseEmbed(`${e('controller')} Live Game Schedule`, COLORS.lightpurple)
        .setDescription('*No active games or raffles right now. Check back soon!*')
    );
  }

  for (const game of gamesRes.rows) {
    const prizeText = game.prize_amount ? `${game.prize_amount} ${game.currency}` : game.prize || 'No prize';
    const isAuto    = /rumble|regret|dice attack|auto game/i.test(game.game_name);
    const category  = /raffle/i.test(game.game_name) ? 'Raffle' : /giveaway/i.test(game.game_name) ? 'Giveaway' : isAuto ? 'Auto-Game' : 'Game';
    const desc = [
      `**Prize:** ${prizeText}`,
      `**Host:** <@${game.host_id}>`,
      `**Started:** ${tsF(game.started_at)} (${tsR(game.started_at)})`,
      game.message_link ? `[Jump to Game](${game.message_link})` : '',
    ].filter(Boolean).join('\n');
    embeds.push(baseEmbed(`${game.game_name}`, COLORS.tbppurple).setDescription(desc));
  }

  for (const raffle of rafflesRes.rows) {
    const prizeText = raffle.prize_amount ? `${raffle.prize_amount} ${raffle.currency}` : raffle.prize || 'No prize';
    const jumpLink  = raffle.message_id && raffle.channel_id
      ? `https://discord.com/channels/${raffle.guild_id}/${raffle.channel_id}/${raffle.message_id}`
      : null;
    const desc = [
      `**Prize:** ${prizeText}`,
      `**Host:** <@${raffle.host_id}>`,
      `**Ends:** ${tsF(raffle.ends_at)} (${tsR(raffle.ends_at)})`,
      jumpLink ? `[Jump to Raffle](${jumpLink})` : '',
    ].filter(Boolean).join('\n');
    embeds.push(baseEmbed(`${prizeText} Raffle`, COLORS.tbppink).setDescription(desc));
  }

  // Ping game role only when new game added
  if (pingRole) try {
    const cfgRes = await query(`SELECT game_ping_role_id, schedule_channel_id, last_ping_message_id FROM guild_config WHERE guild_id=$1`, [guildId]);
    if (cfgRes.rows.length && cfgRes.rows[0].game_ping_role_id && cfgRes.rows[0].schedule_channel_id) {
      const schedCh = await client.channels.fetch(cfgRes.rows[0].schedule_channel_id);
      // Delete previous ping message
      if (cfgRes.rows[0].last_ping_message_id) {
        try {
          const oldMsg = await schedCh.messages.fetch(cfgRes.rows[0].last_ping_message_id);
          await oldMsg.delete();
        } catch {}
      }
      // Send new ping and save message ID
      const pingMsg = await schedCh.send(`<@&${cfgRes.rows[0].game_ping_role_id}> A new game or raffle is now live!`);
      await query(`UPDATE guild_config SET last_ping_message_id=$1 WHERE guild_id=$2`, [pingMsg.id, guildId]);
    }
  } catch {}

  try {
    const guild   = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(board.channel_id);
    embed.setFooter({ text: `${guild.name} • Last updated` }).setTimestamp();

    // Split into chunks of 10 (Discord limit)
    const chunks = [];
    for (let i = 0; i < embeds.length; i += 10) chunks.push(embeds.slice(i, i + 10));

    if (board.message_id) {
      try {
        const msg = await channel.messages.fetch(board.message_id);
        await msg.delete();
      } catch {}
    }

    let firstMsgId = null;
    for (const chunk of chunks) {
      const msg = await channel.send({ embeds: chunk });
      if (!firstMsgId) firstMsgId = msg.id;
    }
    const msg = { id: firstMsgId };

    await query(
      `UPDATE game_schedule_board SET message_id=$1, updated_at=NOW() WHERE guild_id=$2`,
      [msg.id, guildId]
    );
    } catch (err) {
    console.error('[ScheduleBoard] Failed to refresh:', err.message);
  }
}

module.exports = { refreshScheduleBoard };
