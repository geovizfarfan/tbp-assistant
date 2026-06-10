const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { updateDailyProgress, sendCongratsIfGoalMet } = require('../../utils/dailyGoals');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('payout')
    .setDescription('Confirm a prize was paid out')
    .addUserOption(o => o.setName('winner').setDescription('Who received the prize').setRequired(true)),

  async execute(interaction) {
    const id     = interaction.options.getInteger('id');
    const winnerOverride = interaction.options.getUser('winner') || null;
    const now = new Date();
    await interaction.deferReply({ ephemeral: true });

    // Try all three tables
    const tables = [
      { table: 'raffles',   type: 'raffle'   },
      { table: 'giveaways', type: 'giveaway' },
      { table: 'game_logs', type: 'game'     },
    ];

    let found = null;
    let foundType = null;

    for (const { table, type } of tables) {
      const res = await query(
        `SELECT * FROM ${table} WHERE id=$1 AND guild_id=$2`,
        [id, interaction.guildId]
      );
      if (res.rows.length) {
        found = res.rows[0];
        foundType = type;
        break;
      }
    }

    if (!found) {
      return interaction.editReply({ content: `${e('wrong')} No raffle, giveaway, or game found with ID #${id}.` });
    }

    if (found.payout_status === 'paid') {
      return interaction.editReply({ content: `${e('wrong')} #${id} is already marked as paid.` });
    }

    // Use override winner if provided
    const finalWinnerId = winnerOverride ? winnerOverride.id : found.winner_id;

    // Mark paid in the right table
    const tableMap = { raffle: 'raffles', giveaway: 'giveaways', game: 'game_logs' };
    await query(
      `UPDATE ${tableMap[foundType]} SET payout_status='paid', payout_confirmed_at=$1, winner_id=CASE WHEN winner_id IS NULL THEN $2 ELSE winner_id END WHERE id=$3`,
      [now, finalWinnerId, id]
    );
    await query(
      `UPDATE member_wins SET payout_status='paid', paid_at=$1 WHERE ref_id=$2 AND type=$3`,
      [now, id, foundType]
    );
    // If new winner provided and not already in member_wins, add them
    if (winnerOverride && !found.winner_id) {
      await query(
        `INSERT INTO member_wins (guild_id, user_id, username, type, ref_id, prize, prize_amount, currency, host_id, won_at, payout_status, paid_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),'paid',$10)
         ON CONFLICT DO NOTHING`,
        [interaction.guildId, winnerOverride.id, winnerOverride.username, foundType, id,
         found.prize, found.prize_amount, found.currency, found.host_id, now]
      );
    }
    await query(
      `UPDATE payout_reminders SET resolved=true WHERE type=$1 AND ref_id=$2`,
      [foundType, id]
    );

    // Update winner announcement to Claimed
    try {
      const { e } = require('../../utils/appEmojis');
      const { EmbedBuilder } = require('discord.js');
      const annRes = await query(`SELECT * FROM winner_announcements WHERE game_id=$1 AND guild_id=$2 AND status='pending'`, [id, interaction.guildId]);
      if (annRes.rows.length) {
        const ann = annRes.rows[0];
        await query(`UPDATE winner_announcements SET status='claimed' WHERE id=$1`, [ann.id]);
        const winnerCh = await interaction.client.channels.fetch(ann.channel_id);
        const msg = await winnerCh.messages.fetch(ann.message_id);
        if (msg.embeds[0]) {
          const claimedEmbed = EmbedBuilder.from(msg.embeds[0])
            .spliceFields(3, 1, {
              name: e('payout') + ' Status',
              value: e('checkmark') + ' Claimed — confirmed by <@' + interaction.user.id + '>',
              inline: false
            });
          await msg.edit({ embeds: [claimedEmbed] });
        }
      }
    } catch (err) { console.error('[Payout] Winner message update failed:', err.message); }

    const prize = found.prize_amount ? `${found.prize_amount} ${found.currency}` : found.prize || 'N/A';

    // Post transcript to admin channel after payout confirmed
    try {
      const { e } = require('../../utils/appEmojis');
      const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');
      const cfgRes = await query(`SELECT game_transcript_channel_id FROM guild_config WHERE guild_id=$1`, [interaction.guildId]);
      if (cfgRes.rows.length && cfgRes.rows[0].game_transcript_channel_id && foundType === 'game') {
        const transcriptCh = await interaction.client.channels.fetch(cfgRes.rows[0].game_transcript_channel_id);
        const durationMs = now - new Date(found.started_at);
        const durationMins = Math.round(durationMs / 60000);
        const durationHrs = Math.floor(durationMins / 60);
        const durationRem = durationMins % 60;
        const durationStr = durationHrs > 0 ? (durationRem > 0 ? `${durationHrs}h ${durationRem}m` : `${durationHrs}h`) : `${durationMins}m`;
        const transcriptEmbed = baseEmbed(`${e('receipt')} Game Transcript — ${found.game_name}`, 0xCBC3E3, interaction.guild?.name)
          .addFields(
            { name: `${e('controller')} Game`,         value: found.game_name, inline: true },
            { name: `${e('members')} Host`,             value: `<@${found.host_id}>`, inline: true },
            { name: `${e('trophies')} Winner`,          value: `<@${finalWinnerId}>`, inline: true },
            { name: `${e('purplesparkle')} Prize`,      value: prize, inline: true },
            { name: `${e('RojasClock')} Started`,       value: tsF(found.started_at), inline: true },
            { name: `${e('confetti')} Ended`,           value: tsF(found.ended_at), inline: true },
            { name: `${e('RojasClock')} Duration`,      value: durationStr, inline: true },
            { name: `${e('payout')} Payout`,            value: `${e('checkmark')} Confirmed by <@${interaction.user.id}>`, inline: true },
            { name: `${e('members')} Confirmed by`,     value: `<@${interaction.user.id}>`, inline: true },
            { name: `${e('purplesparkle')} Jump Link`,  value: found.message_link ? `[View Game](${found.message_link})` : 'N/A', inline: true },
          );
        await transcriptCh.send({ embeds: [transcriptEmbed] });
      }
    } catch (err) { console.error('[Payout] Transcript post failed:', err.message); }

    const typeLabel = foundType.charAt(0).toUpperCase() + foundType.slice(1);
    const winner = finalWinnerId ? `<@${finalWinnerId}>` : 'N/A';

    const embed = baseEmbed(`${e('payout')} Payout Confirmed`, COLORS.softgreen, interaction.guild?.name)
      .addFields(
        { name: `Type`,                            value: typeLabel, inline: true },
        { name: `ID`,                              value: `#${id}`, inline: true },
        { name: `${e('trophies')} Winner`,         value: winner, inline: true },
        { name: `${e('purplesparkle')} Prize`,     value: prize, inline: true },
        { name: `${e('RojasClock')} Confirmed`,    value: tsF(now), inline: true },
        { name: `${e('members')} Confirmed by`,    value: `<@${interaction.user.id}>`, inline: true },
      );

    await interaction.editReply({ embeds: [embed], components: [] });
  },
};
