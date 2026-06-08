const { query } = require('./database');
const { e } = require('./appEmojis');
const { baseEmbed, tsF, tsR, COLORS } = require('./embeds');

async function refreshScheduleBoard(client, guildId) {
  const boardRes = await query(
    `SELECT * FROM game_schedule_board WHERE guild_id=$1`,
    [guildId]
  );
  if (!boardRes.rows.length) return;
  const board = boardRes.rows[0];

  const gamesRes = await query(
    `SELECT * FROM game_logs WHERE guild_id=$1 AND status='active' ORDER BY started_at ASC`,
    [guildId]
  );

  const embed = baseEmbed(`${e('controller')} Live Game Schedule`, COLORS.lightpurple, guild.name)
    .setDescription(
      gamesRes.rows.length
        ? 'Active games happening right now. Click the link to jump in!'
        : '*No active games right now. Check back soon!*'
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

  embed.setFooter({ text: `${guild.name} • Last updated` }).setTimestamp();

  try {
    const guild   = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(board.channel_id);

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
