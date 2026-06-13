const { SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType } = require('discord.js');
const { query } = require('../../utils/database');
const { e } = require('../../utils/appEmojis');
const { baseEmbed, tsF, COLORS } = require('../../utils/embeds');
const { updateDailyProgress, sendCongratsIfGoalMet } = require('../../utils/dailyGoals');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('payout')
    .setDescription('Confirm a prize was paid out')
    .addUserOption(o => o.setName('staff').setDescription('Admin only: view another staff members unpaid games').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const now = new Date();
    const staffOverride = interaction.options.getUser('staff');

    const staffRes = await query(`SELECT role FROM staff WHERE user_id=$1 AND active=true`, [interaction.user.id]);
    if (!staffRes.rows.length || !['admin','owner','staff','host','rumble_host'].includes(staffRes.rows[0].role)) {
      return interaction.editReply({ content: `Only staff can confirm payouts.` });
    }

    const isAdmin  = ['admin','owner'].includes(staffRes.rows[0].role);
    const targetId = (staffOverride && isAdmin) ? staffOverride.id : interaction.user.id;
    if (staffOverride && !isAdmin) {
      return interaction.editReply({ content: `${e('wrong')} Only admins can view another staff member's payouts.` });
    }

    const unpaidGames = await query(
      `SELECT gl.id, gl.game_name, gl.prize, gl.prize_amount, gl.currency, gl.winner_id, gl.ended_at, 'game' as type,
              mw.username as winner_username
       FROM game_logs gl
       LEFT JOIN member_wins mw ON mw.ref_id = gl.id AND mw.type = 'game'
       WHERE gl.guild_id=$1 AND gl.host_id=$2 AND gl.payout_status NOT IN ('paid','n/a','not_claimed') AND gl.status='ended'
       ORDER BY gl.ended_at DESC`,
      [interaction.guildId, targetId]
    );
    const unpaidRaffles = await query(
      `SELECT r.id, r.prize, r.prize_amount, r.currency, r.winner_id, r.ended_at, 'raffle' as type,
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

    const options = allUnpaid.map(g => {
      const name     = (g.game_name || `Raffle #${g.id}`).replace(/<a?:[^:]+:\d+>/g, '').trim();
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
    const reply = await interaction.editReply({
      content: `${e('payout')} Select which game to confirm payout${forLabel}:`,
      components: [new ActionRowBuilder().addComponents(select)]
    });

    let collected;
    try {
      collected = await reply.awaitMessageComponent({
        filter: i => i.user.id === interaction.user.id,
        componentType: ComponentType.StringSelect,
        time: 120_000,
      });
    } catch {
      return interaction.editReply({ content: `${e('wrong')} Timed out.`, components: [] });
    }

    const [foundType, foundIdStr] = collected.values[0].split(':');
    const id = parseInt(foundIdStr);
    console.log('[Payout] Selected:', foundType, id);
    await collected.deferUpdate();

    const tableMap = { game: 'game_logs', raffle: 'raffles', giveaway: 'giveaways' };
    const foundRes = await query(`SELECT * FROM ${tableMap[foundType]} WHERE id=$1 AND guild_id=$2`, [id, interaction.guildId]);
    if (!foundRes.rows.length) return interaction.editReply({ content: `${e('wrong')} Not found.`, components: [] });
    const found = foundRes.rows[0];
    if (found.payout_status === 'paid') return interaction.editReply({ content: `${e('wrong')} Already marked as paid.`, components: [] });

    const finalWinnerId = found.winner_id;
    const prize = found.prize || (found.prize_amount ? `${found.prize_amount} ${found.currency}` : 'N/A');

    await query(`UPDATE ${tableMap[foundType]} SET payout_status='paid', payout_confirmed_at=$1 WHERE id=$2`, [now, id]);
    await query(`UPDATE member_wins SET payout_status='paid', paid_at=$1 WHERE ref_id=$2 AND type=$3`, [now, id, foundType]);
    await query(`UPDATE payout_reminders SET resolved=true WHERE type=$1 AND ref_id=$2`, [foundType, id]);

    try {
      await updateDailyProgress(interaction.guildId, found.host_id, 'payout');
      await sendCongratsIfGoalMet(interaction.client, interaction.guildId, found.host_id);
    } catch {}

    try {
      const annRes = await query(`SELECT * FROM winner_announcements WHERE game_id=$1 AND guild_id=$2 AND status='pending'`, [id, interaction.guildId]);
      if (annRes.rows.length) {
        const ann = annRes.rows[0];
        await query(`UPDATE winner_announcements SET status='claimed' WHERE id=$1`, [ann.id]);
        const winnerCh = await interaction.client.channels.fetch(ann.channel_id);
        const msg = await winnerCh.messages.fetch(ann.message_id);
        if (msg.embeds[0]) {
          const claimedEmbed = EmbedBuilder.from(msg.embeds[0])
            .setColor(0x7F36F5)
            .spliceFields(3, 1, {
              name: e('payout') + ' Status',
              value: e('checkmark') + ' Claimed — confirmed by <@' + interaction.user.id + '>',
              inline: false
            });
          await msg.edit({ embeds: [claimedEmbed] });
        }
      }
    } catch (err) { console.error('[Payout] Winner message update failed:', err.message); }

    try {
      const cfgRes = await query(`SELECT game_transcript_channel_id FROM guild_config WHERE guild_id=$1`, [interaction.guildId]);
      if (cfgRes.rows.length && cfgRes.rows[0].game_transcript_channel_id && foundType === 'game') {
        const transcriptCh = await interaction.client.channels.fetch(cfgRes.rows[0].game_transcript_channel_id);
        const durationMs   = now - new Date(found.started_at);
        const durationMins = Math.round(durationMs / 60000);
        const durationHrs  = Math.floor(durationMins / 60);
        const durationRem  = durationMins % 60;
        const durationStr  = durationHrs > 0 ? (durationRem > 0 ? `${durationHrs}h ${durationRem}m` : `${durationHrs}h`) : `${durationMins}m`;
        const transcriptEmbed = baseEmbed(`${e('receipt')} Game Transcript — ${found.game_name}`, 0xCBC3E3, interaction.guild?.name)
          .addFields(
            { name: `${e('controller')} Game`,        value: found.game_name, inline: true },
            { name: `${e('members')} Host`,            value: `<@${found.host_id}>`, inline: true },
            { name: `${e('trophies')} Winner`,         value: finalWinnerId ? `<@${finalWinnerId}>` : 'N/A', inline: true },
            { name: `${e('purplesparkle')} Prize`,     value: prize, inline: true },
            { name: `${e('RojasClock')} Started`,      value: tsF(found.started_at), inline: true },
            { name: `${e('confetti')} Ended`,          value: tsF(found.ended_at), inline: true },
            { name: `${e('RojasClock')} Duration`,     value: durationStr, inline: true },
            { name: `${e('payout')} Payout`,           value: `${e('checkmark')} Confirmed by <@${interaction.user.id}>`, inline: true },
            { name: `${e('purplesparkle')} Jump Link`, value: found.message_link ? `[View Game](${found.message_link})` : 'N/A', inline: true },
          );
        await transcriptCh.send({ embeds: [transcriptEmbed] });
      }
    } catch (err) { console.error('[Payout] Transcript post failed:', err.message); }

    const typeLabel = foundType.charAt(0).toUpperCase() + foundType.slice(1);
    const embed = baseEmbed(`${e('payout')} Payout Confirmed`, COLORS.softgreen, interaction.guild?.name)
      .addFields(
        { name: `${e('controller')} Type`,     value: typeLabel, inline: true },
        { name: `${e('trophies')} Winner`,     value: finalWinnerId ? `<@${finalWinnerId}>` : 'N/A', inline: true },
        { name: `${e('purplesparkle')} Prize`, value: prize, inline: true },
      );

    await interaction.editReply({ embeds: [embed], components: [] });
  },
};
