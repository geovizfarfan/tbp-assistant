const {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { query } = require('../../utils/database');
const { baseEmbed, tsF, tsR, COLORS } = require('../../utils/embeds');
const { getPrizeImage, getPrizeLabel } = require('../../utils/prizeImages');

// All prize choices shown in the dropdown
const PRIZE_CHOICES = [
  { label: 'Discord Profile Accessory', value: 'accessory',   emoji: '💎' },
  { label: 'Discord Nitro Basic',        value: 'nitro_basic', emoji: '🌟' },
  { label: 'Discord Nitro',             value: 'nitro',       emoji: '✨' },
  { label: 'Partner Carry',             value: 'carry',       emoji: '🤝' },
  { label: 'Goos',                      value: 'goos',        emoji: '👻' },
  { label: 'Sins',                      value: 'sins',        emoji: '💀' },
  { label: 'Crowns',                    value: 'crowns',      emoji: '👑' },
  { label: 'Gift Card',                 value: 'gift_card',   emoji: '🎁' },
  { label: 'Sticker Pack',              value: 'sticker',     emoji: '🎀' },
  { label: 'Other Gift (specify below)',value: 'gift',        emoji: '🎀' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raffle')
    .setDescription('Raffle management')
    .addSubcommand(sub => sub
      .setName('start')
      .setDescription('Start a new raffle')
      .addStringOption(o => o.setName('ends').setDescription('End timestamp <t:UNIX:F> or unix').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Prize amount (if currency-based)').setRequired(false))
      .addStringOption(o => o.setName('custom_prize').setDescription('Custom prize name (use when selecting "Other Gift")').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('end')
      .setDescription('Manually end a raffle')
      .addIntegerOption(o => o.setName('id').setDescription('Raffle ID').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List active raffles')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') await startRaffle(interaction);
    if (sub === 'end')   await endRaffle(interaction);
    if (sub === 'list')  await listRaffles(interaction);
  },
};

async function startRaffle(interaction) {
  const endsRaw    = interaction.options.getString('ends');
  const amount     = interaction.options.getInteger('amount') || null;
  const customName = interaction.options.getString('custom_prize') || null;

  const unixMatch = endsRaw.match(/<t:(\d+)/);
  const unix = unixMatch ? parseInt(unixMatch[1]) : parseInt(endsRaw);
  if (isNaN(unix)) {
    return interaction.reply({ content: '❌ Invalid timestamp. Use `<t:UNIX:F>` or a raw unix number.', ephemeral: true });
  }
  const endsAt = new Date(unix * 1000);
  if (endsAt <= new Date()) {
    return interaction.reply({ content: '❌ End time must be in the future.', ephemeral: true });
  }

  // Step 1: Show prize dropdown (ephemeral, only to host)
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('raffle_prize_select')
    .setPlaceholder('Choose the prize type...')
    .addOptions(
      PRIZE_CHOICES.map(c =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.label)
          .setValue(c.value)
          .setEmoji(c.emoji)
      )
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    content: '👑 **Select the prize type for this raffle:**',
    components: [row],
    ephemeral: true,
  });

  // Wait for prize selection (60s timeout)
  let prizeKey;
  try {
    const collected = await interaction.channel.awaitMessageComponent({
      filter: i => i.customId === 'raffle_prize_select' && i.user.id === interaction.user.id,
      componentType: ComponentType.StringSelect,
      time: 60_000,
    });
    prizeKey = collected.values[0];
    await collected.deferUpdate();
  } catch {
    return interaction.editReply({ content: '⏰ Prize selection timed out.', components: [] });
  }

  await interaction.editReply({ content: '⏳ Starting raffle...', components: [] });

  const prizeLabel = getPrizeLabel(prizeKey, customName);
  const displayPrize = amount ? `${amount} ${prizeLabel}` : prizeLabel;

  // Resolve thumbnail image
  const imageData = await getPrizeImage(interaction.guildId, prizeKey);

  // Build raffle embed
  const embed = baseEmbed('🎟️ RAFFLE', COLORS.purple)
    .setDescription(
      `**Prize:** ${displayPrize}\n` +
      `**Host:** <@${interaction.user.id}>\n` +
      `**Ends:** ${tsF(endsAt)} (${tsR(endsAt)})`
    )
    .addFields({ name: '👥 Entries', value: '0 entries so far — be the first!' })
    .setFooter({ text: '👑 TBP Royal Ops — Click Join Raffle to enter!' });

  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('raffle_join')
      .setLabel('🎟️ Join Raffle')
      .setStyle(ButtonStyle.Primary)
  );

  // Attach thumbnail
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

  const msg = await interaction.channel.send(msgPayload);

  // Save to DB
  const res = await query(
    `INSERT INTO raffles (guild_id, channel_id, message_id, host_id, prize, prize_amount, currency, ends_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      interaction.guildId, interaction.channelId, msg.id,
      interaction.user.id, prizeLabel, amount,
      ['goos','sins','crowns'].includes(prizeKey) ? prizeKey.toUpperCase() : prizeKey,
      endsAt,
    ]
  );
  const raffleId = res.rows[0].id;

  // Schedule auto-end
  const msUntilEnd = endsAt.getTime() - Date.now();
  setTimeout(() => autoEndRaffle(interaction.client, raffleId, interaction.guildId, interaction.channelId, msg.id), msUntilEnd);

  // Handle join button
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: msUntilEnd,
  });

  collector.on('collect', async (btn) => {
    if (btn.customId !== 'raffle_join') return;
    try {
      await query(
        `INSERT INTO raffle_entries (raffle_id, user_id, username) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [raffleId, btn.user.id, btn.user.username]
      );
      const countRes = await query(`SELECT COUNT(*) FROM raffle_entries WHERE raffle_id=$1`, [raffleId]);
      const count = parseInt(countRes.rows[0].count);

      // Rebuild embed with updated count (re-attach image each edit)
      const updatedEmbed = baseEmbed('🎟️ RAFFLE', COLORS.purple)
        .setDescription(
          `**Prize:** ${displayPrize}\n` +
          `**Host:** <@${interaction.user.id}>\n` +
          `**Ends:** ${tsF(endsAt)} (${tsR(endsAt)})`
        )
        .addFields({ name: '👥 Entries', value: `${count} entered` })
        .setFooter({ text: '👑 TBP Royal Ops — Click Join Raffle to enter!' });

      if (imageData.type === 'attachment') {
        updatedEmbed.setThumbnail(`attachment://${attachmentName}`);
        const refreshedFile = new AttachmentBuilder(imageData.filepath, { name: imageData.filename });
        await msg.edit({ embeds: [updatedEmbed], components: [joinRow], files: [refreshedFile] });
      } else if (imageData.type === 'url') {
        updatedEmbed.setThumbnail(imageData.url);
        await msg.edit({ embeds: [updatedEmbed], components: [joinRow] });
      }

      await btn.reply({ content: `✅ You're in the raffle! Good luck 🍀`, ephemeral: true });
    } catch {
      await btn.reply({ content: '⚠️ You are already entered in this raffle!', ephemeral: true });
    }
  });
}

