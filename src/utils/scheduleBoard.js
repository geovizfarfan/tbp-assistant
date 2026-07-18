const { query } = require('./database');
const { e } = require('./appEmojis');
const { baseEmbed, tsR, COLORS } = require('./embeds');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function refreshScheduleBoard(client, guildId, pingRole = false) {
  try {
    // Get schedule channel
    let channelId;
    const configRes = await query(`SELECT schedule_channel_id FROM guild_config WHERE guild_id=$1`, [guildId]);
    if (configRes.rows.length && configRes.rows[0].schedule_channel_id) {
      channelId = configRes.rows[0].schedule_channel_id;
    } else {
      const boardRes = await query(`SELECT channel_id FROM game_schedule_board WHERE guild_id=$1`, [guildId]);
      if (!boardRes.rows.length) return;
      channelId = boardRes.rows[0].channel_id;
    }

    const guild   = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);

    // Get active games
    const gamesRes = await query(`SELECT * FROM game_logs WHERE guild_id=$1 AND status='active' ORDER BY started_at ASC`, [guildId]);
    const rafflesRes = await query(`SELECT * FROM raffles WHERE guild_id=$1 AND status='active' ORDER BY created_at ASC`, [guildId]);

    // Post or update each game's individual message
    for (const game of gamesRes.rows) {
      const prizeText = game.prize_amount ? `${game.prize_amount} ${game.currency}` : game.prize || 'No prize';
      const isAuto    = /rumble|regret|dice attack|auto game|clash|hangry|hunger games|wheel/i.test(game.game_name);
      const icon      = /raffle/i.test(game.game_name) ? e('raffle') : /giveaway/i.test(game.game_name) ? e('gift') : isAuto ? '<a:sword:1516443055157416069>' : e('controller');
      const cleanName = game.game_name.replace(/<a?:[^:]+:\d+>/g, '').trim();
      const startLabel = new Date(game.started_at) > new Date() ? 'Starts' : 'Started';
      const boardColor = isAuto ? COLORS.lavender : /raffle/i.test(game.game_name) ? COLORS.pastelblue : /giveaway/i.test(game.game_name) ? COLORS.pastelblue : COLORS.pastelyellow;
      const gameEmbed = baseEmbed(`${icon} ${cleanName}`, boardColor, guild.name)
        .addFields(
          { name: `${e('purplesparkle')} Prize`, value: prizeText, inline: true },
          { name: `${e('members')} Host`,        value: `<@${game.host_id}>`, inline: true },
          { name: `${e('RojasClock')} ${startLabel}`,  value: tsR(game.started_at), inline: true },
          { name: `${e('receipt')} ID`,          value: `#${game.id}`, inline: true },
        );
      if (game.message_link && /^https?:\/\//.test(game.message_link)) gameEmbed.setURL(game.message_link);

      if (game.board_message_id) {
        // Edit existing message
        try {
          const msg = await channel.messages.fetch(game.board_message_id);
          await msg.edit({ embeds: [gameEmbed] });
        } catch {
          // Message deleted — post new one
          const msg = await channel.send({ embeds: [gameEmbed] });
          await query(`UPDATE game_logs SET board_message_id=$1 WHERE id=$2`, [msg.id, game.id]);
        }
      } else {
        // Post new message
        const msg = await channel.send({ embeds: [gameEmbed] });
        await query(`UPDATE game_logs SET board_message_id=$1 WHERE id=$2`, [msg.id, game.id]);
      }
    }

    // Post or update each raffle's individual message
    for (const raffle of rafflesRes.rows) {
      const prizeText = raffle.prize_amount ? `${raffle.prize_amount} ${raffle.currency}` : raffle.prize || 'No prize';
      const jumpLink  = raffle.message_id && raffle.channel_id
        ? `https://discord.com/channels/${raffle.guild_id}/${raffle.channel_id}/${raffle.message_id}`
        : null;
      const raffleEmbed = baseEmbed(`${e('raffle')} ${prizeText} Raffle`, COLORS.pastelblue, guild.name)
        .addFields(
          { name: `${e('members')} Host`,    value: `<@${raffle.host_id}>`, inline: true },
          { name: `${e('RojasClock')} Ends`, value: tsR(raffle.ends_at), inline: true },
          { name: `${e('receipt')} ID`,        value: `#${raffle.id}`, inline: true },
        );
      if (jumpLink) raffleEmbed.setURL(jumpLink);

      if (raffle.board_message_id) {
        try {
          const msg = await channel.messages.fetch(raffle.board_message_id);
          await msg.edit({ embeds: [raffleEmbed] });
        } catch {
          const msg = await channel.send({ embeds: [raffleEmbed] });
          await query(`UPDATE raffles SET board_message_id=$1 WHERE id=$2`, [msg.id, raffle.id]);
        }
      } else {
        const msg = await channel.send({ embeds: [raffleEmbed] });
        await query(`UPDATE raffles SET board_message_id=$1 WHERE id=$2`, [msg.id, raffle.id]);
      }
    }

    // Ping game role AFTER board — at the bottom
    if (pingRole) try {
      const cfgRes = await query(`SELECT game_ping_role_id, last_ping_message_id FROM guild_config WHERE guild_id=$1`, [guildId]);
      if (cfgRes.rows.length && cfgRes.rows[0].game_ping_role_id) {
        if (cfgRes.rows[0].last_ping_message_id) {
          try {
            const oldMsg = await channel.messages.fetch(cfgRes.rows[0].last_ping_message_id);
            await oldMsg.delete();
          } catch {}
        }
        const pingRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('game_ping_join').setLabel('🔔 Get Pings').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('game_ping_leave').setLabel('🔕 Stop Pings').setStyle(ButtonStyle.Danger)
        );
        const pingMsg = await channel.send({ content: `<@&${cfgRes.rows[0].game_ping_role_id}> 🎮 A new game or raffle is now live!`, components: [pingRow] });
        await query(`UPDATE guild_config SET last_ping_message_id=$1 WHERE guild_id=$2`, [pingMsg.id, guildId]);
      }
    } catch {}

  } catch (err) {
    console.error('[ScheduleBoard] Failed to refresh:', err.message);
    if (err.errors) console.error('[ScheduleBoard] Detail:', JSON.stringify(err.errors, null, 2));
    console.error(err.stack);
  }
}

async function removeFromBoard(client, guildId, boardMessageId) {
  try {
    if (!boardMessageId) return;
    let channelId;
    const configRes = await query(`SELECT schedule_channel_id FROM guild_config WHERE guild_id=$1`, [guildId]);
    if (configRes.rows.length && configRes.rows[0].schedule_channel_id) {
      channelId = configRes.rows[0].schedule_channel_id;
    } else {
      const boardRes = await query(`SELECT channel_id FROM game_schedule_board WHERE guild_id=$1`, [guildId]);
      if (!boardRes.rows.length) return;
      channelId = boardRes.rows[0].channel_id;
    }
    if (!channelId) return;
    const guild   = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    const msg = await channel.messages.fetch(boardMessageId);
    await msg.delete();
  } catch {}
}

module.exports = { refreshScheduleBoard, removeFromBoard };
