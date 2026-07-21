const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { query } = require('../utils/database');

const MAX_ATTEMPTS = 5;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L to avoid confusion

function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

async function handleReactionAdd(reaction, user, client) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);

  const cfgRes = await query('SELECT * FROM verify_config WHERE rules_message_id = $1', [reaction.message.id]);
  if (!cfgRes.rows.length) return;
  const cfg = cfgRes.rows[0];

  const reactedEmoji = reaction.emoji.id || reaction.emoji.name;
  const configuredEmoji = cfg.rules_emoji.match(/^<a?:\w+:(\d+)>$/)?.[1] || cfg.rules_emoji;
  if (reactedEmoji !== configuredEmoji) return;

  const guild = reaction.message.guild;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  if (member.roles.cache.has(cfg.verified_role_id)) return; // already verified

  const captchaChannel = await client.channels.fetch(cfg.captcha_channel_id).catch(() => null);
  if (!captchaChannel) return;

  const code = generateCode();
  await query(`
    INSERT INTO verify_pending (guild_id, user_id, code, attempts)
    VALUES ($1,$2,$3,0)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET code=$3, attempts=0, created_at=NOW()
  `, [guild.id, user.id, code]);

  const button = new ButtonBuilder()
    .setCustomId(`verify_start:${user.id}`)
    .setLabel('Solve Captcha')
    .setEmoji('🔐')
    .setStyle(ButtonStyle.Primary);

  const embed = new EmbedBuilder()
    .setColor('#d6c2ee')
    .setTitle('🔐 Verification')
    .setDescription(`<@${user.id}> your code is:\n\n# \`${code}\`\n\nClick the button below and type this code exactly to get verified.`);

  const msg = await captchaChannel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] }).catch(() => null);
  if (msg) await query('UPDATE verify_pending SET message_id = $1 WHERE guild_id = $2 AND user_id = $3', [msg.id, guild.id, user.id]);

  // Remove their reaction so they can react again later for a fresh code if needed
  await reaction.users.remove(user.id).catch(() => {});
}

async function handleCaptchaButton(interaction) {
  const [, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: '❌ This captcha isn\'t yours — react to the rules message yourself to get your own.', ephemeral: true });
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
      return interaction.editReply(`❌ Incorrect — that was your last attempt. React to the rules message again to get a fresh code.`);
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

  // Clean up the captcha message
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

module.exports = { handleReactionAdd, handleCaptchaButton, handleCaptchaModal };
