require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, REST, Routes, Partials } = require('discord.js');

process.on('unhandledRejection', (error) => {
  console.error('[UnhandledRejection]', error?.stack || error?.message || error);
  if (error?.requestBody) console.error('[UnhandledRejection] requestBody:', JSON.stringify(error.requestBody));
  if (error?.rawError) console.error('[UnhandledRejection] rawError:', JSON.stringify(error.rawError));
});
process.on('uncaughtException', (error) => {
  console.error('[UncaughtException]', error?.stack || error?.message || error);
});
const { initDB } = require('./utils/database');
const { startReminderLoop } = require('./utils/reminders');
const { handleTicketMessage, handleThreadCreate, handleChannelDelete } = require('./events/ticketTracker');
const { loadAppEmojis } = require('./utils/appEmojis');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

// We deliberately register many independent messageCreate/messageUpdate listeners
// (RR, Rumble Slaughter, tickets, level XP, sticky, shop, etc.) — this is expected
// by design, not a runaway leak, so raise Node's default warning threshold.
client.setMaxListeners(25);

client.commands = new Collection();

// Load all commands recursively
function loadCommands(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommands(fullPath);
    } else if (entry.name.endsWith('.js')) {
      const cmd = require(fullPath);
      if (cmd.data && cmd.execute) {
        client.commands.set(cmd.data.name, cmd);
        console.log(`[Commands] Loaded: ${cmd.data.name}`);
      }
    }
  }
}

loadCommands(path.join(__dirname, 'commands'));


async function restoreRaffles(client) {
  try {
    const { query } = require('./utils/database');
    const now = new Date();
    const res = await query(
      `SELECT * FROM raffles WHERE status='active'`,
      []
    );
    console.log(`[Raffles] Restoring ${res.rows.length} active raffles...`);
    for (const raffle of res.rows) {
      const endsAt = new Date(raffle.ends_at);
      const msLeft = endsAt.getTime() - now.getTime();
      const { default: autoEnd } = await import('./commands/raffle/autoEndRaffle.js').catch(() => ({ default: null }));
      if (msLeft <= 0) {
        // Already expired - end it now
        const { autoEndRaffle } = require('./commands/raffle/raffle.js');
        if (autoEndRaffle) await autoEndRaffle(client, raffle.id, raffle.guild_id, raffle.channel_id, raffle.message_id);
      } else {
        // Reschedule
        const { autoEndRaffle } = require('./commands/raffle/raffle.js');
        if (autoEndRaffle) setTimeout(() => autoEndRaffle(client, raffle.id, raffle.guild_id, raffle.channel_id, raffle.message_id), msLeft);
        console.log(`[Raffles] Raffle #${raffle.id} rescheduled, ends in ${Math.round(msLeft/60000)}min`);
      }
    }
  } catch (err) {
    console.error('[Raffles] Restore failed:', err.message);
  }
}

