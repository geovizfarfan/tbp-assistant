const { SlashCommandBuilder } = require('discord.js');
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
      .addStringOption(o => o.setName('game').setDescription('Game name (e.g. Ghosty Trivia)').setRequired(true))
      .addStringOption(o => o.setName('link').setDescription('Message link to the game post').setRequired(true))
      .addStringOption(o => o.setName('prize').setDescription('Prize description').setRequired(false))
      .addIntegerOption(o => o.setName('amount').setDescription('Prize amount').setRequired(false))
      .addStringOption(o => o.setName('currency').setDescription('Currency').setRequired(false)
        .addChoices(
          { name: 'Goos',   value: 'GOOS' },
          { name: 'Sins',   value: 'SINS' },
          { name: 'Crowns', value: 'CROWNS' },
          { name: 'MEE6',   value: 'MEE6' },
          { name: 'OOS',    value: 'OOS' },
        ))
      .addStringOption(o => o.setName('start_time').setDescription('Start time (e.g. 8PM ET, or <t:UNIX:F>)').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('end')
      .setDescription('End a game and log the winner')
      .addStringOption(o => o.setName('link').setDescription('Message link of the game (same one used in /game log)').setRequired(true))
      .addUserOption(o => o.setName('winner').setDescription('The winner').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('payout')
      .setDescription('Confirm payout was sent for a game')
      .addIntegerOption(o => o.setName('id').setDescription('Game log ID').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('set-board')
      .setDescription('[Admin] Set the #game-schedule channel for the live board')
      .addChannelOption(o => o.setName('channel').setDescription('The channel to post the schedule board in').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'log')       await logGame(interaction);
    if (sub === 'end')       await endGame(interaction);
    if (sub === 'payout')    await payoutGame(interaction);
    if (sub === 'set-board') await setBoard(interaction);
  },
};

async function logGame(interaction) {
  const gameName  = interaction.options.getString('game');
  const link      = interaction.options.getString('link');
  const prize     = interaction.options.getString('prize') || null;
  const amount    = interaction.options.getInteger('amount') || null;
  const currency  = interaction.options.getString('currency') || 'GOOS';
  const startRaw  = interaction.options.getString('start_time') || null;

  // Parse start time if provided
  let startedAt = new Date();
  if (startRaw) {
    const unixMatch = startRaw.match(/<t:(\d+)/);
    if (unixMatch) {
      startedAt = new Date(parseInt(unixMatch[1]) * 1000);
    } else {
      // Try natural parse
      const parsed = new Date(startRaw);
      if (!isNaN(parsed)) startedAt = parsed;
    }
  }

  await interaction.deferReply();

  const res = await query(
    `INSERT INTO game_logs (guild_id, channel_id, message_link, host_id, game_name, prize, prize_amount, currency, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [interaction.guildId, interaction.channelId, link, interaction.user.id, gameName, prize, amount, currency, startedAt]
  );
  const gameId = res.rows[0].id;

  const prizeDisplay = amount ? `${amount} ${currency}` : (prize || 'No prize listed');

  const embed = baseEmbed(`🎮 Game Logged — ${gameName}`, COLORS.blue)
    .setDescription(`A new game is live! Click the link below to jump in.`)
    .addFields(
      { name: '🎮 Game',      value: gameName, inline: true },
      { name: '👤 Host',      value: `<@${interaction.user.id}>`, inline: true },
      { name: '🏆 Prize',     value: prizeDisplay, inline: true },
      { name: '🕐 Started',   value: tsF(startedAt), inline: true },
      { name: '📌 Status',    value: '🟢 Active', inline: true },
      { name: '🆔 Game ID',   value: `#${gameId}`, inline: true },
      { name: '🔗 Jump In',   value: `[Click here to join](${link})`, inline: false },
    )
    .setFooter({ text: '👑 TBP Royal Ops — Use /game end when finished' });

  await interaction.editReply({ embeds: [embed] });

  // Refresh the schedule board
  await refreshScheduleBoard(interaction.client, interaction.guildId);
}

async function endGame(interaction) {
  const link   = interaction.options.getString('link');
  const winner = interaction.options.getUser('winner');
  const now    = new Date();
  await interaction.deferReply();

  const gameRes = await query(
    `SELECT * FROM game_logs WHERE guild_id=$1 AND message_link=$2 AND status='active' LIMIT 1`,
    [interaction.guildId, link]
  );

  if (!gameRes.rows.length) {
    return interaction.editReply({ content: '❌ No active game found with that message link.' });
  }
  const game = gameRes.rows[0];

  await query(
    `UPDATE game_logs SET status='ended', ended_at=$1, winner_id=$2 WHERE id=$3`,
    [now, winner.id, game.id]
  );

  // Log member win
  await query(
    `INSERT INTO member_wins (guild_id, user_id, username, type, ref_id, prize, prize_amount, currency, host_id, won_at)
     VALUES ($1,$2,$3,'game',$4,$5,$6,$7,$8,$9)`,
    [interaction.guildId, winner.id, winner.username, game.id,
     game.prize || game.game_name, game.prize_amount, game.currency, game.host_id, now]
  );

  // Payout reminder if prize exists
  if (game.prize || game.prize_amount) {
    await query(
      `INSERT INTO payout_reminders (type, ref_id, host_id, winner_id, prize, guild_id, channel_id)
       VALUES ('game',$1,$2,$3,$4,$5,$6)`,
      [game.id, game.host_id, winner.id,
       `${game.prize_amount ? game.prize_amount + ' ' : ''}${game.currency}`.trim(),
       interaction.guildId, interaction.channelId]
    );
  }

  const duration = Math.round((now - new Date(game.started_at)) / 60000);

  const embed = baseEmbed(`🏁 Game Ended — ${game.game_name}`, COLORS.gold)
    .addFields(
      { name: '🏆 Winner',    value: `<@${winner.id}>`, inline: true },
      { name: '👤 Host',      value: `<@${game.host_id}>`, inline: true },
      { name: '🎁 Prize',     value: game.prize_amount ? `${game.prize_amount} ${game.currency}` : (game.prize || 'N/A'), inline: true },
      { name: '🕐 Started',   value: tsF(game.started_at), inline: true },
      { name: '🏁 Ended',     value: tsF(now), inline: true },
      { name: '⏱️ Duration',  value: `${duration} minutes`, inline: true },
      { name: '💸 Payout',    value: game.prize ? '⏳ Pending — host will reach out' : 'N/A', inline: false },
    );

  await interaction.editReply({ embeds: [embed] });

  // Refresh schedule board (game is now ended, removes from active list)
  await refreshScheduleBoard(interaction.client, interaction.guildId);
}

async function payoutGame(interaction) {
  const id  = interaction.options.getInteger('id');
  const now = new Date();
  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `UPDATE game_logs SET payout_status='paid', payout_confirmed_at=$1 WHERE id=$2 AND guild_id=$3 RETURNING *`,
    [now, id, interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: '❌ Game not found.' });

  await query(
    `UPDATE member_wins SET payout_status='paid', paid_at=$1 WHERE ref_id=$2 AND type='game'`,
    [now, id]
  );
  await query(
    `UPDATE payout_reminders SET resolved=true WHERE type='game' AND ref_id=$1`,
    [id]
  );

  await interaction.editReply({ content: `✅ Game #${id} payout confirmed at ${tsF(now)}` });
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

  await interaction.editReply({
    content: `✅ Game schedule board set to <#${channel.id}>.\nThe bot will post and manage a live schedule there automatically whenever a game is logged or ended.`,
  });

  // Post initial board immediately
  await refreshScheduleBoard(interaction.client, interaction.guildId);
}
