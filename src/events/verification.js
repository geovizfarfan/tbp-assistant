const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { query } = require('../utils/database');

const MAX_ATTEMPTS = 5;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L to avoid confusion

function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function matchesEmoji(reaction, configuredEmoji) {
  const reactedEmoji = reaction.emoji.id || reaction.emoji.name;
  const configuredId = configuredEmoji?.match(/^<a?:\w+:(\d+)>$/)?.[1] || configuredEmoji;
  return reactedEmoji === configuredId;
}

async function buildCaptchaChallenge(cfg, userId, code) {
  const instructions = cfg.captcha_instructions ? `${cfg.captcha_instructions}\n\n` : '';
  const embed = new EmbedBuilder()
    .setColor('#d6c2ee')
    .setTitle(cfg.captcha_title || '🔐 Verification')
    .setDescription(`<@${userId}> ${instructions}your code is:\n\n# \`${code}\`\n\nClick the button below and type this code exactly to get verified.`);

  const solveButton = new ButtonBuilder()
    .setCustomId(`verify_start:${userId}`)
    .setLabel('Solve Captcha')
    .setEmoji('🔐')
    .setStyle(ButtonStyle.Primary);

  const newCodeButton = new ButtonBuilder()
    .setCustomId(`verify_newcode:${userId}`)
    .setLabel('New Code')
    .setEmoji('🔄')
    .setStyle(ButtonStyle.Secondary);

  return { embed, row: new ActionRowBuilder().addComponents(solveButton, newCodeButton) };
}

async function handleReactionAdd(reaction, user, client) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);

  console.log(`[Verify] Reaction from ${user.username} on message ${reaction.message.id} with ${reaction.emoji.id || reaction.emoji.name}`);

  const cfgRes = await query(
    'SELECT * FROM verify_config WHERE rules_message_id = $1 OR verify_message_id = $1',
    [reaction.message.id]
  );
  if (!cfgRes.rows.length) {
    console.log(`[Verify] Message ${reaction.message.id} doesn't match any tracked rules/verify message — ignoring.`);
    return;
  }
  const cfg = cfgRes.rows[0];
  console.log(`[Verify] Matched config — rules_message_id=${cfg.rules_message_id}, verify_message_id=${cfg.verify_message_id}`);

  const guild = reaction.message.guild;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    console.log(`[Verify] Could not fetch member ${user.id} — ignoring.`);
    return;
  }
  if (member.roles.cache.has(cfg.verified_role_id)) {
    console.log(`[Verify] ${user.username} already has the verified role — ignoring.`);
    return;
  }

  // Reaction on the RULES message — acknowledge with a nudge toward the next step.
  // The reaction itself is never removed — it's their permanent proof of step 1.
  if (reaction.message.id === cfg.rules_message_id) {
    if (!matchesEmoji(reaction, cfg.rules_emoji)) return;

    const captchaChannel = await client.channels.fetch(cfg.captcha_channel_id).catch(() => null);
    if (captchaChannel) {
      const notice = await reaction.message.channel.send({
        content: `<@${user.id}> ✅ Got it! Now head to <#${cfg.captcha_channel_id}> and react with ${cfg.verify_emoji} to start your captcha.`,
      }).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 20_000);
    }
    return;
  }

  // Reaction on the VERIFICATION-TRIGGER message — this is what actually starts the captcha
  if (reaction.message.id === cfg.verify_message_id) {
    console.log(`[Verify] This is the verify-trigger message. Checking emoji match: reacted=${reaction.emoji.id || reaction.emoji.name}, configured=${cfg.verify_emoji}`);
    if (!matchesEmoji(reaction, cfg.verify_emoji)) {
      console.log(`[Verify] Emoji didn't match — ignoring.`);
      return;
    }

    // Require them to have reacted to rules first
    const rulesChannel = await client.channels.fetch(cfg.rules_channel_id).catch(() => null);
    const rulesMsg = rulesChannel && cfg.rules_message_id ? await rulesChannel.messages.fetch(cfg.rules_message_id).catch(() => null) : null;
    const rulesReaction = rulesMsg?.reactions.cache.get(
      cfg.rules_emoji.match(/^<a?:\w+:(\d+)>$/)?.[1] || cfg.rules_emoji
    );
    const rulesUsers = rulesReaction ? await rulesReaction.users.fetch().catch(() => null) : null;
    const hasReadRules = rulesUsers?.has(user.id) || false;
    console.log(`[Verify] hasReadRules=${hasReadRules} (rulesMsg found=${!!rulesMsg}, rulesReaction found=${!!rulesReaction}, rulesUsers count=${rulesUsers?.size})`);

    const captchaChannel = await client.channels.fetch(cfg.captcha_channel_id).catch(() => null);
    if (!captchaChannel) {
      console.log(`[Verify] Could not fetch captcha channel ${cfg.captcha_channel_id} — ignoring.`);
      return;
    }

    if (!hasReadRules) {
      const notice = await captchaChannel.send({
        content: `<@${user.id}> you need to react to the rules in <#${cfg.rules_channel_id}> first!`,
      }).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 15_000);
      await reaction.users.remove(user.id).catch(() => {}); // let them try again cleanly
      return;
    }

    console.log(`[Verify] Generating captcha for ${user.username}...`);
    const code = generateCode();
    await query(`
      INSERT INTO verify_pending (guild_id, user_id, code, attempts)
      VALUES ($1,$2,$3,0)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET code=$3, attempts=0, created_at=NOW()
    `, [guild.id, user.id, code]);

    const { embed, row } = await buildCaptchaChallenge(cfg, user.id, code);
    const msg = await captchaChannel.send({ embeds: [embed], components: [row] }).catch((err) => {
      console.error(`[Verify] Failed to send captcha challenge:`, err.message);
      return null;
    });
    if (msg) {
      console.log(`[Verify] Captcha challenge posted successfully: ${msg.id}`);
      await query('UPDATE verify_pending SET message_id = $1 WHERE guild_id = $2 AND user_id = $3', [msg.id, guild.id, user.id]);
    }
  }
}

