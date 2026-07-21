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
    .setDescription('Welcome! Select a category below to learn about each feature.\n\n🚀 **New here?** Pick **Getting Started** from the dropdown for a step-by-step setup walkthrough.\n\nVELOURA works alongside **Play & Regret** — wins in Rumble Royale automatically award <:sins:1522291331672703100> **Sins** currency.')
    .addFields(
      { name: '🚀 Getting Started',                                value: 'Step-by-step setup guide for new servers', inline: true },
      { name: '<a:tickets:1523139713278672996> Tickets',          value: 'Create & manage support tickets',         inline: true },
      { name: '<:rumble:1522372419338375299> Rumble Royale',      value: 'Track RR battles, wins & seasons',        inline: true },
      { name: '<a:payout:1512913911953756291> Payments',         value: 'Track payments & send receipts',           inline: true },
      { name: '📌 Sticky Notes',                                  value: 'Pin persistent messages in channels',     inline: true },
      { name: '🔔 Ping Panels',                                   value: 'Role notification toggle panels',         inline: true },
      { name: '<:role:1524456992683593979> Role Panels',          value: 'Dropdown & reaction self-assign roles',   inline: true },
      { name: '<a:shop:1524457010714640464> Shop',                value: 'Sins economy — roles, perks & items',     inline: true },
      { name: '<a:purplesparkle:1512912828489793626> Giveaways',  value: 'Live giveaways with bonus entries',       inline: true },
      { name: '<a:trophies:1512912823062364281> Level System',   value: 'XP, levels & leaderboard',                inline: true },
      { name: '<a:payout:1512913911953756291> Staff & Payroll',  value: 'Staff roster, eligibility & payouts',     inline: true },
      { name: '🤖 General',                                       value: 'Lock, Ban Log, Embed, Wheel & more',      inline: true },
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
      .setTitle('🚀 Getting Started with VELOURA')
      .setDescription('Recommended setup order for a brand-new server. Each step links to the relevant `/help` category for full details.')
      .addFields(
        { name: '1️⃣ Core Channels', value: '`/settings channels schedule:#ch winners:#ch ticket:#ch staff_notif:#ch transcript:#ch boost:#ch`\nSet these once — everything else reads from here. All optional, set only what you need.', inline: false },
        { name: '2️⃣ Staff Roster', value: '`/staff add user:@member role:staff`\nAdds them to payroll/eligibility tracking and unlocks staff-only commands like `/rr add`.', inline: false },
        { name: '3️⃣ Tickets', value: '`/ticket setup staff_role:@Staff staff_channel:#staff-tickets transcript:#logs` → `/ticket panel title:"Support"`\nSee **Tickets** category for panel types, close flow, and repost.', inline: false },
        { name: '4️⃣ Rumble Royale', value: '`/rr setup channel:#ch reward:500 winner_role:@Winner ping_role1:@Role`\nRepeat per RR channel. See **Rumble Royale** category for seasons, stats, and announce styles.', inline: false },
        { name: '5️⃣ Shop', value: '`/shop setup shop_channel:#shop fulfillment_channel:#staff-orders` → `/shop additem ...`\nSee **Shop** category for item types (Role, Auto Reaction, Nickname, Custom) and the buy → use flow.', inline: false },
        { name: '6️⃣ Role Panels & Ping Panels', value: '`/rolepanel create` for dropdown/reaction self-assign roles.\n`/pingpanel post` for simple single-role notification toggles.', inline: false },
        { name: '7️⃣ Sticky Notes', value: '`/sticky set channel:#ch message:"..."`\nKeeps an important message pinned to the bottom of a channel.', inline: false },
        { name: '8️⃣ Giveaways', value: '`/giveaway bonusrole add role:@VIP entries:2` (optional, one-time setup)\nThen `/giveaway start prize:"..." duration_amount:1 duration_unit:Days` whenever you want to run one.', inline: false },
        { name: '9️⃣ Payments', value: '`/pay seller add user:@member` → `/pay methods set seller:@member method:CashApp value:"$tag"`\nLets approved sellers track and receipt payments to members.', inline: false },
        { name: '🔍 Check Your Work', value: 'Run `/help` → **Server Config** any time to see a live snapshot of everything currently configured — channels, active panels, shop items, giveaways, and more.', inline: false },
      )
      .setFooter({ text: 'You don\'t need to do this all at once — set up what you need, when you need it' }),

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
        { name: '🔒 Close Ticket', value: 'Click the **Close Ticket** button, or run `/ticket close reason:"..."` inside the thread. Transcript is auto-sent to member + transcript channel.', inline: false },
        { name: '🔁 Repost Panel', value: '`/ticket repost panel_id:1`\nRebuilds and reposts a panel if its message was accidentally deleted — no need to recreate types.', inline: false },
        { name: '👤 Add/Remove User', value: '`/ticket add @user` / `/ticket remove @user`\nAdd or remove staff from a ticket thread.', inline: false },
      )
      .setFooter({ text: 'Members open tickets via panel buttons • Staff join via staff channel notification' }),

    rumble: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('<:rumble:1522372419338375299> Rumble Royale')
      .setDescription('Track Rumble Royale battles, wins, seasons and auto-award Sins to winners.')
      .addFields(
        { name: '⚙️ Setup Channel', value: '`/rr setup channel:#ch reward:500 ping_role1:@Role winner_role:@Role reaction_emoji:<:emoji:id> announce_style:Embed/Ping`\nConfigures a channel for RR tracking. All fields except channel are optional. `announce_style: Ping Only` posts just a role ping + next room instead of the full embed.', inline: false },
        { name: '📝 Add Host Info', value: '`/rr add channel:#ch other_reward:"Sticker" description:"Tonight: Boardgame era"`\nAnyone on the staff roster (or with the mod/admin role) can add a one-time description or reward — updates the *live* battle announcement immediately if one is currently posted, no need to wait for the next battle.', inline: false },
        { name: '🔁 Repost Announcement', value: '`/rr repost channel:#ch`\nManually resends the battle-start announcement for a channel using its current config (title, image, next room). Staff roster access, same as `/rr add`.', inline: false },
        { name: '🏆 Seasons (multiple, concurrent)', value: '`/rumble season start name:"Season 1" wheel_campaign:"..."` → `/rumble season add season:"Season 1" channel:#ch` → `/rumble season end season:"Season 1"`\nRun several seasons at once, each independent. Optionally link a season to a Wheel Roles campaign — completing it auto-enters members into that wheel. `/rumble season list` and `/rumble season info` to check progress.', inline: false },
        { name: '💀 Rumble Slaughter', value: '`/rumbleslaughter setup channel:#ch winner_role:@Role ping_role:@Role`\nAuto-assigns a role to the champion of Rumble Slaughter (a Play & Regret game mode) — detected directly from its own announcement, no manual work needed.', inline: false },
        { name: '💰 Currency & Wallet', value: '`/rr currency use_sins:True/False name:"..." emoji:"..."` — choose real Sins or your own currency\n`/rr wallet [user]` — check custom currency balance', inline: false },
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
        { name: '🔒 Lock', value: '`/lock channel:#ch reason:"..."`\nToggles Send Messages off/on for everyone in one command — works correctly even on role-restricted private channels.', inline: false },
        { name: '🔨 Ban Log', value: '`/banlog setup channel:#mod-log`\nAuto-posts whenever a member is banned, pulling the reason and who banned them from the audit log.\n`/banlog reason id:5 reason:"..."` — add/fix a reason after the fact\n`/banlog list` — recent bans', inline: false },
        { name: '📋 Custom Embeds', value: '`/embed create description:"..." title:"..." color:#d6c2ee image: thumbnail: footer: author: channel:`\nPost a fully custom embed anywhere.\n`/embed edit message_id:` — opens a form pre-filled with the current text, edit in place instead of retyping\n`/embed list [page]` / `/embed repost id:` — recover an embed if its message gets deleted', inline: false },
        { name: '<a:purplesparkle:1512912828489793626> Boost Detection', value: 'Set with `/settings channels boost:#ch`\nBot auto-posts a thank you message when someone boosts the server.', inline: false },
        { name: '<:rumble:1522372419338375299> Rumble Grind', value: '`/grind setup channel:#ch role:@Role max_channels:50 duration:1`\nPosts a panel for members to create personal temp Rumble channels — inherits the category\'s existing permissions.', inline: false },
        { name: '🎡 Wheel', value: '`/wheel members entries:"@a, @b, @c"` — spin for a winner\n`/wheel prizes prizes:"..." winner:@user` — spin a prize wheel for a winner you picked\n`/wheel combo entries: prizes:` — spin winner then prize in one flow\n`/wheel reactions link: emoji:` — pull entries from message reactions\n`/wheel boosted entries:` — boosted odds spin\n`/wheel role-bonus-add/list/remove` — bonus entries per role\nSins prizes are paid from the host\'s own wallet.', inline: false },
        { name: '🎯 Wheel Roles (auto-entry campaigns)', value: '`/wheel roles create name:"..." roles:@r1 @r2 auto_signup:True/False channel:#ch`\nMembers who collect every listed role qualify — automatically if `auto_signup:True`, or by clicking an Enter button if False.\n`/wheel roles spin name:"..."` — spin against everyone currently qualified\n`/wheel roles entries/list/close/delete` — manage campaigns', inline: false },
        { name: '🏆 Member Wins', value: '`/member-wins user:@member`\nSee everything a member has won across raffles, giveaways, and games.', inline: false },
        { name: '🔐 Private Rooms', value: '`/private-room setup`\nSets up auto-archiving private threads.', inline: false },
        { name: '💌 GoosDate', value: '`/goosdate setup channel:#ch role:@Role` — configure reminders\n`/goosdate toggle enabled:True/False`\n`/goosdate status`', inline: false },
      )
      .setFooter({ text: 'Use /settings to configure channels and roles' }),

    level: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('<a:trophies:1512912823062364281> Level System')
      .setDescription('Members earn XP by chatting and level up over time — the XP curve gets progressively harder, naturally forming Easy/Medium/Hard tiers.\n\n⚠️ **Off by default** — run `/level config enabled:True` to turn XP gain on for your server.')
      .addFields(
        { name: '🟢 Turn On/Off', value: '`/level config enabled:True`\nXP gain is fully opt-in — nothing accrues until this is set.', inline: false },
        { name: '📊 Check Level', value: '`/level check [user]`\nShows level, tier (🟢 Easy / 🟡 Medium / 🔴 Hard), total XP, and progress to the next level.', inline: false },
        { name: '🏆 Leaderboard', value: '`/level leaderboard`\nTop 10 members by level.', inline: false },
        { name: '⚙️ Configure', value: '`/level config levelup_channel:#ch announce:True xp_min:15 xp_max:25 cooldown_seconds:60`\nSet a dedicated channel for level-up announcements (defaults to wherever the message was sent), tune XP range and cooldown, or turn announcements off entirely.', inline: false },
        { name: '🚫 Exclude Channels', value: '`/level exclude add channel:#bot-commands`\n`/level exclude remove channel:#ch`\n`/level exclude list`\nStop specific channels from earning XP.', inline: false },
        { name: '✏️ Manually Set Level', value: '`/level set user:@member level:10`\nAdmin override — also what shop level-up items would hook into if built later.', inline: false },
        { name: '🗑️ Reset Server', value: '`/level reset confirm:True`\nWipes every member\'s level and XP on this server. Cannot be undone.', inline: false },
      )
      .setFooter({ text: 'XP curve: 5×level² + 50×level + 100 needed per level (same formula MEE6 uses)' }),

    staffpay: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('<a:payout:1512913911953756291> Staff & Payroll')
      .setDescription('Manage your staff roster, track eligibility, and handle payouts.')
      .addFields(
        { name: '👤 Staff Roster', value: '`/staff add user:@member role:staff pay:500 currency:MEE6` — add someone to the roster\n`/staff remove user:@member`\n`/staff list`', inline: false },
        { name: '📋 Staff Report', value: '`/staff report user:@member`\nFull eligibility report — games hosted, schedule adherence, payout status.', inline: false },
        { name: '💰 Payment History', value: '`/staff payhistory user:@member`\nShows their last 15 payments plus last-paid and next-due dates.', inline: false },
        { name: '✅ Mark Paid', value: '`/admin mark-paid user:@member amount:500`\nLogs the payment, DMs a receipt, and updates their next-due date automatically.', inline: false },
        { name: '📊 Payroll Overview', value: '`/admin payroll [user]` — current status for staff/boosters\n`/admin pay-summary` — full server pay summary, splits into multiple fields if the list is long\n`/admin paycheck-check user:@member` — single-member eligibility check\n`/admin daily-report period:` — daily/weekly staff activity report', inline: false },
        { name: '⚠️ Late & Missed', value: '`/admin late-payouts` — overdue payouts\n`/admin missed-schedules` — staff who missed scheduled sessions\n`/admin stop-reminder id:` — stop a specific payout reminder', inline: false },
        { name: '⚙️ Configure Requirements', value: '`/admin set-requirements min_games: min_auto_games: min_raffles: min_giveaways: max_late_payouts: bonus_per_game:`\n`/admin set-daily-goals role: games: autogames: payouts:`\n`/admin set-roles mod_role: admin_role: game_ping_role:`\n`/admin set-channels schedule_channel: winner_channel: ticket_channel: staff_notif_channel: transcript_channel:`\n`/admin set-timezone timezone:`', inline: false },
        { name: '💎 Boosters', value: '`/booster add user:@member amount:10 currency:MEE6 tier:...` \n`/booster remove user:@member`\n`/booster paid user:@member`\n`/booster list` / `/booster overdue`', inline: false },
        { name: '💸 My Unpaid Games', value: '`/payout [staff]`\nStaff can check their own unpaid games; admins can check anyone\'s.', inline: false },
      )
      .setFooter({ text: 'See /admin settings-summary for a full config snapshot' }),

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

    rolepanel: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('<:role:1524456992683593979> Role Panels')
      .setDescription('Self-assign role panels — members pick their own roles via dropdown or reaction.')
      .addFields(
        { name: '⚙️ Create Panel', value: '`/rolepanel create name:game-pings title:"Game Pings" style:Dropdown channel:#roles description:"..."`\nCreates a panel. `style` is `Dropdown` (multi-select menu) or `Reaction` (react to toggle).', inline: false },
        { name: '➕ Add Role', value: '`/rolepanel addrole name:game-pings role:@Fortnite emoji:🎮 label:"Fortnite"`\nAdds a role option — panel auto-reposts with the new option.', inline: false },
        { name: '➖ Remove Role', value: '`/rolepanel removerole name:game-pings role:@Fortnite`', inline: false },
        { name: '📄 List Panels', value: '`/rolepanel list [name]`\nShows all panels, or one panel\'s full role list.', inline: false },
        { name: '🗑️ Delete Panel', value: '`/rolepanel delete name:game-pings`', inline: false },
        { name: '🔁 Repost', value: '`/rolepanel repost name:game-pings`\nRebuilds and reposts the panel — also refreshes role names live if any were renamed since the panel was created.', inline: false },
      )
      .setFooter({ text: 'Dropdown panels support multi-select — members can toggle several roles in one interaction' }),

    shop: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('<a:shop:1524457010714640464> Shop')
      .setDescription('Spend Sins on Roles, Auto Reactions, Nicknames, Level Ups, and Custom items — buy now, activate with `/shop use` when ready.')
      .addFields(
        { name: '⚙️ Setup', value: '`/shop setup shop_channel:#shop fulfillment_channel:#staff-orders`\nAlso settable via `/settings channels shop:#ch shop_fulfillment:#ch`.', inline: false },
        { name: '➕ Add Item', value: '`/shop additem name:"VIP Role" price:5000 type:Role role:@VIP category:"Roles" duration_amount:7 duration_unit:Days`\nTypes: Role, Auto Reaction (buyer picks their own emoji), Nickname (rename another member), Nickname Remover (reset your own), Level Up (grants +N levels — set `levels:`), Custom (staff fulfills).', inline: false },
        { name: '🛍️ Buy', value: 'Members pick an item from the shop panel dropdown. This charges Sins and adds it to their inventory — nothing activates yet. A DM receipt is sent automatically.', inline: false },
        { name: '✅ Use', value: '`/shop use item_id:3`\nActivates an item from inventory — grants the role, prompts for an emoji/nickname target if needed, adds levels, or notifies staff (Custom items). This is what removes it from inventory.', inline: false },
        { name: '🎁 Gift', value: '`/shop gift item_id:3 to:@friend`\nSend an unused item straight to someone else\'s inventory — free, no purchase needed on their end.', inline: false },
        { name: '🎒 Inventory', value: '`/shop inventory [user]`\nShows unused items (need `/shop use`) and active items (with expiry countdowns).', inline: false },
        { name: '✏️ Edit / Remove Item', value: '`/shop edititem item_id:3 price:6000` — only fills in fields you provide\n`/shop removeitem item_id:3`', inline: false },
        { name: '🔄 Revoke', value: '`/shop revoke user:@member item_id:3`\nPulls back a used role/nickname and marks the purchase expired.', inline: false },
        { name: '📋 List / Repost', value: '`/shop list` — admin view of all items, grouped by category\n`/shop repost` — rebuilds the panel if its message was deleted', inline: false },
      )
      .setFooter({ text: 'Each category gets its own embed + dropdown, so the panel never hits Discord\'s size limits' }),

    giveaway: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('<a:purplesparkle:1512912828489793626> Giveaways')
      .setDescription('Live, auto-running giveaways — members react to enter, winner(s) picked automatically when time\'s up.')
      .addFields(
        { name: '🎉 Start', value: '`/giveaway start prize:"Nitro" duration_amount:1 duration_unit:Days winners:1 thumbnail:<upload> entry_emoji:🎉 claim_hours:6 ticket_channel:#claim`\nOnly `prize` and duration are required. If you have bonus-entry or required roles configured, you\'ll get a dropdown to pick which apply to this giveaway.', inline: false },
        { name: '✨ Bonus Entries', value: '`/giveaway bonusrole add role:@VIP entries:2`\nBuilds a reusable library. Entries stack if someone qualifies for multiple roles.', inline: false },
        { name: '📜 Entry Requirements (unlimited roles)', value: '`/giveaway requiredrole add roles:@Role1 @Role2 @Role3` — add as many at once as you want, one command\nA member must have ALL selected roles to be eligible — pick which ones apply per giveaway from a dropdown at start time.', inline: false },
        { name: '🎫 Check My Entries', value: 'Every giveaway posts a "Check My Entries" button — members can click it anytime to see their ticket count and which bonus roles are contributing, without needing to ask staff.', inline: false },
        { name: '📋 See Everyone\'s Entries', value: '`/giveaway entries id:4`\nHost/staff view — every eligible entrant sorted by ticket count, plus anyone who reacted but got excluded for missing a required role.', inline: false },
        { name: '✏️ Edit', value: '`/giveaway edit id:4 prize:"..." winners:2 duration_amount:1 duration_unit:Hours thumbnail:<upload>`\nHost only. Changing the duration properly reschedules the auto-end, not just the display.', inline: false },
        { name: '🏁 End Early', value: '`/giveaway end id:4`\nPicks winner(s) now instead of waiting.', inline: false },
        { name: '❌ Cancel', value: '`/giveaway cancel id:4`\nHost only. Ends it with no winner picked at all — different from `end`, which always picks someone.', inline: false },
        { name: '🔁 Reroll', value: '`/giveaway reroll id:4 count:1`\nPicks new winner(s) for an already-ended giveaway, excluding previous winners.', inline: false },
        { name: '🔁 Repost', value: '`/giveaway repost id:4`\nRebuilds the message if it was deleted — does nothing if it still exists, to protect everyone\'s entries.', inline: false },
        { name: '📋 List', value: '`/giveaway list`\nShows every active giveaway with its ID, time remaining, and channel.', inline: false },
      )
      .setFooter({ text: 'Anyone who reacts with anything other than the entry emoji is simply ignored' }),

    verify: new EmbedBuilder().setColor('#d6c2ee')
      .setTitle('🔐 Verification')
      .setDescription('React to rules, solve a captcha in-server, get auto-verified — no DMs involved.')
      .addFields(
        { name: '⚙️ Setup', value: '`/verify setup verified_role:@Verified rules_channel:#rules captcha_channel:#verification rules_text:"..." emoji:✅`\nPosts your rules with a reaction. Custom emojis work too — type `<a` or `<:` and pick from your server\'s emoji list.', inline: false },
        { name: '👤 The Flow', value: '1. Member reacts to rules\n2. Bot posts a personal captcha challenge in the captcha channel with a 6-character code and a "Solve Captcha" button (only they can click it)\n3. Clicking opens a form to type the code back\n4. Correct → instantly get the verified role. Wrong → told how many of their 5 attempts are left, and can react again anytime for a fresh code.', inline: false },
        { name: '👋 Welcome Message', value: '`/verify welcome channel:#welcome text:"Hey {user}, welcome!\\n\\nCheck out..." title:"Welcome!" image:<url>`\nPosts automatically the moment someone verifies. `{user}` mentions them in your text, and they\'re always pinged for real (mentions inside embeds alone don\'t trigger notifications). Optional — leave unset and nothing extra happens.', inline: false },
        { name: '🔁 Repost Rules', value: '`/verify repost-rules`\nRebuilds the rules message if it was deleted — does nothing if it still exists.', inline: false },
        { name: '📋 Status', value: '`/verify status user:@member`\nCheck if someone\'s verified, or mid-captcha with how many attempts used.', inline: false },
      )
      .setFooter({ text: 'The code is plain text, not an image — blocks casual bots/spam, not a sophisticated targeted attack' }),

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
      lines.push('❌ Not configured — run `/shop setup`');
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
