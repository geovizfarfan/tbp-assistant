const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('payout')
    .setDescription('Confirm a prize was paid out')
    .addIntegerOption(o => o.setName('id').setDescription('The raffle, giveaway, or game ID').setRequired(true))
    .addUserOption(o => o.setName('winner').setDescription('Who received the prize').setRequired(true)),

  async execute(interaction) {
    const id             = interaction.options.getInteger('id');
    const winnerOverride = interaction.options.getUser('winner');
    const now            = new Date();
    await interaction.deferReply({ ephemeral: true });

    const staffRes = await query(`SELECT role FROM staff WHERE user_id=$1 AND active=true`, [interaction.user.id]);
    if (!staffRes.rows.length || !['admin','owner'].includes(staffRes.rows[0].role)) {
      return interaction.editReply({ content: `Only admins and owners can confirm payouts.` });
    }

    const tables = [
      { table: 'raffles',   type: 'raffle'   },
      { table: 'giveaways', type: 'giveaway' },
      { table: 'game_logs', type: 'game'     },
    ];

    let found = null;
    let foundType = null;

    for (const { table, type } of tables) {
      const res = await query(`SELECT * FROM ${table} WHERE id=$1 AND guild_id=$2`, [id, interaction.guildId]);
      if (res.rows.length) { found = res.rows[0]; foundType = type; break; }
    }

    if (!found) return interaction.editReply({ content: `${e('wrong')} No raffle, giveaway, or game found with ID #${id}.` });
    if (found.payout_status === 'paid') return interaction.editReply({ content: `${e('wrong')} #${id} is already marked as paid.` });

    const finalWinnerId = found.winner_id || winnerOverride.id;
    const tableMap = { raffle: 'raffles', giveaway: 'giveaways', game: 'game_logs' };

    await query(
      `UPDATE ${tableMap[foundType]} SET payout_status='paid', payout_confirmed_at=$1, winner_id=CASE WHEN winner_id IS NULL THEN $2 ELSE winner_id END WHERE id=$3`,
      [now, winnerOverride.id, id]
    );
    await query(`UPDATE member_wins SET payout_status='paid', paid_at=$1 WHERE ref_id=$2 AND type=$3`, [now, id, foundType]);

    if (!found.winner_id) {
      await query(
        `INSERT INTO member_wins (guild_id, user_id, username, type, ref_id, prize, prize_amount, currency, host_id, won_at, payout_status, paid_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),'paid',$10) ON CONFLICT DO NOTHING`,
        [interaction.guildId, winnerOverride.id, winnerOverride.username, foundType, id,
         found.prize, found.prize_amount, found.currency, found.host_id, now]
      );
    }

    await query(`UPDATE payout_reminders SET resolved=true WHERE type=$1 AND ref_id=$2`, [foundType, id]);

    const typeLabel = foundType.charAt(0).toUpperCase() + foundType.slice(1);
    const prize     = found.prize_amount ? `${found.prize_amount} ${found.currency}` : found.prize || 'N/A';

    const embed = baseEmbed(`${e('payout')} Payout Confirmed`, COLORS.softgreen, interaction.guild?.name)
      .addFields(
        { name: `Type`,                          value: typeLabel, inline: true },
        { name: `ID`,                            value: `#${id}`, inline: true },
        { name: `${e('trophies')} Winner`,       value: `<@${finalWinnerId}>`, inline: true },
        { name: `${e('purplesparkle')} Prize`,   value: prize, inline: true },
        { name: `${e('RojasClock')} Confirmed`,  value: tsF(now), inline: true },
        { name: `${e('members')} Confirmed by`,  value: `<@${interaction.user.id}>`, inline: true },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
