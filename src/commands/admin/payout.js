const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { updateDailyProgress, sendCongratsIfGoalMet } = require('../../utils/dailyGoals');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('payout')
    .setDescription('Confirm a prize was paid out')
,

  async execute(interaction) {
    const now = new Date();
    await interaction.deferReply({ ephemeral: true });

    const staffRes = await query(
      `SELECT role FROM staff WHERE user_id=$1 AND active=true`,
      [interaction.user.id]
    );
    if (!staffRes.rows.length || !['admin','owner','staff','host','rumble_host'].includes(staffRes.rows[0].role)) {
      return interaction.editReply({ content: `Only staff can confirm payouts.` });
    }

    const unpaidGames = await query(
      `SELECT id, game_name, prize, prize_amount, currency, winner_id, 'game' as type FROM game_logs
       WHERE guild_id=$1 AND host_id=$2 AND payout_status != 'paid' AND payout_status != 'n/a' AND status='ended'
       ORDER BY ended_at DESC`,
      [interaction.guildId, interaction.user.id]
    );
    const unpaidRaffles = await query(
      `SELECT id, prize, prize_amount, currency, winner_id, 'raffle' as type FROM raffles
       WHERE guild_id=$1 AND host_id=$2 AND payout_status != 'paid' AND status='ended'
       ORDER BY ended_at DESC`,
      [interaction.guildId, interaction.user.id]
    );

    const allUnpaid = [...unpaidGames.rows, ...unpaidRaffles.rows];
    if (!allUnpaid.length) return interaction.editReply({ content: `${e('checkmark')} You have no unpaid games or raffles!` });

    const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType } = require('discord.js');
    const options = allUnpaid.map(g => {
      const name   = g.game_name || `Raffle #${g.id}`;
      const prize  = (g.prize || (g.prize_amount ? `${g.prize_amount} ${g.currency}` : 'No prize')).replace(/<[^>]+>/g, '').replace(/:[^:]+:/g, '').trim();
      const winner = g.winner_id ? `Winner ID: ${g.winner_id}` : 'No winner yet';
      return new StringSelectMenuOptionBuilder()
        .setLabel(`${name} — ${prize}`.slice(0, 100))
        .setDescription(winner.slice(0, 100))
        .setValue(`${g.type}:${g.id}`);
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId('payout_select')
      .setPlaceholder('Select the game to confirm payout for...')
      .addOptions(options);
    await interaction.editReply({ content: `${e('payout')} Select which game to confirm payout for:`, components: [new ActionRowBuilder().addComponents(select)] });

    let collected;
    try {
      collected = await interaction.channel.awaitMessageComponent({
        filter: i => i.customId === 'payout_select' && i.user.id === interaction.user.id,
        componentType: ComponentType.StringSelect,
        time: 60_000,
      });
    } catch {
      return interaction.editReply({ content: `${e('wrong')} Timed out.`, components: [] });
    }

    const [foundType, foundIdStr] = collected.values[0].split(':');
    const id = parseInt(foundIdStr);
    await collected.deferUpdate();

    const tableMap = { game: 'game_logs', raffle: 'raffles', giveaway: 'giveaways' };
    const foundRes = await query(`SELECT * FROM ${tableMap[foundType]} WHERE id=$1 AND guild_id=$2`, [id, interaction.guildId]);
    if (!foundRes.rows.length) return interaction.editReply({ content: `${e('wrong')} Not found.`, components: [] });
    const found = foundRes.rows[0];
    if (found.payout_status === 'paid') return interaction.editReply({ content: `${e('wrong')} Already marked as paid.`, components: [] });

    const finalWinnerId = found.winner_id;
  },
};
