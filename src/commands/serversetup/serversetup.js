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
    description: 'Every key channel the bot posts to or reads from, plus the Private Room button — buttons below.',
    items: [
      'Ticket transcripts channel — *not yet split from game transcripts, coming in a later phase*',
    ],
  },
  settings: {
    label: 'Other Settings',
    emoji: '⚙️',
    description: 'General server-wide behavior, GoosDate reminders, and full leveling management — buttons below. Verify setup stays standalone (`/verify setup`) since it involves 2 channels, a role, and long rules text — too much for one form. Shop and Staff setup live under their own categories.',
    items: [],
  },
  automod: {
    label: 'Triggers, Filter & Staff Bios',
    emoji: '⚡',
    description: 'Custom trigger words, the word filter, and Meet the Staff setup — buttons below. Role-restricted triggers and exact-match word filters need the extra options only `/trigger`/`/wordfilter` support directly.',
    items: [],
  },
  roles: {
    label: 'Server Role Set',
    emoji: '🎭',
    description: 'Roles the bot pings or manages automatically — buttons below.',
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
    label: 'Game & Perks Settings',
    emoji: '🎁',
    description: 'Giveaway bonus/required-role libraries, Wheel role bonuses, and raffle management — buttons below.',
    items: [],
  },
  sellers: {
    label: 'Payments, Sellers & Shop',
    emoji: '💳',
    description: 'Seller roster and shop channels — buttons below. Payment methods are self-service (a seller sets their own via `/payment methods set`, not something set for them here). Shop item management (`additem`/`edititem`/`removeitem`) has too many fields to fit here cleanly — use those commands directly.',
    items: [],
  },
  panels: {
    label: 'Panels & Embeds',
    emoji: '🧩',
    description: 'Ping panels, custom embeds, and listing/reposting/removing ticket panels — buttons below. Creating a panel and adding ticket types involves several fields entered one at a time, which is an ongoing management flow rather than a single setup step — use `/ticket panel`, `/ticket addtype`, and `/rolepanel` directly for those.',
    items: [],
  },
  sticky: {
    label: 'Sticky Notes',
    emoji: '📌',
    description: 'The message that stays pinned to the bottom of a channel — buttons below.',
    items: [],
  },
  rumble: {
    label: 'Rumble Setup',
    emoji: '⚔️',
    description: 'RR currency, Rumble Grind panel, achievement channel, and full season management — buttons below. Full battle setup (channels, roles, rewards) is more involved than fits here — use `/rr setup` and `/rs setup` directly for that.',
    items: [],
  },
};

function buildHomeEmbed(guild) {
  const summaries = [
    '📺 **Server Channel Set** — schedule board, winners, tickets, staff notifications, boosts, transcripts, game board, private rooms',
    '⚙️ **Other Settings** — timezone, claim time, welcome message, GoosDate reminders, bulk role removal, full leveling management',
    '🎭 **Server Role Set** — mod, admin, and game-ping roles',
    '🚀 **Server Booster Set** — manage boosters and payments',
    '👥 **Staff & Payroll** — staff roster, pay requirements per role, daily goals',
    '📋 **Settings Summary** — a live snapshot of everything configured so far',
    '🎁 **Game & Perks Settings** — giveaway bonus/required roles, wheel role bonuses, raffle management',
    '💳 **Payments, Sellers & Shop** — approve sellers, shop channel setup',
    '🧩 **Panels & Embeds** — ping panels, custom embeds, ticket panel list/repost/remove',
    '📌 **Sticky Notes** — the message pinned to the bottom of a channel',
    '⚔️ **Rumble Setup** — RR currency, Grind panel, role achievement channel, full season management',
  ];
  return new EmbedBuilder()
    .setColor('#d6c2ee')
    .setTitle('⚙️ Server Setup')
    .setDescription(
      'Pick a category below to see everything that lives there. This is a growing hub — some items still point to their original commands for now, and will move fully into this menu over time.\n\n' +
      summaries.join('\n')
    )
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

function buildChannelExtraButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gset:gameboard').setLabel('Game Board Channel').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_extras:privateroom').setLabel('Post Private Room Button').setStyle(ButtonStyle.Secondary),
  );
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

function buildGrindChannelPicker() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('serversetup_grindchan')
    .setPlaceholder('Pick the channel for the Grind panel');
  return new ActionRowBuilder().addComponents(menu);
}

function buildRoleAchievementChannelPicker() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('serversetup_roleachievementchan')
    .setPlaceholder('Pick the achievement announcement channel');
  return new ActionRowBuilder().addComponents(menu);
}

function buildLevelSetUserPicker() {
  const menu = new UserSelectMenuBuilder()
    .setCustomId('serversetup_levelsetuser')
    .setPlaceholder('Pick the member');
  return new ActionRowBuilder().addComponents(menu);
}

function buildLevelExcludeAddPicker() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('serversetup_levelexcludeaddchan')
    .setPlaceholder('Pick the channel to exclude');
  return new ActionRowBuilder().addComponents(menu);
}

function buildLevelExcludeRemovePicker() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('serversetup_levelexcluderemovechan')
    .setPlaceholder('Pick the channel to re-enable');
  return new ActionRowBuilder().addComponents(menu);
}

function buildGrindRolePicker(channelId) {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(`serversetup_grindrole:${channelId}`)
    .setPlaceholder('Pick the notification role');
  return new ActionRowBuilder().addComponents(menu);
}

function buildWheelAddRolePicker() {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId('serversetup_wheeladdrole')
    .setPlaceholder('Pick the role');
  return new ActionRowBuilder().addComponents(menu);
}

function buildBulkRemoveRolePicker() {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId('serversetup_bulkremoverole')
    .setPlaceholder('Pick the role to strip');
  return new ActionRowBuilder().addComponents(menu);
}

async function buildSeasonSelectMenu(guildId, customId, placeholder) {
  const res = await query(`SELECT name FROM rr_seasons WHERE guild_id=$1 AND status='active' ORDER BY started_at DESC LIMIT 25`, [guildId]);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder);
  if (!res.rows.length) {
    menu.addOptions({ label: 'No active seasons', value: 'none' }).setDisabled(true);
  } else {
    menu.addOptions(res.rows.map(r => ({ label: r.name, value: r.name })));
  }
  return new ActionRowBuilder().addComponents(menu);
}

function buildWheelRemoveRolePicker() {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId('serversetup_wheelremoverole')
    .setPlaceholder('Pick the role to remove');
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
    new ButtonBuilder().setCustomId('serversetup_gset:wheeladd').setLabel('Wheel: Add Role Bonus').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_gset:wheellist').setLabel('Wheel: List Bonuses').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:wheelremove').setLabel('Wheel: Remove Bonus').setStyle(ButtonStyle.Danger),
  );
}

function buildGiveawayButtons3() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gset:rafflelist').setLabel('List My Raffles').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:raffleend').setLabel('End Raffle').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:rafflecancel').setLabel('Cancel Raffle').setStyle(ButtonStyle.Danger),
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
    new ButtonBuilder().setCustomId('serversetup_panels:pingpost').setLabel('Post Ping Panel').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_panels:pingremove').setLabel('Remove Ping Panel').setStyle(ButtonStyle.Danger),
  );
}

function buildStickyButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_panels:stickyset').setLabel('Set Sticky').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_panels:stickyremove').setLabel('Remove Sticky').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_panels:stickyperms').setLabel('Sticky Permissions').setStyle(ButtonStyle.Secondary),
  );
}

