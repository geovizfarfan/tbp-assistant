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
    description: 'General server-wide behavior — buttons below. Verify setup stays standalone (`/verify setup`) since it involves 2 channels, a role, and long rules text — too much for one form. Shop and Staff setup live under their own categories.',
    items: [],
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
    label: 'Payments, Sellers & Shop',
    emoji: '💳',
    description: 'Seller roster and shop channels — buttons below. Payment methods are self-service (a seller sets their own via `/pay methods set`, not something set for them here). Shop item management (`additem`/`edititem`/`removeitem`) has too many fields to fit here cleanly — use those commands directly.',
    items: [],
  },
  panels: {
    label: 'Panels & Sticky Content',
    emoji: '🧩',
    description: 'Sticky notes and ping panels — buttons below. Role panels and ticket panels involve adding items one at a time (roles, ticket types), which is an ongoing management flow rather than a single setup step — use `/rolepanel` and `/ticket panel` directly for those.',
    items: [],
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

function buildSellerButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_seller:add').setLabel('Add Seller').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_seller:remove').setLabel('Remove Seller').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_seller:list').setLabel('List Sellers').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_seller:shopsetup').setLabel('Shop Setup').setStyle(ButtonStyle.Primary),
  );
}

function buildSellerUserPicker(action) {
  const menu = new UserSelectMenuBuilder()
    .setCustomId(`serversetup_selleruser:${action}`)
    .setPlaceholder(`Pick who to ${action}`);
  return new ActionRowBuilder().addComponents(menu);
}

function buildShopChannelPicker() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('serversetup_shopchan')
    .setPlaceholder('Pick the shop channel');
  return new ActionRowBuilder().addComponents(menu);
}

function buildFulfillChannelPicker(shopChannelId) {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(`serversetup_fulfillchan:${shopChannelId}`)
    .setPlaceholder('Pick the fulfillment channel (optional)');
  const skipButton = new ButtonBuilder()
    .setCustomId(`serversetup_fulfillskip:${shopChannelId}`)
    .setLabel('Skip')
    .setStyle(ButtonStyle.Secondary);
  return [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(skipButton)];
}

function buildPanelsButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_panels:stickyset').setLabel('Set Sticky').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_panels:stickyremove').setLabel('Remove Sticky').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_panels:pingpost').setLabel('Post Ping Panel').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_panels:pingremove').setLabel('Remove Ping Panel').setStyle(ButtonStyle.Danger),
  );
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

    if (key === 'settings') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildSettingsButtons(), buildSettingsButtons2(), buildBackButton()],
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

    if (key === 'sellers') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildSellerButtons(), buildBackButton()],
      });
    }

    if (key === 'panels') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildPanelsButtons(), buildBackButton()],
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

  async handleSellerButton(interaction) {
    const [, action] = interaction.customId.split(':');

    if (action === 'list') {
      const res = await query('SELECT user_id FROM pay_sellers WHERE guild_id=$1', [interaction.guildId]);
      const embed = new EmbedBuilder().setColor('#d6c2ee').setTitle('💳 Approved Sellers')
        .setDescription(res.rows.length ? res.rows.map(r => `<@${r.user_id}>`).join('\n') : 'No approved sellers yet.');
      return interaction.update({ embeds: [embed], components: [buildSellerButtons(), buildBackButton()] });
    }

    if (action === 'shopsetup') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the shop channel:')],
        components: [buildShopChannelPicker(), buildBackButton()],
      });
    }

    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription(`Pick who to ${action}:`)],
      components: [buildSellerUserPicker(action), buildBackButton()],
    });
  },

  async handleSellerUserPicked(interaction) {
    const [, action] = interaction.customId.split(':');
    const user = interaction.users.first();
    await interaction.deferUpdate();

    if (action === 'add') {
      await query('INSERT INTO pay_sellers (guild_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [interaction.guildId, user.id]);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ <@${user.id}> is now an approved seller.`)],
        components: [buildSellerButtons(), buildBackButton()],
      });
    }

    if (action === 'remove') {
      await query('DELETE FROM pay_sellers WHERE guild_id=$1 AND user_id=$2', [interaction.guildId, user.id]);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ <@${user.id}> removed from sellers.`)],
        components: [buildSellerButtons(), buildBackButton()],
      });
    }
  },

  async handleShopChannelPicked(interaction) {
    const channel = interaction.channels.first();
    const [row1, row2] = buildFulfillChannelPicker(channel.id);
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription(`Shop channel: <#${channel.id}>. Now pick the fulfillment channel, or skip:`)],
      components: [row1, row2, buildBackButton()],
    });
  },

  async handleFulfillChannelPicked(interaction) {
    const [, shopChannelId] = interaction.customId.split(':');
    const fulfillChannel = interaction.channels.first();
    return finishShopSetup(interaction, shopChannelId, fulfillChannel.id);
  },

  async handleFulfillSkip(interaction) {
    const [, shopChannelId] = interaction.customId.split(':');
    return finishShopSetup(interaction, shopChannelId, null);
  },

  async handlePanelsButton(interaction) {
    const [, action] = interaction.customId.split(':');

    if (action === 'stickyset') {
      const modal = new ModalBuilder()
        .setCustomId('serversetup_stickymodal')
        .setTitle('Set Sticky Message');
      const messageInput = new TextInputBuilder().setCustomId('message').setLabel('Message (stays at bottom of this channel)').setStyle(TextInputStyle.Paragraph).setRequired(true);
      const titleInput = new TextInputBuilder().setCustomId('title').setLabel('Title (optional)').setStyle(TextInputStyle.Short).setRequired(false);
      const colorInput = new TextInputBuilder().setCustomId('color').setLabel('Color hex (optional, default #d6c2ee)').setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(
        new ActionRowBuilder().addComponents(messageInput),
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(colorInput),
      );
      return interaction.showModal(modal);
    }

    if (action === 'stickyremove') {
      await interaction.deferUpdate();
      const res = await query('DELETE FROM sticky_messages WHERE guild_id=$1 AND channel_id=$2 RETURNING message_id', [interaction.guildId, interaction.channelId]);
      const msg = res.rows.length ? `✅ Sticky message removed from this channel.` : `❌ No sticky message found in this channel.`;
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(res.rows.length ? '#2ecc71' : '#ff4444').setDescription(msg)],
        components: [buildPanelsButtons(), buildBackButton()],
      });
    }

    if (action === 'pingpost') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the role this panel gives/removes:')],
        components: [buildPingRolePicker(), buildBackButton()],
      });
    }

    if (action === 'pingremove') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the channel to remove the ping panel from:')],
        components: [buildPingRemoveChannelPicker(), buildBackButton()],
      });
    }
  },

  async handleStickyModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const text = interaction.fields.getTextInputValue('message').replace(/\\n/g, '\n');
    const title = interaction.fields.getTextInputValue('title') || null;
    const color = interaction.fields.getTextInputValue('color') || '#d6c2ee';

    const embed = new EmbedBuilder().setColor(color).setDescription(text);
    if (title) embed.setTitle(title);

    const msg = await interaction.channel.send({ embeds: [embed] });

    await query(`
      INSERT INTO sticky_messages (guild_id, channel_id, message_id, content, title, color)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (guild_id, channel_id) DO UPDATE SET
        message_id = EXCLUDED.message_id, content = EXCLUDED.content, title = EXCLUDED.title, color = EXCLUDED.color
    `, [interaction.guildId, interaction.channelId, msg.id, text, title, color]);

    return interaction.editReply(`✅ Sticky message set in <#${interaction.channelId}>. It will stay at the bottom.`);
  },

  async handlePingRolePicked(interaction) {
    const role = interaction.roles.first();

    const modal = new ModalBuilder()
      .setCustomId(`serversetup_pingmodal:${role.id}`)
      .setTitle('Ping Panel Details');
    const titleInput = new TextInputBuilder().setCustomId('title').setLabel('Panel title').setStyle(TextInputStyle.Short).setRequired(true);
    const descInput = new TextInputBuilder().setCustomId('description').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false);
    const colorInput = new TextInputBuilder().setCustomId('color').setLabel('Color hex (optional, default #d6c2ee)').setStyle(TextInputStyle.Short).setRequired(false);
    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(colorInput),
    );
    return interaction.showModal(modal);
  },

  async handlePingPanelModal(interaction) {
    const [, roleId] = interaction.customId.split(':');
    await interaction.deferReply({ ephemeral: true });

    const title = interaction.fields.getTextInputValue('title');
    const description = interaction.fields.getTextInputValue('description') ||
      `Want to get notified <a:notify:1522746425639960636> ?\nClick Below <a:whitesparkle:1512912831761092740>`;
    const color = interaction.fields.getTextInputValue('color') || '#d6c2ee';

    const { buildPanel } = require('../pingpanel/pingpanel');
    const { embed, row } = buildPanel(title, description, roleId, color);
    const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

    await query(`
      INSERT INTO pingpanel_sticky (guild_id, channel_id, role_id, message_id, title, description, color)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (guild_id, channel_id) DO UPDATE SET
        role_id = EXCLUDED.role_id, message_id = EXCLUDED.message_id,
        title = EXCLUDED.title, description = EXCLUDED.description, color = EXCLUDED.color
    `, [interaction.guildId, interaction.channelId, roleId, msg.id, title, description, color]);

    return interaction.editReply(`✅ Ping panel posted in <#${interaction.channelId}> for <@&${roleId}>.`);
  },

  async handlePingRemoveChannelPicked(interaction) {
    const channel = interaction.channels.first();
    await interaction.deferUpdate();

    await query('DELETE FROM pingpanel_sticky WHERE guild_id=$1 AND channel_id=$2', [interaction.guildId, channel.id]);

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ Ping panel removed from <#${channel.id}>.`)],
      components: [buildPanelsButtons(), buildBackButton()],
    });
  },

  async handleSettingsButton(interaction) {
    const [, action] = interaction.customId.split(':');

    if (action === 'timezone') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick your server timezone:')],
        components: [buildTimezoneSelect(), buildBackButton()],
      });
    }

    if (action === 'claimtime') {
      const modal = new ModalBuilder().setCustomId('serversetup_claimtimemodal').setTitle('Claim Time');
      const defaultInput = new TextInputBuilder().setCustomId('default').setLabel('Hours for regular winners (default: 6)').setStyle(TextInputStyle.Short).setRequired(false);
      const boosterInput = new TextInputBuilder().setCustomId('booster').setLabel('Hours for boosters (default: 12)').setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(defaultInput), new ActionRowBuilder().addComponents(boosterInput));
      return interaction.showModal(modal);
    }

    if (action === 'banlog') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the ban log channel:')],
        components: [buildBanlogChannelPicker(), buildBackButton()],
      });
    }

    if (action === 'welcome') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the channel for welcome messages:')],
        components: [buildWelcomeChannelPicker(), buildBackButton()],
      });
    }

    if (action === 'levelchan') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the level-up announcement channel:')],
        components: [buildLevelChannelPicker(), buildBackButton()],
      });
    }

    if (action === 'levelon' || action === 'leveloff') {
      await interaction.deferUpdate();
      const enabled = action === 'levelon';
      await query(`
        INSERT INTO level_config (guild_id, enabled) VALUES ($1,$2)
        ON CONFLICT (guild_id) DO UPDATE SET enabled = $2
      `, [interaction.guildId, enabled]);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ Level system is now **${enabled ? 'ON' : 'OFF'}**.`)],
        components: [buildSettingsButtons(), buildSettingsButtons2(), buildBackButton()],
      });
    }

    if (action === 'rrsins') {
      await interaction.deferUpdate();
      const { isGuildAllowedSins } = require('../../utils/sinsRequests');
      if (!isGuildAllowedSins(interaction.guildId)) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor('#ff4444').setDescription('❌ Real Sins are only available in specific approved servers. Use "RR: Custom Currency" instead.')],
          components: [buildSettingsButtons(), buildSettingsButtons2(), buildBackButton()],
        });
      }
      await query(`
        INSERT INTO rr_guild_config (guild_id, use_sins) VALUES ($1,true)
        ON CONFLICT (guild_id) DO UPDATE SET use_sins = true
      `, [interaction.guildId]);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription('✅ Rumble Royale now uses real Sins.')],
        components: [buildSettingsButtons(), buildSettingsButtons2(), buildBackButton()],
      });
    }

    if (action === 'rrcustom') {
      const modal = new ModalBuilder().setCustomId('serversetup_rrcurrencymodal').setTitle('Custom RR Currency');
      const nameInput = new TextInputBuilder().setCustomId('name').setLabel('Currency name, e.g. Coins').setStyle(TextInputStyle.Short).setRequired(true);
      const emojiInput = new TextInputBuilder().setCustomId('emoji').setLabel('Currency emoji, e.g. 🪙').setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(emojiInput));
      return interaction.showModal(modal);
    }
  },

  async handleTimezonePicked(interaction) {
    const timezone = interaction.values[0];
    await interaction.deferUpdate();

    await query(`
      INSERT INTO guild_config (guild_id, timezone) VALUES ($1,$2)
      ON CONFLICT (guild_id) DO UPDATE SET timezone = $2
    `, [interaction.guildId, timezone]);

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ Timezone set to **${timezone}**.`)],
      components: [buildSettingsButtons(), buildSettingsButtons2(), buildBackButton()],
    });
  },

  async handleClaimTimeModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const defaultRaw = interaction.fields.getTextInputValue('default');
    const boosterRaw = interaction.fields.getTextInputValue('booster');
    const defaultHrs = defaultRaw ? parseInt(defaultRaw, 10) : null;
    const boosterHrs = boosterRaw ? parseInt(boosterRaw, 10) : null;

    if (defaultRaw && isNaN(defaultHrs)) return interaction.editReply('❌ Default hours must be a number.');
    if (boosterRaw && isNaN(boosterHrs)) return interaction.editReply('❌ Booster hours must be a number.');

    await query(`
      INSERT INTO guild_config (guild_id, claim_hours_default, claim_hours_booster)
      VALUES ($1, $2, $3)
      ON CONFLICT (guild_id) DO UPDATE SET
        claim_hours_default = COALESCE($2, guild_config.claim_hours_default),
        claim_hours_booster  = COALESCE($3, guild_config.claim_hours_booster)
    `, [interaction.guildId, defaultHrs, boosterHrs]);

    return interaction.editReply('✅ Claim time updated.');
  },

  async handleBanlogChannelPicked(interaction) {
    const channel = interaction.channels.first();
    await interaction.deferUpdate();

    await query(`
      INSERT INTO guild_config (guild_id, ban_log_channel_id) VALUES ($1,$2)
      ON CONFLICT (guild_id) DO UPDATE SET ban_log_channel_id = $2
    `, [interaction.guildId, channel.id]);

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ Ban log channel set to <#${channel.id}>.`)],
      components: [buildSettingsButtons(), buildSettingsButtons2(), buildBackButton()],
    });
  },

  async handleLevelChannelPicked(interaction) {
    const channel = interaction.channels.first();
    await interaction.deferUpdate();

    await query(`
      INSERT INTO level_config (guild_id, levelup_channel_id) VALUES ($1,$2)
      ON CONFLICT (guild_id) DO UPDATE SET levelup_channel_id = $2
    `, [interaction.guildId, channel.id]);

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ Level-up announcements will post in <#${channel.id}>.`)],
      components: [buildSettingsButtons(), buildSettingsButtons2(), buildBackButton()],
    });
  },

  async handleWelcomeChannelPicked(interaction) {
    const channel = interaction.channels.first();

    const modal = new ModalBuilder().setCustomId(`serversetup_welcomemodal:${channel.id}`).setTitle('Welcome Message');
    const textInput = new TextInputBuilder().setCustomId('text').setLabel('Text — use {user} to mention them').setStyle(TextInputStyle.Paragraph).setRequired(true);
    const titleInput = new TextInputBuilder().setCustomId('title').setLabel('Title (optional)').setStyle(TextInputStyle.Short).setRequired(false);
    const imageInput = new TextInputBuilder().setCustomId('image').setLabel('Image/icon URL (optional)').setStyle(TextInputStyle.Short).setRequired(false);
    modal.addComponents(
      new ActionRowBuilder().addComponents(textInput),
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(imageInput),
    );
    return interaction.showModal(modal);
  },

  async handleWelcomeModal(interaction) {
    const [, channelId] = interaction.customId.split(':');
    await interaction.deferReply({ ephemeral: true });

    const text = interaction.fields.getTextInputValue('text').replace(/\\n/g, '\n');
    const title = interaction.fields.getTextInputValue('title') || null;
    const image = interaction.fields.getTextInputValue('image') || null;

    const cfgRes = await query('SELECT 1 FROM verify_config WHERE guild_id = $1', [interaction.guildId]);
    if (!cfgRes.rows.length) return interaction.editReply('❌ Run Verify Setup first (`/verify setup`) before configuring the welcome message.');

    await query(`
      UPDATE verify_config SET
        welcome_channel_id = $1,
        welcome_text = $2,
        welcome_title = COALESCE($3, welcome_title),
        welcome_image = COALESCE($4, welcome_image)
      WHERE guild_id = $5
    `, [channelId, text, title, image, interaction.guildId]);

    return interaction.editReply(`✅ Welcome messages will post in <#${channelId}>.`);
  },

  async handleRRCurrencyModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const name = interaction.fields.getTextInputValue('name');
    const emoji = interaction.fields.getTextInputValue('emoji') || null;

    await query(`
      INSERT INTO rr_guild_config (guild_id, use_sins, currency_name, currency_emoji)
      VALUES ($1,false,$2,$3)
      ON CONFLICT (guild_id) DO UPDATE SET use_sins=false, currency_name=$2, currency_emoji=$3
    `, [interaction.guildId, name, emoji]);

    return interaction.editReply(`✅ Rumble Royale now uses custom currency: **${name}** ${emoji || ''}`);
  },
};

