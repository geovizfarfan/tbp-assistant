const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, PermissionFlagsBits
} = require('discord.js');
const { query } = require('../../utils/database');

const CATEGORIES = {
  tickets: {
    emoji: '<a:tickets:1523139713278672996>',
    label: 'Tickets',
    description: 'Ticket system commands',
  },
  rumble: {
    emoji: '<:rumble:1522372419338375299>',
    label: 'Rumble Royale',
    description: 'RR tracking & management',
  },
  payments: {
    emoji: '<a:payout:1512913911953756291>',
    label: 'Payments',
    description: 'Payment tracking system',
  },
  sticky: {
    emoji: '📌',
    label: 'Sticky Notes',
    description: 'Persistent channel messages',
  },
  panels: {
    emoji: '🔔',
    label: 'Ping Panels',
    description: 'Role notification panels',
  },
  general: {
    emoji: '🤖',
    label: 'General',
    description: 'AFK, Purge, Boost, Grind',
  },
  playregret: {
    emoji: '<a:SINS:1522338148380704910>',
    label: 'Play & Regret',
    description: 'Sins currency & connection',
  },
  config: {
    emoji: '⚙️',
    label: 'Server Config',
    description: 'Setup guide & current config',
  },
};

function buildSelectMenu(selected = null) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('help_category')
      .setPlaceholder('Select a category...')
      .addOptions(Object.entries(CATEGORIES).map(([key, cat]) => ({
        label: cat.label,
        description: cat.description,
        value: key,
        emoji: cat.emoji.startsWith('<') ? { id: cat.emoji.match(/\d+/)?.[0], name: cat.emoji.match(/:([^:]+):/)?.[1], animated: cat.emoji.startsWith('<a:') } : { name: cat.emoji },
        default: key === selected,
      })))
  );
}

function buildHomeEmbed() {
  return new EmbedBuilder()
    .setColor('#d6c2ee')
    .setTitle('<a:purplesparkle:1512912828489793626> VELOURA Help Center')
    .setDescription('Welcome! Select a category below to learn about each feature.\n\nVELOURA works alongside **Play & Regret** — wins in Rumble Royale automatically award <:sins:1522291331672703100> **Sins** currency.')
    .addFields(
      { name: '<a:tickets:1523139713278672996> Tickets',          value: 'Create & manage support tickets',         inline: true },
      { name: '<:rumble:1522372419338375299> Rumble Royale',      value: 'Track RR battles, wins & seasons',        inline: true },
      { name: '<a:payout:1512913911953756291> Payments',         value: 'Track payments & send receipts',           inline: true },
      { name: '📌 Sticky Notes',                                  value: 'Pin persistent messages in channels',     inline: true },
      { name: '🔔 Ping Panels',                                   value: 'Role notification toggle panels',         inline: true },
      { name: '🤖 General',                                       value: 'AFK, Purge, Boost detection & Grind',     inline: true },
      { name: '<a:SINS:1522338148380704910> Play & Regret',       value: 'Sins currency & RR integration',          inline: true },
      { name: '⚙️ Server Config',                                 value: 'Setup guide & current server config',     inline: true },
    )
    .setFooter({ text: '𝚃𝙷𝙴 𝙱𝙾𝙰𝚁𝙳 𝙿𝚁𝙸𝙽𝙲𝙴𝚂𝚂 • VELOURA' })
    .setTimestamp();
}

