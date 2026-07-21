const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Member verification — react to rules, react to verify, solve a captcha, get verified')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Configure verification')
      .addRoleOption(o => o.setName('verified_role').setDescription('Role to assign once verified').setRequired(true))
      .addChannelOption(o => o.setName('rules_channel').setDescription('Channel to post the rules message in').setRequired(true))
      .addChannelOption(o => o.setName('captcha_channel').setDescription('Channel where members react to start their captcha').setRequired(true))
      .addStringOption(o => o.setName('rules_text').setDescription('Rules text (use \\n for new lines)').setRequired(true))
      .addStringOption(o => o.setName('rules_title').setDescription('Title shown above the rules (default: "📜 Server Rules")'))
      .addStringOption(o => o.setName('rules_emoji').setDescription('Emoji members react with on the rules message (default: ✅)'))
      .addStringOption(o => o.setName('verify_emoji').setDescription('Emoji members react with in the captcha channel to start their captcha (default: 🔓)')))
    .addSubcommand(sub => sub
      .setName('edit-rules')
      .setDescription('Edit the rules message in place — only fills in fields you provide')
      .addStringOption(o => o.setName('title').setDescription('New title, e.g. "🎲 Server Rules"'))
      .addStringOption(o => o.setName('text').setDescription('New rules text (use \\n for new lines)'))
      .addStringOption(o => o.setName('reaction_emoji').setDescription('New reaction emoji (changes what members react with)')))
    .addSubcommand(sub => sub
      .setName('customize-captcha')
      .setDescription('Customize the captcha step — only fills in fields you provide')
      .addStringOption(o => o.setName('title').setDescription('Title shown on the personal captcha challenge (default: "🔐 Verification")'))
      .addStringOption(o => o.setName('instructions').setDescription('Extra instructions shown above the code (use \\n for new lines)'))
      .addStringOption(o => o.setName('verify_emoji').setDescription('New reaction emoji for the verification-trigger message')))
    .addSubcommand(sub => sub
      .setName('repost-rules')
      .setDescription('Repost the rules message if it was deleted'))
    .addSubcommand(sub => sub
      .setName('repost-verify')
      .setDescription('Repost the verification-trigger message if it was deleted'))
    .addSubcommand(sub => sub
      .setName('welcome')
      .setDescription('Configure a welcome message posted after a member successfully verifies')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post welcome messages in (leave blank to disable)'))
      .addStringOption(o => o.setName('text').setDescription('Welcome text — use {user} to mention them, \\n for new lines'))
      .addStringOption(o => o.setName('title').setDescription('Embed title (default: "Welcome!")'))
      .addStringOption(o => o.setName('image').setDescription('Image or server icon URL shown in the corner')))
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Check a member\'s verification status')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    if (sub === 'setup') {
      const role    = interaction.options.getRole('verified_role');
      const channel = interaction.options.getChannel('rules_channel');
      const captchaChannel = interaction.options.getChannel('captcha_channel');
      const text    = interaction.options.getString('rules_text').replace(/\\n/g, '\n');
      const title   = interaction.options.getString('rules_title') || '📜 Server Rules';
      const rulesEmoji  = interaction.options.getString('rules_emoji') || '✅';
      const verifyEmoji = interaction.options.getString('verify_emoji') || '<a:unlock:1520461704259960842>';

      const rulesEmbed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle(title)
        .setDescription(`${text}\n\nReact with ${rulesEmoji} once you've read and agree.`);

      const rulesMsg = await channel.send({ embeds: [rulesEmbed] }).catch(() => null);
      if (!rulesMsg) return interaction.editReply(`❌ Couldn't post in <#${channel.id}> — check Veloura's permissions.`);
      await rulesMsg.react(rulesEmoji).catch(() => {});

      const verifyEmbed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle('🔓 Start Verification')
        .setDescription(`Once you've reacted to the rules in <#${channel.id}>, react with ${verifyEmoji} below to start your captcha.`);

      const verifyMsg = await captchaChannel.send({ embeds: [verifyEmbed] }).catch(() => null);
      if (!verifyMsg) return interaction.editReply(`❌ Couldn't post in <#${captchaChannel.id}> — check Veloura's permissions.`);
      await verifyMsg.react(verifyEmoji).catch(() => {});

      await query(`
        INSERT INTO verify_config (guild_id, rules_channel_id, rules_message_id, rules_title, rules_text, rules_emoji, captcha_channel_id, verify_message_id, verify_emoji, verified_role_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (guild_id) DO UPDATE SET
          rules_channel_id=$2, rules_message_id=$3, rules_title=$4, rules_text=$5, rules_emoji=$6,
          captcha_channel_id=$7, verify_message_id=$8, verify_emoji=$9, verified_role_id=$10
      `, [interaction.guildId, channel.id, rulesMsg.id, title, text, rulesEmoji, captchaChannel.id, verifyMsg.id, verifyEmoji, role.id]);

      return interaction.editReply(`✅ Verification set up. Members react with ${rulesEmoji} in <#${channel.id}>, then ${verifyEmoji} in <#${captchaChannel.id}> to get their captcha, then get <@&${role.id}> once solved. Both reactions stay in place permanently as proof of each step.`);
    }

    if (sub === 'edit-rules') {
      const title = interaction.options.getString('title');
      const text  = interaction.options.getString('text')?.replace(/\\n/g, '\n');
      const newEmoji = interaction.options.getString('reaction_emoji');

      if (!title && !text && !newEmoji) return interaction.editReply('❌ Provide at least one of `title`, `text`, or `reaction_emoji`.');

      const cfgRes = await query('SELECT * FROM verify_config WHERE guild_id = $1', [interaction.guildId]);
      if (!cfgRes.rows.length) return interaction.editReply('❌ Verification isn\'t set up yet — run `/verify setup` first.');
      const cfg = cfgRes.rows[0];

      const channel = await interaction.client.channels.fetch(cfg.rules_channel_id).catch(() => null);
      if (!channel) return interaction.editReply('❌ The configured rules channel no longer exists.');

      const msg = cfg.rules_message_id ? await channel.messages.fetch(cfg.rules_message_id).catch(() => null) : null;
      if (!msg) return interaction.editReply('❌ Couldn\'t find the rules message — run `/verify repost-rules` first, or `/verify setup` to recreate it.');

      const finalTitle = title || cfg.rules_title || '📜 Server Rules';
      const finalText  = text || cfg.rules_text;
      const finalEmoji = newEmoji || cfg.rules_emoji;

      const embed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle(finalTitle)
        .setDescription(`${finalText}\n\nReact with ${finalEmoji} once you've read and agree.`);

      await msg.edit({ embeds: [embed] }).catch((err) => {
        console.error('[Verify] Failed to edit rules:', err.message);
      });

      if (newEmoji && newEmoji !== cfg.rules_emoji) {
        await msg.reactions.removeAll().catch(() => {});
        await msg.react(newEmoji).catch(() => {});
      }

      await query(`
        UPDATE verify_config SET rules_title = $1, rules_text = $2, rules_emoji = $3 WHERE guild_id = $4
      `, [finalTitle, finalText, finalEmoji, interaction.guildId]);

      return interaction.editReply(`✅ Rules updated. ${msg.url}`);
    }

    if (sub === 'customize-captcha') {
      const title = interaction.options.getString('title');
      const instructions = interaction.options.getString('instructions')?.replace(/\\n/g, '\n');
      const newEmoji = interaction.options.getString('verify_emoji');

      if (!title && !instructions && !newEmoji) return interaction.editReply('❌ Provide at least one of `title`, `instructions`, or `verify_emoji`.');

      const cfgRes = await query('SELECT * FROM verify_config WHERE guild_id = $1', [interaction.guildId]);
      if (!cfgRes.rows.length) return interaction.editReply('❌ Verification isn\'t set up yet — run `/verify setup` first.');
      const cfg = cfgRes.rows[0];

      await query(`
        UPDATE verify_config SET
          captcha_title = COALESCE($1, captcha_title),
          captcha_instructions = COALESCE($2, captcha_instructions),
          verify_emoji = COALESCE($3, verify_emoji)
        WHERE guild_id = $4
      `, [title, instructions, newEmoji, interaction.guildId]);

      if (newEmoji && newEmoji !== cfg.verify_emoji && cfg.captcha_channel_id && cfg.verify_message_id) {
        const captchaChannel = await interaction.client.channels.fetch(cfg.captcha_channel_id).catch(() => null);
        const verifyMsg = captchaChannel ? await captchaChannel.messages.fetch(cfg.verify_message_id).catch(() => null) : null;
        if (verifyMsg) {
          await verifyMsg.reactions.removeAll().catch(() => {});
          await verifyMsg.react(newEmoji).catch(() => {});
          const embed = EmbedBuilder.from(verifyMsg.embeds[0]).setDescription(
            `Once you've reacted to the rules, react with ${newEmoji} below to start your captcha.`
          );
          await verifyMsg.edit({ embeds: [embed] }).catch(() => {});
        }
      }

      return interaction.editReply('✅ Captcha settings updated.');
    }

    if (sub === 'repost-rules') {
      const cfgRes = await query('SELECT * FROM verify_config WHERE guild_id = $1', [interaction.guildId]);
      if (!cfgRes.rows.length) return interaction.editReply('❌ Verification isn\'t set up yet — run `/verify setup` first.');
      const cfg = cfgRes.rows[0];

      const channel = await interaction.client.channels.fetch(cfg.rules_channel_id).catch(() => null);
      if (!channel) return interaction.editReply('❌ The configured rules channel no longer exists.');

      if (cfg.rules_message_id) {
        const existing = await channel.messages.fetch(cfg.rules_message_id).catch(() => null);
        if (existing) return interaction.editReply(`✅ The rules message still exists — no repost needed. ${existing.url}`);
      }

      const embed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle(cfg.rules_title || '📜 Server Rules')
        .setDescription(`${cfg.rules_text}\n\nReact with ${cfg.rules_emoji} once you've read and agree.`);

      const msg = await channel.send({ embeds: [embed] }).catch(() => null);
      if (!msg) return interaction.editReply(`❌ Couldn't repost in <#${channel.id}> — check Veloura's permissions.`);
      await msg.react(cfg.rules_emoji).catch(() => {});

      await query('UPDATE verify_config SET rules_message_id = $1 WHERE guild_id = $2', [msg.id, interaction.guildId]);
      return interaction.editReply(`✅ Rules reposted in <#${channel.id}>. ${msg.url}`);
    }

    if (sub === 'repost-verify') {
      const cfgRes = await query('SELECT * FROM verify_config WHERE guild_id = $1', [interaction.guildId]);
      if (!cfgRes.rows.length) return interaction.editReply('❌ Verification isn\'t set up yet — run `/verify setup` first.');
      const cfg = cfgRes.rows[0];

      const channel = await interaction.client.channels.fetch(cfg.captcha_channel_id).catch(() => null);
      if (!channel) return interaction.editReply('❌ The configured captcha channel no longer exists.');

      if (cfg.verify_message_id) {
        const existing = await channel.messages.fetch(cfg.verify_message_id).catch(() => null);
        if (existing) return interaction.editReply(`✅ The verification message still exists — no repost needed. ${existing.url}`);
      }

      const embed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle('🔓 Start Verification')
        .setDescription(`Once you've reacted to the rules, react with ${cfg.verify_emoji} below to start your captcha.`);

      const msg = await channel.send({ embeds: [embed] }).catch(() => null);
      if (!msg) return interaction.editReply(`❌ Couldn't repost in <#${channel.id}> — check Veloura's permissions.`);
      await msg.react(cfg.verify_emoji).catch(() => {});

      await query('UPDATE verify_config SET verify_message_id = $1 WHERE guild_id = $2', [msg.id, interaction.guildId]);
      return interaction.editReply(`✅ Verification message reposted in <#${channel.id}>. ${msg.url}`);
    }

    if (sub === 'welcome') {
      const channel = interaction.options.getChannel('channel');
      const text    = interaction.options.getString('text')?.replace(/\\n/g, '\n');
      const title   = interaction.options.getString('title');
      const image   = interaction.options.getString('image');

      if (!channel) {
        await query('UPDATE verify_config SET welcome_channel_id = NULL WHERE guild_id = $1', [interaction.guildId]);
        return interaction.editReply('✅ Welcome messages disabled.');
      }

      const cfgRes = await query('SELECT 1 FROM verify_config WHERE guild_id = $1', [interaction.guildId]);
      if (!cfgRes.rows.length) return interaction.editReply('❌ Run `/verify setup` first before configuring the welcome message.');

      await query(`
        UPDATE verify_config SET
          welcome_channel_id = $1,
          welcome_text  = COALESCE($2, welcome_text),
          welcome_title = COALESCE($3, welcome_title),
          welcome_image = COALESCE($4, welcome_image)
        WHERE guild_id = $5
      `, [channel.id, text, title, image, interaction.guildId]);

      return interaction.editReply(`✅ Welcome messages will post in <#${channel.id}> whenever someone successfully verifies.`);
    }

    if (sub === 'status') {
      const user = interaction.options.getUser('user');
      const cfgRes = await query('SELECT verified_role_id FROM verify_config WHERE guild_id = $1', [interaction.guildId]);
      if (!cfgRes.rows.length) return interaction.editReply('❌ Verification isn\'t set up yet.');

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.editReply('❌ Couldn\'t find that member in this server.');

      const isVerified = member.roles.cache.has(cfgRes.rows[0].verified_role_id);
      const pendingRes = await query('SELECT * FROM verify_pending WHERE guild_id = $1 AND user_id = $2', [interaction.guildId, user.id]);

      const lines = [`${isVerified ? '✅ Verified' : '❌ Not verified'}`];
      if (!isVerified && pendingRes.rows.length) {
        lines.push(`🔄 Currently mid-captcha (${pendingRes.rows[0].attempts} attempt(s) so far)`);
      }
      return interaction.editReply(lines.join('\n'));
    }
  },
};