function buildPingRolePicker() {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId('serversetup_pingrole')
    .setPlaceholder('Pick the role for this panel');
  return new ActionRowBuilder().addComponents(menu);
}

function buildPingRemoveChannelPicker() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('serversetup_pingremovechan')
    .setPlaceholder('Pick the channel to remove the panel from');
  return new ActionRowBuilder().addComponents(menu);
}

function buildSettingsButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gset:timezone').setLabel('Timezone').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('serversetup_gset:claimtime').setLabel('Claim Time').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('serversetup_gset:banlog').setLabel('Ban Log Channel').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('serversetup_gset:welcome').setLabel('Welcome Message').setStyle(ButtonStyle.Primary),
  );
}

function buildSettingsButtons2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gset:levelon').setLabel('Level Up ON').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_gset:leveloff').setLabel('Level Up OFF').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_gset:levelchan').setLabel('Level-Up Channel').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:rrsins').setLabel('RR: Use Sins').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:rrcustom').setLabel('RR: Custom Currency').setStyle(ButtonStyle.Secondary),
  );
}

function buildTimezoneSelect() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('serversetup_timezone')
    .setPlaceholder('Pick your server timezone')
    .addOptions(
      { label: 'ET — Eastern', value: 'America/New_York' },
      { label: 'CT — Central', value: 'America/Chicago' },
      { label: 'MT — Mountain', value: 'America/Denver' },
      { label: 'PT — Pacific', value: 'America/Los_Angeles' },
      { label: 'GMT', value: 'Europe/London' },
      { label: 'CET — Central European', value: 'Europe/Paris' },
    );
  return new ActionRowBuilder().addComponents(menu);
}