client.once('ready', async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);

  // Fully populate the member cache for every guild. Without this, guildMemberUpdate
  // (used for boost detection) silently never fires for members who haven't
  // recently sent a message or otherwise been cached since the last restart.
  for (const guild of client.guilds.cache.values()) {
    await guild.members.fetch().catch((err) => {
      console.error(`[Bot] Failed to fetch members for ${guild.name}:`, err.message);
    });
  }
  console.log(`[Bot] Member cache primed for ${client.guilds.cache.size} guild(s).`);

  try {
    await loadAppEmojis(client.user.id, process.env.DISCORD_TOKEN);
  } catch (e) { console.error('[Emojis] load error:', e.message); }

  try {
    await restoreRaffles(client);
  } catch (e) { console.error('[Raffles] restore error:', e.message); }

  try {
    await initDB();
  } catch (e) { console.error('[DB] init error:', e.message); }
  // Restore grind auto-delete timers
  try {
    const { query: q } = require('./utils/database');
    const { scheduleDelete } = require('./commands/grind/grind');
    const res = await q('SELECT * FROM grind_channels', []);
    for (const row of res.rows) {
      const ms = new Date(row.expires_at).getTime() - Date.now();
      if (ms > 0) {
        const ch = await client.channels.fetch(row.channel_id).catch(() => null);
        if (ch) {
          const cfgRes = await q('SELECT * FROM grind_config WHERE guild_id = $1', [row.guild_id]);
          scheduleDelete(ch, row.guild_id, row.user_id, ms, client, cfgRes.rows[0] || {});
        }
      }
    }
    console.log('[Grind] Restored auto-delete timers.');
  } catch(e) { console.error('[Grind] restore error:', e.message); }

  // Restore shop role-expiry timers
  try {
    const { query: q } = require('./utils/database');
    const { scheduleRoleRemoval, scheduleReactionExpiry, scheduleNicknameRevert } = require('./commands/shop/shop');
    const res = await q(`
      SELECT sp.id, sp.guild_id, sp.user_id, sp.expires_at, sp.target_user_id, sp.original_nickname, si.role_id, si.type
      FROM shop_purchases sp
      JOIN shop_items si ON si.id = sp.item_id
      WHERE sp.expires_at IS NOT NULL AND sp.expired = false
    `, []);
    for (const row of res.rows) {
      const ms = new Date(row.expires_at).getTime() - Date.now();
      const guild = client.guilds.cache.get(row.guild_id);
      if (!guild) continue;

      if (row.type === 'nickname') {
        if (ms > 0) {
          scheduleNicknameRevert(guild, row.target_user_id, row.original_nickname, ms, row.id);
        } else {
          const member = await guild.members.fetch(row.target_user_id).catch(() => null);
          if (member) await member.setNickname(row.original_nickname || null).catch(() => {});
          await q('UPDATE shop_purchases SET expired = true WHERE id = $1', [row.id]).catch(() => {});
        }
        continue;
      }

      if (ms > 0) {
        if (row.role_id) scheduleRoleRemoval(guild, row.user_id, row.role_id, ms, row.id);
        else scheduleReactionExpiry(row.id, ms);
      } else {
        // Already expired while bot was offline — clean up immediately
        if (row.role_id) {
          const member = await guild.members.fetch(row.user_id).catch(() => null);
          if (member) await member.roles.remove(row.role_id).catch(() => {});
        }
        await q('UPDATE shop_purchases SET expired = true WHERE id = $1', [row.id]).catch(() => {});
      }
    }
    console.log('[Shop] Restored role-expiry timers.');
  } catch(e) { console.error('[Shop] restore error:', e.message); }

  // Restore active giveaway end-timers
  try {
    const { query: q } = require('./utils/database');
    const { scheduleGiveawayEnd, finishGiveaway } = require('./commands/giveaway/giveaway');
    const res = await q(`SELECT id, ends_at FROM giveaway_events WHERE status = 'active'`, []);
    for (const row of res.rows) {
      const ms = new Date(row.ends_at).getTime() - Date.now();
      if (ms > 0) {
        scheduleGiveawayEnd(client, row.id, ms);
      } else {
        // Already expired while bot was offline — finish it now
        finishGiveaway(client, row.id).catch(err => console.error('[Giveaway] restore finish error:', err.message));
      }
    }
    console.log('[Giveaway] Restored active giveaway timers.');
  } catch(e) { console.error('[Giveaway] restore error:', e.message); }

  startReminderLoop(client);
  const { startPrivateRoomCleanupLoop } = require('./utils/privateRooms');
  startPrivateRoomCleanupLoop(client);
  const { startGoosDateLoop } = require('./utils/goosDate');
  startGoosDateLoop(client);

  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commands = [...client.commands.values()].map(c => c.data.toJSON());
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log(`[Commands] Registered ${commands.length} commands globally`);
  } catch (err) {
    console.error('[Commands] Failed to register:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('grind_')) {
    return grindModule.handleButton(interaction, client);
  }
  if (interaction.isButton() && interaction.customId.startsWith('pingpanel_')) {
    return pingPanelModule.handleButton(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith('wheel_')) {
    return wheelModule.handleButton(interaction, client);
  }
  if (interaction.isButton() && interaction.customId.startsWith('wheelroles_enter:')) {
    return wheelModule.handleEnterButton(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith('giveaway_checkentries:')) {
    const { handleCheckEntriesButton } = require('./commands/giveaway/giveaway');
    return handleCheckEntriesButton(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith('verify_start:')) {
    const { handleCaptchaButton } = require('./events/verification');
    return handleCaptchaButton(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith('verify_newcode:')) {
    const { handleNewCodeButton } = require('./events/verification');
    return handleNewCodeButton(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith('serversetup_nav:')) {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleButton(interaction);
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'serversetup_channelpick') {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleChannelSettingSelect(interaction);
  }
  if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('serversetup_channelset:')) {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleChannelPicked(interaction);
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'serversetup_rolepick') {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleRoleSettingSelect(interaction);
  }
  if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('serversetup_roleset:')) {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleRolePicked(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith('serversetup_booster:')) {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleBoosterButton(interaction);
  }
  if (interaction.isUserSelectMenu() && interaction.customId.startsWith('serversetup_boosteruser:')) {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleBoosterUserPicked(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith('serversetup_staff:')) {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleStaffButton(interaction);
  }
  if (interaction.isUserSelectMenu() && interaction.customId.startsWith('serversetup_staffuser:')) {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleStaffUserPicked(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith('serversetup_extras:')) {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleExtrasButton(interaction);
  }
  if (interaction.isChannelSelectMenu() && interaction.customId === 'serversetup_goosdatechan') {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleGoosdateChannelPicked(interaction);
  }
  if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('serversetup_goosdaterole:')) {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleGoosdateRolePicked(interaction);
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'help_category') {
    return helpModule.handleSelect(interaction, client);
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('rolepanel_select:')) {
    return rolePanelModule.handleSelect(interaction);
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'shop_select') {
    return shopModule.handleSelect(interaction);
  }
  if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
    return ticketModule.handleButton(interaction, client);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_')) {
    return ticketModule.handleModal(interaction, client);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('shop_emoji_modal:')) {
    return shopModule.handleEmojiModal(interaction);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('shop_nickname_modal:')) {
    return shopModule.handleNicknameModal(interaction);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('embededit_modal:')) {
    const { handleEditModal } = require('./commands/embed/embed');
    return handleEditModal(interaction);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('serversetup_boostermodal:')) {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleBoosterAddModal(interaction);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('serversetup_staffmodal:')) {
    const serverSetupModule = require('./commands/serversetup/serversetup');
    return serverSetupModule.handleStaffAddModal(interaction);
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('verify_modal:')) {
    const { handleCaptchaModal } = require('./events/verification');
    return handleCaptchaModal(interaction);
  }
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try { await command.autocomplete(interaction); }
      catch (err) { console.error(`[Autocomplete Error] ${interaction.commandName}:`, err.message); }
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[Command Error] ${interaction.commandName}:`, err);
    const msg = { content: '❌ An error occurred.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

// Rumble Royale integration
const { handleMessage: handleRRMessage, handleReaction: handleRRReaction } = require('./events/rumbleRoyale');
const { handleMessage: handleSlaughterMessage } = require('./events/rumbleSlaughter');
const grindModule = require('./commands/grind/grind');
const pingPanelModule = require('./commands/pingpanel/pingpanel');
const stickyModule    = require('./commands/sticky/sticky');
const ticketModule    = require('./commands/ticket/ticket');
const helpModule      = require('./commands/help/help');
const wheelModule     = require('./commands/wheel/wheel');
const rolePanelModule = require('./commands/rolepanel/rolepanel');
const shopModule      = require('./commands/shop/shop');
const banlogModule    = require('./commands/banlog/banlog');
const { handleMessageXp } = require('./events/levelXp');
client.on('messageCreate', async (message) => {
  try { await handleRRMessage(message, client); }
  catch (e) { console.error('[RumbleRoyale]', e.message); }
});
client.on('messageCreate', async (message) => {
  try { await handleSlaughterMessage(message, client); }
  catch (e) { console.error('[RumbleSlaughter]', e.message); }
});
client.on('messageUpdate', async (oldMsg, newMsg) => {
  if (!newMsg.embeds?.length) return;
  if (oldMsg.embeds?.length) return;
  try { await handleRRMessage(newMsg, client); }
  catch (e) { console.error('[RumbleRoyale] update:', e.message); }
});

// Auto-react to messages from members with winner roles
client.on('messageCreate', async (message) => {
  try { await handleRRReaction(message, client); }
  catch (e) { /* ignore reaction errors */ }
});

// Auto-react to messages from members who bought a shop reaction perk
client.on('messageCreate', async (message) => {
  try { await shopModule.handleAutoReact(message, client); }
  catch (e) { /* ignore reaction errors */ }
});

// Sticky ping panel repost
client.on('messageCreate', async (message) => {
  try { await pingPanelModule.handleStickyRepost(message, client); }
  catch (e) { /* ignore */ }
});

// Sticky notes repost
client.on('messageCreate', async (message) => {
  try { await stickyModule.handleStickyRepost(message, client); }
  catch (e) { /* ignore */ }
});

// Sticky ticket action row
client.on('messageCreate', async (message) => {
  try { await ticketModule.handleStickyActionRow(message, client); }
  catch (e) { /* ignore */ }
});

// Ticket staff embed live update (catches manual member adds too)
client.on('threadMembersUpdate', async (addedMembers, removedMembers, thread) => {
  try { await ticketModule.handleThreadMembersUpdate(thread, client); }
  catch (e) { console.error('[Ticket] threadMembersUpdate:', e.message); }
});

// Reaction role panels
client.on('messageReactionAdd', async (reaction, user) => {
  try { await rolePanelModule.handleReactionAdd(reaction, user); }
  catch (e) { console.error('[RolePanel] add:', e.message); }
});
client.on('messageReactionRemove', async (reaction, user) => {
  try { await rolePanelModule.handleReactionRemove(reaction, user); }
  catch (e) { console.error('[RolePanel] remove:', e.message); }
});

// Member verification
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    const { handleReactionAdd } = require('./events/verification');
    await handleReactionAdd(reaction, user, client);
  } catch (e) { console.error('[Verify] reaction:', e.message); }
});
client.on('messageCreate', async (message) => {
  try {
    const { handleCaptchaChannelMessage } = require('./events/verification');
    await handleCaptchaChannelMessage(message, client);
  } catch (e) { console.error('[Verify] sticky repost:', e.message); }
});
client.on('guildMemberAdd', async (member) => {
  try {
    const { handleMemberJoin } = require('./events/verification');
    await handleMemberJoin(member, client);
  } catch (e) { console.error('[Verify] welcome on join:', e.message); }
});

// Ban log
client.on('guildBanAdd', async (ban) => {
  try { await banlogModule.handleBan(ban, client); }
  catch (e) { console.error('[BanLog]', e.message); }
});

// Level system XP gain
client.on('messageCreate', async (message) => {
  try { await handleMessageXp(message, client); }
  catch (e) { console.error('[Level] XP error:', e.message); }
});

// Boost detection
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    const wasBooster = oldMember.premiumSince;
    const isBooster  = newMember.premiumSince;
    if (!wasBooster && isBooster) {
      const { query: q } = require('./utils/database');
      const res = await q('SELECT boost_channel_id FROM guild_config WHERE guild_id = $1', [newMember.guild.id]);
      const channelId = res.rows[0]?.boost_channel_id;
      if (!channelId) {
        console.log(`[Boost] ${newMember.user.username} boosted ${newMember.guild.name}, but no boost_channel_id is configured.`);
        return;
      }
      const ch = await client.channels.fetch(channelId).catch((err) => {
        console.error(`[Boost] Failed to fetch boost channel ${channelId}:`, err.message);
        return null;
      });
      if (!ch) return;
      const { EmbedBuilder } = require('discord.js');
      await ch.send({ embeds: [
        new EmbedBuilder()
          .setColor('#d6c2ee')
          .setTitle('<a:purplesparkle:1512912828489793626> A huge thank you to our Server Booster! <a:purplesparkle:1512912828489793626>')
          .setDescription(
            `Your support helps make **${newMember.guild.name}** an even better place for everyone. Every boost helps us unlock awesome perks, improve the server, and continue growing this amazing community.

We truly appreciate you being part of the community. <a:TeamHands:1523082734182989918>

Thank you <@${newMember.id}> for helping us keep the magic alive! <a:BunnyLove:1523082730185691348>`
          )
          .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
          .setTimestamp()
      ]}).catch((err) => console.error('[Boost] Failed to send boost message:', err.message));
    }
  } catch(e) { console.error('[Boost]', e.message); }
});

// Wheel Roles auto-signup — checks role-collection campaigns independently of
// boost detection, since that listener has an early return that would block it
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (typeof wheelModule.checkAutoSignupCampaigns !== 'function') return; // Wheel Roles not yet built
  try { await wheelModule.checkAutoSignupCampaigns(client, oldMember, newMember); }
  catch (e) { console.error('[WheelRoles] auto-signup error:', e.message); }
});

// Ticket tracking
client.on('messageCreate', handleTicketMessage);
client.on('channelDelete', handleChannelDelete);
client.on('threadCreate', (thread) => handleThreadCreate(thread, client));

// AFK system — watch for mentions of AFK users and auto-clear on return
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const { query } = require('./utils/database');
  const { e } = require('./utils/appEmojis');

  // Helper: format duration since a date
  function formatDuration(since) {
    const ms = Date.now() - new Date(since).getTime();
    const totalMins = Math.floor(ms / 60000);
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours > 0 && mins > 0) return hours + 'h ' + mins + 'm';
    if (hours > 0) return hours + 'h';
    return mins + 'm';
  }

  // 1. Auto-clear AFK status when the AFK user sends a message
  try {
    const selfRes = await query('SELECT * FROM afk_status WHERE user_id=$1', [message.author.id]);
    if (selfRes.rows.length) {
      await query('DELETE FROM afk_status WHERE user_id=$1', [message.author.id]);
      const duration = formatDuration(selfRes.rows[0].set_at);
      await message.reply({
        content: e('confetti') + ' Welcome back **' + message.author.username + '**! You were AFK for **' + duration + '**.',
        allowedMentions: { repliedUser: false },
      }).catch(() => {});
    }
  } catch {}

  // 2. Notify when an AFK user is mentioned (with 2min cooldown per AFK user to avoid spam)
  if (message.mentions.users.size === 0) return;
  try {
    const mentionedIds = [...message.mentions.users.keys()];
    const placeholders = mentionedIds.map((_, i) => '$' + (i + 1)).join(',');
    const afkRes = await query(
      'SELECT * FROM afk_status WHERE user_id IN (' + placeholders + ')',
      mentionedIds
    );
    for (const afk of afkRes.rows) {
      // 2-minute cooldown per AFK user to prevent spam
      if (afk.last_notified_at) {
        const cooldownMs = 2 * 60 * 1000;
        if (Date.now() - new Date(afk.last_notified_at).getTime() < cooldownMs) continue;
      }
      const duration = formatDuration(afk.set_at);
      const serverName = message.guild.name;
      const afkUser = message.mentions.users.get(afk.user_id);
      const username = afkUser ? afkUser.username : 'That user';
      await message.reply({
        content:
          '<a:afk:1522096882036510791> **' + username + '** is AFK\n' +
          '> **Reason:** ' + afk.reason + '\n' +
          '-# ' + serverName + ' • AFK for ' + duration,
        allowedMentions: { repliedUser: false },
      }).catch(() => {});
      await query('UPDATE afk_status SET last_notified_at=NOW() WHERE user_id=$1', [afk.user_id]);
    }
  } catch (err) {
    console.error('[AFK] Error:', err.message);
  }
});

// Private room activity tracking — any message in a tracked private room thread
// resets its inactivity timer and un-archives it if needed.
client.on('messageCreate', async (message) => {
  if (!message.channel.isThread || !message.channel.isThread()) return;
  if (message.author.bot) return;
  try {
    const { touchActivity } = require('./utils/privateRooms');
    await touchActivity(message.channel.id);
  } catch (err) {
    // Not a tracked private room thread, or DB hiccup; safe to ignore.
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  // Raffle join button
  if (interaction.customId === 'raffle_join') {
    try {
      const { query } = require('./utils/database');
      const { e } = require('./utils/appEmojis');
      const raffleRes = await query(
        `SELECT * FROM raffles WHERE channel_id=$1 AND message_id=$2 AND status='active'`,
        [interaction.channelId, interaction.message.id]
      );
      if (!raffleRes.rows.length) {
        return interaction.reply({ content: 'This raffle has ended.', ephemeral: true });
      }
      const raffle = raffleRes.rows[0];
      await query(
        `INSERT INTO raffle_entries (raffle_id, user_id, username) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [raffle.id, interaction.user.id, interaction.user.username]
      );
      const countRes = await query(`SELECT COUNT(*) FROM raffle_entries WHERE raffle_id=$1`, [raffle.id]);
      const count = parseInt(countRes.rows[0].count);
      try {
        const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
        const { getPrizeImage } = require('./utils/prizeImages');
        const oldEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed)
          .spliceFields(0, oldEmbed.fields.length)
          .addFields({ name: `${e('members')} Entries`, value: `${count} entered` });

        // Re-attach the image file if it was an attachment, to prevent Discord rendering it full-size
        const imageData = await getPrizeImage(interaction.guildId, raffle.prize_key || 'gift');
        if (imageData.type === 'attachment') {
          const refreshedFile = new AttachmentBuilder(imageData.filepath, { name: imageData.filename });
          updatedEmbed.setThumbnail(`attachment://${imageData.filename}`);
          await interaction.message.edit({ embeds: [updatedEmbed], files: [refreshedFile] });
        } else {
          await interaction.message.edit({ embeds: [updatedEmbed] });
        }
      } catch (err) { console.error('[RaffleJoin] Embed update failed:', err.message); }
      await interaction.reply({ content: `${e('checkmark')} You're in the raffle! Good luck!`, ephemeral: true });
    } catch (err) {
      console.error('[RaffleJoin] Error:', err.message);
      await interaction.reply({ content: 'Something went wrong joining the raffle.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  // Private room creation button
  if (interaction.customId === 'privateroom_create') {
    try {
      const { query } = require('./utils/database');
      const { e } = require('./utils/appEmojis');

      const existingRes = await query(
        "SELECT * FROM private_rooms WHERE guild_id=$1 AND user_id=$2 AND status IN ('active','archived')",
        [interaction.guildId, interaction.user.id]
      );

      if (existingRes.rows.length) {
        const existing = existingRes.rows[0];
        try {
          const existingThread = await interaction.client.channels.fetch(existing.thread_id);
          if (existing.status === 'archived') {
            await existingThread.setArchived(false, 'Reopened via private room button');
            await query(
              "UPDATE private_rooms SET status='active', archived_at=NULL, last_activity_at=NOW() WHERE id=$1",
              [existing.id]
            );
            await existingThread.send(e('confetti') + ' Welcome back, <@' + interaction.user.id + '>! Your private room has been reopened.');
          }
          return interaction.reply({
            content: e('checkmark') + ' You already have a private room: ' + existingThread.toString(),
            ephemeral: true,
          });
        } catch {
          // Thread was deleted out-of-band; clean up the stale row and let them create a new one
          await query("DELETE FROM private_rooms WHERE id=$1", [existing.id]);
        }
      }

      const thread = await interaction.channel.threads.create({
        name: 'Private Room — ' + interaction.user.username,
        type: 12, // PrivateThread
        invitable: false,
        reason: 'Private room requested via button',
      });

      await thread.members.add(interaction.user.id);

      await query(
        `INSERT INTO private_rooms (guild_id, user_id, thread_id, parent_channel_id)
         VALUES ($1,$2,$3,$4)`,
        [interaction.guildId, interaction.user.id, thread.id, interaction.channelId]
      );

      await thread.send(e('confetti') + ' Welcome to your private gambling room, <@' + interaction.user.id + '>! This room archives after 24 hours of inactivity (reopen anytime), and deletes permanently after 1 week archived.');

      await interaction.reply({
        content: e('checkmark') + ' Your private room is ready: ' + thread.toString(),
        ephemeral: true,
      });
    } catch (err) {
      console.error('[PrivateRoom] Creation failed:', err.message);
      await interaction.reply({ content: 'Something went wrong creating your private room.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  // Game winner payout buttons (Claimed / Not Claimed)
  if (interaction.customId.startsWith('gamewin_claimed_') || interaction.customId.startsWith('gamewin_notclaimed_')) {
    try {
      const { query } = require('./utils/database');
      const { e } = require('./utils/appEmojis');
      const { EmbedBuilder } = require('discord.js');

      const isClaimed = interaction.customId.startsWith('gamewin_claimed_');
      const gameId = parseInt(interaction.customId.split('_').pop());

      const gameRes = await query('SELECT * FROM game_logs WHERE id=$1 AND guild_id=$2', [gameId, interaction.guildId]);
      if (!gameRes.rows.length) {
        return interaction.reply({ content: `${e('wrong')} Game not found.`, ephemeral: true });
      }
      const game = gameRes.rows[0];

      const staffRes = await query(`SELECT role FROM staff WHERE user_id=$1 AND active=true`, [interaction.user.id]);
      const staffRole = staffRes.rows[0]?.role;
      const isHost = interaction.user.id === game.host_id;
      const isAdminOrOwner = ['admin', 'owner'].includes(staffRole);

      if (!isHost && !isAdminOrOwner) {
        return interaction.reply({ content: `${e('wrong')} Only the host, an admin, or the owner can mark this payout.`, ephemeral: true });
      }

      const now = new Date();
      const newStatus = isClaimed ? 'paid' : 'not_claimed';
      if (game.payout_status === 'n/a') {
        return interaction.reply({ content: 'This game is marked N/A (host won their own game) — payout status cannot be changed.', ephemeral: true });
      }
      await query('UPDATE game_logs SET payout_status=$1, payout_confirmed_at=$2 WHERE id=$3', [newStatus, now, gameId]);
      await query(`UPDATE member_wins SET payout_status=$1, paid_at=$2 WHERE ref_id=$3 AND type='game'`, [newStatus, now, gameId]);
      await query(`UPDATE payout_reminders SET resolved=true WHERE type='game' AND ref_id=$1`, [gameId]);

      const oldEmbed = interaction.message.embeds[0];
      const fields = oldEmbed.fields.map(f => {
        if (f.name.includes('Payout')) {
          return {
            name: f.name,
            value: isClaimed
              ? `${e('checkmark')} Claimed — confirmed by <@${interaction.user.id}>`
              : `${e('wrong')} Not Claimed — confirmed by <@${interaction.user.id}>`,
            inline: f.inline,
          };
        }
        return { name: f.name, value: f.value, inline: f.inline };
      });
      const newColor = isClaimed ? 0x7F36F5 : 0x00FFF9;
      const updatedEmbed = EmbedBuilder.from(oldEmbed).setColor(newColor).setFields(fields);

      await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
      await interaction.reply({
        content: isClaimed ? `${e('checkmark')} Marked as claimed.` : `${e('wrong')} Marked as not claimed.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('[GameWinButton] Error:', err.message);
      await interaction.reply({ content: 'Something went wrong updating the payout.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (!['game_ping_join', 'game_ping_leave'].includes(interaction.customId)) return;
  try {
    const { query } = require('./utils/database');
    const cfg = await query(`SELECT game_ping_role_id FROM guild_config WHERE guild_id=$1`, [interaction.guildId]);
    if (!cfg.rows.length || !cfg.rows[0].game_ping_role_id) return interaction.reply({ content: 'Game ping role not configured.', ephemeral: true });
    const roleId = cfg.rows[0].game_ping_role_id;
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (interaction.customId === 'game_ping_join') {
      await member.roles.add(roleId);
      await interaction.reply({ content: '🔔 You will now be pinged for new games!', ephemeral: true });
    } else {
      await member.roles.remove(roleId);
      await interaction.reply({ content: '🔕 You will no longer be pinged for new games.', ephemeral: true });
    }
  } catch (err) {
    console.error('[GamePing] Button error:', err.message);
    await interaction.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => {});
  }
});

async function loginWithRetry() {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await client.login(process.env.DISCORD_TOKEN);
      return; // success
    } catch (err) {
      console.error(`[Login] Attempt ${attempt} failed:`, err.message);
      // Long, gentle backoff — repeatedly exiting and letting Railway instantly
      // restart just hammers Discord's rate limit harder. Stay in the same
      // process and wait it out instead: 30s, 1m, 2m, 4m... capped at 10m.
      const delayMs = Math.min(30_000 * Math.pow(2, attempt - 1), 600_000);
      console.log(`[Login] Waiting ${Math.round(delayMs / 1000)}s before retrying (not exiting — avoids restart-loop rate limiting)...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

loginWithRetry();