async function handleCaptchaButton(interaction) {
  const [, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: '❌ This captcha isn\'t yours.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`verify_modal:${interaction.user.id}`)
    .setTitle('Enter Your Verification Code');

  const codeInput = new TextInputBuilder()
    .setCustomId('code')
    .setLabel('Type the code shown above')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(6);

  modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
  await interaction.showModal(modal);
}

async function handleNewCodeButton(interaction) {
  const [, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: '❌ This captcha isn\'t yours.', ephemeral: true });
  }
  await interaction.deferUpdate();

  const cfgRes = await query('SELECT * FROM verify_config WHERE guild_id = $1', [interaction.guildId]);
  if (!cfgRes.rows.length) return;
  const cfg = cfgRes.rows[0];

  const newCode = generateCode();
  await query(`
    UPDATE verify_pending SET code = $1, attempts = 0 WHERE guild_id = $2 AND user_id = $3
  `, [newCode, interaction.guildId, ownerId]);

  const { embed, row } = await buildCaptchaChallenge(cfg, ownerId, newCode);
  await interaction.message.edit({ embeds: [embed], components: [row] }).catch(() => {});
}

async function handleCaptchaModal(interaction) {
  const [, ownerId] = interaction.customId.split(':');
  await interaction.deferReply({ ephemeral: true });

  const pendingRes = await query('SELECT * FROM verify_pending WHERE guild_id = $1 AND user_id = $2', [interaction.guildId, ownerId]);
  if (!pendingRes.rows.length) return interaction.editReply('❌ No pending verification found — react to the rules message again to get a new code.');
  const pending = pendingRes.rows[0];

  const submitted = interaction.fields.getTextInputValue('code').trim().toUpperCase();

  if (submitted !== pending.code) {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await query('DELETE FROM verify_pending WHERE guild_id = $1 AND user_id = $2', [interaction.guildId, ownerId]);
      return interaction.editReply(`❌ Incorrect — that was your last attempt. Click "New Code" on your challenge message to get a fresh one.`);
    }
    await query('UPDATE verify_pending SET attempts = $1 WHERE guild_id = $2 AND user_id = $3', [attempts, interaction.guildId, ownerId]);
    return interaction.editReply(`❌ Incorrect code. ${MAX_ATTEMPTS - attempts} attempt(s) left — click "Solve Captcha" again to retry.`);
  }

  const cfgRes = await query('SELECT * FROM verify_config WHERE guild_id = $1', [interaction.guildId]);
  if (!cfgRes.rows.length) return interaction.editReply('❌ Verification config is missing — contact staff.');
  const cfg = cfgRes.rows[0];

  const member = await interaction.guild.members.fetch(ownerId).catch(() => null);
  if (!member) return interaction.editReply('❌ Couldn\'t find your member record — contact staff.');

  await member.roles.add(cfg.verified_role_id).catch((err) => {
    console.error('[Verify] Failed to add role:', err.message);
  });

  await query('DELETE FROM verify_pending WHERE guild_id = $1 AND user_id = $2', [interaction.guildId, ownerId]);

  // Update the captcha message to show success, remove the buttons
  if (pending.message_id) {
    const channel = interaction.channel;
    const msg = await channel.messages.fetch(pending.message_id).catch(() => null);
    if (msg) await msg.edit({ embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ <@${ownerId}> verified successfully!`)], components: [] }).catch(() => {});
  }

  // Post the welcome message, if configured
  if (cfg.welcome_channel_id) {
    const welcomeChannel = await interaction.client.channels.fetch(cfg.welcome_channel_id).catch(() => null);
    if (welcomeChannel) {
      const welcomeText = (cfg.welcome_text || 'Hey {user}, welcome to the server!').replace(/\{user\}/g, `<@${ownerId}>`);
      const welcomeEmbed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle(cfg.welcome_title || '🎉 Welcome!')
        .setDescription(welcomeText);
      if (cfg.welcome_image) welcomeEmbed.setThumbnail(cfg.welcome_image);
      await welcomeChannel.send({ content: `<@${ownerId}>`, embeds: [welcomeEmbed] }).catch((err) => {
        console.error('[Verify] Failed to post welcome message:', err.message);
      });
    }
  }

  return interaction.editReply('✅ Verified! Welcome to the server.');
}

module.exports = { handleReactionAdd, handleCaptchaButton, handleNewCodeButton, handleCaptchaModal };