async function buildStickyPermsView(guild) {
  const res = await query('SELECT target_type, target_id FROM sticky_permissions WHERE guild_id=$1', [guild.id]);
  const lines = res.rows.length
    ? res.rows.map(r => r.target_type === 'role' ? `<@&${r.target_id}>` : `<@${r.target_id}>`).join('\n')
    : 'No extra roles/users granted yet — admins only for now.';

  const embed = new EmbedBuilder().setColor('#d6c2ee')
    .setTitle('📌 Sticky Permissions')
    .setDescription(lines);

  const addRoleMenu = new RoleSelectMenuBuilder().setCustomId('serversetup_stickypermaddrole').setPlaceholder('Add a role');
  const addUserMenu = new UserSelectMenuBuilder().setCustomId('serversetup_stickypermadduser').setPlaceholder('Add a user');

  const components = [
    new ActionRowBuilder().addComponents(addRoleMenu),
    new ActionRowBuilder().addComponents(addUserMenu),
  ];

  if (res.rows.length) {
    const options = [];
    for (const r of res.rows.slice(0, 25)) {
      let label;
      if (r.target_type === 'role') {
        const role = guild.roles.cache.get(r.target_id);
        label = `Role: ${role ? role.name : 'unknown-role'}`;
      } else {
        const member = await guild.members.fetch(r.target_id).catch(() => null);
        label = `User: ${member ? member.user.username : 'unknown-user'}`;
      }
      options.push({ label: label.slice(0, 100), value: `${r.target_type}:${r.target_id}` });
    }
    const removeMenu = new StringSelectMenuBuilder()
      .setCustomId('serversetup_stickypermremove')
      .setPlaceholder('Remove a role/user')
      .addOptions(options);
    components.push(new ActionRowBuilder().addComponents(removeMenu));
  }

  components.push(buildBackButton());
  return { embed, components };
}

function buildPanelsButtons2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_panels:embedlist').setLabel('List Embeds').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_panels:embedrepost').setLabel('Repost Embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_panels:embeddelete').setLabel('Delete Embed').setStyle(ButtonStyle.Danger),
  );
}

