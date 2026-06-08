const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');
const { refreshScheduleBoard } = require('../../utils/scheduleBoard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('game')
    .setDescription('Game hosting log')
    .addSubcommand(sub => sub
      .setName('log')
      .setDescription('Log a game you are hosting now')
      .addStringOption(o => o.setName('game').setDescription('Game name e.g. Ghosty Trivia').setRequired(true))
      .addStringOption(o => o.setName('link').setDescription('Message link to the game post').setRequired(true))
      .addStringOption(o => o.setName('prize').setDescription('Prize e.g. 500 Goos or Discord Nitro').setRequired(true))
      .addUserOption(o => o.setName('host').setDescription('Who actually hosted (leave blank if you are the host)').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('end')
      .setDescription('End a game and log the winner')
      .addStringOption(o => o.setName('link').setDescription('Message link of the game').setRequired(true))
      .addUserOption(o => o.setName('winner').setDescription('The winner').setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('View your hosted games')
      .addUserOption(o => o.setName('user').setDescription('View a specific staff member\'s active games').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('edit')
      .setDescription('Fix a logged game — update name, link or prize')
      .addIntegerOption(o => o.setName('id').setDescription('Game ID').setRequired(true))
      .addStringOption(o => o.setName('game').setDescription('New game name').setRequired(false))
      .addStringOption(o => o.setName('link').setDescription('New message link').setRequired(false))
      .addStringOption(o => o.setName('prize').setDescription('New prize e.g. 500 Goos').setRequired(false))
      .addUserOption(o => o.setName('host').setDescription('Correct host').setRequired(false))
      .addStringOption(o => o.setName('start_time').setDescription('Correct start time e.g. <t:UNIX:F> or unix timestamp').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('set-board')
      .setDescription('[Admin] Set the #game-schedule channel for the live board')
      .addChannelOption(o => o.setName('channel').setDescription('The channel').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'log')       await logGame(interaction);
    if (sub === 'end')       await endGame(interaction);
    if (sub === 'list')      await listGames(interaction);
    if (sub === 'edit')      await editGame(interaction);
    if (sub === 'set-board') await setBoard(interaction);
  },
};

async function logGame(interaction) {
  const gameName   = interaction.options.getString('game');
  const link       = interaction.options.getString('link');
  const prize      = interaction.options.getString('prize');
  const hostOverride = interaction.options.getUser('host');
  const hostId     = hostOverride ? hostOverride.id : interaction.user.id;
  const amount     = null;
  const currency   = 'Goos';
  const startRaw = interaction.options.getString('start_time') || null;

  let startedAt = new Date();
  // Try to fetch message timestamp from link
  try {
    const parts = link.match(/channels\/([^/]+)\/([^/]+)\/([^/]+)/);
    if (parts) {
      const fetchedChannel = await interaction.client.channels.fetch(parts[2]);
      const fetchedMsg = await fetchedChannel.messages.fetch(parts[3]);
      startedAt = fetchedMsg.createdAt;
      console.log(`[GameLog] Got message time: ${startedAt}`);
    }
  } catch (err) {
    console.error(`[GameLog] Could not fetch message time: ${err.message}`);
  }
  // Try to fetch message timestamp from link
  try {
    const parts = link.match(/channels\/([^/]+)\/([^/]+)\/([^/]+)/);
    if (parts) {
      const fetchedChannel = await interaction.client.channels.fetch(parts[2]);
      const fetchedMsg = await fetchedChannel.messages.fetch(parts[3]);
      startedAt = fetchedMsg.createdAt;
      console.log(`[GameLog] Got message time: ${startedAt}`);
    }
  } catch (err) {
    console.error(`[GameLog] Could not fetch message time: ${err.message}`);
  }
  if (startRaw) {
    const unixMatch = startRaw.match(/<t:(\d+)/);
    if (unixMatch) startedAt = new Date(parseInt(unixMatch[1]) * 1000);
    else { const parsed = new Date(startRaw); if (!isNaN(parsed)) startedAt = parsed; }
  }

  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `INSERT INTO game_logs (guild_id, channel_id, message_link, host_id, game_name, prize, prize_amount, currency, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [interaction.guildId, interaction.channelId, link, hostId, gameName, prize, amount, currency, startedAt]
  );
  const gameId = res.rows[0].id;
  const prizeDisplay = prize || 'No prize listed';

  const embed = baseEmbed(`${e('controller')} Game Logged — ${gameName}`, COLORS.lightpurple, interaction.guild?.name)
    .setDescription('A new game is live! Click the link below to jump in.')
    .addFields(
      { name: `${e('controller')} Game`,    value: gameName, inline: true },
      { name: `${e('members')} Host`,       value: `<@${hostId}>`, inline: true },
      { name: `${e('trophies')} Prize`,     value: prizeDisplay, inline: true },
      { name: `${e('RojasClock')} Started`, value: tsF(startedAt), inline: true },
      { name: `${e('announce')} Status`,    value: `${e('greendot')} Active`, inline: true },
      { name: `Game ID`,                    value: `#${gameId}`, inline: true },
      { name: `${e('purplesparkle')} Jump In`, value: `[Click here to join](${link})`, inline: false },
    )
    .setFooter({ text: `${interaction.guild?.name || '👑 Royal Ops'} — Use /game end when finished` });

  await interaction.editReply({ embeds: [embed] });
  await refreshScheduleBoard(interaction.client, interaction.guildId);
}

async function endGame(interaction) {
  const link   = interaction.options.getString('link');
  const winner = interaction.options.getUser('winner');
  const now    = new Date();
  await interaction.deferReply({ ephemeral: true });

  const gameRes = await query(
    `SELECT * FROM game_logs WHERE guild_id=$1 AND message_link=$2 AND status='active' LIMIT 1`,
    [interaction.guildId, link]
  );
  if (!gameRes.rows.length) return interaction.editReply({ content: `${e('wrong')} No active game found with that link.` });
  const game = gameRes.rows[0];

  await query(`UPDATE game_logs SET status='ended', ended_at=$1, winner_id=$2 WHERE id=$3`, [now, winner.id, game.id]);

  await query(
    `INSERT INTO member_wins (guild_id, user_id, username, type, ref_id, prize, prize_amount, currency, host_id, won_at)
     VALUES ($1,$2,$3,'game',$4,$5,$6,$7,$8,$9)`,
    [interaction.guildId, winner.id, winner.username, game.id, game.prize || game.game_name, game.prize_amount, game.currency, game.host_id, now]
  );

  if (game.prize || game.prize_amount) {
    await query(
      `INSERT INTO payout_reminders (type, ref_id, host_id, winner_id, prize, guild_id, channel_id)
       VALUES ('game',$1,$2,$3,$4,$5,$6)`,
      [game.id, game.host_id, winner.id, `${game.prize_amount ? game.prize_amount + ' ' : ''}${game.currency}`.trim(), interaction.guildId, interaction.channelId]
    );
  }

  const durationMs = now - new Date(game.started_at);
  const durationMins = Math.round(durationMs / 60000);
  const durationHrs  = Math.floor(durationMins / 60);
  const durationRem  = durationMins % 60;
  const durationStr  = durationHrs > 0
    ? (durationRem > 0 ? `${durationHrs}h ${durationRem}m` : `${durationHrs}h`)
    : `${durationMins}m`;
  const embed = baseEmbed(`${e('confetti')} Game Ended — ${game.game_name}`, COLORS.tbppurple, interaction.guild?.name)
    .addFields(
      { name: `${e('trophies')} Winner`,    value: `<@${winner.id}>`, inline: true },
      { name: `${e('members')} Host`,       value: `<@${game.host_id}>`, inline: true },
      { name: `${e('purplesparkle')} Prize`,value: game.prize_amount ? `${game.prize_amount} ${game.currency}` : (game.prize || 'N/A'), inline: true },
      { name: `${e('RojasClock')} Started`, value: tsF(game.started_at), inline: true },
      { name: `${e('confetti')} Ended`,     value: tsF(now), inline: true },
      { name: `${e('RojasClock')} Duration`,value: durationStr, inline: true },
      { name: `${e('payout')} Payout`,      value: game.prize ? `${e('Loading')} Pending — host will reach out` : 'N/A', inline: false },
    );

  await interaction.editReply({ embeds: [embed] });
  await refreshScheduleBoard(interaction.client, interaction.guildId);

  try {
    const configRes = await query(`SELECT winner_channel_id, ticket_channel_id, game_transcript_channel_id FROM guild_config WHERE guild_id=$1`, [interaction.guildId]);
    if (configRes.rows.length) {
      const cfg = configRes.rows[0];
      const ticketMention = cfg.ticket_channel_id ? `<#${cfg.ticket_channel_id}>` : 'our support channel';
      if (cfg.winner_channel_id) {
        const winnerCh = await interaction.client.channels.fetch(cfg.winner_channel_id);
        const winEmbed = baseEmbed(`${e('confetti')} Game Winner — ${game.game_name}`, 0x7F36F5, interaction.guild?.name)
          .addFields(
            { name: `${e('trophies')} Winner`,    value: `<@${winner.id}>`, inline: true },
            { name: `${e('purplesparkle')} Prize`, value: game.prize_amount ? `${game.prize_amount} ${game.currency}` : (game.prize || 'N/A'), inline: true },
            { name: `${e('members')} Host`,        value: `<@${game.host_id}>`, inline: true },
            { name: `${e('payout')} Payout`,       value: `${e('Loading')} Pending — please open a ticket in ${ticketMention} to claim your prize!`, inline: false },
          );
        const winnerMsg = await winnerCh.send({ content: `${e('confetti')} Congratulations <@${winner.id}>!`, embeds: [winEmbed] });

        const boosterRes = await query(`SELECT id FROM boosters WHERE guild_id=$1 AND user_id=$2 AND active=true`, [interaction.guildId, winner.id]);
        const isBooster = boosterRes.rows.length > 0;
        const claimHours = isBooster ? 12 : 6;

        const annRes = await query(
          `INSERT INTO winner_announcements (guild_id, game_id, channel_id, message_id, winner_id, prize, is_booster)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [interaction.guildId, game.id, cfg.winner_channel_id, winnerMsg.id, winner.id,
           game.prize_amount ? `${game.prize_amount} ${game.currency}` : (game.prize || 'N/A'), isBooster]
        );
        const annId = annRes.rows[0].id;

        setTimeout(async () => {
          try {
            const ann = await query(`SELECT * FROM winner_announcements WHERE id=$1`, [annId]);
            if (!ann.rows.length || ann.rows[0].status !== 'pending') return;
            const ticketRes = await query(
              `SELECT id FROM ticket_logs WHERE guild_id=$1 AND opened_by=$2 AND opened_at > $3`,
              [interaction.guildId, winner.id, now]
            );
            if (!ticketRes.rows.length) {
              await query(`UPDATE winner_announcements SET status='not_claimed' WHERE id=$1`, [annId]);
              try {
                const msg = await winnerCh.messages.fetch(winnerMsg.id);
                const notClaimedEmbed = baseEmbed(`${e('confetti')} Game Winner — ${game.game_name}`, 0x7F36F5, interaction.guild?.name)
                  .addFields(
                    { name: `${e('trophies')} Winner`,    value: `<@${winner.id}>`, inline: true },
                    { name: `${e('purplesparkle')} Prize`, value: game.prize_amount ? `${game.prize_amount} ${game.currency}` : (game.prize || 'N/A'), inline: true },
                    { name: `${e('members')} Host`,        value: `<@${game.host_id}>`, inline: true },
                    { name: `${e('payout')} Status`,       value: `${e('wrong')} Not Claimed — winner did not open a ticket within ${claimHours}hrs`, inline: false },
                  );
                await msg.edit({ embeds: [notClaimedEmbed] });
              } catch {}
            }
          } catch (err) { console.error('[Winners] Not-claimed check failed:', err.message); }
        }, claimHours * 60 * 60 * 1000);
      }
      if (cfg.game_transcript_channel_id) {
        const transcriptCh = await interaction.client.channels.fetch(cfg.game_transcript_channel_id);
        const transcriptEmbed = baseEmbed(`${e('receipt')} Game Transcript — ${game.game_name}`, 0xCBC3E3, interaction.guild?.name)
          .addFields(
            { name: `${e('controller')} Game`,        value: game.game_name, inline: true },
            { name: `${e('members')} Host`,            value: `<@${game.host_id}>`, inline: true },
            { name: `${e('trophies')} Winner`,         value: `<@${winner.id}>`, inline: true },
            { name: `${e('purplesparkle')} Prize`,     value: game.prize_amount ? `${game.prize_amount} ${game.currency}` : (game.prize || 'N/A'), inline: true },
            { name: `${e('RojasClock')} Started`,      value: tsF(game.started_at), inline: true },
            { name: `${e('confetti')} Ended`,          value: tsF(now), inline: true },
            { name: `${e('RojasClock')} Duration`,     value: durationStr, inline: true },
            { name: `${e('payout')} Payout`,           value: `${e('Loading')} Pending`, inline: true },
            { name: `${e('members')} Logged by`,       value: `<@${interaction.user.id}>`, inline: true },
            { name: `${e('purplesparkle')} Jump Link`, value: game.message_link ? `[View Game](${game.message_link})` : 'N/A', inline: true },
          );
        await transcriptCh.send({ embeds: [transcriptEmbed] });
      }
    }
  } catch (err) {
    console.error('[GameEnd] Channel post failed:', err.message);
  }
}


async function listGames(interaction) {
  const targetUser = interaction.options.getUser('user');
  await interaction.deferReply({ ephemeral: true });

  const hostId = targetUser ? targetUser.id : interaction.user.id;
  const res = await query(
    `SELECT * FROM game_logs WHERE guild_id=$1 AND host_id=$2 AND status='active' ORDER BY started_at DESC LIMIT 20`,
    [interaction.guildId, hostId]
  );

  if (!res.rows.length) {
    const who = targetUser ? `<@${targetUser.id}>` : 'You';
    return interaction.editReply({ content: `${who} has no active games.` });
  }

  const title = targetUser ? `${e('controller')} ${targetUser.username}'s Active Games` : `${e('controller')} Your Active Games`;
  const embed = baseEmbed(title, COLORS.lightpurple, interaction.guild?.name);

  for (const g of res.rows) {
    const payout = g.payout_status === 'paid' ? `${e('checkmark')} Paid` : g.payout_status === 'late' ? `${e('atention')} Late` : `${e('Loading')} Pending`;
    embed.addFields({
      name: `#${g.id} — ${g.game_name}`,
      value: `${e('purplesparkle')} Prize: ${g.prize || 'N/A'} | Payout: ${payout}${g.message_link ? ` | [Jump](${g.message_link})` : ''}`,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}


async function editGame(interaction) {
  const id       = interaction.options.getInteger('id');
  const gameName = interaction.options.getString('game');
  const link     = interaction.options.getString('link');
  const prize    = interaction.options.getString('prize');
  const host      = interaction.options.getUser('host');
  const startRaw  = interaction.options.getString('start_time');
  await interaction.deferReply({ ephemeral: true });

  if (!gameName && !link && !prize && !host && !startRaw) {
    return interaction.editReply({ content: `${e('wrong')} Please provide at least one field to update.` });
  }

  const setClauses = [];
  const vals = [];
  let idx = 1;
  if (gameName) { setClauses.push(`game_name=$${idx++}`); vals.push(gameName); }
  if (link)     { setClauses.push(`message_link=$${idx++}`); vals.push(link); }
  if (prize)    { setClauses.push(`prize=$${idx++}`); vals.push(prize); }
  if (host)     { setClauses.push(`host_id=$${idx++}`); vals.push(host.id); }
  if (startRaw) {
    const unixMatch = startRaw.match(/<t:(\d+)/);
    const unix = unixMatch ? parseInt(unixMatch[1]) : parseInt(startRaw);
    if (!isNaN(unix)) { setClauses.push(`started_at=$${idx++}`); vals.push(new Date(unix * 1000)); }
  }
  vals.push(id, interaction.guildId);

  const res = await query(
    `UPDATE game_logs SET ${setClauses.join(', ')} WHERE id=$${idx} AND guild_id=$${idx+1} RETURNING *`,
    vals
  );

  if (!res.rows.length) return interaction.editReply({ content: `${e('wrong')} Game #${id} not found.` });

  const lines = [`${e('checkmark')} Game #${id} updated:`];
  if (gameName) lines.push(`${e('controller')} Name → **${gameName}**`);
  if (link)     lines.push(`${e('purplesparkle')} Link → updated`);
  if (prize)    lines.push(`${e('trophies')} Prize → **${prize}**`);
  if (host)     lines.push(`${e('members')} Host → <@${host.id}>`);
  if (startRaw) lines.push(`${e('RojasClock')} Start time → updated`);

  await interaction.editReply({ content: lines.join('\n') });
  await refreshScheduleBoard(interaction.client, interaction.guildId);
}

async function setBoard(interaction) {
  const channel = interaction.options.getChannel('channel');
  await interaction.deferReply({ ephemeral: true });

  await query(
    `INSERT INTO game_schedule_board (guild_id, channel_id)
     VALUES ($1,$2)
     ON CONFLICT (guild_id) DO UPDATE SET channel_id=$2, message_id=NULL, updated_at=NOW()`,
    [interaction.guildId, channel.id]
  );

  await interaction.editReply({ content: `${e('checkmark')} Game schedule board set to <#${channel.id}>. The bot will manage it automatically.` });
  await refreshScheduleBoard(interaction.client, interaction.guildId);
}
