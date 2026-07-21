const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Member verification — react to rules, solve a captcha, get verified')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Configure verification')
      .addRoleOption(o => o.setName('verified_role').setDescription('Role to assign once verified').setRequired(true))
      .addChannelOption(o => o.setName('rules_channel').setDescription('Channel to post the rules message in').setRequired(true))
      .addChannelOption(o => o.setName('captcha_channel').setDescription('Channel where members solve their captcha').setRequired(true))
      .addStringOption(o => o.setName('rules_text').setDescription('Rules text (use \\n for new lines)').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji members react with to start verification (default: ✅)')))
    .addSubcommand(sub => sub
      .setName('repost-rules')
      .setDescription('Repost the rules message if it was deleted'))
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
      const emoji   = interaction.options.getString('emoji') || '✅';

      const embed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle('📜 Server Rules')
        .setDescription(`${text}\n\nReact with ${emoji} below to begin verification.`);

      const msg = await channel.send({ embeds: [embed] }).catch(() => null);
      if (!msg) return interaction.editReply(`❌ Couldn't post in <#${channel.id}> — check Veloura's permissions.`);
      await msg.react(emoji).catch(() => {});

      await query(`
        INSERT INTO verify_config (guild_id, rules_channel_id, rules_message_id, rules_text, rules_emoji, captcha_channel_id, verified_role_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (guild_id) DO UPDATE SET
          rules_channel_id=$2, rules_message_id=$3, rules_text=$4, rules_emoji=$5, captcha_channel_id=$6, verified_role_id=$7
      `, [interaction.guildId, channel.id, msg.id, text, emoji, captchaChannel.id, role.id]);

      return interaction.editReply(`✅ Verification set up. Members react with ${emoji} in <#${channel.id}>, solve a captcha in <#${captchaChannel.id}>, then get <@&${role.id}>.`);
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
        .setTitle('📜 Server Rules')
        .setDescription(`${cfg.rules_text}\n\nReact with ${cfg.rules_emoji} below to begin verification.`);

      const msg = await channel.send({ embeds: [embed] }).catch(() => null);
      if (!msg) return interaction.editReply(`❌ Couldn't repost in <#${channel.id}> — check Veloura's permissions.`);
      await msg.react(cfg.rules_emoji).catch(() => {});

      await query('UPDATE verify_config SET rules_message_id = $1 WHERE guild_id = $2', [msg.id, interaction.guildId]);
      return interaction.editReply(`✅ Rules reposted in <#${channel.id}>. ${msg.url}`);
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
