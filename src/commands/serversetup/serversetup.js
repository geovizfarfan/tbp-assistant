const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { query } = require('../../utils/database');

const CHANNEL_SETTINGS = {
  schedule:  { label: 'Game Schedule Board',   column: 'schedule_channel_id' },
  winners:   { label: 'Winners Channel',       column: 'winner_channel_id' },
  ticket:    { label: 'Ticket Channel',        column: 'ticket_channel_id' },
  staff_notif: { label: 'Staff Notifications', column: 'staff_notif_channel_id' },
  boost:     { label: 'Boost Announcement',    column: 'boost_channel_id' },
  transcript: { label: 'Game Transcripts',     column: 'game_transcript_channel_id' },
};

const ROLE_SETTINGS = {
  mod:       { label: 'Mod Role',       column: 'mod_role_id' },
  admin:     { label: 'Admin Role',     column: 'admin_role_id' },
  game_ping: { label: 'Game Ping Role', column: 'game_ping_role_id' },
};

const CATEGORIES = {
  channels: {
    label: 'Server Channel Set',
    emoji: '📺',
    description: 'Every key channel the bot posts to or reads from.',
    items: [
      'Game board channel — `/settings channels schedule:`',
      'Winners channel — `/settings channels winners:`',
      'Ticket channel — `/settings channels ticket:`',
      'Ticket transcripts channel — *not yet split from game transcripts, coming in a later phase*',
      'Staff notifications channel — `/settings channels staff_notif:`',
      'Game transcripts channel — `/settings channels transcript:`',
      'Claim time — `/settings claim-time default: booster:`',
      'Grind setup — `/grind setup`',
    ],
  },
  settings: {
    label: 'Server Settings',
    emoji: '⚙️',
    description: 'General server-wide behavior and integrations.',
    items: [
      'Claim time — `/settings claim-time`',
      'Set timezone — `/settings timezone`',
      'Level config / excluded channels — `/level config`, `/level exclude add`',
      'Verify setup — `/verify setup`',
      'Ban log setup — `/banlog setup`',
      'RR currency — `/rr currency` *(rename to /rr wallet-config coming in a later phase)*',
      'RR wallet — `/rr wallet` *(rename coming in a later phase)*',
      'Shop setup — `/shop setup`',
      'Staff setup — `/staff add`',
      'Welcome message — `/verify welcome`',
    ],
  },
  roles: {
    label: 'Server Role Set',
    emoji: '🎭',
    description: 'Roles the bot pings or manages automatically.',
    items: [
      'Game ping role — `/settings roles game_ping:`',
      'Mod / Admin roles — `/settings roles mod: admin:`',
      'Other ping roles as needed',
    ],
  },
  goosty: {
    label: 'Extras & Utilities',
    emoji: '✨',
    description: 'GoosDate reminders and private rooms — buttons below.',
    items: [],
  },
  boosters: {
    label: 'Server Booster Set',
    emoji: '🚀',
    description: 'Server boost tracking and announcements — buttons below.',
    items: [
      'Boost announcement channel — configure via Server Channel Set',
    ],
  },
  staff: {
    label: 'Staff & Payroll',
    emoji: '👥',
    description: 'Staff roster and pay tracking — buttons below.',
    items: [],
  },
  summary: {
    label: 'Settings Summary',
    emoji: '📋',
    description: 'Read-only overview of current configuration — loads live below.',
    items: [
      'Pay summary — `/staff report`',
      'Ban log list — `/banlog list`',
    ],
  },
  giveaways: {
    label: 'Giveaway & Raffle Settings',
    emoji: '🎁',
    description: 'Bonus-entry and required-role libraries for giveaways — buttons below. Raffles have no separate settings; running one is `/raffle start`.',
    items: [],
  },
  sellers: {
    label: 'Seller Settings',
    emoji: '💳',
    description: 'Payment methods and seller roster.',
    items: [
      'Set a member\'s pay method — `/pay method`',
      'Add a seller — `/pay seller add`',
      'List sellers — `/pay seller list`',
      'Anything else payment-related — `/pay` commands',
    ],
  },
  panels: {
    label: 'Panels',
    emoji: '🧩',
    description: 'Role panels and ticket panels.',
    items: [
      'Role panel create/edit/delete/remove/repost — `/rolepanel` commands',
      'Ticket panels — `/ticket panel` commands',
    ],
  },
};