function buildCategoryEmbed(category) {
  const embeds = {
    tickets: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('<a:tickets:1523139713278672996> Ticket System')
      .setDescription('Create private thread tickets with staff notifications, transcripts and ratings.')
      .addFields(
        { name: '⚙️ Setup', value: '`/ticket setup staff_role:@Role category:#Cat transcript:#Ch staff_channel:#Ch`\nConfigures the ticket system. Run once to get started.', inline: false },
        { name: '📋 Create Panel', value: '`/ticket panel title:"Title" description:"..." color:#hex`\nPosts a ticket panel. Use `single_button:true` for one button.', inline: false },
        { name: '➕ Add Ticket Type', value: '`/ticket addtype panel_id:1 name:"Boost" emoji:🎲 questions:"Q1|Q2"`\nAdds a button to the panel. Run multiple times for more buttons.', inline: false },
        { name: '✏️ Edit Panel', value: '`/ticket edit panel_id:1 title:"New Title" description:"..."`\nUpdate any panel field without recreating it.', inline: false },
        { name: '📄 List Panels', value: '`/ticket panels`\nShows all panels and their IDs.', inline: false },
        { name: '🗑️ Remove Panel', value: '`/ticket removepanel panel_id:1`\nDeletes a panel and all its buttons.', inline: false },
        { name: '🔒 Close Ticket', value: 'Click the **Close Ticket** button inside the ticket thread. A modal will ask for a reason. Transcript is auto-sent to member + transcript channel.', inline: false },
        { name: '👤 Add/Remove User', value: '`/ticket add @user` / `/ticket remove @user`\nAdd or remove staff from a ticket thread.', inline: false },
      )
      .setFooter({ text: 'Members open tickets via panel buttons • Staff join via staff channel notification' }),

    rumble: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('<:rumble:1522372419338375299> Rumble Royale')
      .setDescription('Track Rumble Royale battles, wins, seasons and auto-award Sins to winners.')
      .addFields(
        { name: '⚙️ Setup Channel', value: '`/rr setup channel:#ch reward:500 ping_role1:@Role winner_role:@Role reaction_emoji:<:emoji:id>`\nConfigures a channel for RR tracking. All fields except channel are optional.', inline: false },
        { name: '📝 Add Host Info', value: '`/rr add channel:#ch other_reward:"Sticker" description:"Tonight: Boardgame era"`\nMods/staff can add a one-time description or reward before a battle.', inline: false },
        { name: '🏆 Season Management', value: '`/rr season start name:"Season 1"` → `/rr season add channel:#ch` → `/rr season end`\nDefines which channels count toward the collection achievement.', inline: false },
        { name: '📊 Stats', value: '`/rr stats [user] [channel] [period] [scope]`\nView leaderboards — filter by channel, week/month/all, server/global.', inline: false },
        { name: '📋 Log Channels', value: '`/rr log admin channel:#ch` — config change logs\n`/rr log achievement channel:#ch` — collection achievement logs', inline: false },
        { name: '🗑️ Clear Channel', value: '`/rr clear channel:#ch`\nRemoves all RR config for a channel.', inline: false },
      )
      .setFooter({ text: 'Winners auto-receive Sins from Play & Regret • Reactions auto-applied to winner role holders' }),

    payments: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('<a:payout:1512913911953756291> Payment Tracking')
      .setDescription('Track payments between sellers and members. Each seller manages their own records independently.')
      .addFields(
        { name: '👤 Approve Sellers', value: '`/pay seller add @user`\nOwner approves who can use seller commands.', inline: false },
        { name: '💳 Set Payment Methods', value: '`/pay methods set paypal:https://paypal.me/you venmo:... cashapp:... applepay:... zelle:...`\nEach seller sets their own links.', inline: false },
        { name: '📋 Log Payment', value: '`/pay log @user amount:10 service:"Sticker Pack" method:PayPal paid:false`\nLogs a payment and DMs the member a receipt.', inline: false },
        { name: '✅ Mark Paid', value: '`/pay mark id:123`\nMarks a payment as fully paid and DMs a receipt.', inline: false },
        { name: '⏳ Partial Payment', value: '`/pay partial id:123 amount:5`\nLogs a partial payment, shows remaining balance.', inline: false },
        { name: '✏️ Edit Entry', value: '`/pay edit id:123 amount: service: method: notes:`\nEdit any field — member is notified of changes.', inline: false },
        { name: '🗑️ Remove Entry', value: '`/pay remove id:123`', inline: false },
        { name: '📊 Your List', value: '`/pay list [status:unpaid/partial/paid/all]`\nYour full records with IDs, amounts, timestamps and totals.', inline: false },
        { name: '👛 Member Balance', value: '`/pay balance @seller`\nAnyone can check their own balance with a seller and see payment links.', inline: false },
        { name: '🔍 Show Payment Methods', value: '`/pay methods show seller:@seller method:CashApp`\nAnyone can view a seller\'s payment links.', inline: false },
      )
      .setFooter({ text: 'Sellers only see their own records • Members only see their own balance' }),

    sticky: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('📌 Sticky Notes')
      .setDescription('Persistent messages that always stay at the bottom of a channel.')
      .addFields(
        { name: '📌 Set Sticky', value: '`/sticky set message:"Your text here" title:"Optional Title" color:#hex`\nRun in the channel where you want the sticky. Use `\\n` for line breaks.', inline: false },
        { name: '✏️ Edit Sticky', value: '`/sticky edit message:"New text" title:"New Title"`\nUpdate the sticky in the current channel.', inline: false },
        { name: '🗑️ Remove Sticky', value: '`/sticky remove`\nRun in the channel to remove and delete the sticky message.', inline: false },
      )
      .setFooter({ text: 'Sticky reposts to the bottom every time someone sends a message' }),

    panels: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🔔 Ping Panels')
      .setDescription('Sticky panels with Get Notified / Remove Ping buttons for role toggles.')
      .addFields(
        { name: '📋 Post Panel', value: '`/pingpanel post role:@Role title:"Get notified for X" description:"..." color:#hex`\nPosts a sticky panel in the current channel (or specify a channel).', inline: false },
        { name: '🗑️ Remove Panel', value: '`/pingpanel remove channel:#ch`\nRemoves the sticky panel from a channel.', inline: false },
        { name: 'ℹ️ How it works', value: 'The panel auto-reposts to the bottom when messages are sent.\nMembers click **Get Notified** to receive the role or **Remove Ping** to remove it.', inline: false },
      )
      .setFooter({ text: 'Each channel can have one ping panel' }),

    general: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🤖 General Commands')
      .addFields(
        { name: '<a:afk:1522096882036510791> AFK', value: '`/afk set reason:"Be back soon"` — set yourself as AFK globally\n`/afk clear` — manually clear your AFK status\nBot auto-clears when you send a message and shows how long you were gone.', inline: false },
        { name: '🧹 Purge', value: '`/purge amount:50`\nDeletes up to 100 messages in the current channel. Requires admin or configured purge role.', inline: false },
        { name: '<a:purplesparkle:1512912828489793626> Boost Detection', value: 'Set with `/settings channels boost:#ch`\nBot auto-posts a thank you message when someone boosts the server.', inline: false },
        { name: '<:rumble:1522372419338375299> Rumble Grind', value: '`/grind setup channel:#ch role:@Role max_channels:50 duration:1`\nPosts a panel for members to create personal temp Rumble channels.\nChannels auto-delete after the set duration.', inline: false },
      )
      .setFooter({ text: 'Use /settings to configure channels and roles' }),

    playregret: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('<a:SINS:1522338148380704910> Play & Regret Integration')
      .setDescription('VELOURA connects directly to the **Play & Regret** bot\'s database to award <:sins:1522291331672703100> **Sins** currency automatically.')
      .addFields(
        { name: 'How it works', value: 'When a Rumble Royale battle ends, VELOURA detects the winner and automatically adds Sins to their Play & Regret balance. No manual action needed.', inline: false },
        { name: '⚔️ Set Reward Amount', value: 'Use `/rr setup reward:500` to configure how many Sins winners receive per channel. Each channel can have a different reward.', inline: false },
        { name: '<a:moneybag:1522373120147849226> Check Balance', value: 'Members can check their Sins balance using Play & Regret\'s `!bal` command.', inline: false },
        { name: '<a:SINS:1522338148380704910> Sins Commands (Play & Regret)', value: '`/sins balance` — check your balance\n`/sins give @user amount:100` — transfer Sins to another member\n`/grantsins @user amount:100` — owner grants Sins without deducting', inline: false },
        { name: '⚙️ Setup Required', value: 'The `PLAY_AND_REGRET_DB_URL` environment variable must be set in VELOURA\'s Railway config to enable the connection.', inline: false },
      )
      .setFooter({ text: 'Sins are awarded automatically on every RR win' }),

    config: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('⚙️ Server Config')
      .setDescription('Loading your server configuration...')
      .setTimestamp(),
  };

  return embeds[category] || buildHomeEmbed();
}

