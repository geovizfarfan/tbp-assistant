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
      .addStringOption(o => o.setName('game').setDescription('Game name').setRequired(true))
      .addStringOption(o => o.setName('link').setDescription('Message link to the game post').setRequired(true))
      .addStringOption(o => o.setName('prize').setDescription('Prize description').setRequired(false))
      .addIntegerOption(o => o.setName('amount').setDescription('Prize amount').setRequired(false))
      .addStringOption(o => o.setName('currency').setDescription('Currency').setRequired(false)
        .addChoices(
          { name: 'Goos (Ghosty)',        value: 'Goos'   },
          { name: 'Sins (Play & Regret)', value: 'Sins'   },
          { name: 'Crowns (MEE6)',        value: 'Crowns' },
        ))
      .addStringOption(o => o.setName('start_time').setDescription('Start time e.g. 8PM or <t:UNIX:F>').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('end')
      .setDescription('End a game and log the winner')
      .addStringOption(o => o.setName('link').setDescription('Message link of the game').setRequired(true))
      .addUserOption(o => o.setName('winner').setDescription('The winner').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('payout')
      .setDescription('Confirm payout was sent')
      .addIntegerOption(o => o.setName('id').setDescription('Game log ID').setRequired(true))
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
    if (sub === 'payout')    await payoutGame(interaction);
    if (sub === 'set-board') await setBoard(interaction);
  },
};

async function logGame(interaction) {
  const gameName = interaction.options.getString('game');
  const link     = interaction.options.getString('link');
  const prize    = interaction.options.getString('prize') || null;
  const amount   = interaction.options.getInteger('amount') || null;
  const currency = interaction.options.getString('currency') || 'Goos';
  const startRaw = interaction.options.getString('start_time') || null;

  let startedAt = new Date();
  if (startRaw) {
    const unixMatch = startRaw.match(/<t:(\d+)/);
    if (unixMatch) startedAt = new Date(parseInt(unixMatch[1]) * 1000);
    else { const parsed = new Date(startRaw); if (!isNaN(parsed)) startedAt = parsed; }
  }

  await interaction.deferReply({ ephemeral: true });

  const res = await query(
    `INSERT INTO game_logs (guild_id, channel_id, message_link, host_id, game_name, prize, prize_amount, currency, started_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [interaction.guildId, interaction.channelId, link, interaction.user.id, gameName, prize, amount, currency, startedAt]
  );
  const gameId = res.rows[0].id;
  const prizeDisplay = amount ? `${amount} ${currency}` : (prize || 'No prize listed');

  const embed = baseEmbed(`${e('controller')} Game Logged — ${gameName}`, COLORS.lightpurple, interaction.guild?.name)
    .setDescription('A new game is live! Click the link below to jump in.')
    .addFields(
      { name: `${e('controller')} Game`,    value: gameName, inline: true },
      { name: `${e('members')} Host`,       value: `<@${interaction.user.id}>`, inline: true },
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
  await interaction.deferReply();

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

  const duration = Math.round((now - new Date(game.started_at)) / 60000);
  const embed = baseEmbed(`${e('confetti')} Game Ended — ${game.game_name}`, COLORS.tbppurple, interaction.guild?.name)
    .addFields(
      { name: `${e('trophies')} Winner`,    value: `<@${winner.id}>`, inline: true },
      { name: `${e('members')} Host`,       value: `<@${game.host_id}>`, inline: true },
      { name: `${e('purplesparkle')} Prize`,value: game.prize_amount ? `${game.prize_amount} ${game.currency}` : (game.prize || 'N/A'), inline: true },
      { name: `${e('RojasClock')} Started`, value: tsF(game.started_at), inline: true },
      { name: `${e('confetti')} Ended`,     value: tsF(now), inline: true },
      { name: `${e('RojasClock')} Duration`,value: `${duration} minutes`, inline: true },
      { name: `${e('payout')} Payout`,      value: game.prize ? `${e('Loading')} Pending — host will reach out` : 'N/A', inline: false },
    );

  await interaction.editReply({ embeds: [embed] });
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
  if (!res.rows.length) return interaction.editReply({ content: `${e('wrong')} Game not found.` });

  await query(`UPDATE member_wins SET payout_status='paid', paid_at=$1 WHERE ref_id=$2 AND type='game'`, [now, id]);
  await query(`UPDATE payout_reminders SET resolved=true WHERE type='game' AND ref_id=$1`, [id]);
  await interaction.editReply({ content: `${e('checkmark')} Game #${id} payout confirmed at ${tsF(now)}` });
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