function buildHomeEmbed(guild) {
  return new EmbedBuilder()
    .setColor('#d6c2ee')
    .setTitle('⚙️ Server Setup')
    .setDescription('Pick a category below to see everything that lives there. This is a growing hub — some items still point to their original commands for now, and will move fully into this menu over time.')
    .setFooter({ text: guild.name });
}

function buildCategoryEmbed(key, guild) {
  const cat = CATEGORIES[key];
  return new EmbedBuilder()
    .setColor('#d6c2ee')
    .setTitle(`${cat.emoji} ${cat.label}`)
    .setDescription(cat.description + '\n\n' + cat.items.map(i => `• ${i}`).join('\n'))
    .setFooter({ text: guild.name });
}

function buildHomeButtons() {
  const keys = Object.keys(CATEGORIES);
  const rows = [];
  for (let i = 0; i < keys.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const key of keys.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`serversetup_nav:${key}`)
          .setLabel(CATEGORIES[key].label)
          .setEmoji(CATEGORIES[key].emoji)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }
  return rows;
}

function buildBackButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('serversetup_nav:home')
      .setLabel('Back')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Primary)
  );
}

function buildChannelSettingSelect() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('serversetup_channelpick')
    .setPlaceholder('Which channel do you want to set?')
    .addOptions(Object.entries(CHANNEL_SETTINGS).map(([key, cfg]) => ({
      label: cfg.label,
      value: key,
    })));
  return new ActionRowBuilder().addComponents(menu);
}

function buildChannelPicker(settingKey) {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(`serversetup_channelset:${settingKey}`)
    .setPlaceholder(`Pick the channel for ${CHANNEL_SETTINGS[settingKey].label}`);
  return new ActionRowBuilder().addComponents(menu);
}

function buildRoleSettingSelect() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('serversetup_rolepick')
    .setPlaceholder('Which role do you want to set?')
    .addOptions(Object.entries(ROLE_SETTINGS).map(([key, cfg]) => ({
      label: cfg.label,
      value: key,
    })));
  return new ActionRowBuilder().addComponents(menu);
}

function buildRolePicker(settingKey) {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(`serversetup_roleset:${settingKey}`)
    .setPlaceholder(`Pick the role for ${ROLE_SETTINGS[settingKey].label}`);
  return new ActionRowBuilder().addComponents(menu);
}

function buildBoosterButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_booster:add').setLabel('Add Booster').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_booster:remove').setLabel('Remove Booster').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_booster:paid').setLabel('Mark Paid').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('serversetup_booster:list').setLabel('List').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_booster:overdue').setLabel('Overdue').setStyle(ButtonStyle.Secondary),
  );
}

function buildBoosterUserPicker(action) {
  const menu = new UserSelectMenuBuilder()
    .setCustomId(`serversetup_boosteruser:${action}`)
    .setPlaceholder(`Pick who to ${action}`);
  return new ActionRowBuilder().addComponents(menu);
}

function buildStaffButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_staff:add').setLabel('Add Staff').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_staff:remove').setLabel('Remove Staff').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_staff:list').setLabel('List').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_staff:report').setLabel('Full Report').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('serversetup_staff:payhistory').setLabel('Pay History').setStyle(ButtonStyle.Secondary),
  );
}

function buildStaffUserPicker(action) {
  const menu = new UserSelectMenuBuilder()
    .setCustomId(`serversetup_staffuser:${action}`)
    .setPlaceholder(`Pick who to ${action}`);
  return new ActionRowBuilder().addComponents(menu);
}

function buildExtrasButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_extras:goosdatesetup').setLabel('GoosDate Setup').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('serversetup_extras:goosdateon').setLabel('GoosDate ON').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_extras:goosdateoff').setLabel('GoosDate OFF').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_extras:goosdatestatus').setLabel('GoosDate Status').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_extras:privateroom').setLabel('Post Private Room Button').setStyle(ButtonStyle.Secondary),
  );
}

function buildGoosdateChannelPicker() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('serversetup_goosdatechan')
    .setPlaceholder('Pick the channel for GoosDate reminders');
  return new ActionRowBuilder().addComponents(menu);
}

function buildGoosdateRolePicker(channelId) {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(`serversetup_goosdaterole:${channelId}`)
    .setPlaceholder('Pick the role to ping');
  return new ActionRowBuilder().addComponents(menu);
}

function buildGiveawayButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gw:bonusadd').setLabel('Add Bonus Role').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_gw:bonusremove').setLabel('Remove Bonus Role').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_gw:bonuslist').setLabel('List Bonus Roles').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gw:reqadd').setLabel('Add Required Roles').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_gw:reqremove').setLabel('Remove Required Role').setStyle(ButtonStyle.Danger),
  );
}

function buildGiveawayButtons2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gw:reqlist').setLabel('List Required Roles').setStyle(ButtonStyle.Secondary),
  );
}

function buildBonusRolePicker() {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId('serversetup_gwbonusrole')
    .setPlaceholder('Pick the bonus-entry role');
  return new ActionRowBuilder().addComponents(menu);
}

function buildBonusRemovePicker() {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId('serversetup_gwbonusremove')
    .setPlaceholder('Pick the role to remove');
  return new ActionRowBuilder().addComponents(menu);
}

function buildRequiredRoleAddPicker() {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId('serversetup_gwreqadd')
    .setPlaceholder('Pick up to 10 required roles')
    .setMinValues(1)
    .setMaxValues(10);
  return new ActionRowBuilder().addComponents(menu);
}

function buildRequiredRemovePicker() {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId('serversetup_gwreqremove')
    .setPlaceholder('Pick the role to remove');
  return new ActionRowBuilder().addComponents(menu);
}


