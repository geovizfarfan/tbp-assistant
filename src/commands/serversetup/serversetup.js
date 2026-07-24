const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder } = require('discord.js');
const { query } = require('../../utils/database');

const CHANNEL_SETTINGS = {
  schedule:  { label: 'Game Schedule Board',   column: 'schedule_channel_id' },
  winners:   { label: 'Winners Channel',       column: 'winner_channel_id' },
  ticket:    { label: 'Ticket Channel',        column: 'ticket_channel_id' },
  staff_notif: { label: 'Staff Notifications', column: 'staff_notif_channel_id' },
  boost:     { label: 'Boost Announcement',    column: 'boost_channel_id' },
  transcript: { label: 'Game Transcripts',     column: 'game_transcript_channel_id' },
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
    label: 'Ghosty Settings',
    emoji: '👻',
    description: 'GoosDate reminders and private rooms.',
    items: [
      'Set GoosDate — `/goosdate set`',
      'GoosDate toggle — `/settings goosdate enabled:`',
      'GoosDate status — `/goosdate status`',
      'Private room setup — `/privateroom setup`',
    ],
  },
  boosters: {
    label: 'Server Booster Set',
    emoji: '🚀',
    description: 'Server boost tracking and announcements.',
    items: [
      'Booster add/remove/list — *not yet built, coming in a later phase*',
      'Boost announcement channel — `/settings channels boost:`',
    ],
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
    label: 'Giveaway Settings',
    emoji: '🎁',
    description: 'Everything for giveaways and raffles.',
    items: [
      'Bonus role add/remove/list — `/giveaway bonusrole add/remove/list`',
      'Required roles — `/giveaway requiredrole add/remove/list`',
      'Raffle settings — `/raffle` commands',
    ],
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
};
