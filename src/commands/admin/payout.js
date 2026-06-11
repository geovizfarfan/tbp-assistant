const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { updateDailyProgress, sendCongratsIfGoalMet } = require('../../utils/dailyGoals');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('payout')
    .setDescription('Confirm a prize was paid out')
    .addUserOption(o => o.setName('staff').setDescription('Admin only: view another staff members unpaid games').setRequired(false)),

  async execute(interaction) {
    const now         = new Date();
    const staffOverride = interaction.options.getUser('staff');
    await interaction.deferReply({ ephemeral: true });

    const staffRes = await query(`SELECT role FROM staff WHERE user_id=$1 AND active=true`, [interaction.user.id]);
    if (!staffRes.rows.length || !['admin','owner','staff','host','rumble_host'].includes(staffRes.rows[0].role)) {
      return interaction.editReply({ content: `Only staff can confirm payouts.` });
    }

    // Only admin/owner can view other staff's games
    const isAdmin = ['admin','owner'].includes(staffRes.rows[0].role);
    const targetId = (staffOverride && isAdmin) ? staffOverride.id : interaction.user.id;
    if (staffOverride && !isAdmin) {
      return interaction.editReply({ content: `${e('wrong')} Only admins can view another staff member's payouts.` });
    }

    const unpaidGames = await query(
      `SELECT gl.id, gl.game_name, gl.prize, gl.prize_amount, gl.currency, gl.winner_id, 'game' as type,
              mw.username as winner_username
       FROM game_logs gl
       LEFT JOIN member_wins mw ON mw.ref_id = gl.id AND mw.type = 'game'
       WHERE gl.guild_id=$1 AND gl.host_id=$2 AND gl.payout_status NOT IN ('paid','n/a','not_claimed') AND gl.status='ended'
       ORDER BY gl.ended_at DESC`,
      [interaction.guildId, targetId]
    );
    const unpaidRaffles = await query(
      `SELECT r.id, r.prize, r.prize_amount, r.currency, r.winner_id, 'raffle' as type,
              mw.username as winner_username
       FROM raffles r
       LEFT JOIN member_wins mw ON mw.ref_id = r.id AND mw.type = 'raffle'
       WHERE r.guild_id=$1 AND r.host_id=$2 AND r.payout_status != 'paid' AND r.status='ended'
       ORDER BY r.ended_at DESC`,
      [interaction.guildId, targetId]
    );

    const allUnpaid = [...unpaidGames.rows, ...unpaidRaffles.rows];
    const targetName = (staffOverride && isAdmin) ? staffOverride.username : 'You';
    if (!allUnpaid.length) return interaction.editReply({ content: `${e('checkmark')} ${targetName} has no unpaid games or raffles!` });

    const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType } = require('discord.js');
    const options = allUnpaid.map(g => {
      const name     = g.game_name || `Raffle #${g.id}`;
      const prize    = (g.prize || (g.prize_amount ? `${g.prize_amount} ${g.currency}` : 'No prize')).replace(/<[^>]+>/g, '').replace(/:[^:]+:/g, '').trim();
      const winner   = g.winner_username ? `Winner: ${g.winner_username}` : (g.winner_id ? `Winner: ${g.winner_id}` : 'No winner yet');
      const isAuto   = /rumble|regret|dice attack|auto game/i.test(name);
      const category = g.type === 'raffle' ? 'Raffle' : g.type === 'giveaway' ? 'Giveaway' : isAuto ? 'Auto-Game' : 'Game';
      return new StringSelectMenuOptionBuilder()
        .setLabel(`[${category}] ${name} — ${prize}`.slice(0, 100))
        .setDescription(winner.slice(0, 100))
        .setValue(`${g.type}:${g.id}`);
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId('payout_select')
      .setPlaceholder('Select the game to confirm payout for...')
      .addOptions(options);
    const forLabel = (staffOverride && isAdmin) ? ` for ${staffOverride.username}` : '';
    await interaction.editReply({ content: `${e('payout')} Select which game to confirm payout${forLabel}:`, components: [new ActionRowBuilder().addComponents(select)] });

    let collected;
    try {
      collected = await interaction.awaitMessageComponent({
        filter: i => i.customId === 'payout_select',
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