async function buildConfigEmbed(guild, client) {
  const lines = [];

  try {
    // Guild config
    const gc = await query('SELECT * FROM guild_config WHERE guild_id=$1', [guild.id]);
    const g = gc.rows[0];
    if (g) {
      lines.push('**⚙️ General Settings**');
      lines.push(`Boost Channel: ${g.boost_channel_id ? `<#${g.boost_channel_id}>` : '❌ Not set'}`);
      lines.push(`Mod Role: ${g.mod_role_id ? `<@&${g.mod_role_id}>` : '❌ Not set'}`);
      lines.push(`Admin Role: ${g.admin_role_id ? `<@&${g.admin_role_id}>` : '❌ Not set'}`);
      lines.push('');
    }

    // Ticket config
    const tc = await query('SELECT * FROM ticket_config WHERE guild_id=$1', [guild.id]);
    const t = tc.rows[0];
    lines.push('**<a:tickets:1523139713278672996> Tickets**');
    if (t) {
      lines.push(`Staff Role: <@&${t.staff_role_id}>`);
      lines.push(`Category: ${t.category_id ? `<#${t.category_id}>` : '❌ Not set'}`);
      lines.push(`Transcript Channel: ${t.transcript_channel_id ? `<#${t.transcript_channel_id}>` : '❌ Not set'}`);
      lines.push(`Staff Channel: ${t.staff_channel_id ? `<#${t.staff_channel_id}>` : '❌ Not set'}`);
    } else {
      lines.push('❌ Not configured — run `/ticket setup`');
    }
    lines.push('');

    // RR config
    const rr = await query('SELECT * FROM rr_channel_config WHERE guild_id=$1', [guild.id]);
    lines.push('**<:rumble:1522372419338375299> Rumble Royale**');
    if (rr.rows.length) {
      for (const r of rr.rows) {
        lines.push(`<#${r.channel_id}> — Reward: ${r.reward_amount} sins${r.winner_role_id ? ` — Role: <@&${r.winner_role_id}>` : ''}`);
      }
    } else {
      lines.push('❌ No channels configured — run `/rr setup`');
    }
    lines.push('');

    // RR log channels
    const rrg = await query('SELECT * FROM rr_guild_config WHERE guild_id=$1', [guild.id]);
    const rrgc = rrg.rows[0];
    if (rrgc) {
      lines.push('**<:rumble:1522372419338375299> RR Log Channels**');
      lines.push(`Admin Log: ${rrgc.log_channel_id ? `<#${rrgc.log_channel_id}>` : '❌ Not set'}`);
      lines.push(`Achievement Log: ${rrgc.achievement_log_channel_id ? `<#${rrgc.achievement_log_channel_id}>` : '❌ Not set'}`);
      lines.push('');
    }

    // Active season
    const season = await query('SELECT * FROM rr_seasons WHERE guild_id=$1 AND status=$2', [guild.id, 'active']);
    if (season.rows.length) {
      lines.push(`**<:rumble:1522372419338375299> Active Season:** ${season.rows[0].name}`);
      lines.push('');
    }

    // Ticket panels
    const panels = await query('SELECT * FROM ticket_panels WHERE guild_id=$1', [guild.id]);
    lines.push('**<a:tickets:1523139713278672996> Ticket Panels**');
    if (panels.rows.length) {
      for (const p of panels.rows) lines.push(`ID \`${p.id}\` — ${p.title} in <#${p.channel_id}>`);
    } else {
      lines.push('❌ No panels — run `/ticket panel`');
    }
    lines.push('');

    // Sticky messages
    const stickies = await query('SELECT channel_id FROM sticky_messages WHERE guild_id=$1', [guild.id]);
    lines.push('**📌 Sticky Notes**');
    lines.push(stickies.rows.length ? stickies.rows.map(r => `<#${r.channel_id}>`).join(', ') : '❌ None active');
    lines.push('');

    // Ping panels
    const pp = await query('SELECT channel_id FROM pingpanel_sticky WHERE guild_id=$1', [guild.id]);
    lines.push('**🔔 Ping Panels**');
    lines.push(pp.rows.length ? pp.rows.map(r => `<#${r.channel_id}>`).join(', ') : '❌ None active');

  } catch(e) {
    lines.push('❌ Error loading config: ' + e.message);
  }

  return new EmbedBuilder().setColor('#d6c2ee')
    .setTitle('⚙️ Server Configuration')
    .setDescription(lines.join('\n').slice(0, 4096))
    .setTimestamp()
    .setFooter({ text: guild.name });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('VELOURA help center — commands, guides and server config'),

  async execute(interaction) {
    await interaction.reply({
      embeds: [buildHomeEmbed()],
      components: [buildSelectMenu()],
      ephemeral: true,
    });
  },

  async handleSelect(interaction, client) {
    if (interaction.customId !== 'help_category') return;
    const category = interaction.values[0];

    let embed;
    if (category === 'config') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          interaction.user.id !== process.env.OWNER_ID) {
        embed = new EmbedBuilder().setColor('#ff4444').setDescription('❌ Server config is admin only.');
      } else {
        embed = await buildConfigEmbed(interaction.guild, client);
      }
    } else {
      embed = buildCategoryEmbed(category);
    }

    await interaction.update({
      embeds: [embed],
      components: [buildSelectMenu(category)],
    });
  },
};