function buildBanlogChannelPicker() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('serversetup_banlogchan')
    .setPlaceholder('Pick the ban log channel');
  return new ActionRowBuilder().addComponents(menu);
}

function buildLevelChannelPicker() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('serversetup_levelchan')
    .setPlaceholder('Pick the level-up announcement channel');
  return new ActionRowBuilder().addComponents(menu);
}

function buildWelcomeChannelPicker() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('serversetup_welcomechan')
    .setPlaceholder('Pick the welcome-message channel');
  return new ActionRowBuilder().addComponents(menu);
}

async function finishShopSetup(interaction, shopChannelId, fulfillChannelId) {
  await interaction.deferUpdate();

  await query(`
    INSERT INTO shop_config (guild_id, shop_channel_id, fulfillment_channel_id)
    VALUES ($1,$2,$3)
    ON CONFLICT (guild_id) DO UPDATE SET
      shop_channel_id = EXCLUDED.shop_channel_id,
      fulfillment_channel_id = COALESCE(EXCLUDED.fulfillment_channel_id, shop_config.fulfillment_channel_id)
  `, [interaction.guildId, shopChannelId, fulfillChannelId]);

  const { renderAndPost } = require('../shop/shop');
  await renderAndPost(interaction.client, interaction.guildId);

  return interaction.editReply({
    embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(
      `✅ Shop configured in <#${shopChannelId}>${fulfillChannelId ? ` (used/custom items → <#${fulfillChannelId}>)` : ''}.`
    )],
    components: [buildSellerButtons(), buildBackButton()],
  });
}