function buildPanelsButtons3() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_panels:ticketpanellist').setLabel('List Ticket Panels').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_panels:ticketpanelrepost').setLabel('Repost Ticket Panel').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_panels:ticketpanelremove').setLabel('Remove Ticket Panel').setStyle(ButtonStyle.Danger),
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

  async handleCleanupChannels(interaction) {
    await interaction.deferUpdate();
    const { cleanupDeletedChannelRefs, cleanupDeletedRoleRefs } = require('../../utils/channelCleanup');
    const clearedChannels = await cleanupDeletedChannelRefs(interaction.guild);
    const clearedRoles = await cleanupDeletedRoleRefs(interaction.guild);
    const cleared = clearedChannels + clearedRoles;

    const { buildConfigEmbed } = require('../help/help');
    const liveEmbed = await buildConfigEmbed(interaction.guild, interaction.client);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('serversetup_cleanupchannels').setLabel('Clean Up Deleted Channels & Roles').setStyle(ButtonStyle.Danger),
    );

    return interaction.editReply({
      content: cleared ? `✅ Cleared **${clearedChannels}** stale channel reference${clearedChannels === 1 ? '' : 's'} and **${clearedRoles}** stale role reference${clearedRoles === 1 ? '' : 's'}.` : '✅ Nothing to clean up — no stale channel or role references found.',
      embeds: [liveEmbed],
      components: [row, buildBackButton()],
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
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('serversetup_cleanupchannels').setLabel('Clean Up Deleted Channels & Roles').setStyle(ButtonStyle.Danger),
      );
      return interaction.editReply({
        embeds: [liveEmbed],
        components: [row, buildBackButton()],
      });
    }

    if (key === 'channels') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildChannelSettingSelect(), buildChannelExtraButtons(), buildBackButton()],
      });
    }

    if (key === 'settings') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
      });
    }

    if (key === 'automod') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildAutomodButtons(), buildAutomodButtons2(), buildBackButton()],
      });
    }

    if (key === 'rumble') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildRumbleButtons(), buildRumbleButtons2(), buildRumbleButtons3(), buildBackButton()],
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

    if (key === 'giveaways') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildGiveawayButtons(), buildGiveawayButtons2(), buildGiveawayButtons3(), buildBackButton()],
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
        components: [buildPanelsButtons(), buildPanelsButtons2(), buildPanelsButtons3(), buildBackButton()],
      });
    }

    if (key === 'sticky') {
      return interaction.update({
        embeds: [buildCategoryEmbed(key, interaction.guild)],
        components: [buildStickyButtons(), buildBackButton()],
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
      const tierInput = new TextInputBuilder().setCustomId('tier').setLabel('Tier (basic / standard / premium)').setStyle(TextInputStyle.Short).setRequired(false);
      const notesInput = new TextInputBuilder().setCustomId('notes').setLabel('Notes').setStyle(TextInputStyle.Paragraph).setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(amountInput),
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
    const tier = (interaction.fields.getTextInputValue('tier') || 'basic').toLowerCase();
    const notes = interaction.fields.getTextInputValue('notes') || null;

    if (isNaN(amount)) return interaction.editReply('❌ Amount must be a number.');
    if (!['basic', 'standard', 'premium'].includes(tier)) return interaction.editReply('❌ Tier must be basic, standard, or premium.');

    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user) return interaction.editReply('❌ Could not find that user.');

    const currRes = await query('SELECT currency_name FROM guild_config WHERE guild_id=$1', [interaction.guildId]);
    const currency = currRes.rows[0]?.currency_name || 'Coins';

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
      const payInput = new TextInputBuilder().setCustomId('pay').setLabel('Pay Amount').setStyle(TextInputStyle.Short).setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(roleInput),
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
    const payRaw = interaction.fields.getTextInputValue('pay');
    const pay = payRaw ? parseInt(payRaw, 10) : 0;

    const validRoles = ['owner', 'admin', 'staff', 'host', 'rumble_host'];
    if (!validRoles.includes(role)) return interaction.editReply(`❌ Role must be one of: ${validRoles.join(', ')}`);
    if (payRaw && isNaN(pay)) return interaction.editReply('❌ Pay amount must be a number.');

    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user) return interaction.editReply('❌ Could not find that user.');

    const currRes = await query('SELECT currency_name FROM guild_config WHERE guild_id=$1', [interaction.guildId]);
    const currency = currRes.rows[0]?.currency_name || 'Coins';

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

    if (action === 'grindsetup') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the channel to post the Rumble Grind panel in:')],
        components: [buildGrindChannelPicker(), buildBackButton()],
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
          components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
        });
      }
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ GoosDate reminders are now **${enabled ? 'ON' : 'OFF'}**.`)],
        components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
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

  async handleRoleAchievementChannelPicked(interaction) {
    const channel = interaction.channels.first();
    await interaction.deferUpdate();

    await query(`
      INSERT INTO rr_guild_config (guild_id, achievement_log_channel_id)
      VALUES ($1, $2)
      ON CONFLICT (guild_id) DO UPDATE SET achievement_log_channel_id = EXCLUDED.achievement_log_channel_id
    `, [interaction.guildId, channel.id]);

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ "Collected all roles" announcements will post in <#${channel.id}>.`)],
      components: [buildRumbleButtons(), buildRumbleButtons2(), buildRumbleButtons3(), buildBackButton()],
    });
  },

  async handleGrindChannelPicked(interaction) {
    const channel = interaction.channels.first();
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription(`Channel set to <#${channel.id}>. Now pick the notification role:`)],
      components: [buildGrindRolePicker(channel.id), buildBackButton()],
    });
  },

  async handleGrindRolePicked(interaction) {
    const [, channelId] = interaction.customId.split(':');
    const role = interaction.roles.first();

    const modal = new ModalBuilder().setCustomId(`serversetup_grindmodal:${channelId}:${role.id}`).setTitle('Grind Setup');
    const maxChanInput = new TextInputBuilder().setCustomId('max_channels').setLabel('Max temp channels (default: 50)').setStyle(TextInputStyle.Short).setRequired(false);
    const durationInput = new TextInputBuilder().setCustomId('duration').setLabel('Hours before auto-delete (default: 1)').setStyle(TextInputStyle.Short).setRequired(false);
    const colorInput = new TextInputBuilder().setCustomId('embed_color').setLabel('Embed color hex (default: #d6c2ee)').setStyle(TextInputStyle.Short).setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(maxChanInput),
      new ActionRowBuilder().addComponents(durationInput),
      new ActionRowBuilder().addComponents(colorInput),
    );
    return interaction.showModal(modal);
  },

  async handleRaffleEndModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const id = parseInt(interaction.fields.getTextInputValue('id'), 10);
    if (isNaN(id)) return interaction.editReply('❌ Raffle ID must be a number.');
    const { endRaffleCore } = require('../raffle/raffle');
    const result = await endRaffleCore(interaction, id);
    return interaction.editReply(result);
  },

  async handleRaffleCancelModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const id = parseInt(interaction.fields.getTextInputValue('id'), 10);
    if (isNaN(id)) return interaction.editReply('❌ Raffle ID must be a number.');
    const reason = interaction.fields.getTextInputValue('reason') || 'No reason provided';
    const { cancelRaffleCore } = require('../raffle/raffle');
    const result = await cancelRaffleCore(interaction, id, reason);
    return interaction.editReply(result);
  },

  async handleEmbedRepostModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const id = parseInt(interaction.fields.getTextInputValue('id'), 10);
    if (isNaN(id)) return interaction.editReply('❌ Embed ID must be a number.');
    const { repostEmbedCore } = require('../embed/embed');
    const result = await repostEmbedCore(interaction, id);
    return interaction.editReply(result);
  },

  async handleEmbedDeleteModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const id = parseInt(interaction.fields.getTextInputValue('id'), 10);
    if (isNaN(id)) return interaction.editReply('❌ Embed ID must be a number.');
    const { deleteEmbedCore } = require('../embed/embed');
    const result = await deleteEmbedCore(interaction, id);
    return interaction.editReply(result);
  },

  async handleTicketPanelRepostModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const panelId = interaction.fields.getTextInputValue('panel_id').trim();
    const { repostPanelCore } = require('../ticket/ticket');
    const result = await repostPanelCore(interaction.client, interaction.guildId, panelId);
    return interaction.editReply(result);
  },

  async handleTicketPanelRemoveModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const panelId = interaction.fields.getTextInputValue('panel_id').trim();
    const { removePanelCore } = require('../ticket/ticket');
    const result = await removePanelCore(interaction.client, interaction.guildId, panelId);
    return interaction.editReply(result);
  },

  async handleSeasonStartModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.fields.getTextInputValue('name');
    const wheelCampaign = interaction.fields.getTextInputValue('wheel_campaign') || null;
    const resetRolesRaw = interaction.fields.getTextInputValue('reset_roles')?.trim().toLowerCase();
    const resetRoles = resetRolesRaw === 'no' ? false : true;
    const { startSeasonCore } = require('../rumbleseasons/rumbleseasons');
    const result = await startSeasonCore(interaction, name, wheelCampaign, resetRoles);
    if (result.error) return interaction.editReply(result.error);
    return interaction.editReply({ embeds: [result.embed] });
  },

  async handleSeasonInfoPicked(interaction) {
    const seasonName = interaction.values[0];
    await interaction.deferUpdate();
    const { getSeasonInfoEmbed } = require('../rumbleseasons/rumbleseasons');
    const embed = await getSeasonInfoEmbed(interaction, seasonName);
    if (!embed) return interaction.editReply(`❌ No active season named **${seasonName}**.`);
    return interaction.editReply({
      embeds: [embed],
      components: [buildRumbleButtons(), buildRumbleButtons2(), buildRumbleButtons3(), buildBackButton()],
    });
  },

  async handleSeasonEndPicked(interaction) {
    const seasonName = interaction.values[0];
    if (seasonName === 'none') return interaction.update({ content: 'No active seasons.', embeds: [], components: [] });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`serversetup_seasonendconfirm:${encodeURIComponent(seasonName)}`).setLabel(`Yes, end "${seasonName}"`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('serversetup_nav:rumble').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#e74c3c').setDescription(`⚠️ Ending **${seasonName}** removes all its winner roles from every member and resets its achievements. This can't be undone. Are you sure?`)],
      components: [row],
    });
  },

  async handleSeasonEndConfirm(interaction) {
    const [, encodedName] = interaction.customId.split(':');
    const seasonName = decodeURIComponent(encodedName);
    await interaction.deferUpdate();
    const { endSeasonCore } = require('../rumbleseasons/rumbleseasons');
    const result = await endSeasonCore(interaction, seasonName);
    if (result.error) return interaction.editReply({ content: result.error, embeds: [], components: [buildRumbleButtons(), buildRumbleButtons2(), buildRumbleButtons3(), buildBackButton()] });
    return interaction.editReply({
      embeds: [result.embed],
      components: [buildRumbleButtons(), buildRumbleButtons2(), buildRumbleButtons3(), buildBackButton()],
    });
  },

  async handleSeasonAddChanPicked(interaction) {
    const seasonName = interaction.values[0];
    if (seasonName === 'none') return interaction.update({ content: 'No active seasons.', embeds: [], components: [] });

    const menu = new ChannelSelectMenuBuilder()
      .setCustomId(`serversetup_seasonaddchanselect:${encodeURIComponent(seasonName)}`)
      .setPlaceholder(`Pick the channel to add to ${seasonName}`);
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription(`Pick the channel to add to **${seasonName}**:`)],
      components: [new ActionRowBuilder().addComponents(menu), buildBackButton()],
    });
  },

  async handleSeasonAddChanSelected(interaction) {
    const [, encodedName] = interaction.customId.split(':');
    const seasonName = decodeURIComponent(encodedName);
    const channel = interaction.channels.first();
    await interaction.deferUpdate();
    const { addChannelCore } = require('../rumbleseasons/rumbleseasons');
    const result = await addChannelCore(interaction, seasonName, channel);
    const color = result.error ? '#ff4444' : '#2ecc71';
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color).setDescription(result.error || result.text)],
      components: [buildRumbleButtons(), buildRumbleButtons2(), buildRumbleButtons3(), buildBackButton()],
    });
  },

  async handleSeasonRemoveChanPicked(interaction) {
    const seasonName = interaction.values[0];
    if (seasonName === 'none') return interaction.update({ content: 'No active seasons.', embeds: [], components: [] });

    const menu = new ChannelSelectMenuBuilder()
      .setCustomId(`serversetup_seasonremovechanselect:${encodeURIComponent(seasonName)}`)
      .setPlaceholder(`Pick the channel to remove from ${seasonName}`);
    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription(`Pick the channel to remove from **${seasonName}**:`)],
      components: [new ActionRowBuilder().addComponents(menu), buildBackButton()],
    });
  },

  async handleSeasonRemoveChanSelected(interaction) {
    const [, encodedName] = interaction.customId.split(':');
    const seasonName = decodeURIComponent(encodedName);
    const channel = interaction.channels.first();
    await interaction.deferUpdate();
    const { removeChannelCore } = require('../rumbleseasons/rumbleseasons');
    const result = await removeChannelCore(interaction, seasonName, channel);
    const color = result.error ? '#ff4444' : '#2ecc71';
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(color).setDescription(result.error || result.text)],
      components: [buildRumbleButtons(), buildRumbleButtons2(), buildRumbleButtons3(), buildBackButton()],
    });
  },

  async handleSeasonLinkPicked(interaction) {
    const seasonName = interaction.values[0];
    if (seasonName === 'none') return interaction.update({ content: 'No active seasons.', embeds: [], components: [] });

    const modal = new ModalBuilder().setCustomId(`serversetup_seasonlinkmodal:${encodeURIComponent(seasonName)}`).setTitle(`Link Campaign — ${seasonName}`.slice(0, 45));
    const campaignInput = new TextInputBuilder().setCustomId('wheel_campaign').setLabel('Campaign name (leave blank to unlink)').setStyle(TextInputStyle.Short).setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(campaignInput));
    return interaction.showModal(modal);
  },

  async handleSeasonLinkModal(interaction) {
    const [, encodedName] = interaction.customId.split(':');
    const seasonName = decodeURIComponent(encodedName);
    await interaction.deferReply({ ephemeral: true });
    const wheelCampaign = interaction.fields.getTextInputValue('wheel_campaign') || null;
    const { linkSeasonCore } = require('../rumbleseasons/rumbleseasons');
    const result = await linkSeasonCore(interaction, seasonName, wheelCampaign);
    if (result.error) return interaction.editReply(result.error);
    return interaction.editReply(result.text);
  },

  async handleSeasonResetRolesPicked(interaction) {
    const seasonName = interaction.values[0];
    if (seasonName === 'none') return interaction.update({ content: 'No active seasons.', embeds: [], components: [] });

    const modal = new ModalBuilder().setCustomId(`serversetup_seasonresetrolesmodal:${encodeURIComponent(seasonName)}`).setTitle(`Reset Roles — ${seasonName}`.slice(0, 45));
    const resetInput = new TextInputBuilder().setCustomId('reset_roles').setLabel('Reset roles on completion? yes/no').setStyle(TextInputStyle.Short).setRequired(true).setValue('yes');
    modal.addComponents(new ActionRowBuilder().addComponents(resetInput));
    return interaction.showModal(modal);
  },

  async handleSeasonResetRolesModal(interaction) {
    const [, encodedName] = interaction.customId.split(':');
    const seasonName = decodeURIComponent(encodedName);
    await interaction.deferReply({ ephemeral: true });
    const raw = interaction.fields.getTextInputValue('reset_roles').trim().toLowerCase();
    const resetRoles = raw !== 'no';
    const { resetRolesSettingCore } = require('../rumbleseasons/rumbleseasons');
    const result = await resetRolesSettingCore(interaction, seasonName, resetRoles);
    if (result.error) return interaction.editReply(result.error);
    return interaction.editReply(result.text);
  },

  async handleLevelSetUserPicked(interaction) {
    const user = interaction.users.first();
    const modal = new ModalBuilder().setCustomId(`serversetup_levelsetmodal:${user.id}`).setTitle(`Set Level — ${user.username}`.slice(0, 45));
    const levelInput = new TextInputBuilder().setCustomId('level').setLabel('Level to set').setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(levelInput));
    return interaction.showModal(modal);
  },

  async handleLevelSetModal(interaction) {
    const [, userId] = interaction.customId.split(':');
    await interaction.deferReply({ ephemeral: true });

    const level = parseInt(interaction.fields.getTextInputValue('level'), 10);
    if (isNaN(level) || level < 0) return interaction.editReply('❌ Level must be a non-negative number.');

    const { xpForLevel } = require('../../utils/levelSystem');
    const totalXp = xpForLevel(level);

    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user) return interaction.editReply('❌ Couldn\'t find that user anymore.');

    await query(`
      INSERT INTO levels (guild_id, user_id, username, xp, level)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = $4, level = $5, username = $3
    `, [interaction.guildId, user.id, user.username, totalXp, level]);

    return interaction.editReply(`✅ Set <@${user.id}> to **Level ${level}**.`);
  },

  async handleLevelResetConfirm(interaction) {
    await interaction.deferUpdate();
    const res = await query('DELETE FROM levels WHERE guild_id = $1', [interaction.guildId]);
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ Reset complete — cleared level/XP data for **${res.rowCount}** member${res.rowCount === 1 ? '' : 's'} on this server.`)],
      components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
    });
  },

  async handleLevelExcludeAddPicked(interaction) {
    const channel = interaction.channels.first();
    await interaction.deferUpdate();
    await query('INSERT INTO level_excluded_channels (guild_id, channel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [interaction.guildId, channel.id]);
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ <#${channel.id}> no longer earns XP.`)],
      components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
    });
  },

  async handleLevelExcludeRemovePicked(interaction) {
    const channel = interaction.channels.first();
    await interaction.deferUpdate();
    await query('DELETE FROM level_excluded_channels WHERE guild_id = $1 AND channel_id = $2', [interaction.guildId, channel.id]);
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ <#${channel.id}> earns XP again.`)],
      components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
    });
  },

  async handleBulkRemoveRolePicked(interaction) {
    const role = interaction.roles.first();
    await interaction.deferUpdate();

    await interaction.guild.members.fetch();
    const count = role.members.size;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`serversetup_bulkremove_all:${role.id}`).setLabel(`Remove from ALL (${count})`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`serversetup_bulkremove_specific:${role.id}`).setLabel('Remove from Specific Members').setStyle(ButtonStyle.Secondary),
    );

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription(`${role} is currently held by **${count}** member${count === 1 ? '' : 's'}. What do you want to do?`)],
      components: [row, buildBackButton()],
    });
  },

  async handleBulkRemoveAllStart(interaction) {
    const [, roleId] = interaction.customId.split(':');
    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role) return interaction.update({ content: '❌ Couldn\'t find that role anymore.', embeds: [], components: [] });

    await interaction.guild.members.fetch();
    const count = role.members.size;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`serversetup_bulkremove_allconfirm:${roleId}`).setLabel(`Yes, remove from all ${count}`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('serversetup_nav:settings').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    return interaction.update({
      embeds: [new EmbedBuilder().setColor('#e74c3c').setDescription(`⚠️ This will remove ${role} from **${count}** member${count === 1 ? '' : 's'}. This can't be undone. Are you sure?`)],
      components: [row],
    });
  },

  async handleBulkRemoveAllConfirm(interaction) {
    const [, roleId] = interaction.customId.split(':');
    await interaction.deferUpdate();

    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role) return interaction.editReply({ content: '❌ Couldn\'t find that role anymore.', embeds: [], components: [] });

    await interaction.guild.members.fetch();
    const targets = [...role.members.values()];

    let removed = 0, failed = 0;
    for (const member of targets) {
      await member.roles.remove(role).then(() => removed++).catch(() => failed++);
    }

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(failed ? '#faa61a' : '#2ecc71').setDescription(
        `✅ Removed ${role} from **${removed}** member${removed === 1 ? '' : 's'}.` +
        (failed ? `\n❌ Failed on ${failed} (likely a role hierarchy issue).` : '')
      )],
      components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
    });
  },

  async handleBulkRemoveSpecificStart(interaction) {
    const [, roleId] = interaction.customId.split(':');
    const modal = new ModalBuilder().setCustomId(`serversetup_bulkremovemodal:${roleId}`).setTitle('Remove From Specific Members');
    const usersInput = new TextInputBuilder().setCustomId('users').setLabel('Type @ to mention members').setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(usersInput));
    return interaction.showModal(modal);
  },

  async handleBulkRemoveSpecificModal(interaction) {
    const [, roleId] = interaction.customId.split(':');
    await interaction.deferReply({ ephemeral: true });

    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role) return interaction.editReply('❌ Couldn\'t find that role anymore.');

    const usersRaw = interaction.fields.getTextInputValue('users');
    const ids = [...usersRaw.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
    if (!ids.length) return interaction.editReply('❌ Couldn\'t find any member mentions in that — type @ to mention them.');

    const targets = [];
    for (const id of ids) {
      const member = await interaction.guild.members.fetch(id).catch(() => null);
      if (member && member.roles.cache.has(role.id)) targets.push(member);
    }
    if (!targets.length) return interaction.editReply('❌ None of those members have that role.');

    let removed = 0, failed = 0;
    for (const member of targets) {
      await member.roles.remove(role).then(() => removed++).catch(() => failed++);
    }

    return interaction.editReply(
      `✅ Removed ${role} from **${removed}** member${removed === 1 ? '' : 's'}.` +
      (failed ? `\n❌ Failed on ${failed} (likely a role hierarchy issue).` : '')
    );
  },

  async handleStickyPermAddRole(interaction) {
    await interaction.deferUpdate();
    const role = interaction.roles.first();
    await query(
      `INSERT INTO sticky_permissions (guild_id, target_type, target_id) VALUES ($1,'role',$2) ON CONFLICT DO NOTHING`,
      [interaction.guildId, role.id]
    );
    const { embed, components } = await buildStickyPermsView(interaction.guild);
    return interaction.editReply({ embeds: [embed], components });
  },

  async handleStickyPermAddUser(interaction) {
    await interaction.deferUpdate();
    const user = interaction.users.first();
    await query(
      `INSERT INTO sticky_permissions (guild_id, target_type, target_id) VALUES ($1,'user',$2) ON CONFLICT DO NOTHING`,
      [interaction.guildId, user.id]
    );
    const { embed, components } = await buildStickyPermsView(interaction.guild);
    return interaction.editReply({ embeds: [embed], components });
  },

  async handleStickyPermRemove(interaction) {
    await interaction.deferUpdate();
    const [targetType, targetId] = interaction.values[0].split(':');
    await query(
      `DELETE FROM sticky_permissions WHERE guild_id=$1 AND target_type=$2 AND target_id=$3`,
      [interaction.guildId, targetType, targetId]
    );
    const { embed, components } = await buildStickyPermsView(interaction.guild);
    return interaction.editReply({ embeds: [embed], components });
  },

  async handleTriggerAddMsgModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const word = interaction.fields.getTextInputValue('word').trim();
    const message = interaction.fields.getTextInputValue('message');

    const existing = await query(`SELECT id FROM custom_triggers WHERE guild_id=$1 AND trigger_word=$2`, [interaction.guildId, word]);
    if (existing.rows.length) return interaction.editReply('❌ That trigger word already exists — remove it first if you want to replace it.');

    await query(
      `INSERT INTO custom_triggers (guild_id, trigger_word, action_type, response_text, created_by) VALUES ($1,$2,'message',$3,$4)`,
      [interaction.guildId, word, message, interaction.user.id]
    );
    return interaction.editReply(`✅ Trigger **${word}** added — posts your message when typed. (Need it restricted to a role? Use \`/trigger add\` directly — role restriction isn't available in this quick form.)`);
  },

  async handleTriggerAddReactModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const word = interaction.fields.getTextInputValue('word').trim();
    const emojis = interaction.fields.getTextInputValue('emojis').trim().split(/\s+/);

    const existing = await query(`SELECT id FROM custom_triggers WHERE guild_id=$1 AND trigger_word=$2`, [interaction.guildId, word]);
    if (existing.rows.length) return interaction.editReply('❌ That trigger word already exists — remove it first if you want to replace it.');

    await query(
      `INSERT INTO custom_triggers (guild_id, trigger_word, action_type, reaction_emojis, created_by) VALUES ($1,$2,'reaction',$3,$4)`,
      [interaction.guildId, word, emojis, interaction.user.id]
    );
    return interaction.editReply(`✅ Trigger **${word}** added — reacts with ${emojis.join(' ')} when typed.`);
  },

  async handleTriggerRemovePicked(interaction) {
    await interaction.deferUpdate();
    const word = interaction.values[0];
    await query(`DELETE FROM custom_triggers WHERE guild_id=$1 AND trigger_word=$2`, [interaction.guildId, word]);
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ Trigger **${word}** removed.`)],
      components: [buildBackButton()],
    });
  },

  async handleFilterAddModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const phrase = interaction.fields.getTextInputValue('phrase').trim();

    const existing = await query(`SELECT id FROM word_filters WHERE guild_id=$1 AND phrase=$2 AND match_type='contains'`, [interaction.guildId, phrase]);
    if (existing.rows.length) return interaction.editReply('❌ That phrase is already filtered.');

    await query(
      `INSERT INTO word_filters (guild_id, phrase, match_type, created_by) VALUES ($1,$2,'contains',$3)`,
      [interaction.guildId, phrase, interaction.user.id]
    );
    return interaction.editReply(`✅ Now auto-deleting messages containing **${phrase}**. (Need an exact-match-only filter instead? Use \`/wordfilter add\` directly.)`);
  },

  async handleFilterRemovePicked(interaction) {
    await interaction.deferUpdate();
    const [phrase, matchType] = interaction.values[0].split('::');
    await query(`DELETE FROM word_filters WHERE guild_id=$1 AND phrase=$2 AND match_type=$3`, [interaction.guildId, phrase, matchType]);
    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ **${phrase}** removed from the filter.`)],
      components: [buildBackButton()],
    });
  },

  async handleStaffBioChannelPicked(interaction) {
    const channelId = interaction.values[0];
    const modal = new ModalBuilder().setCustomId(`serversetup_staffbioquestions_modal:${channelId}`).setTitle('Meet the Staff — Questions');
    const questionsInput = new TextInputBuilder().setCustomId('questions').setLabel('Up to 5 questions, separated by |').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
    modal.addComponents(new ActionRowBuilder().addComponents(questionsInput));
    return interaction.showModal(modal);
  },

  async handleStaffBioQuestionsModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const channelId = interaction.customId.split(':')[1];
    const questionsRaw = interaction.fields.getTextInputValue('questions');
    const questions = questionsRaw.split('|').map(q => q.trim()).filter(Boolean).slice(0, 5);

    if (!questions.length) return interaction.editReply('❌ Couldn\'t parse any questions — separate them with `|`.');

    await query(
      `INSERT INTO staff_bio_config (guild_id, channel_id, questions) VALUES ($1,$2,$3)
       ON CONFLICT (guild_id) DO UPDATE SET channel_id=$2, questions=$3`,
      [interaction.guildId, channelId, questions.join('|')]
    );

    return interaction.editReply(`✅ Meet the Staff configured — profiles post to <#${channelId}> with ${questions.length} question${questions.length === 1 ? '' : 's'}. Staff run \`/staffbio submit\` to fill theirs out.`);
  },

  async handleWheelAddRolePicked(interaction) {
    const role = interaction.roles.first();
    const modal = new ModalBuilder().setCustomId(`serversetup_wheeladdmodal:${role.id}`).setTitle('Wheel Role Bonus');
    const bonusInput = new TextInputBuilder().setCustomId('bonus').setLabel('Extra entries per member with this role').setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(bonusInput));
    return interaction.showModal(modal);
  },

  async handleWheelAddModal(interaction) {
    const [, roleId] = interaction.customId.split(':');
    await interaction.deferReply({ ephemeral: true });

    const bonus = parseInt(interaction.fields.getTextInputValue('bonus'), 10);
    if (isNaN(bonus) || bonus <= 0) return interaction.editReply('❌ Bonus must be a positive number.');

    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role) return interaction.editReply('❌ Couldn\'t find that role anymore.');

    await query(
      'INSERT INTO wheel_role_bonuses (guild_id, role_id, role_name, bonus_entries, added_by) VALUES ($1,$2,$3,$4,$5) ' +
      'ON CONFLICT (guild_id, role_id) DO UPDATE SET bonus_entries=$4, role_name=$3',
      [interaction.guildId, role.id, role.name, bonus, interaction.user.id]
    );

    return interaction.editReply(`✅ ${role} now gets +${bonus} wheel entries.`);
  },

  async handleWheelRemoveRolePicked(interaction) {
    const role = interaction.roles.first();
    await interaction.deferUpdate();

    const res = await query('DELETE FROM wheel_role_bonuses WHERE guild_id=$1 AND role_id=$2 RETURNING role_name', [interaction.guildId, role.id]);

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor(res.rows.length ? '#2ecc71' : '#e74c3c')
        .setDescription(res.rows.length ? `✅ Removed bonus entries for ${role}.` : `❌ ${role} had no bonus configured.`)],
      components: [buildGiveawayButtons(), buildGiveawayButtons2(), buildGiveawayButtons3(), buildBackButton()],
    });
  },

  async handleGrindSetupModal(interaction) {
    const [, channelId, roleId] = interaction.customId.split(':');
    await interaction.deferReply({ ephemeral: true });

    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel) return interaction.editReply('❌ Couldn\'t find that channel anymore.');

    const maxChannelsRaw = interaction.fields.getTextInputValue('max_channels');
    const durationRaw = interaction.fields.getTextInputValue('duration');
    const color = interaction.fields.getTextInputValue('embed_color') || '#d6c2ee';
    const maxChannels = maxChannelsRaw ? parseInt(maxChannelsRaw, 10) : 50;
    const duration = durationRaw ? parseInt(durationRaw, 10) : 1;

    if (isNaN(maxChannels) || isNaN(duration)) {
      return interaction.editReply('❌ Max channels and duration must be numbers.');
    }

    await query(`
      INSERT INTO grind_config (guild_id, panel_channel_id, role_id, max_channels, duration_hours, embed_color)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (guild_id) DO UPDATE SET
        panel_channel_id = EXCLUDED.panel_channel_id,
        role_id          = EXCLUDED.role_id,
        max_channels     = EXCLUDED.max_channels,
        duration_hours   = EXCLUDED.duration_hours,
        embed_color      = EXCLUDED.embed_color
    `, [interaction.guildId, channelId, roleId, maxChannels, duration, color]);

    const { buildPanelEmbeds, getChannelCount } = require('../grind/grind');
    const count = await getChannelCount(interaction.guildId);
    const config = { guild_id: interaction.guildId, embed_color: color, max_channels: maxChannels, duration_hours: duration };
    const { subEmbed, chEmbed, subRow, chRow } = buildPanelEmbeds(config, count);

    const msg1 = await channel.send({ embeds: [subEmbed], components: [subRow] });
    const msg2 = await channel.send({ embeds: [chEmbed], components: [chRow] });

    await query(`
      UPDATE grind_config SET panel_message_id1=$1, panel_message_id2=$2 WHERE guild_id=$3
    `, [msg1.id, msg2.id, interaction.guildId]).catch(() => {});

    return interaction.editReply(`✅ Grind panel posted in <#${channelId}>, pinging <@&${roleId}>.`);
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
      components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
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
      components: [buildGiveawayButtons(), buildGiveawayButtons2(), buildGiveawayButtons3(), buildBackButton()],
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
      components: [buildGiveawayButtons(), buildGiveawayButtons2(), buildGiveawayButtons3(), buildBackButton()],
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
      components: [buildGiveawayButtons(), buildGiveawayButtons2(), buildGiveawayButtons3(), buildBackButton()],
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
        components: [buildStickyButtons(), buildBackButton()],
      });
    }

    if (action === 'stickyperms') {
      await interaction.deferUpdate();
      const { embed, components } = await buildStickyPermsView(interaction.guild);
      return interaction.editReply({ embeds: [embed], components });
    }

    if (action === 'pingpost') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the role this panel gives/removes:')],
        components: [buildPingRolePicker(), buildBackButton()],
      });
    }

    if (action === 'embedlist') {
      await interaction.deferUpdate();
      const countRes = await query('SELECT COUNT(*) FROM custom_embeds WHERE guild_id = $1', [interaction.guildId]);
      const total = parseInt(countRes.rows[0].count);
      if (!total) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('No custom embeds tracked yet — only ones posted after the tracking update will show up here.')],
          components: [buildPanelsButtons(), buildPanelsButtons2(), buildPanelsButtons3(), buildBackButton()],
        });
      }
      const res = await query('SELECT * FROM custom_embeds WHERE guild_id = $1 ORDER BY created_at DESC LIMIT 15', [interaction.guildId]);
      const lines = res.rows.map(r => `\`#${r.id}\` ${r.title ? `**${r.title}**` : '*(no title)*'} — <#${r.channel_id}>`).join('\n');
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setTitle('📋 Recent Custom Embeds').setDescription(lines)
          .setFooter({ text: `Showing latest 15 of ${total} • use /embed list for more pages` })],
        components: [buildPanelsButtons(), buildPanelsButtons2(), buildPanelsButtons3(), buildBackButton()],
      });
    }

    if (action === 'embedrepost') {
      const modal = new ModalBuilder().setCustomId('serversetup_embedrepostmodal').setTitle('Repost Embed');
      const idInput = new TextInputBuilder().setCustomId('id').setLabel('Embed ID (see List Embeds)').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(idInput));
      return interaction.showModal(modal);
    }

    if (action === 'embeddelete') {
      const modal = new ModalBuilder().setCustomId('serversetup_embeddeletemodal').setTitle('Delete Embed');
      const idInput = new TextInputBuilder().setCustomId('id').setLabel('Embed ID (see List Embeds)').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(idInput));
      return interaction.showModal(modal);
    }

    if (action === 'ticketpanellist') {
      await interaction.deferUpdate();
      const { listPanelsEmbed } = require('../ticket/ticket');
      const embed = await listPanelsEmbed(interaction.guildId);
      return interaction.editReply({
        embeds: [embed],
        components: [buildPanelsButtons(), buildPanelsButtons2(), buildPanelsButtons3(), buildBackButton()],
      });
    }

    if (action === 'ticketpanelrepost') {
      const modal = new ModalBuilder().setCustomId('serversetup_ticketpanelrepostmodal').setTitle('Repost Ticket Panel');
      const idInput = new TextInputBuilder().setCustomId('panel_id').setLabel('Panel ID (see List Ticket Panels)').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(idInput));
      return interaction.showModal(modal);
    }

    if (action === 'ticketpanelremove') {
      const modal = new ModalBuilder().setCustomId('serversetup_ticketpanelremovemodal').setTitle('Remove Ticket Panel');
      const idInput = new TextInputBuilder().setCustomId('panel_id').setLabel('Panel ID (see List Ticket Panels)').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(idInput));
      return interaction.showModal(modal);
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
      components: [buildPanelsButtons(), buildPanelsButtons2(), buildPanelsButtons3(), buildBackButton()],
    });
  },

  async handleSettingsButton(interaction) {
    const [, action] = interaction.customId.split(':');

    if (action === 'roleachievement') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the channel for "collected all roles" announcements:')],
        components: [buildRoleAchievementChannelPicker(), buildBackButton()],
      });
    }

    if (action === 'seasonlist') {
      await interaction.deferUpdate();
      const res = await query(
        `SELECT s.*, COUNT(DISTINCT sc.channel_id) AS channel_count
         FROM rr_seasons s LEFT JOIN rr_season_channels sc ON sc.season_id = s.id
         WHERE s.guild_id = $1 AND s.status = 'active'
         GROUP BY s.id ORDER BY s.started_at ASC`,
        [interaction.guildId]
      );
      const embed = new EmbedBuilder().setColor('#d6c2ee').setTitle('⚔️ Active Seasons');
      if (!res.rows.length) {
        embed.setDescription('No active seasons. Use the "Start Season" button below to start one.');
      } else {
        const lines = res.rows.map(s => `**${s.name}** — ${s.channel_count} channel(s) — started <t:${Math.floor(new Date(s.started_at).getTime()/1000)}:R>`).join('\n');
        embed.setDescription(lines);
      }
      return interaction.editReply({
        embeds: [embed],
        components: [buildRumbleButtons(), buildRumbleButtons2(), buildRumbleButtons3(), buildBackButton()],
      });
    }

    if (action === 'seasonstart') {
      const modal = new ModalBuilder().setCustomId('serversetup_seasonstartmodal').setTitle('Start Season');
      const nameInput = new TextInputBuilder().setCustomId('name').setLabel('Season name').setStyle(TextInputStyle.Short).setRequired(true);
      const campaignInput = new TextInputBuilder().setCustomId('wheel_campaign').setLabel('Wheel Roles campaign (optional)').setStyle(TextInputStyle.Short).setRequired(false);
      const resetInput = new TextInputBuilder().setCustomId('reset_roles').setLabel('Reset roles on completion? yes/no').setStyle(TextInputStyle.Short).setRequired(false).setValue('yes');
      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(campaignInput),
        new ActionRowBuilder().addComponents(resetInput),
      );
      return interaction.showModal(modal);
    }

    if (action === 'seasoninfo') {
      const row = await buildSeasonSelectMenu(interaction.guildId, 'serversetup_seasoninfopick', 'Pick a season for details');
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick a season to view details:')],
        components: [row, buildBackButton()],
      });
    }

    if (action === 'seasonend') {
      const row = await buildSeasonSelectMenu(interaction.guildId, 'serversetup_seasonendpick', 'Pick a season to end');
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick a season to end (this removes all its winner roles):')],
        components: [row, buildBackButton()],
      });
    }

    if (action === 'seasonaddchan') {
      const row = await buildSeasonSelectMenu(interaction.guildId, 'serversetup_seasonaddchanpick', 'Pick a season');
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick which season to add a channel to:')],
        components: [row, buildBackButton()],
      });
    }

    if (action === 'seasonremovechan') {
      const row = await buildSeasonSelectMenu(interaction.guildId, 'serversetup_seasonremovechanpick', 'Pick a season');
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick which season to remove a channel from:')],
        components: [row, buildBackButton()],
      });
    }

    if (action === 'seasonlink') {
      const row = await buildSeasonSelectMenu(interaction.guildId, 'serversetup_seasonlinkpick', 'Pick a season');
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick which season to link (or unlink) a Wheel Roles campaign for:')],
        components: [row, buildBackButton()],
      });
    }

    if (action === 'seasonresetroles') {
      const row = await buildSeasonSelectMenu(interaction.guildId, 'serversetup_seasonresetrolespick', 'Pick a season');
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick which season to change the role-reset setting for:')],
        components: [row, buildBackButton()],
      });
    }

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

    if (action === 'gameboard') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the channel for the live game schedule board:')],
        components: [buildGameBoardChannelPicker(), buildBackButton()],
      });
    }

    if (action === 'leveltuning') {
      const cfgRes = await query('SELECT * FROM level_config WHERE guild_id=$1', [interaction.guildId]);
      const cfg = cfgRes.rows[0] || {};
      const modal = new ModalBuilder().setCustomId('serversetup_leveltuningmodal').setTitle('Level Tuning');

      const announceInput = new TextInputBuilder().setCustomId('announce').setLabel('Announce level-ups? (true/false)').setStyle(TextInputStyle.Short).setRequired(false)
        .setValue(String(cfg.announce_levelup ?? true));
      const xpMinInput = new TextInputBuilder().setCustomId('xp_min').setLabel('Min XP per message').setStyle(TextInputStyle.Short).setRequired(false)
        .setValue(String(cfg.xp_min ?? 15));
      const xpMaxInput = new TextInputBuilder().setCustomId('xp_max').setLabel('Max XP per message').setStyle(TextInputStyle.Short).setRequired(false)
        .setValue(String(cfg.xp_max ?? 25));
      const cooldownInput = new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown seconds between XP gains').setStyle(TextInputStyle.Short).setRequired(false)
        .setValue(String(cfg.cooldown_seconds ?? 60));

      modal.addComponents(
        new ActionRowBuilder().addComponents(announceInput),
        new ActionRowBuilder().addComponents(xpMinInput),
        new ActionRowBuilder().addComponents(xpMaxInput),
        new ActionRowBuilder().addComponents(cooldownInput),
      );
      return interaction.showModal(modal);
    }

    if (action === 'triggeraddmsg') {
      const modal = new ModalBuilder().setCustomId('serversetup_triggeraddmsg_modal').setTitle('Add Message Trigger');
      const wordInput = new TextInputBuilder().setCustomId('word').setLabel('Trigger word, e.g. !yay').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50);
      const msgInput = new TextInputBuilder().setCustomId('message').setLabel('Message to post when triggered').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
      modal.addComponents(new ActionRowBuilder().addComponents(wordInput), new ActionRowBuilder().addComponents(msgInput));
      return interaction.showModal(modal);
    }

    if (action === 'triggeraddreact') {
      const modal = new ModalBuilder().setCustomId('serversetup_triggeraddreact_modal').setTitle('Add Reaction Trigger');
      const wordInput = new TextInputBuilder().setCustomId('word').setLabel('Trigger word, e.g. !hearts').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50);
      const emojiInput = new TextInputBuilder().setCustomId('emojis').setLabel('Emojis, space-separated').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200);
      modal.addComponents(new ActionRowBuilder().addComponents(wordInput), new ActionRowBuilder().addComponents(emojiInput));
      return interaction.showModal(modal);
    }

    if (action === 'triggerlist') {
      await interaction.deferUpdate();
      const res = await query(`SELECT * FROM custom_triggers WHERE guild_id=$1 ORDER BY trigger_word`, [interaction.guildId]);
      const desc = res.rows.length
        ? res.rows.map(t => `**${t.trigger_word}** — ${t.action_type === 'message' ? 'posts a message' : `reacts: ${t.reaction_emojis.join(' ')}`}${t.restricted_role_id ? ` (restricted to <@&${t.restricted_role_id}>)` : ''}`).join('\n')
        : 'No triggers configured yet.';
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setTitle('⚡ Trigger Words').setDescription(desc)],
        components: [buildBackButton()],
      });
    }

    if (action === 'triggerremove') {
      await interaction.deferUpdate();
      const res = await query(`SELECT trigger_word FROM custom_triggers WHERE guild_id=$1 ORDER BY trigger_word LIMIT 25`, [interaction.guildId]);
      if (!res.rows.length) {
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('No triggers to remove.')], components: [buildBackButton()] });
      }
      const menu = new StringSelectMenuBuilder().setCustomId('serversetup_triggerremovepick').setPlaceholder('Pick a trigger to remove')
        .addOptions(res.rows.map(r => ({ label: r.trigger_word, value: r.trigger_word })));
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the trigger to remove:')],
        components: [new ActionRowBuilder().addComponents(menu), buildBackButton()],
      });
    }

    if (action === 'filteradd') {
      const modal = new ModalBuilder().setCustomId('serversetup_filteradd_modal').setTitle('Add Word Filter');
      const phraseInput = new TextInputBuilder().setCustomId('phrase').setLabel('Word/phrase to auto-delete').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200);
      modal.addComponents(new ActionRowBuilder().addComponents(phraseInput));
      return interaction.showModal(modal);
    }

    if (action === 'filterlist') {
      await interaction.deferUpdate();
      const res = await query(`SELECT phrase, match_type FROM word_filters WHERE guild_id=$1 ORDER BY phrase`, [interaction.guildId]);
      const desc = res.rows.length ? res.rows.map(f => `**${f.phrase}** — ${f.match_type}`).join('\n') : 'No filtered words yet.';
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setTitle('🚫 Word Filter').setDescription(desc)],
        components: [buildBackButton()],
      });
    }

    if (action === 'filterremove') {
      await interaction.deferUpdate();
      const res = await query(`SELECT phrase, match_type FROM word_filters WHERE guild_id=$1 ORDER BY phrase LIMIT 25`, [interaction.guildId]);
      if (!res.rows.length) {
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('No filtered words to remove.')], components: [buildBackButton()] });
      }
      const menu = new StringSelectMenuBuilder().setCustomId('serversetup_filterremovepick').setPlaceholder('Pick a word/phrase to remove')
        .addOptions(res.rows.map(r => ({ label: `${r.phrase} (${r.match_type})`, value: `${r.phrase}::${r.match_type}` })));
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the word/phrase to remove:')],
        components: [new ActionRowBuilder().addComponents(menu), buildBackButton()],
      });
    }

    if (action === 'staffbiosetup') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the channel Meet the Staff profiles should post/update in:')],
        components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('serversetup_staffbiochannel').setPlaceholder('Pick a channel')), buildBackButton()],
      });
    }

    if (action === 'levelsetmember') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the member whose level you want to set:')],
        components: [buildLevelSetUserPicker(), buildBackButton()],
      });
    }

    if (action === 'levelreset') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('serversetup_levelresetconfirm').setLabel('Yes, wipe every level on this server').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('serversetup_nav:settings').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#e74c3c').setDescription('⚠️ This wipes **every member\'s** level and XP on this server. This can\'t be undone. Are you sure?')],
        components: [row],
      });
    }

    if (action === 'levelexcludeadd') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the channel to exclude from earning XP:')],
        components: [buildLevelExcludeAddPicker(), buildBackButton()],
      });
    }

    if (action === 'levelexcluderemove') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the channel to re-enable XP for:')],
        components: [buildLevelExcludeRemovePicker(), buildBackButton()],
      });
    }

    if (action === 'levelexcludelist') {
      await interaction.deferUpdate();
      const res = await query('SELECT channel_id FROM level_excluded_channels WHERE guild_id = $1', [interaction.guildId]);
      const desc = res.rows.length
        ? `Excluded channels:\n${res.rows.map(r => `<#${r.channel_id}>`).join('\n')}`
        : 'No channels are excluded — every channel earns XP.';
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription(desc)],
        components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
      });
    }

    if (action === 'rafflelist') {
      await interaction.deferUpdate();
      const res = await query(
        `SELECT * FROM raffles WHERE guild_id=$1 AND host_id=$2 AND status='active' ORDER BY ends_at DESC LIMIT 20`,
        [interaction.guildId, interaction.user.id]
      );
      const embed = new EmbedBuilder().setColor('#d6c2ee').setTitle('🎟️ Your Active Raffles');
      if (!res.rows.length) {
        embed.setDescription('You have no active raffles.');
      } else {
        for (const r of res.rows) {
          embed.addFields({ name: `#${r.id} — ${r.prize}`, value: `Ends: <t:${Math.floor(new Date(r.ends_at).getTime()/1000)}:f>` });
        }
      }
      return interaction.editReply({
        embeds: [embed],
        components: [buildGiveawayButtons(), buildGiveawayButtons2(), buildGiveawayButtons3(), buildBackButton()],
      });
    }

    if (action === 'raffleend') {
      const modal = new ModalBuilder().setCustomId('serversetup_raffleendmodal').setTitle('End Raffle');
      const idInput = new TextInputBuilder().setCustomId('id').setLabel('Raffle ID').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(idInput));
      return interaction.showModal(modal);
    }

    if (action === 'rafflecancel') {
      const modal = new ModalBuilder().setCustomId('serversetup_rafflecancelmodal').setTitle('Cancel Raffle');
      const idInput = new TextInputBuilder().setCustomId('id').setLabel('Raffle ID').setStyle(TextInputStyle.Short).setRequired(true);
      const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)').setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(
        new ActionRowBuilder().addComponents(idInput),
        new ActionRowBuilder().addComponents(reasonInput),
      );
      return interaction.showModal(modal);
    }


    if (action === 'bulkremoverole') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the role to bulk-remove:')],
        components: [buildBulkRemoveRolePicker(), buildBackButton()],
      });
    }

    if (action === 'wheeladd') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the role to give bonus wheel entries:')],
        components: [buildWheelAddRolePicker(), buildBackButton()],
      });
    }

    if (action === 'wheelremove') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor('#d6c2ee').setDescription('Pick the role to remove bonus wheel entries from:')],
        components: [buildWheelRemoveRolePicker(), buildBackButton()],
      });
    }

    if (action === 'wheellist') {
      await interaction.deferUpdate();
      const res = await query('SELECT role_id, role_name, bonus_entries FROM wheel_role_bonuses WHERE guild_id=$1 ORDER BY bonus_entries DESC', [interaction.guildId]);
      const embed = new EmbedBuilder().setColor('#d6c2ee').setTitle('🎡 Wheel Role Bonuses');
      if (!res.rows.length) {
        embed.setDescription('No role bonuses configured yet.');
      } else {
        for (const row of res.rows) {
          // Prefer the live role name (in case it was renamed since being
          // configured); fall back to what was stored if the role is gone.
          const liveRole = await interaction.guild.roles.fetch(row.role_id).catch(() => null);
          const displayName = liveRole ? liveRole.name : `${row.role_name} (deleted role)`;
          embed.addFields({ name: displayName, value: `+${row.bonus_entries} entries`, inline: true });
        }
      }
      return interaction.editReply({
        embeds: [embed],
        components: [buildGiveawayButtons(), buildGiveawayButtons2(), buildGiveawayButtons3(), buildBackButton()],
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
        components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
      });
    }

    if (action === 'rrsins') {
      await interaction.deferUpdate();
      const { isGuildAllowedSins } = require('../../utils/sinsRequests');
      if (!isGuildAllowedSins(interaction.guildId)) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor('#ff4444').setDescription('❌ Real Sins are only available in specific approved servers. Use "RR: Custom Currency" instead.')],
          components: [buildRumbleButtons(), buildRumbleButtons2(), buildRumbleButtons3(), buildBackButton()],
        });
      }
      await query(`
        INSERT INTO rr_guild_config (guild_id, use_sins) VALUES ($1,true)
        ON CONFLICT (guild_id) DO UPDATE SET use_sins = true
      `, [interaction.guildId]);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription('✅ Rumble Royale now uses real Sins.')],
        components: [buildRumbleButtons(), buildRumbleButtons2(), buildRumbleButtons3(), buildBackButton()],
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
      components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
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
      components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
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
      components: [buildSettingsButtons(), buildSettingsButtons2(), buildSettingsButtons3(), buildSettingsButtons4(), buildBackButton()],
    });
  },

  async handleGameBoardChannelPicked(interaction) {
    const channel = interaction.channels.first();
    await interaction.deferUpdate();

    await query(`
      INSERT INTO game_schedule_board (guild_id, channel_id)
      VALUES ($1,$2)
      ON CONFLICT (guild_id) DO UPDATE SET channel_id=$2, message_id=NULL, updated_at=NOW()
    `, [interaction.guildId, channel.id]);

    return interaction.editReply({
      embeds: [new EmbedBuilder().setColor('#2ecc71').setDescription(`✅ Game schedule board will post in <#${channel.id}>.`)],
      components: [buildChannelSettingSelect(), buildChannelExtraButtons(), buildBackButton()],
    });
  },

  async handleLevelTuningModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const announceRaw = interaction.fields.getTextInputValue('announce').trim().toLowerCase();
    const announce = announceRaw === 'false' ? false : true;
    const xpMin = parseInt(interaction.fields.getTextInputValue('xp_min'), 10);
    const xpMax = parseInt(interaction.fields.getTextInputValue('xp_max'), 10);
    const cooldown = parseInt(interaction.fields.getTextInputValue('cooldown'), 10);

    if (isNaN(xpMin) || isNaN(xpMax) || isNaN(cooldown)) {
      return interaction.editReply('❌ XP min/max and cooldown must all be numbers.');
    }
    if (xpMin > xpMax) {
      return interaction.editReply('❌ Min XP can\'t be greater than max XP.');
    }

    await query(`
      INSERT INTO level_config (guild_id, announce_levelup, xp_min, xp_max, cooldown_seconds)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (guild_id) DO UPDATE SET
        announce_levelup = $2, xp_min = $3, xp_max = $4, cooldown_seconds = $5
    `, [interaction.guildId, announce, xpMin, xpMax, cooldown]);

    return interaction.editReply(`✅ Level tuning updated — ${xpMin}-${xpMax} XP per message, ${cooldown}s cooldown, announcements ${announce ? 'on' : 'off'}.`);
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

function buildAutomodButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gset:triggeraddmsg').setLabel('Add Message Trigger').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_gset:triggeraddreact').setLabel('Add Reaction Trigger').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_gset:triggerlist').setLabel('List Triggers').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:triggerremove').setLabel('Remove Trigger').setStyle(ButtonStyle.Danger),
  );
}

function buildAutomodButtons2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gset:filteradd').setLabel('Add Word Filter').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_gset:filterlist').setLabel('List Word Filters').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:filterremove').setLabel('Remove Word Filter').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_gset:staffbiosetup').setLabel('Meet the Staff Setup').setStyle(ButtonStyle.Primary),
  );
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
    new ButtonBuilder().setCustomId('serversetup_gset:leveltuning').setLabel('Level Tuning').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:bulkremoverole').setLabel('Bulk Remove Role').setStyle(ButtonStyle.Danger),
  );
}

function buildSettingsButtons3() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_extras:goosdatesetup').setLabel('GoosDate Setup').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('serversetup_extras:goosdateon').setLabel('GoosDate ON').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_extras:goosdateoff').setLabel('GoosDate OFF').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_extras:goosdatestatus').setLabel('GoosDate Status').setStyle(ButtonStyle.Secondary),
  );
}

function buildSettingsButtons4() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gset:levelsetmember').setLabel('Set Member Level').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('serversetup_gset:levelreset').setLabel('Reset All Levels').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_gset:levelexcludeadd').setLabel('Exclude Channel').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:levelexcluderemove').setLabel('Un-exclude Channel').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:levelexcludelist').setLabel('List Excluded').setStyle(ButtonStyle.Secondary),
  );
}

function buildRumbleButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gset:rrsins').setLabel('RR: Use Sins').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:rrcustom').setLabel('RR: Custom Currency').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_extras:grindsetup').setLabel('Grind Setup').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('serversetup_gset:roleachievement').setLabel('Role Achievement Channel').setStyle(ButtonStyle.Secondary),
  );
}

function buildRumbleButtons2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gset:seasonlist').setLabel('List Active Seasons').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:seasonstart').setLabel('Start Season').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_gset:seasoninfo').setLabel('Season Info').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:seasonend').setLabel('End Season').setStyle(ButtonStyle.Danger),
  );
}

function buildRumbleButtons3() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('serversetup_gset:seasonaddchan').setLabel('Add Channel to Season').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('serversetup_gset:seasonremovechan').setLabel('Remove Channel from Season').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('serversetup_gset:seasonlink').setLabel('Link Wheel Campaign').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('serversetup_gset:seasonresetroles').setLabel('Reset Roles Setting').setStyle(ButtonStyle.Secondary),
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

function buildGameBoardChannelPicker() {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId('serversetup_gameboardchan')
    .setPlaceholder('Pick the game schedule board channel');
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
