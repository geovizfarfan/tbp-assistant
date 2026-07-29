const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { isGuildAllowedSins } = require('../../utils/sinsRequests');
const { e } = require('../../utils/appEmojis');
const { getGuildCurrencyConfig, adjustGuildBalance, getGuildBalance } = require('../../utils/currency');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('currency')
    .setDescription('Set this server\'s currency — used for staff pay, boosters, RR, and more')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Use real Sins, or set a custom currency name and emoji')
      .addBooleanOption(o => o.setName('use_sins').setDescription('Use real Sins (Play & Regret)? False = custom currency').setRequired(true))
      .addStringOption(o => o.setName('name').setDescription('Custom currency name, e.g. "Coins" (required if use_sins is False)'))
      .addStringOption(o => o.setName('emoji').setDescription('Custom currency emoji, e.g. 🪙'))
      .addBooleanOption(o => o.setName('auto_pay').setDescription('Automatically pay staff/boosters when due, no admin action needed (default: off)')))
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('See this server\'s current currency setting'))
    .addSubcommand(sub => sub
      .setName('balance')
      .setDescription('Check a member\'s balance in this server\'s currency')
      .addUserOption(o => o.setName('user').setDescription('User to check (defaults to you)')))
    .addSubcommand(sub => sub
      .setName('give')
      .setDescription('Give (or take) this server\'s currency from a member (admin only)')
      .addUserOption(o => o.setName('user').setDescription('User to adjust').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to give — negative to take away').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      await interaction.deferReply({ ephemeral: true });
      const cfg = await getGuildCurrencyConfig(interaction.guildId);
      const embed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setTitle(`${e('payday')} Server Currency`)
        .setDescription(
          (cfg.useSins
            ? `Using real **Sins** (synced with Play & Regret).`
            : `Using custom currency: **${cfg.currencyName}** ${cfg.currencyEmoji || ''}`) +
          `\n\nAuto-pay: ${cfg.autoPayEnabled ? '**ON** ⏰' : '**OFF**'}`
        );
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'balance') {
      await interaction.deferReply();
      const target = interaction.options.getUser('user') || interaction.user;
      const cfg = await getGuildCurrencyConfig(interaction.guildId);
      const balance = await getGuildBalance(interaction.guildId, target.id);

      if (balance === null) {
        return interaction.editReply(`${target.username} doesn't have a balance yet.`);
      }

      const embed = new EmbedBuilder()
        .setColor('#d6c2ee')
        .setDescription(`${cfg.currencyEmoji || ''} **${target.username}** has **${Number(balance).toLocaleString()}** ${cfg.currencyName}`)
        .setThumbnail(target.displayAvatarURL());
      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'give') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID) {
        return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
      }
      await interaction.deferReply();

      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const cfg = await getGuildCurrencyConfig(interaction.guildId);

      const newBalance = await adjustGuildBalance(interaction.guildId, target.id, target.username, amount);
      if (newBalance === null) {
        return interaction.editReply(`${e('wrong')} Failed to adjust balance — try again in a moment.`);
      }

      const verb = amount >= 0 ? 'Gave' : 'Took';
      const embed = new EmbedBuilder()
        .setColor(amount >= 0 ? '#2ecc71' : '#e74c3c')
        .setDescription(
          `${verb} **${Math.abs(amount).toLocaleString()}** ${cfg.currencyName} ${amount >= 0 ? 'to' : 'from'} **${target.username}**\n` +
          `> **Reason:** ${reason}\n` +
          `New balance: **${Number(newBalance).toLocaleString()} ${cfg.currencyName}**`
        );
      return interaction.editReply({ embeds: [embed] });
    }

    // ── setup ──────────────────────────────────────────────────────────────
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
    }

    const useSins = interaction.options.getBoolean('use_sins');
    const name    = interaction.options.getString('name');
    const emoji   = interaction.options.getString('emoji');
    const autoPay = interaction.options.getBoolean('auto_pay');

    await interaction.deferReply({ ephemeral: true });

    if (useSins && !isGuildAllowedSins(interaction.guildId)) {
      return interaction.editReply(`${e('wrong')} Real Sins are only available in specific approved servers. Set up a custom currency instead (\`use_sins:False name:"..." emoji:"..."\`).`);
    }
    if (!useSins && !name) {
      return interaction.editReply(`${e('wrong')} Please provide a \`name\` for your custom currency (e.g. "Coins") when \`use_sins\` is False.`);
    }
    if (!useSins && name.toLowerCase() === 'sins') {
      return interaction.editReply(`${e('wrong')} "Sins" is reserved for the real Sins currency — pick a different name for your custom one.`);
    }
    if (!useSins) {
      const clash = await query(
        'SELECT guild_id FROM guild_config WHERE LOWER(currency_name) = LOWER($1) AND currency_use_sins = false AND guild_id != $2 LIMIT 1',
        [name, interaction.guildId]
      );
      if (clash.rows.length) {
        return interaction.editReply(`${e('wrong')} "${name}" is already in use as another server's custom currency name. Please pick a different one to avoid confusion between servers.`);
      }
    }

    await query(`
      INSERT INTO guild_config (guild_id, currency_use_sins, currency_name, currency_emoji, auto_pay_enabled)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (guild_id) DO UPDATE SET
        currency_use_sins = $2,
        currency_name = $3,
        currency_emoji = $4,
        auto_pay_enabled = COALESCE($5, guild_config.auto_pay_enabled)
    `, [interaction.guildId, useSins, useSins ? 'Sins' : name, emoji, autoPay]);

    // Also keep RR's own currency config in sync, since its battle
    // announcements read from here directly.
    await query(`
      INSERT INTO rr_guild_config (guild_id, use_sins, currency_name, currency_emoji)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (guild_id) DO UPDATE SET
        use_sins = $2,
        currency_name = $3,
        currency_emoji = $4
    `, [interaction.guildId, useSins, useSins ? 'Sins' : name, emoji || '<a:SINS:1522338148380704910>']);

    const cfg = await getGuildCurrencyConfig(interaction.guildId);
    const autoPayNote = cfg.autoPayEnabled
      ? '\n\n⏰ Auto-pay is **ON** — staff and boosters get paid automatically the moment they\'re due, no admin action needed.'
      : '\n\nAuto-pay is currently off — payments still require `/mark-paid pay`. Run `/currency setup` again with `auto_pay:True` to turn it on.';

    return interaction.editReply((useSins
      ? `${e('checkmark')} This server now uses real **Sins** everywhere — staff pay, boosters, Rumble Royale, and more.`
      : `${e('checkmark')} This server now uses **${name}** ${emoji || ''} everywhere — staff pay, boosters, Rumble Royale, and more.`) + autoPayNote);
  },
};