module.exports = {
  data: new SlashCommandBuilder()
    .setName('server-setup')
    .setDescription('Central hub for every server configuration option'),

  CATEGORIES,
  buildHomeEmbed,
  buildCategoryEmbed,
  buildHomeButtons,
  buildBackButton,

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }

    await interaction.reply({
      embeds: [buildHomeEmbed(interaction.guild)],
      components: buildHomeButtons(),
      ephemeral: true,
    });
  },

  async handleButton(interaction) {
    const [, key] = interaction.customId.split(':');

    if (key === 'home') {
      return interaction.update({
        embeds: [buildHomeEmbed(interaction.guild)],
        components: buildHomeButtons(),
      });
    }

    if (!CATEGORIES[key]) return;

    if (key === 'summary') {
      await interaction.deferUpdate();
      const { buildConfigEmbed } = require('../help/help');
      const liveEmbed = await buildConfigEmbed(interaction.guild, interaction.client);
      return interaction.editReply({
        embeds: [liveEmbed],
        components: [buildBackButton()],
      });
    }

    if (key === 'channels') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildChannelSettingSelect(), buildBackButton()],
      });
    }

    if (key === 'roles') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildRoleSettingSelect(), buildBackButton()],
      });
    }

    if (key === 'boosters') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildBoosterButtons(), buildBackButton()],
      });
    }

    if (key === 'staff') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildStaffButtons(), buildBackButton()],
      });
    }

    if (key === 'goosty') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildExtrasButtons(), buildBackButton()],
      });
    }

    if (key === 'giveaways') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildGiveawayButtons(), buildGiveawayButtons2(), buildBackButton()],
      });
    }

    return interaction.update({
      embeds: [buildCategoryEmbed(key, interaction.guild)],
      components: [buildBackButton()],
    });
  },

  async handleChannelSettingSelect(interaction) {
    const settingKey = interaction.values[0];
    const cfg = CHANNEL_SETTINGS[settingKey];

    const embed = new EmbedBuilder()
      .setColor('#d6c2ee')
      .setTitle(`📺 Set ${cfg.label}`)
      .setDescription('Pick the channel below.');

    return interaction.update({
      embeds: [embed],
      components: [buildChannelPicker(settingKey), buildChannelSettingSelect(), buildBackButton()],
    });
  },

  async handleChannelPicked(interaction) {
    const [, settingKey] = interaction.customId.split(':');
    const cfg = CHANNEL_SETTINGS[settingKey];
    if (!cfg) return;

    const channel = interaction.channels.first();
    await interaction.deferUpdate();

    await query(`
      INSERT INTO guild_config (guild_id, ${cfg.column})
      VALUES ($1, $2)
      ON CONFLICT (guild_id) DO UPDATE SET ${cfg.column} = $2
    `, [interaction.guildId, channel.id]);

    const embed = new EmbedBuilder()
      .setColor('#2ecc71')
      .setDescription(`✅ **${cfg.label}** set to <#${channel.id}>.`);

    return interaction.editReply({
      embeds: [embed],
      components: [buildChannelSettingSelect(), buildBackButton()],
    });
  },

  async handleRoleSettingSelect(interaction) {
    const settingKey = interaction.values[0];
    const cfg = ROLE_SETTINGS[settingKey];

    const embed = new EmbedBuilder()
      .setColor('#d6c2ee')
      .setTitle(`🎭 Set ${cfg.label}`)
      .setDescription('Pick the role below.');

    return interaction.update({
      embeds: [embed],
      components: [buildRolePicker(settingKey), buildRoleSettingSelect(), buildBackButton()],
    });
  },

  async handleRolePicked(interaction) {
    const [, settingKey] = interaction.customId.split(':');
    const cfg = ROLE_SETTINGS[settingKey];
    if (!cfg) return;

    const role = interaction.roles.first();
    await interaction.deferUpdate();

    await query(`
      INSERT INTO guild_config (guild_id, ${cfg.column})
      VALUES ($1, $2)
      ON CONFLICT (guild_id) DO UPDATE SET ${cfg.column} = $2
    `, [interaction.guildId, role.id]);

    const embed = new EmbedBuilder()
      .setColor('#2ecc71')
      .setDescription(`✅ **${cfg.label}** set to <@&${role.id}>.`);

    return interaction.editReply({
      embeds: [embed],
      components: [buildRoleSettingSelect(), buildBackButton()],
    });
  },

  async handleBoosterButton(interaction) {
    const [, action] = interaction.customId.split(':');

    if (action === 'list') {
      const { listBoosters } = require('../admin/booster');
      return listBoosters(interaction);
    }
    if (action === 'overdue') {
      const { overdueBoosters } = require('../admin/booster');
      return overdueBoosters(interaction);
    }

    // add / remove / paid all need a user first
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription(`Pick who to ${action}:`)],
      components: [buildBoosterUserPicker(action), buildBackButton()],
    });
  },

  async handleBoosterUserPicked(interaction) {
    const [, action] = interaction.customId.split(':');
    const user = interaction.users.first();

    if (action === 'add') {
      const modal = new ModalBuilder()
        .setCustomId(`serversetup_boostermodal:${user.id}`)
        .setTitle(`Add Booster: ${user.username}`);

      const amountInput = new TextInputBuilder().setCustomId('amount').setLabel('Monthly Amount').setStyle(TextInputStyle.Short).setRequired(true);
      const currencyInput = new TextInputBuilder().setCustomId('currency').setLabel('Currency (Crowns / Sins / Goos)').setStyle(TextInputStyle.Short).setRequired(false);
      const tierInput = new TextInputBuilder().setCustomId('tier').setLabel('Tier (basic / standard / premium)').setStyle(TextInputStyle.Short).setRequired(false);
      const notesInput = new TextInputBuilder().setCustomId('notes').setLabel('Notes').setStyle(TextInputStyle.Paragraph).setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(amountInput),
        new ActionRowBuilder().addComponents(currencyInput),
        new ActionRowBuilder().addComponents(tierInput),
        new ActionRowBuilder().addComponents(notesInput),
      );
      return interaction.showModal(modal);
    }

    await interaction.deferUpdate();

    if (action === 'remove') {
      await query(`UPDATE boosters SET active=false WHERE guild_id=$1 AND user_id=$2`, [interaction.guildId, user.id]);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ <@${user.id}> removed from booster tracking.`)],
        components: [buildBoosterButtons(), buildBackButton()],
      });
    }

    if (action === 'paid') {
      const now = new Date();
      const nextDue = new Date();
      nextDue.setDate(nextDue.getDate() + 30);
      const res = await query(
        `UPDATE boosters SET last_paid_at=$1, next_pay_due_at=$2 WHERE guild_id=$3 AND user_id=$4 RETURNING *`,
        [now, nextDue, interaction.guildId, user.id]
      );
      if (!res.rows.length) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor('#ff4444').setDescription(`❌ <@${user.id}> isn't tracked as a booster.`)],
          components: [buildBoosterButtons(), buildBackButton()],
        });
      }
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ <@${user.id}> marked paid — ${res.rows[0].amount_owed} ${res.rows[0].currency}. Next due in 30 days.`)],
        components: [buildBoosterButtons(), buildBackButton()],
      });
    }
  },

  async handleBoosterAddModal(interaction) {
    const [, userId] = interaction.customId.split(':');
    await interaction.deferReply({ ephemeral: true });

    const amount = parseInt(interaction.fields.getTextInputValue('amount'), 10);
    const currency = interaction.fields.getTextInputValue('currency') || 'Crowns';
    const tier = (interaction.fields.getTextInputValue('tier') || 'basic').toLowerCase();
    const notes = interaction.fields.getTextInputValue('notes') || null;

    if (isNaN(amount)) return interaction.editReply('❌ Amount must be a number.');
    if (!['basic', 'standard', 'premium'].includes(tier)) return interaction.editReply('❌ Tier must be basic, standard, or premium.');

    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user) return interaction.editReply('❌ Could not find that user.');

    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + 30);

    await query(
      `INSERT INTO boosters (guild_id, user_id, username, boost_tier, amount_owed, currency, next_pay_due_at, added_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET boost_tier=$4, amount_owed=$5, currency=$6, active=true, notes=$9`,
      [interaction.guildId, user.id, user.username, tier, amount, currency, nextDue, interaction.user.id, notes]
    );

    return interaction.editReply(`✅ <@${user.id}> added as a **${tier}** booster — ${amount} ${currency}/month.`);
  },

  async handleStaffButton(interaction) {
    const [, action] = interaction.customId.split(':');

    if (action === 'list') {
      const { listStaff } = require('../staff/staff');
      return listStaff(interaction);
    }

    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription(`Pick who to ${action}:`)],
      components: [buildStaffUserPicker(action), buildBackButton()],
    });
  },

  async handleStaffUserPicked(interaction) {
    const [, action] = interaction.customId.split(':');
    const user = interaction.users.first();

    if (action === 'add') {
      const modal = new ModalBuilder()
        .setCustomId(`serversetup_staffmodal:${user.id}`)
        .setTitle(`Add Staff: ${user.username}`);

      const roleInput = new TextInputBuilder().setCustomId('role').setLabel('Role (owner/admin/staff/host/rumble_host)').setStyle(TextInputStyle.Short).setRequired(true);
      const currencyInput = new TextInputBuilder().setCustomId('currency').setLabel('Pay Currency (Crowns / Sins / Goos)').setStyle(TextInputStyle.Short).setRequired(false);
      const payInput = new TextInputBuilder().setCustomId('pay').setLabel('Pay Amount').setStyle(TextInputStyle.Short).setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(roleInput),
        new ActionRowBuilder().addComponents(currencyInput),
        new ActionRowBuilder().addComponents(payInput),
      );
      return interaction.showModal(modal);
    }

    if (action === 'remove') {
      await interaction.deferUpdate();
      await query(`UPDATE staff SET active=false WHERE user_id=$1`, [user.id]);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ <@${user.id}> removed from staff.`)],
        components: [buildStaffButtons(), buildBackButton()],
      });
    }

    if (action === 'report') {
      const { staffReport } = require('../staff/staff');
      return staffReport(interaction, user);
    }

    if (action === 'payhistory') {
      const { payHistory } = require('../staff/staff');
      return payHistory(interaction, user);
    }
  },

  async handleStaffAddModal(interaction) {
    const [, userId] = interaction.customId.split(':');
    await interaction.deferReply({ ephemeral: true });

    const role = interaction.fields.getTextInputValue('role').toLowerCase().trim();
    const currency = interaction.fields.getTextInputValue('currency') || 'Crowns';
    const payRaw = interaction.fields.getTextInputValue('pay');
    const pay = payRaw ? parseInt(payRaw, 10) : 0;

    const validRoles = ['owner', 'admin', 'staff', 'host', 'rumble_host'];
    if (!validRoles.includes(role)) return interaction.editReply(`❌ Role must be one of: ${validRoles.join(', ')}`);
    if (payRaw && isNaN(pay)) return interaction.editReply('❌ Pay amount must be a number.');

    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user) return interaction.editReply('❌ Could not find that user.');

    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + 30);

    await query(
      `INSERT INTO staff (user_id, username, role, pay_currency, pay_amount, next_pay_due_at, added_by, guild_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id) DO UPDATE SET role=$3, pay_currency=$4, pay_amount=$5, active=true, guild_id=$8`,
      [user.id, user.username, role, currency, pay, nextDue, interaction.user.id, interaction.guildId]
    );

    return interaction.editReply(`✅ <@${user.id}> added as **${role}** — ${pay} ${currency}/period.`);
  },

  async handleExtrasButton(interaction) {
    const [, action] = interaction.customId.split(':');

    if (action === 'goosdatesetup') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the channel for GoosDate reminders:')],
        components: [buildGoosdateChannelPicker(), buildBackButton()],
      });
    }

    if (action === 'goosdatestatus') {
      const { status } = require('../goosdate/goosdate');
      return status(interaction);
    }

    if (action === 'privateroom') {
      const { setupButton } = require('../privateroom/privateroom');
      return setupButton(interaction);
    }

    if (action === 'goosdateon' || action === 'goosdateoff') {
      await interaction.deferUpdate();
      const enabled = action === 'goosdateon';
      const res = await query(
        `UPDATE goosdate_config SET enabled=$1, updated_at=NOW() WHERE guild_id=$2 RETURNING *`,
        [enabled, interaction.guildId]
      );
      if (!res.rows.length) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor('#ff4444').setDescription('❌ GoosDate hasn\'t been set up yet — use GoosDate Setup first.')],
          components: [buildExtrasButtons(), buildBackButton()],
        });
      }
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ GoosDate reminders are now **${enabled ? 'ON' : 'OFF'}**.`)],
        components: [buildExtrasButtons(), buildBackButton()],
      });
    }
  },

  async handleGoosdateChannelPicked(interaction) {
    const channel = interaction.channels.first();
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription(`Channel set to <#${channel.id}>. Now pick the role to ping:`)],
      components: [buildGoosdateRolePicker(channel.id), buildBackButton()],
    });
  },

  async handleGoosdateRolePicked(interaction) {
    const [, channelId] = interaction.customId.split(':');
    const role = interaction.roles.first();
    await interaction.deferUpdate();

    await query(
      `INSERT INTO goosdate_config (guild_id, channel_id, role_id, enabled)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (guild_id) DO UPDATE SET channel_id=$2, role_id=$3, enabled=true`,
      [interaction.guildId, channelId, role.id]
    );

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ GoosDate reminders will post in <#${channelId}> and ping <@&${role.id}>.`)],
      components: [buildExtrasButtons(), buildBackButton()],
    });
  },

  async handleGiveawayButton(interaction) {
    const [, action] = interaction.customId.split(':');

    if (action === 'bonuslist') {
      const { bonusRoleList } = require('../giveaway/giveaway');
      return bonusRoleList(interaction);
    }
    if (action === 'reqlist') {
      const { requiredRoleList } = require('../giveaway/giveaway');
      return requiredRoleList(interaction);
    }

    const pickers = {
      bonusadd: [buildBonusRolePicker(), 'Pick the role that should grant bonus entries:'],
      bonusremove: [buildBonusRemovePicker(), 'Pick the bonus-entry role to remove:'],
      reqadd: [buildRequiredRoleAddPicker(), 'Pick up to 10 roles to require (member must have ALL of them):'],
      reqremove: [buildRequiredRemovePicker(), 'Pick the required role to remove:'],
    };
    const [picker, prompt] = pickers[action] || [];
    if (!picker) return;

    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription(prompt)],
      components: [picker, buildBackButton()],
    });
  },

  async handleBonusRolePicked(interaction) {
    const role = interaction.roles.first();

    const modal = new ModalBuilder()
      .setCustomId(`serversetup_gwbonusmodal:${role.id}`)
      .setTitle(`Bonus Entries: ${role.name}`);

    const entriesInput = new TextInputBuilder().setCustomId('entries').setLabel('Extra entries this role grants').setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(entriesInput));
    return interaction.showModal(modal);
  },

  async handleBonusRoleModal(interaction) {
    const [, roleId] = interaction.customId.split(':');
    await interaction.deferReply({ ephemeral: true });

    const entries = parseInt(interaction.fields.getTextInputValue('entries'), 10);
    if (isNaN(entries) || entries <= 0) return interaction.editReply('❌ Entries must be a whole number greater than 0.');

    await query(`
      INSERT INTO giveaway_bonus_roles (guild_id, role_id, bonus_entries)
      VALUES ($1,$2,$3)
      ON CONFLICT (guild_id, role_id) DO UPDATE SET bonus_entries = EXCLUDED.bonus_entries
    `, [interaction.guildId, roleId, entries]);

    return interaction.editReply(`✅ <@&${roleId}> now grants **+${entries}** bonus ${entries === 1 ? 'entry' : 'entries'}.`);
  },

  async handleBonusRoleRemovePicked(interaction) {
    const role = interaction.roles.first();
    await interaction.deferUpdate();

    const del = await query('DELETE FROM giveaway_bonus_roles WHERE guild_id=$1 AND role_id=$2 RETURNING id', [interaction.guildId, role.id]);
    const msg = del.rows.length
      ? `✅ Removed <@&${role.id}> from the bonus-entry library.`
      : `❌ <@&${role.id}> wasn't in the bonus-entry library.`;

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(del.rows.length ? '#2ecc71' : '#ff4444').setDescription(msg)],
      components: [buildGiveawayButtons(), buildGiveawayButtons2(), buildBackButton()],
    });
  },

  async handleRequiredRoleAddPicked(interaction) {
    await interaction.deferUpdate();
    const roles = [...interaction.roles.values()];

    for (const role of roles) {
      await query(`
        INSERT INTO giveaway_required_roles (guild_id, role_id) VALUES ($1,$2)
        ON CONFLICT (guild_id, role_id) DO NOTHING
      `, [interaction.guildId, role.id]);
    }

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ Added to the entry-requirement library: ${roles.map(r => `<@&${r.id}>`).join(', ')}`)],
      components: [buildGiveawayButtons(), buildGiveawayButtons2(), buildBackButton()],
    });
  },

  async handleRequiredRoleRemovePicked(interaction) {
    const role = interaction.roles.first();
    await interaction.deferUpdate();

    const del = await query('DELETE FROM giveaway_required_roles WHERE guild_id=$1 AND role_id=$2 RETURNING id', [interaction.guildId, role.id]);
    const msg = del.rows.length
      ? `✅ Removed <@&${role.id}> from the entry-requirement library.`
      : `❌ <@&${role.id}> wasn't in the entry-requirement library.`;

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(del.rows.length ? '#2ecc71' : '#ff4444').setDescription(msg)],
      components: [buildGiveawayButtons(), buildGiveawayButtons2(), buildBackButton()],
    });
  },
};
