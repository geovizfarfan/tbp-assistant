const { query } = require('./database');
const { e } = require('./appEmojis');
const { baseEmbed, tsR, COLORS } = require('./embeds');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const ICONS = {
  wheel:    '<a:color_wheel:1532822238120644627>',
  giveaway: '<a:gift:1512915751458050268>',
  rumble:   '<a:rumblesword:1522372420894330921>',
  raffle:   '<:raffle:1512914674402853085>',
  other:    '<:control:1532888892879929534>',
};

// "Auto" games run themselves without a live host present the whole time.
const AUTO_GAME_PATTERN = /rumble|grind|regret|hangry|hunger|clash|raffle|giveaway|wheel/i;

function getBoardIcon(name) {
  if (/rumble/i.test(name)) return ICONS.rumble;
  if (/wheel/i.test(name)) return ICONS.wheel;
  if (/giveaway/i.test(name)) return ICONS.giveaway;
  if (/raffle/i.test(name)) return ICONS.raffle;
  return ICONS.other;
}

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

    // Self-healing: if a previous removeFromBoard call ever failed silently
    // (message already gone, transient API error, etc), this catches any
    // board messages left behind for games/raffles that are no longer active.
    const staleGames = await query(`SELECT id, board_message_id FROM game_logs WHERE guild_id=$1 AND status != 'active' AND board_message_id IS NOT NULL`, [guildId]);
    for (const g of staleGames.rows) {
      const msg = await channel.messages.fetch(g.board_message_id).catch(() => null);
      if (msg) await msg.delete().catch(err => console.error(`[ScheduleBoard] Failed to clean up stale game #${g.id}:`, err.message));
      await query(`UPDATE game_logs SET board_message_id=NULL WHERE id=$1`, [g.id]).catch(() => {});
    }
    const staleRaffles = await query(`SELECT id, board_message_id FROM raffles WHERE guild_id=$1 AND status != 'active' AND board_message_id IS NOT NULL`, [guildId]);
    for (const r of staleRaffles.rows) {
      const msg = await channel.messages.fetch(r.board_message_id).catch(() => null);
      if (msg) await msg.delete().catch(err => console.error(`[ScheduleBoard] Failed to clean up stale raffle #${r.id}:`, err.message));
      await query(`UPDATE raffles SET board_message_id=NULL WHERE id=$1`, [r.id]).catch(() => {});
    }
    const staleGiveaways = await query(`SELECT id, board_message_id FROM giveaway_events WHERE guild_id=$1 AND status != 'active' AND board_message_id IS NOT NULL`, [guildId]);
    for (const g of staleGiveaways.rows) {
      const msg = await channel.messages.fetch(g.board_message_id).catch(() => null);
      if (msg) await msg.delete().catch(err => console.error(`[ScheduleBoard] Failed to clean up stale giveaway #${g.id}:`, err.message));
      await query(`UPDATE giveaway_events SET board_message_id=NULL WHERE id=$1`, [g.id]).catch(() => {});
    }
    const staleCampaigns = await query(`SELECT id, board_message_id FROM wheel_role_campaigns WHERE guild_id=$1 AND status != 'active' AND board_message_id IS NOT NULL`, [guildId]);
    for (const c of staleCampaigns.rows) {
      const msg = await channel.messages.fetch(c.board_message_id).catch(() => null);
      if (msg) await msg.delete().catch(err => console.error(`[ScheduleBoard] Failed to clean up stale campaign #${c.id}:`, err.message));
      await query(`UPDATE wheel_role_campaigns SET board_message_id=NULL WHERE id=$1`, [c.id]).catch(() => {});
    }

    // Get active games
    const gamesRes = await query(`SELECT * FROM game_logs WHERE guild_id=$1 AND status='active' ORDER BY started_at ASC`, [guildId]);
    const rafflesRes = await query(`SELECT * FROM raffles WHERE guild_id=$1 AND status='active' ORDER BY created_at ASC`, [guildId]);
    const giveawaysRes = await query(`SELECT * FROM giveaway_events WHERE guild_id=$1 AND status='active' ORDER BY created_at ASC`, [guildId]);
    const campaignsRes = await query(`SELECT * FROM wheel_role_campaigns WHERE guild_id=$1 AND status='active' AND entry_message_id IS NOT NULL ORDER BY created_at ASC`, [guildId]);

    // Post or update each game's individual message
    for (const game of gamesRes.rows) {
      const prizeText = game.prize_amount ? `${game.prize_amount} ${game.currency}` : game.prize || 'No prize';
      const isAuto    = AUTO_GAME_PATTERN.test(game.game_name);
      const icon      = getBoardIcon(game.game_name);
      const cleanName = game.game_name.replace(/<a?:[^:]+:\d+>/g, '').trim();
      const startLabel = new Date(game.started_at) > new Date() ? 'Starts' : 'Started';
      const boardColor = isAuto ? COLORS.lavender : COLORS.pastelyellow;
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
      const raffleEmbed = baseEmbed(`${ICONS.raffle} ${prizeText} Raffle`, COLORS.lavender, guild.name)
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

    // Post or update each giveaway's individual message
    for (const gw of giveawaysRes.rows) {
      const jumpLink = gw.message_id && gw.channel_id
        ? `https://discord.com/channels/${gw.guild_id}/${gw.channel_id}/${gw.message_id}`
        : null;
      const gwEmbed = baseEmbed(`${ICONS.giveaway} ${gw.prize} Giveaway`, COLORS.lavender, guild.name)
        .addFields(
          { name: `${e('members')} Host`,    value: `<@${gw.host_id}>`, inline: true },
          { name: `${e('RojasClock')} Ends`, value: tsR(gw.ends_at), inline: true },
          { name: `${e('receipt')} ID`,        value: `#${gw.id}`, inline: true },
        );
      if (jumpLink) gwEmbed.setURL(jumpLink);

      if (gw.board_message_id) {
        try {
          const msg = await channel.messages.fetch(gw.board_message_id);
          await msg.edit({ embeds: [gwEmbed] });
        } catch {
          const msg = await channel.send({ embeds: [gwEmbed] });
          await query(`UPDATE giveaway_events SET board_message_id=$1 WHERE id=$2`, [msg.id, gw.id]);
        }
      } else {
        const msg = await channel.send({ embeds: [gwEmbed] });
        await query(`UPDATE giveaway_events SET board_message_id=$1 WHERE id=$2`, [msg.id, gw.id]);
      }
    }

    // Post or update each Wheel Roles campaign's individual message
    for (const camp of campaignsRes.rows) {
      const jumpLink = camp.entry_message_id && camp.entry_channel_id
        ? `https://discord.com/channels/${camp.guild_id}/${camp.entry_channel_id}/${camp.entry_message_id}`
        : null;
      const entRes = await query(`SELECT COUNT(*) FROM wheel_role_campaign_entries WHERE campaign_id=$1 AND currently_qualified=true`, [camp.id]);
      const entrantCount = entRes.rows[0].count;
      const campEmbed = baseEmbed(`${ICONS.wheel} ${camp.name}`, COLORS.lavender, guild.name)
        .addFields(
          { name: `${e('members')} Host`,      value: camp.host_id ? `<@${camp.host_id}>` : 'N/A', inline: true },
          { name: `${e('member')} Entrants`,   value: `${entrantCount}`, inline: true },
          { name: `${e('receipt')} ID`,        value: `#${camp.id}`, inline: true },
        );
      if (jumpLink) campEmbed.setURL(jumpLink);

      if (camp.board_message_id) {
        try {
          const msg = await channel.messages.fetch(camp.board_message_id);
          await msg.edit({ embeds: [campEmbed] });
        } catch {
          const msg = await channel.send({ embeds: [campEmbed] });
          await query(`UPDATE wheel_role_campaigns SET board_message_id=$1 WHERE id=$2`, [msg.id, camp.id]);
        }
      } else {
        const msg = await channel.send({ embeds: [campEmbed] });
        await query(`UPDATE wheel_role_campaigns SET board_message_id=$1 WHERE id=$2`, [msg.id, camp.id]);
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
      if (!boardRes.rows.length) {
        console.error(`[ScheduleBoard] removeFromBoard: no schedule channel configured for guild ${guildId}`);
        return;
      }
      channelId = boardRes.rows[0].channel_id;
    }
    if (!channelId) return;
    const guild   = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.error(`[ScheduleBoard] removeFromBoard: schedule channel ${channelId} not found in guild ${guildId}`);
      return;
    }
    const msg = await channel.messages.fetch(boardMessageId).catch(() => null);
    if (!msg) {
      // Already gone (manually deleted, etc) — nothing more to do.
      return;
    }
    await msg.delete();
  } catch (err) {
    console.error(`[ScheduleBoard] removeFromBoard failed for message ${boardMessageId} in guild ${guildId}:`, err.message);
  }
}

module.exports = { refreshScheduleBoard, removeFromBoard };