async function autoEndRaffle(client, raffleId, guildId, channelId, messageId) {
  try {
    const raffleRes = await query(`SELECT * FROM raffles WHERE id=$1`, [raffleId]);
    const raffle = raffleRes.rows[0];
    if (!raffle || raffle.status !== 'active') return;

    const entriesRes = await query(`SELECT * FROM raffle_entries WHERE raffle_id=$1`, [raffleId]);
    const entries = entriesRes.rows;
    const now = new Date();

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);

    if (!entries.length) {
      await query(`UPDATE raffles SET status='ended', ended_at=$1 WHERE id=$2`, [now, raffleId]);
      const noWinEmbed = baseEmbed('🎟️ RAFFLE ENDED', COLORS.grey)
        .setDescription('No entries were submitted — no winner this time.');
      await channel.send({ embeds: [noWinEmbed] });
      return;
    }

    const winner = entries[Math.floor(Math.random() * entries.length)];

    await query(
      `UPDATE raffles SET status='ended', ended_at=$1, winner_id=$2 WHERE id=$3`,
      [now, winner.user_id, raffleId]
    );

    // Log member win
    await query(
      `INSERT INTO member_wins (guild_id, user_id, username, type, ref_id, prize, prize_amount, currency, host_id, won_at)
       VALUES ($1,$2,$3,'raffle',$4,$5,$6,$7,$8,$9)`,
      [guildId, winner.user_id, winner.username, raffleId, raffle.prize, raffle.prize_amount, raffle.currency, raffle.host_id, now]
    );

    // Payout reminder
    await query(
      `INSERT INTO payout_reminders (type, ref_id, host_id, winner_id, prize, guild_id, channel_id)
       VALUES ('raffle',$1,$2,$3,$4,$5,$6)`,
      [raffleId, raffle.host_id, winner.user_id, `${raffle.prize_amount ? raffle.prize_amount + ' ' : ''}${raffle.prize}`, guildId, channelId]
    );

    const winEmbed = baseEmbed('🎉 RAFFLE WINNER!', COLORS.gold)
      .setDescription(
        `**Winner:** <@${winner.user_id}>\n` +
        `**Prize:** ${raffle.prize_amount ? `${raffle.prize_amount} ` : ''}${raffle.prize}\n` +
        `**Host:** <@${raffle.host_id}>\n` +
        `**Ended:** ${tsF(now)}\n\n` +
        `*Payout pending — host will reach out shortly.*`
      );

    await channel.send({ content: `🎟️ <@${winner.user_id}> Congratulations!`, embeds: [winEmbed] });

    // Update original raffle message to show ended state
    try {
      const origMsg = await channel.messages.fetch(messageId);
      const endedEmbed = baseEmbed('🎟️ RAFFLE — ENDED', COLORS.grey)
        .setDescription(`**Winner:** <@${winner.user_id}>\n**Ended:** ${tsF(now)}`);
      await origMsg.edit({ embeds: [endedEmbed], components: [] });
    } catch {}

  } catch (err) {
    console.error('[Raffle autoEnd]', err);
  }
}

async function endRaffle(interaction) {
  const id = interaction.options.getInteger('id');
  await interaction.deferReply({ ephemeral: true });
  const raffleRes = await query(`SELECT * FROM raffles WHERE id=$1 AND guild_id=$2`, [id, interaction.guildId]);
  if (!raffleRes.rows.length) return interaction.editReply({ content: '❌ Raffle not found.' });
  await autoEndRaffle(interaction.client, id, interaction.guildId, raffleRes.rows[0].channel_id, raffleRes.rows[0].message_id);
  await interaction.editReply({ content: `✅ Raffle #${id} ended manually.` });
}

async function listRaffles(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(
    `SELECT * FROM raffles WHERE guild_id=$1 AND status='active' ORDER BY ends_at ASC LIMIT 10`,
    [interaction.guildId]
  );
  if (!res.rows.length) return interaction.editReply({ content: 'No active raffles right now.' });

  const embed = baseEmbed('🎟️ Active Raffles', COLORS.purple);
  for (const r of res.rows) {
    embed.addFields({
      name: `#${r.id} — ${r.prize}`,
      value: `Host: <@${r.host_id}> | Ends: ${tsF(r.ends_at)} (${tsR(r.ends_at)})`,
    });
  }
  await interaction.editReply({ embeds: [embed] });
}
