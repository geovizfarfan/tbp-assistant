const { query } = require('./database');
const { e } = require('./appEmojis');
const { baseEmbed, tsF, tsR, COLORS } = require('./embeds');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function refreshScheduleBoard(client, guildId, pingRole = false) {
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

  const gamesRes = await query(`SELECT * FROM game_logs WHERE guild_id=$1 AND status='active' ORDER BY started_at ASC`, [guildId]);
  const rafflesRes = await query(`SELECT * FROM raffles WHERE guild_id=$1 AND status='active' ORDER BY created_at ASC`, [guildId]);

  // Build individual embeds per game/raffle
  const embeds = [];

  for (const game of gamesRes.rows) {
    const prizeText = game.prize_amount ? `${game.prize_amount} ${game.currency}` : game.prize || 'No prize';
    const isAuto    = /rumble|regret|dice attack|auto game/i.test(game.game_name);
    const icon      = /raffle/i.test(game.game_name) ? e('raffle') : /giveaway/i.test(game.game_name) ? e('gift') : isAuto ? e('bullet') : e('controller');
    const cleanName = game.game_name.replace(/<a?:[^:]+:\d+>/g, '').trim();
    const gameEmbed = baseEmbed(`${icon} ${cleanName}`, COLORS.tbppurple)
      .addFields(
        { name: `${e('purplesparkle')} Prize`, value: prizeText, inline: true },
        { name: `${e('members')} Host`,        value: `<@${game.host_id}>`, inline: true },
        { name: `${e('RojasClock')} Started`,  value: tsR(game.started_at), inline: true },
      );
    if (game.message_link) gameEmbed.setURL(game.message_link);
    embeds.push(gameEmbed);
  }

  for (const raffle of rafflesRes.rows) {
    const prizeText = raffle.prize_amount ? `${raffle.prize_amount} ${raffle.currency}` : raffle.prize || 'No prize';
    const jumpLink  = raffle.message_id && raffle.channel_id
      ? `https://discord.com/channels/${raffle.guild_id}/${raffle.channel_id}/${raffle.message_id}`
      : null;
    const raffleEmbed = baseEmbed(`${e('raffle')} ${prizeText} Raffle`, COLORS.tbppink)
      .addFields(
        { name: `${e('members')} Host`,    value: `<@${raffle.host_id}>`, inline: true },
        { name: `${e('RojasClock')} Ends`, value: tsR(raffle.ends_at), inline: true },
      );
    if (jumpLink) raffleEmbed.setURL(jumpLink);
    embeds.push(raffleEmbed);
  }

  const emptyEmbed = baseEmbed(`${e('controller')} Live Game Schedule`, COLORS.lightpurple)
    .setDescription('*No active games or raffles right now. Check back soon!*');

  // Ping game role only when new game added
  if (pingRole) try {
    const cfgRes = await query(`SELECT game_ping_role_id, schedule_channel_id, last_ping_message_id FROM guild_config WHERE guild_id=$1`, [guildId]);
    if (cfgRes.rows.length && cfgRes.rows[0].game_ping_role_id && cfgRes.rows[0].schedule_channel_id) {
      const schedCh = await client.channels.fetch(cfgRes.rows[0].schedule_channel_id);
      if (cfgRes.rows[0].last_ping_message_id) {
        try {
          const oldMsg = await schedCh.messages.fetch(cfgRes.rows[0].last_ping_message_id);
          await oldMsg.delete();
        } catch {}
      }
      const pingRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('game_ping_join').setLabel('🔔 Get Pings').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('game_ping_leave').setLabel('🔕 Stop Pings').setStyle(ButtonStyle.Danger)
      );
      const pingMsg = await schedCh.send({ content: `<@&${cfgRes.rows[0].game_ping_role_id}> 🎮 A new game or raffle is now live!`, components: [pingRow] });
      await query(`UPDATE guild_config SET last_ping_message_id=$1 WHERE guild_id=$2`, [pingMsg.id, guildId]);
    }
  } catch {}

  try {
    const guild   = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);

    // Delete old board message
    if (messageId) {
      try {
        const oldMsg = await channel.messages.fetch(messageId);
        await oldMsg.delete();
      } catch {}
    }

    const toSend = embeds.length ? embeds : [emptyEmbed];
    const chunks = [];
    for (let i = 0; i < toSend.length; i += 10) chunks.push(toSend.slice(i, i + 10));

    let firstMsgId = null;
    for (const chunk of chunks) {
      const sent = await channel.send({ embeds: chunk });
      if (!firstMsgId) firstMsgId = sent.id;
    }

    await query(
      `UPDATE game_schedule_board SET message_id=$1, updated_at=NOW() WHERE guild_id=$2`,
      [firstMsgId, guildId]
    );
  } catch (err) {
    console.error('[ScheduleBoard] Failed to refresh:', err.message);
  }
}

module.exports = { refreshScheduleBoard };
