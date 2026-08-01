const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, PermissionFlagsBits
} = require('discord.js');
const { query } = require('../../utils/database');

const CATEGORIES = {
  getstarted: {
    emoji: '🚀',
    label: 'Getting Started',
    description: 'Step-by-step setup guide for new servers',
  },
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
  season: {
    emoji: '<a:rumblesword:1522372420894330921>',
    label: 'Seasons',
    description: 'Multi-channel seasons & achievement roles',
  },
  wheel: {
    emoji: '<a:color_wheel:1532822238120644627>',
    label: 'Wheel',
    description: 'Instant spins & Wheel Roles campaigns',
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
  rolepanel: {
    emoji: '<:role:1524456992683593979>',
    label: 'Role Panels',
    description: 'Dropdown & reaction self-assign roles',
  },
  shop: {
    emoji: '<a:shop:1524457010714640464>',
    label: 'Shop',
    description: 'Sins economy shop',
  },
  giveaway: {
    emoji: '<a:purplesparkle:1512912828489793626>',
    label: 'Giveaways',
    description: 'Live giveaways with entries & bonus roles',
  },
  level: {
    emoji: '<a:trophies:1512912823062364281>',
    label: 'Level System',
    description: 'XP, levels & leaderboard',
  },
  staffpay: {
    emoji: '<a:payout:1512913911953756291>',
    label: 'Staff & Payroll',
    description: 'Staff roster, eligibility & payouts',
  },
  general: {
    emoji: '🤖',
    label: 'General',
    description: 'Lock, Ban Log, Embed, Wheel & more',
  },
  verify: {
    emoji: '🔐',
    label: 'Verification',
    description: 'Rules, captcha & auto role assignment',
  },
  playregret: {
    emoji: '<a:SINS:1522338148380704910>',
    label: 'Play & Regret',
    description: 'Sins currency & connection',
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
    .setDescription('Welcome! Select a category below to learn about each feature.\n\n🚀 **New here?** Pick **Getting Started** from the dropdown for a step-by-step setup walkthrough.\n\nVELOURA works alongside **Play & Regret** — wins in Rumble Royale automatically award <:sins:1522291331672703100> **Sins** currency.')
    .addFields(
      { name: '🚀 Getting Started',                                value: 'Step-by-step setup guide for new servers', inline: true },
      { name: '<a:tickets:1523139713278672996> Tickets',          value: 'Create & manage support tickets',         inline: true },
      { name: '<:rumble:1522372419338375299> Rumble Royale',      value: 'Track RR battles, wins & seasons',        inline: true },
      { name: '<a:rumblesword:1522372420894330921> Seasons',      value: 'Multi-channel seasons & achievements',    inline: true },
      { name: '<a:color_wheel:1532822238120644627> Wheel',        value: 'Instant spins & Wheel Roles campaigns',   inline: true },
      { name: '<a:payout:1512913911953756291> Payments',         value: 'Track payments & send receipts',           inline: true },
      { name: '📌 Sticky Notes',                                  value: 'Pin persistent messages in channels',     inline: true },
      { name: '🔔 Ping Panels',                                   value: 'Role notification toggle panels',         inline: true },
      { name: '<:role:1524456992683593979> Role Panels',          value: 'Dropdown & reaction self-assign roles',   inline: true },
      { name: '<a:shop:1524457010714640464> Shop',                value: 'Sins economy — roles, perks & items',     inline: true },
      { name: '<a:purplesparkle:1512912828489793626> Giveaways',  value: 'Live giveaways with bonus entries',       inline: true },
      { name: '<a:trophies:1512912823062364281> Level System',   value: 'XP, levels & leaderboard',                inline: true },
      { name: '<a:payout:1512913911953756291> Staff & Payroll',  value: 'Staff roster, eligibility & payouts',     inline: true },
      { name: '🤖 General',                                       value: 'Lock, Ban Log, Embed & more',             inline: true },
      { name: '🔐 Verification',                                  value: 'Rules, captcha & auto role assignment',  inline: true },
      { name: '<a:SINS:1522338148380704910> Play & Regret',       value: 'Sins currency & RR integration',          inline: true },
      { name: '⚙️ Server Config',                                 value: 'Setup guide & current server config',     inline: true },
    )
    .setFooter({ text: '𝚃𝙷𝙴 𝙱𝙾𝙰𝚁𝙳 𝙿𝚁𝙸𝙽𝙲𝙴𝚂𝚂 • VELOURA' })
    .setTimestamp();
}

function buildCategoryEmbed(category) {
  const embeds = {
    getstarted: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🌟 Getting Started')
      .addFields(
        { name: 'How do I set up the server for the first time?', value: 'Run `/server-setup` — it\'s the central hub for channels, roles, staff, and everything else fundamental to running Veloura.', inline: false },
        { name: 'How do I add staff members?', value: 'Run `/server-setup` → Staff & Payroll — unlocks payroll tracking and staff-only commands like `/rr reward add`.', inline: false },
        { name: 'Where do I see my current config?', value: '`/help` → Server Config, for a live snapshot of everything configured right now.', inline: false },
      ),

    tickets: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🎫 Tickets')
      .addFields(
        { name: 'How do I set up tickets?', value: '`/ticket setup` — configures staff role, category, and core behavior. Listing/reposting/removing existing panels is also in `/server-setup` → Panels & Embeds.', inline: false },
        { name: 'How do I create a ticket panel?', value: '`/ticket panel` to create one, then `/ticket addtype` to add buttons to it.', inline: false },
        { name: 'How does a member open or close a ticket?', value: 'They click the panel button to open; staff use `/ticket close reason:` to close.', inline: false },
        { name: 'What if a panel gets deleted?', value: 'Run `/server-setup` → Panels & Embeds → Repost Ticket Panel to rebuild it.', inline: false },
      ),

    rumble: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('⚔️ Rumble Royale & Slaughter')
      .addFields(
        { name: 'How do I set up Rumble Royale?', value: '`/rr setup channel:#ch` — configure reward, winner role, ping roles, and announcement style for a channel. Currency and a few other settings are also in `/server-setup` → Rumble Setup.', inline: false },
        { name: 'How do I add a one-time bonus reward?', value: '`/rr reward add channel:#ch other_reward:"..."` — updates the *live* announcement immediately. `/rr reward remove` clears it.', inline: false },
        { name: 'How do I set up Rumble Slaughter?', value: '`/rs setup channel:#ch winner_role:@Role` — mirrors RR setup; Veloura detects the champion and posts its own summary automatically.', inline: false },
        { name: 'Can I run multiple seasons at once?', value: 'Yes — run `/server-setup` → Rumble Setup for the full season toolkit (start/end/info/add-channel/remove-channel/link-campaign). Each season is independent, and can link to a Wheel Roles campaign.', inline: false },
      ),

    season: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('⚔️ Seasons')
      .addFields(
        { name: 'What is a season?', value: 'A group of RR/RS channels tracked together, with an achievement role for members who win the winner role in *every* channel in the season.', inline: false },
        { name: 'How do I create one?', value: 'Season management is inside `/server-setup` → Rumble Setup — start a season, then add each channel that\'s part of it, one at a time.', inline: false },
        { name: 'How do I set the achievement role/channel?', value: 'Run `/server-setup` → Rumble Setup → Role Achievement Channel — this is where members get pinged once they collect every winner role in the season.', inline: false },
        { name: 'How do I check a season\'s progress?', value: 'Run `/server-setup` → Rumble Setup → season info — shows every channel in it and who\'s completed it so far.', inline: false },
        { name: 'How do I end a season?', value: 'Run `/server-setup` → Rumble Setup → end season — resets achievement progress for that season only; other active seasons are unaffected. If a Wheel Roles campaign is linked, it auto-ends too and its posted message greys out with a "closed" notice.', inline: false },
        { name: 'Can I link a season to a wheel giveaway?', value: 'Yes — `/wheel roles create name:"..." season:"..." require_all_season_roles:True` builds a campaign that only qualifies members who\'ve completed every role in that season. Then `/wheel roles post` to actually let people enter.', inline: false },
      ),

    wheel: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🎡 Wheel')
      .addFields(
        { name: 'How do I do a quick spin?', value: '`/wheel members entries:"@a, @b, @c"` — repeat a name to weight their odds (e.g. `@a, @a, @b` gives @a double odds). Also: `/wheel reactions`, `/wheel boosted`, `/wheel prizes`, `/wheel combo`.', inline: false },
        { name: 'What\'s a Wheel Roles campaign?', value: 'An ongoing entry pool tied to roles — unlike a quick spin, members get added automatically as they qualify, and you spin whenever you\'re ready.', inline: false },
        { name: 'How do I set one up?', value: '`/wheel roles create name:"..." season:"..."` to pull qualifying roles from a season (add `require_all_season_roles:True` to require every role, not just one). Or skip `season` and use `roles:` to mention roles manually.', inline: false },
        { name: 'How do members actually enter?', value: 'Either automatically the moment they get a qualifying role (`auto_signup` is on by default), or by reacting to a posted message — run `/wheel roles post name:"..." channel:#ch` to post one with a live-updating wheel image.', inline: false },
        { name: 'How do I spin it?', value: '`/wheel roles spin name:"..."` — uses everyone currently entered, weighted by how many qualifying roles they have if `extra_entries` was enabled.', inline: false },
        { name: 'How do I see who\'s entered?', value: '`/wheel roles list name:"..."` — shows every entrant and their exact odds.', inline: false },
        { name: 'How do I end or delete a campaign?', value: '`/wheel roles end name:"..."` stops new entries but keeps existing ones for spinning. `/wheel roles delete name:"..."` wipes it completely.', inline: false },
      ),

    payments: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('💳 Payments')
      .addFields(
        { name: 'How do I log a payment I made?', value: '`/payment log user:@member amount:500 service:"..." method:"..."`', inline: false },
        { name: 'How do I check what I\'m owed?', value: '`/payout` — shows your own unpaid games; admins can check anyone\'s.', inline: false },
        { name: 'How do I add a seller or payment method?', value: 'Run `/server-setup` → Payments & Sellers to approve a seller. For your own payment info, use `/payment methods set`.', inline: false },
      ),

    sticky: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('📌 Sticky Notes')
      .addFields(
        { name: 'How do I make a message stick to the bottom of a channel?', value: 'Run `/server-setup` → Sticky Notes — Veloura reposts it automatically as new messages come in.', inline: false },
        { name: 'How do I edit or remove one?', value: '`/sticky edit` to change it, `/sticky remove` to take it down.', inline: false },
      ),

    panels: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('📋 Ping Panels')
      .addFields(
        { name: 'How do I post a role-ping panel?', value: 'Run `/server-setup` → Panels & Embeds — one click for members to ping that role.', inline: false },
      ),

    general: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🤖 General')
      .addFields(
        { name: 'How do I lock a channel?', value: '`/lock channel:#ch reason:"..."`', inline: false },
        { name: 'How do I set up ban logging?', value: 'Run `/server-setup` → Other Settings.', inline: false },
        { name: 'How do I post a custom embed?', value: '`/embed create description:"..."` — `/embed edit` to change it later without retyping.', inline: false },
        { name: 'How do I report a bug or issue?', value: '`/report bug category:"..." description:"..."` — admins set the channel it goes to with `/report setup`.', inline: false },
      ),

    level: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🏅 Level System')
      .addFields(
        { name: 'How do I turn leveling on?', value: 'Run `/server-setup` → Other Settings — off by default.', inline: false },
        { name: 'How do I check my level?', value: '`/level check` — or `/level leaderboard` for the top of the server.', inline: false },
        { name: 'How do I manually set someone\'s level?', value: '`/level set user:@member level:5` (admin only) — posts publicly so it\'s visible, not just to you.', inline: false },
        { name: 'What are the tiers?', value: 'Levels 1–10 are 🟢 Easy, 11–25 are 🟡 Medium, 26+ are 🔴 Hard — this is automatic based on level, shown on level-up announcements.', inline: false },
        { name: 'Can members buy levels?', value: 'Yes — add a shop item with `type: Level Up` and set how many `levels` it grants. Members use it via `/shop use`, which instantly applies the levels and announces it publicly.', inline: false },
      ),

    staffpay: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('👥 Staff & Payroll')
      .addFields(
        { name: 'How do I add someone to staff?', value: 'Run `/server-setup` → Staff & Payroll.', inline: false },
        { name: 'How do I mark someone as paid?', value: '`/mark-paid user:@member amount:500` — works for staff and boosters, auto-detects which.', inline: false },
        { name: 'How do I see staff activity or pay status?', value: '`/admin staff-report period:` for activity, `/admin pay-summary` for pay status.', inline: false },
        { name: 'How do I configure pay requirements or goals?', value: 'Use `/staff requirements` and `/staff daily-goals` — both support per-role settings. For roles/channels/timezone, run `/server-setup`.', inline: false },
      ),

    playregret: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('<a:SINS:1522338148380704910> Play & Regret')
      .addFields(
        { name: 'What is Sins?', value: 'Play & Regret\'s currency — Veloura reads/writes to the same wallet for RR rewards, shop purchases, and wheel prizes.', inline: false },
        { name: 'How do I check a wallet balance?', value: '`/rr wallet user:@member`', inline: false },
      ),

    rolepanel: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🎭 Role Panels')
      .addFields(
        { name: 'How do I create a role panel?', value: '`/rolepanel create` to create one, then `/rolepanel addrole` to add roles to it.', inline: false },
        { name: 'What if the panel message gets deleted?', value: '`/rolepanel repost name:"..."` rebuilds it — also refreshes role names if any were renamed.', inline: false },
      ),

    shop: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🛒 Shop')
      .addFields(
        { name: 'How do I set up the shop?', value: 'Run `/server-setup` → Payments & Sellers.', inline: false },
        { name: 'How do I add an item?', value: 'Run `/server-setup` → Payments & Sellers. (Direct command: `/shop additem name:"..." price:100 type:"..."`)', inline: false },
        { name: 'How does a member buy or use something?', value: 'They browse the posted panel; `/shop use item_id:` to use it, `/shop gift` to give it to someone else.', inline: false },
      ),

    giveaway: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🎁 Giveaways')
      .addFields(
        { name: 'How do I start a giveaway?', value: '`/giveaway start prize:"..." duration_amount:1 duration_unit:Days` — or set `prize_type:"Server Currency"` and an `amount` to auto-award your server\'s currency to the winner (the owner mints it free; anyone else funds it from their own balance).', inline: false },
        { name: 'How do I give certain roles extra entries, or require a role to enter?', value: 'Two steps: first build the role library in `/server-setup` → Game & Perks Settings ("Add Bonus Role" / "Add Required Role") — this doesn\'t restrict anything yet, it just builds a pool. Then when you run `/giveaway start`, a prompt appears letting you pick which of those roles apply to *this specific* giveaway. If the library is empty, no prompt appears.', inline: false },
        { name: 'What happens if someone without a required role reacts?', value: 'Their reaction gets removed automatically and a temporary message explains which role they\'re missing — enforced the instant they react, not just at draw time.', inline: false },
        { name: 'How can members check their own entries?', value: 'Every giveaway has a "Check My Entries" button — no command needed.', inline: false },
        { name: 'How do I edit, cancel, or end one early?', value: '`/giveaway edit id:`, `/giveaway cancel id:` (host only, no winner picked), `/giveaway end id:` (picks a winner now).', inline: false },
      ),

    verify: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🔐 Verification')
      .addFields(
        { name: 'How do I set up verification?', value: '`/verify setup verified_role:@Role rules_channel:#ch captcha_channel:#ch rules_text:"..."` — the welcome message after verifying is also in `/server-setup` → Other Settings.', inline: false },
        { name: 'How does a member actually verify?', value: 'React to rules → react to start the captcha → solve the code → role assigned automatically.', inline: false },
        { name: 'How do I add a welcome message?', value: 'Run `/server-setup` → Other Settings — posts the moment someone joins.', inline: false },
        { name: 'How do I edit the rules later?', value: '`/verify edit-rules text:"..."` — only fills in what you provide.', inline: false },
      ),

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

    // Active seasons (multiple can run concurrently)
    const seasons = await query('SELECT * FROM rr_seasons WHERE guild_id=$1 AND status=$2', [guild.id, 'active']);
    if (seasons.rows.length) {
      lines.push(`**<:rumble:1522372419338375299> Active Season(s):** ${seasons.rows.map(s => s.name).join(', ')}`);
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
    lines.push('');

    // Role panels
    const rolePanels = await query('SELECT name, channel_id, style FROM role_panels WHERE guild_id=$1', [guild.id]);
    lines.push('**<:role:1524456992683593979> Role Panels**');
    if (rolePanels.rows.length) {
      for (const rp of rolePanels.rows) lines.push(`\`${rp.name}\` — <#${rp.channel_id}> (${rp.style})`);
    } else {
      lines.push('❌ None — run `/rolepanel create`');
    }
    lines.push('');

    // Shop
    const shopCfg = await query('SELECT * FROM shop_config WHERE guild_id=$1', [guild.id]);
    const sc = shopCfg.rows[0];
    lines.push('**<a:shop:1524457010714640464> Shop**');
    if (sc) {
      lines.push(`Panel Channel: ${sc.shop_channel_id ? `<#${sc.shop_channel_id}>` : '❌ Not set'}`);
      lines.push(`Fulfillment Channel: ${sc.fulfillment_channel_id ? `<#${sc.fulfillment_channel_id}>` : '❌ Not set'}`);
      const itemCount = await query('SELECT COUNT(*) FROM shop_items WHERE guild_id=$1 AND active=true', [guild.id]);
      lines.push(`Active Items: ${itemCount.rows[0].count}`);
    } else {
      lines.push('❌ Not configured — run `/server-setup` → Payments & Sellers');
    }
    lines.push('');

    // Giveaways
    const activeGiveaways = await query(`SELECT id, prize, ends_at FROM giveaway_events WHERE guild_id=$1 AND status='active' ORDER BY ends_at ASC`, [guild.id]);
    lines.push('**<a:purplesparkle:1512912828489793626> Active Giveaways**');
    if (activeGiveaways.rows.length) {
      for (const g of activeGiveaways.rows) lines.push(`\`#${g.id}\` ${g.prize} — ends <t:${Math.floor(new Date(g.ends_at).getTime()/1000)}:R>`);
    } else {
      lines.push('❌ None active');
    }

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
    .setDescription('VELOURA help center — commands and guides'),

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

    const embed = buildCategoryEmbed(category);

    await interaction.update({
      embeds: [embed],
      components: [buildSelectMenu(category)],
    });
  },

  buildConfigEmbed,
};
