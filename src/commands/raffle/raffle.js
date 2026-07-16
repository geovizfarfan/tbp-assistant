const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { adjustBalance, getBalance } = require('../../utils/playAndRegretDb');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');
const { getPrizeImage, getPrizeLabel } = require('../../utils/prizeImages');
const { refreshScheduleBoard, removeFromBoard } = require('../../utils/scheduleBoard');

const PRIZE_CHOICES = [
  { label: 'Discord Profile Accessory', value: 'accessory',   emoji: '💎' },
  { label: 'Discord Nitro',             value: 'nitro',       emoji: '✨' },
  { label: 'Partner Carry',             value: 'carry',       emoji: '🤝' },
  { label: 'Goos',                      value: 'goos',        emoji: '👻' },
  { label: 'Sins',                      value: 'sins',        emoji: '💀' },
  { label: 'Crowns',                    value: 'crowns',      emoji: '👑' },
  { label: 'Gift Card',                 value: 'gift_card',   emoji: '🎁' },
  { label: 'Sticker Pack',              value: 'sticker',     emoji: '🎀' },
  { label: 'Other Gift (specify below)',value: 'gift',        emoji: '🎀' },
  { label: 'Kirby',                     value: 'kirby',       emoji: '🩷' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raffle')
    .setDescription('Raffle management')
    .addSubcommand(sub => sub
      .setName('start')
      .setDescription('Start a new raffle')
      .addStringOption(o => o.setName('prize').setDescription('Prize type').setRequired(true)
        .addChoices(
          { name: 'Discord Profile Accessory', value: 'accessory'   },
          { name: 'Discord Nitro Basic',        value: 'nitro_basic' },
          { name: 'Discord Nitro',              value: 'nitro_premium'},
          { name: 'Partner Carry',              value: 'carry'       },
          { name: 'Goos',                       value: 'goos'        },
          { name: 'Sins',                       value: 'sins'        },
          { name: 'Crowns',                     value: 'crowns'      },
          { name: 'Gift Card',                  value: 'gift_card'   },
          { name: 'Sticker Pack',               value: 'sticker'     },
          { name: 'Other Gift',                 value: 'gift'        },
          { name: 'Kirby',                      value: 'kirby'       },
        ))
      .addStringOption(o => o.setName('duration').setDescription('How long the raffle runs e.g. 2h, 30m, 1h30m, 24h').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Prize amount (if currency-based)').setRequired(false))
      .addStringOption(o => o.setName('custom_prize').setDescription('Custom prize name (only for Other Gift)').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('end')
      .setDescription('Manually end a raffle')
      .addIntegerOption(o => o.setName('id').setDescription('Raffle ID').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List raffles')
      .addBooleanOption(o => o.setName('ended').setDescription('Show ended raffles instead of active').setRequired(false))
      .addUserOption(o => o.setName('user').setDescription('Admin only: view another staff member\'s raffles').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('cancel')
      .setDescription('Cancel an active raffle — no winner selected')
      .addIntegerOption(o => o.setName('id').setDescription('Raffle ID').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for cancellation').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') await startRaffle(interaction);
    if (sub === 'end')   await endRaffle(interaction);
    if (sub === 'list')   await listRaffles(interaction);
    if (sub === 'cancel') await cancelRaffle(interaction);
  },
};


function parseDuration(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();
  let ms = 0;
  const hours   = str.match(/(\d+)h/);
  const minutes = str.match(/(\d+)m/);
  if (hours)   ms += parseInt(hours[1])   * 60 * 60 * 1000;
  if (minutes) ms += parseInt(minutes[1]) * 60 * 1000;
  if (ms === 0) {
    // Try plain number as minutes
    const num = parseInt(str);
    if (!isNaN(num) && num > 0) ms = num * 60 * 1000;
  }
  return ms > 0 ? ms : null;
}

async function startRaffle(interaction) {
  const prizeKey   = interaction.options.getString('prize');
  const endsRaw    = interaction.options.getString('duration');
  const amount     = interaction.options.getInteger('amount') || null;
  const customName = interaction.options.getString('custom_prize') || null;

  const durationMs = parseDuration(endsRaw);
  if (!durationMs) return interaction.reply({ content: `${e('wrong')} Invalid duration. Use formats like: \`2h\`, \`30m\`, \`1h30m\`, \`24h\`, \`90m\`.`, ephemeral: true });
  const endsAt = new Date(Date.now() + durationMs);

  await interaction.deferReply({ ephemeral: true });

  // Sins prizes: paid from the host's own wallet — open to any server, since
  // it's a real transfer, not the bot minting free Sins
  let sinsReserved = false;
  if (prizeKey === 'sins' && amount) {
    const hostBalance = await getBalance(interaction.user.id);
    if (hostBalance === null || Number(hostBalance) < amount) {
      return interaction.editReply(`${e('wrong')} You don't have enough Sins to fund this raffle (need ${amount.toLocaleString()}, you have ${Number(hostBalance || 0).toLocaleString()}). Raffles are paid from your own wallet.`);
    }
    // Reserve the funds now — deducted from host immediately, released to the winner when the raffle ends
    await adjustBalance(interaction.user.id, interaction.user.username, -amount);
    sinsReserved = true;
  }

  const prizeLabel   = getPrizeLabel(prizeKey, customName);
  const displayPrize = amount ? `${amount} ${prizeLabel}` : prizeLabel;
  const imageData    = await getPrizeImage(interaction.guildId, prizeKey);

  const embed = baseEmbed(`${e('raffle')} RAFFLE`, COLORS.lightpurple, interaction.guild?.name)
    .setDescription(
      `**Prize:** ${displayPrize}\n**Host:** <@${interaction.user.id}>\n**Ends:** ${tsF(endsAt)} (${tsR(endsAt)})`
    )
    .addFields({ name: `${e('member')} Entries`, value: '0 entries so far — be the first!' })
    .setFooter({ text: `${interaction.guild?.name || '👑 Royal Ops'} — Click Join Raffle to enter!` });

  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('raffle_join').setLabel('🎟️ Join Raffle').setStyle(ButtonStyle.Primary)
  );

  let msgPayload = { embeds: [embed], components: [joinRow] };
  let attachmentName = null;

  if (imageData.type === 'attachment') {
    const attachment = new AttachmentBuilder(imageData.filepath, { name: imageData.filename });
    embed.setThumbnail(`attachment://${imageData.filename}`);
    msgPayload.files = [attachment];
    attachmentName = imageData.filename;
  } else if (imageData.type === 'url') {
    embed.setThumbnail(imageData.url);
  }

  await interaction.editReply({ content: `${e('checkmark')} Raffle started!` });
  const msg = await interaction.channel.send(msgPayload);

  const res = await query(
    `INSERT INTO raffles (guild_id, channel_id, message_id, host_id, prize, prize_amount, currency, ends_at, prize_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [interaction.guildId, interaction.channelId, msg.id, interaction.user.id, prizeLabel, amount,
     ['goos','sins','crowns'].includes(prizeKey) ? prizeKey.toUpperCase() : prizeKey, endsAt, prizeKey]
  );
  const raffleId = res.rows[0].id;

  // Refresh schedule board to show new raffle
  await refreshScheduleBoard(interaction.client, interaction.guildId, true);

  const msUntilEnd = endsAt.getTime() - Date.now();
  if (msUntilEnd > 0) {
    setTimeout(() => autoEndRaffle(interaction.client, raffleId, interaction.guildId, interaction.channelId, msg.id), msUntilEnd);
  } else {
    // Already expired during setup, end immediately
    await autoEndRaffle(interaction.client, raffleId, interaction.guildId, interaction.channelId, msg.id);
  }

}

async function autoEndRaffle(client, raffleId, guildId, channelId, messageId) {
  try {
    const raffleRes = await query(`SELECT * FROM raffles WHERE id=$1`, [raffleId]);
    const raffle    = raffleRes.rows[0];
    if (!raffle || raffle.status !== 'active') return;

    const entriesRes = await query(`SELECT * FROM raffle_entries WHERE raffle_id=$1`, [raffleId]);
    const entries    = entriesRes.rows;
    const now        = new Date();
    const guild      = await client.guilds.fetch(guildId);
    const channel    = await guild.channels.fetch(channelId);

    if (!entries.length) {
      await query(`UPDATE raffles SET status='ended', ended_at=$1 WHERE id=$2`, [now, raffleId]);
      // Refund the host if Sins were reserved for this raffle and nobody entered
      if (raffle.currency === 'SINS' && raffle.prize_amount) {
        const hostUser = await client.users.fetch(raffle.host_id).catch(() => null);
        await adjustBalance(raffle.host_id, hostUser?.username || 'Unknown', Number(raffle.prize_amount)).catch(() => {});
      }
      await channel.send({ embeds: [baseEmbed(`${e('raffle')} RAFFLE ENDED`, COLORS.grey, guild.name).setDescription('No entries — no winner.' + (raffle.currency === 'SINS' && raffle.prize_amount ? ' Reserved Sins have been refunded to the host.' : ''))] });
      return;
    }

    const winner = entries[Math.floor(Math.random() * entries.length)];
    const hostWonOwnRaffle = raffle.host_id === winner.user_id;

    // Auto-award Sins immediately if this raffle's prize is a Sins amount
    const isSinsRaffle = raffle.currency === 'SINS' && raffle.prize_amount;
    let sinsAwarded = false;
    if (isSinsRaffle && !hostWonOwnRaffle) {
      try {
        await adjustBalance(winner.user_id, winner.username, raffle.prize_amount);
        sinsAwarded = true;
        console.log(`[Raffle] Auto-awarded ${raffle.prize_amount} Sins to ${winner.username}`);
      } catch (err) {
        console.error('[Raffle] Sins award failed:', err.message);
      }
    } else if (isSinsRaffle && hostWonOwnRaffle) {
      // Host won their own raffle — refund the reserved Sins rather than a no-op transfer
      const hostUser = await client.users.fetch(raffle.host_id).catch(() => null);
      await adjustBalance(raffle.host_id, hostUser?.username || 'Unknown', Number(raffle.prize_amount)).catch(() => {});
      sinsAwarded = true;
    }

    await query(`UPDATE raffles SET status='ended', ended_at=$1, winner_id=$2, payout_status=$3 WHERE id=$4`, [now, winner.user_id, hostWonOwnRaffle ? 'n/a' : (sinsAwarded ? 'paid' : 'pending'), raffleId]);

    await query(
      `INSERT INTO member_wins (guild_id, user_id, username, type, ref_id, prize, prize_amount, currency, host_id, won_at)
       VALUES ($1,$2,$3,'raffle',$4,$5,$6,$7,$8,$9)`,
      [guildId, winner.user_id, winner.username, raffleId, raffle.prize, raffle.prize_amount, raffle.currency, raffle.host_id, now]
    );

    if (!hostWonOwnRaffle && !sinsAwarded) {
      await query(
        `INSERT INTO payout_reminders (type, ref_id, host_id, winner_id, prize, guild_id, channel_id)
         VALUES ('raffle',$1,$2,$3,$4,$5,$6)`,
        [raffleId, raffle.host_id, winner.user_id, `${raffle.prize_amount ? raffle.prize_amount + ' ' : ''}${raffle.prize}`, guildId, channelId]
      );
    }

    // Get ticket channel if configured
    let ticketMention = 'our support channel';
    try {
      const cfgRes = await query(`SELECT ticket_channel_id FROM guild_config WHERE guild_id=$1`, [guildId]);
      if (cfgRes.rows.length && cfgRes.rows[0].ticket_channel_id) {
        ticketMention = `<#${cfgRes.rows[0].ticket_channel_id}>`;
      }
    } catch {}

    const prizeText = raffle.prize_amount ? `${raffle.prize_amount} ${raffle.prize}` : raffle.prize;
    const payoutFieldValue = hostWonOwnRaffle
      ? 'N/A'
      : (sinsAwarded
        ? `${e('checkmark')} Automatically added to your Sins balance!`
        : `${e('Loading')} Pending — please open a ticket in ${ticketMention} to claim your prize!`);
    const winnerImageData = await getPrizeImage(guildId, raffle.prize_key);
    const winEmbed = baseEmbed(`${e('confetti')} Raffle Winner — ${prizeText} Raffle`, COLORS.tbppurple, guild.name)
      .addFields(
        { name: `${e('trophies')} Winner`,     value: `<@${winner.user_id}>`, inline: true },
        { name: `${e('purplesparkle')} Prize`,  value: prizeText, inline: true },
        { name: `${e('members')} Host`,         value: `<@${raffle.host_id}>`, inline: true },
        { name: `${e('payout')} Payout`,        value: payoutFieldValue, inline: false },
      );

    let winMsgPayload = { content: `${e('confetti')} Congratulations <@${winner.user_id}>!`, embeds: [winEmbed] };
    if (winnerImageData.type === 'attachment') {
      const winAttachment = new AttachmentBuilder(winnerImageData.filepath, { name: winnerImageData.filename });
      winEmbed.setThumbnail(`attachment://${winnerImageData.filename}`);
      winMsgPayload.files = [winAttachment];
    } else if (winnerImageData.type === 'url') {
      winEmbed.setThumbnail(winnerImageData.url);
    }
    await channel.send(winMsgPayload);

    // Post to #winners channel
    try {
      const winnerCfgRes = await query(`SELECT winner_channel_id, ticket_channel_id FROM guild_config WHERE guild_id=$1`, [guildId]);
      if (winnerCfgRes.rows.length && winnerCfgRes.rows[0].winner_channel_id) {
        const winnerChId = winnerCfgRes.rows[0].winner_channel_id;
        const winnerCh = await guild.channels.fetch(winnerChId);
        const winnersEmbed = baseEmbed(`${e('confetti')} Raffle Winner — ${prizeText} Raffle`, hostWonOwnRaffle ? 0xFFFF00 : 0xFF00C1, guild.name)
          .addFields(
            { name: `${e('trophies')} Winner`,    value: `<@${winner.user_id}>`, inline: true },
            { name: `${e('purplesparkle')} Prize`, value: prizeText, inline: true },
            { name: `${e('members')} Host`,        value: `<@${raffle.host_id}>`, inline: true },
            { name: `${e('payout')} Payout`,       value: payoutFieldValue, inline: false },
            { name: `${e('receipt')} Raffle ID`,   value: `#${raffleId}`, inline: true },
          );
        let winnersMsgPayload = { content: `${e('confetti')} Congratulations <@${winner.user_id}>!`, embeds: [winnersEmbed] };
        if (winnerImageData.type === 'attachment') {
          const winnersAttachment = new AttachmentBuilder(winnerImageData.filepath, { name: winnerImageData.filename });
          winnersEmbed.setThumbnail(`attachment://${winnerImageData.filename}`);
          winnersMsgPayload.files = [winnersAttachment];
        } else if (winnerImageData.type === 'url') {
          winnersEmbed.setThumbnail(winnerImageData.url);
        }
        if (!hostWonOwnRaffle && !sinsAwarded) {
          const raffleClaimedButton = new ButtonBuilder()
            .setCustomId('rafflewin_claimed_' + raffleId)
            .setLabel('Claimed')
            .setEmoji('\u2705')
            .setStyle(ButtonStyle.Success);
          const raffleNotClaimedButton = new ButtonBuilder()
            .setCustomId('rafflewin_notclaimed_' + raffleId)
            .setLabel('Not Claimed')
            .setEmoji('\u274c')
            .setStyle(ButtonStyle.Danger);
          winnersMsgPayload.components = [new ActionRowBuilder().addComponents(raffleClaimedButton, raffleNotClaimedButton)];
        }
        const winnerMsg = await winnerCh.send(winnersMsgPayload);
        await query(
          `INSERT INTO winner_announcements (guild_id, game_id, channel_id, message_id, winner_id, prize, is_booster)
           VALUES ($1,$2,$3,$4,$5,$6,false)`,
          [guildId, raffleId, winnerChId, winnerMsg.id, winner.user_id, prizeText]
        );
      }
    } catch (err) { console.error('[Raffle] #winners post failed:', err.message); }
    // Remove raffle from board
    try {
      const raffleBoard = await query('SELECT board_message_id FROM raffles WHERE id=$1', [raffleId]);
      if (raffleBoard.rows[0]?.board_message_id) await removeFromBoard(client, guildId, raffleBoard.rows[0].board_message_id);
    } catch {}

    try {
      const origMsg = await channel.messages.fetch(messageId);
      await origMsg.edit({
        embeds: [baseEmbed(`${e('raffle')} RAFFLE — ENDED`, COLORS.grey, guild.name).setDescription(`**Winner:** <@${winner.user_id}>\n**Ended:** ${tsF(now)}`)],
        components: [],
        attachments: [],
      });
    } catch {}
  } catch (err) {
    console.error('[Raffle autoEnd]', err);
  }
}


async function cancelRaffle(interaction) {
  const id     = interaction.options.getInteger('id');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  await interaction.deferReply({ ephemeral: true });

  const raffleRes = await query(`SELECT * FROM raffles WHERE id=$1 AND guild_id=$2 AND status='active'`, [id, interaction.guildId]);
  if (!raffleRes.rows.length) return interaction.editReply({ content: `${e('wrong')} Active raffle #${id} not found.` });
  const raffle = raffleRes.rows[0];

  await query(`UPDATE raffles SET status='cancelled', ended_at=NOW() WHERE id=$1`, [id]);

  // Refund the host if Sins were reserved for this raffle
  if (raffle.currency === 'SINS' && raffle.prize_amount) {
    const hostUser = await interaction.client.users.fetch(raffle.host_id).catch(() => null);
    await adjustBalance(raffle.host_id, hostUser?.username || 'Unknown', Number(raffle.prize_amount)).catch(() => {});
  }

  // Edit original raffle message if possible
  try {
    const channel = await interaction.client.channels.fetch(raffle.channel_id);
    const msg     = await channel.messages.fetch(raffle.message_id);
    const cancelEmbed = baseEmbed(`${e('raffle')} RAFFLE CANCELLED`, COLORS.grey, interaction.guild?.name)
      .setDescription(`This raffle was cancelled.\n**Reason:** ${reason}\n**Cancelled by:** <@${interaction.user.id}>`);
    await msg.edit({ embeds: [cancelEmbed], components: [] });
  } catch {}

  await interaction.editReply({ content: `${e('checkmark')} Raffle #${id} cancelled. No winner selected.` });
}

async function endRaffle(interaction) {
  const id = interaction.options.getInteger('id');
  await interaction.deferReply({ ephemeral: true });
  const raffleRes = await query(`SELECT * FROM raffles WHERE id=$1 AND guild_id=$2`, [id, interaction.guildId]);
  if (!raffleRes.rows.length) return interaction.editReply({ content: `${e('wrong')} Raffle not found.` });
  await autoEndRaffle(interaction.client, id, interaction.guildId, raffleRes.rows[0].channel_id, raffleRes.rows[0].message_id);
  await interaction.editReply({ content: `${e('checkmark')} Raffle #${id} ended manually.` });
}

async function listRaffles(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const showEnded = interaction.options.getBoolean('ended') || false;
  const targetUser = interaction.options.getUser('user');
  const statusFilter = showEnded ? 'ended' : 'active';

  const staffRes = await query(`SELECT role FROM staff WHERE user_id=$1 AND active=true`, [interaction.user.id]);
  const isAdmin = staffRes.rows.length && ['admin','owner'].includes(staffRes.rows[0].role);

  if (targetUser && !isAdmin) return interaction.editReply({ content: `${e('wrong')} Only admins can view another staff member's raffles.` });

  const hostId = targetUser ? targetUser.id : interaction.user.id;

  const res = await query(
    `SELECT * FROM raffles WHERE guild_id=$1 AND host_id=$2 AND status=$3 ORDER BY ends_at DESC LIMIT 20`,
    [interaction.guildId, hostId, statusFilter]
  );

  const who = targetUser ? targetUser.username : 'Your';
  if (!res.rows.length) return interaction.editReply({ content: `${who} has no ${statusFilter} raffles.` });

  const title = targetUser
    ? `${e('raffle')} ${targetUser.username}'s ${showEnded ? 'Ended' : 'Active'} Raffles`
    : `${e('raffle')} ${showEnded ? 'Ended' : 'Active'} Raffles`;
  const embed = baseEmbed(title, COLORS.lightpurple, interaction.guild?.name);

  for (const r of res.rows) {
    const payout = r.payout_status === 'paid' ? `${e('checkmark')} Paid` : r.payout_status === 'late' ? `${e('atention')} Late` : `${e('Loading')} Pending`;
    const winnerText = r.winner_id ? `<@${r.winner_id}>` : 'No winner';
    const timeText = showEnded ? `Ended: ${tsF(r.ended_at)} | Winner: ${winnerText}` : `Ends: ${tsF(r.ends_at)} (${tsR(r.ends_at)})`;
    const jumpLink = r.message_id ? ` | [Jump](https://discord.com/channels/${interaction.guildId}/${r.channel_id}/${r.message_id})` : '';
    embed.addFields({
      name: `#${r.id} — ${r.prize}`,
      value: `${e('purplesparkle')} Prize: ${r.prize || 'N/A'} | Payout: ${payout} | ${timeText}${jumpLink}`,
    });
  }
  await interaction.editReply({ embeds: [embed] });
}

module.exports.autoEndRaffle = autoEndRaffle;
