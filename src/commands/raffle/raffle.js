const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');
const { getPrizeImage, getPrizeLabel } = require('../../utils/prizeImages');
const { refreshScheduleBoard } = require('../../utils/scheduleBoard');

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
];

module.exports = { autoEndRaffle,
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
      .setDescription('List active raffles')
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
    `INSERT INTO raffles (guild_id, channel_id, message_id, host_id, prize, prize_amount, currency, ends_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [interaction.guildId, interaction.channelId, msg.id, interaction.user.id, prizeLabel, amount,
     ['goos','sins','crowns'].includes(prizeKey) ? prizeKey.toUpperCase() : prizeKey, endsAt]
  );
  const raffleId = res.rows[0].id;

  // Refresh schedule board to show new raffle
  await refreshScheduleBoard(interaction.client, interaction.guildId);

  const msUntilEnd = endsAt.getTime() - Date.now();
  if (msUntilEnd > 0) {
    setTimeout(() => autoEndRaffle(interaction.client, raffleId, interaction.guildId, interaction.channelId, msg.id), msUntilEnd);
  } else {
    // Already expired during setup, end immediately
    await autoEndRaffle(interaction.client, raffleId, interaction.guildId, interaction.channelId, msg.id);
  }

  const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: msUntilEnd });
  collector.on('collect', async (btn) => {
    if (btn.customId !== 'raffle_join') return;
    try {
      await query(
        `INSERT INTO raffle_entries (raffle_id, user_id, username) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [raffleId, btn.user.id, btn.user.username]
      );
      const countRes = await query(`SELECT COUNT(*) FROM raffle_entries WHERE raffle_id=$1`, [raffleId]);
      const count = parseInt(countRes.rows[0].count);

      const updatedEmbed = baseEmbed(`${e('raffle')} RAFFLE`, COLORS.lightpurple, interaction.guild?.name)
        .setDescription(`**Prize:** ${displayPrize}\n**Host:** <@${interaction.user.id}>\n**Ends:** ${tsF(endsAt)} (${tsR(endsAt)})`)
        .addFields({ name: `${e('member')} Entries`, value: `${count} entered` })
        .setFooter({ text: `${interaction.guild?.name || '👑 Royal Ops'} — Click Join Raffle to enter!` });

      if (imageData.type === 'attachment') {
        updatedEmbed.setThumbnail(`attachment://${attachmentName}`);
        const refreshedFile = new AttachmentBuilder(imageData.filepath, { name: imageData.filename });
        await msg.edit({ embeds: [updatedEmbed], components: [joinRow], files: [refreshedFile] });
      } else if (imageData.type === 'url') {
        updatedEmbed.setThumbnail(imageData.url);
        await msg.edit({ embeds: [updatedEmbed], components: [joinRow] });
      }

      await btn.reply({ content: `${e('checkmark')} You're in the raffle! Good luck!`, ephemeral: true });
    } catch {
      await btn.reply({ content: 'You are already entered in this raffle!', ephemeral: true });
    }
  });
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
      await channel.send({ embeds: [baseEmbed(`${e('raffle')} RAFFLE ENDED`, COLORS.grey, interaction.guild?.name).setDescription('No entries — no winner.')] });
      return;
    }

    const winner = entries[Math.floor(Math.random() * entries.length)];
    await query(`UPDATE raffles SET status='ended', ended_at=$1, winner_id=$2 WHERE id=$3`, [now, winner.user_id, raffleId]);

    await query(
      `INSERT INTO member_wins (guild_id, user_id, username, type, ref_id, prize, prize_amount, currency, host_id, won_at)
       VALUES ($1,$2,$3,'raffle',$4,$5,$6,$7,$8,$9)`,
      [guildId, winner.user_id, winner.username, raffleId, raffle.prize, raffle.prize_amount, raffle.currency, raffle.host_id, now]
    );

    await query(
      `INSERT INTO payout_reminders (type, ref_id, host_id, winner_id, prize, guild_id, channel_id)
       VALUES ('raffle',$1,$2,$3,$4,$5,$6)`,
      [raffleId, raffle.host_id, winner.user_id, `${raffle.prize_amount ? raffle.prize_amount + ' ' : ''}${raffle.prize}`, guildId, channelId]
    );

    const winEmbed = baseEmbed(`${e('raffle')} RAFFLE WINNER!`, COLORS.tbppurple, interaction.guild?.name)
      .setDescription(
        `**Winner:** <@${winner.user_id}>\n**Prize:** ${raffle.prize_amount ? `${raffle.prize_amount} ` : ''}${raffle.prize}\n**Host:** <@${raffle.host_id}>\n**Ended:** ${tsF(now)}\n\n*Payout pending — host will reach out shortly.*`
      );

    await channel.send({ content: `${e('raffle')} <@${winner.user_id}> Congratulations!`, embeds: [winEmbed] });
    await refreshScheduleBoard(client, guildId);

    try {
      const origMsg = await channel.messages.fetch(messageId);
      await origMsg.edit({
        embeds: [baseEmbed(`${e('raffle')} RAFFLE — ENDED`, COLORS.grey, interaction.guild?.name).setDescription(`**Winner:** <@${winner.user_id}>\n**Ended:** ${tsF(now)}`)],
        components: [],
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
  const res = await query(
    `SELECT * FROM raffles WHERE guild_id=$1 AND status='active' ORDER BY ends_at ASC LIMIT 10`,
    [interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: 'No active raffles right now.' });

  const embed = baseEmbed(`${e('raffle')} Active Raffles`, COLORS.lightpurple, interaction.guild?.name);
  for (const r of res.rows) {
    embed.addFields({ name: `#${r.id} — ${r.prize}`, value: `Host: <@${r.host_id}> | Ends: ${tsF(r.ends_at)} (${tsR(r.ends_at)})` });
  }
  await interaction.editReply({ embeds: [embed] });
}
