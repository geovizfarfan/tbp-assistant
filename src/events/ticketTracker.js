const { query } = require('../utils/database');
const { e } = require('../utils/appEmojis');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType } = require('discord.js');

const unclaimedTimers = new Map();
const responseTimers = new Map();
const activeTimers = new Map();
const HR = 60 * 60 * 1000;

async function handleThreadCreate(thread, client) {
  const parent = thread.parent;
  if (!parent) return;
  const isTicket = parent.name?.toLowerCase().includes('ticket') || thread.name?.toLowerCase().includes('ticket');
  if (!isTicket) return;
  const guildId = thread.guildId;
  await query('INSERT INTO ticket_logs (guild_id, channel_id, opened_at, opened_by, status) VALUES ($1,$2,$3,$4,\'open\') ON CONFLICT DO NOTHING', [guildId, thread.id, new Date(), 'system']);
  try {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim_' + thread.id).setLabel('Claim Ticket').setStyle(ButtonStyle.Primary)
    );
    await thread.send({ content: '<a:atention:1512916995543273642> This ticket is unclaimed — staff click **Claim Ticket** to take it.', components: [row] });
  } catch (err) { console.error('[Tickets] Could not post buttons:', err.message); }
  startUnclaimedTimers(thread.id, guildId, client);
  startMemberIdleTimers(thread, guildId, client);
}

async function handleTicketMessage(message) {
  if (message.author.bot) return;
  const channel = message.channel;
  const isThread = channel.isThread && channel.isThread();
  const parent = isThread ? channel.parent : channel;
  if (!parent) return;
  const isTicket = parent.name?.toLowerCase().includes('ticket') || channel.name?.toLowerCase().includes('ticket');
  if (!isTicket) return;
  const guildId = message.guildId;
  const channelId = channel.id;
  const staffRes = await query('SELECT user_id FROM staff WHERE user_id=$1 AND active=true', [message.author.id]);
  const isSenderStaff = staffRes.rows.length > 0;
  let ticketRes = await query('SELECT * FROM ticket_logs WHERE guild_id=$1 AND channel_id=$2 AND status=\'open\' LIMIT 1', [guildId, channelId]);
  if (!ticketRes.rows.length) {
    await query('INSERT INTO ticket_logs (guild_id, channel_id, opened_at, opened_by, status) VALUES ($1,$2,$3,$4,\'open\') ON CONFLICT DO NOTHING', [guildId, channelId, message.createdAt, message.author.id]);
    ticketRes = await query('SELECT * FROM ticket_logs WHERE guild_id=$1 AND channel_id=$2 AND status=\'open\' LIMIT 1', [guildId, channelId]);
  }
  const ticket = ticketRes.rows[0];
  if (!ticket) return;
  if (isSenderStaff) {
    if (ticket.claimed_by && ticket.claimed_by === message.author.id) clearResponseTimer(channelId);
  } else {
    clearMemberIdleTimers(channelId);
    startMemberIdleTimers(channel, guildId, message.client);
    if (ticket.claimed_by) startResponseTimers(channelId, guildId, ticket.claimed_by, message.client);
  }
}

async function handleTicketClaim(btn, client) {
  const channelId = btn.channel.id;
  const guildId = btn.guildId;
  const ticketRes = await query('SELECT * FROM ticket_logs WHERE channel_id=$1 AND status=\'open\' LIMIT 1', [channelId]);
  if (!ticketRes.rows.length) return btn.reply({ content: 'Ticket not found.', ephemeral: true });
  const ticket = ticketRes.rows[0];
  if (ticket.claimed_by) return btn.reply({ content: '<a:atention:1512916995543273642> Already claimed by <@' + ticket.claimed_by + '>.', ephemeral: true });
  const staffRes = await query('SELECT user_id FROM staff WHERE user_id=$1 AND active=true', [btn.user.id]);
  if (!staffRes.rows.length) return btn.reply({ content: '<a:atention:1512916995543273642> Only staff can claim tickets.', ephemeral: true });
  const claimTime = new Date();
  const timeSinceOpen = Math.floor((claimTime - new Date(ticket.opened_at)) / 60000);
  await query('UPDATE ticket_logs SET claimed_by=$1, claimed_at=$2 WHERE channel_id=$3 AND status=\'open\'', [btn.user.id, claimTime, channelId]);
  clearUnclaimedTimers(channelId);
  await btn.update({
    content: '<a:checkmark:1512916161493205165> Claimed by <@' + btn.user.id + '> — ' + timeSinceOpen + 'm after opening.\n<a:atention:1512916995543273642> Click **Confirm Payout** once prize is sent.',
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_payout_' + channelId).setLabel('Confirm Payout').setStyle(ButtonStyle.Success))]
  });
}

async function handleTicketPayout(btn, client) {
  const channelId = btn.channel.id;
  const guildId = btn.guildId;
  const staffRes = await query('SELECT user_id FROM staff WHERE user_id=$1 AND active=true', [btn.user.id]);
  if (!staffRes.rows.length) return btn.reply({ content: '<a:atention:1512916995543273642> Only staff can confirm payouts.', ephemeral: true });
  const ticketRes = await query('SELECT * FROM ticket_logs WHERE channel_id=$1 AND status=\'open\' LIMIT 1', [channelId]);
  if (!ticketRes.rows.length) return btn.reply({ content: 'Ticket not found.', ephemeral: true });
  const ticket = ticketRes.rows[0];
  const openedBy = ticket.opened_by && ticket.opened_by !== 'system' ? ticket.opened_by : null;
  if (!openedBy) return btn.reply({ content: '<a:atention:1512916995543273642> Could not identify the ticket opener.', ephemeral: true });
  const pendingRes = await query(
    'SELECT pr.id, pr.type, pr.ref_id, pr.prize, gl.game_name FROM payout_reminders pr LEFT JOIN game_logs gl ON pr.type=\'game\' AND gl.id=pr.ref_id WHERE pr.winner_id=$1 AND pr.resolved=false AND pr.guild_id=$2',
    [openedBy, guildId]
  );
  if (!pendingRes.rows.length) return btn.reply({ content: '<a:atention:1512916995543273642> No pending payouts found for the ticket opener.', ephemeral: true });
  if (pendingRes.rows.length === 1) { await confirmPayout(pendingRes.rows[0], btn, client, guildId); return; }
  const options = pendingRes.rows.map(p => {
    const label = (p.game_name ? p.game_name + ' — ' + p.prize : p.type + ' #' + p.ref_id + ' — ' + p.prize).slice(0, 100);
    return new StringSelectMenuOptionBuilder().setLabel(label).setValue(String(p.id));
  });
  const select = new StringSelectMenuBuilder().setCustomId('ticket_payout_select_' + channelId).setPlaceholder('Which payout are you confirming?').addOptions(options);
  await btn.reply({ content: 'Select which payout to confirm:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
  try {
    const collected = await btn.channel.awaitMessageComponent({ filter: i => i.customId === 'ticket_payout_select_' + channelId && i.user.id === btn.user.id, componentType: ComponentType.StringSelect, time: 60000 });
    const selected = pendingRes.rows.find(p => p.id === parseInt(collected.values[0]));
    await collected.deferUpdate();
    await confirmPayout(selected, btn, client, guildId);
  } catch { await btn.editReply({ content: 'Payout selection timed out.', components: [] }); }
}

async function confirmPayout(reminder, btn, client, guildId) {
  const now = new Date();
  const tableMap = { game: 'game_logs', raffle: 'raffles', giveaway: 'giveaways' };
  const table = tableMap[reminder.type] || 'game_logs';
  await query('UPDATE ' + table + ' SET payout_status=\'paid\', payout_confirmed_at=$1 WHERE id=$2', [now, reminder.ref_id]);
  await query('UPDATE member_wins SET payout_status=\'paid\', paid_at=$1 WHERE ref_id=$2 AND type=$3', [now, reminder.ref_id, reminder.type]);
  await query('UPDATE payout_reminders SET resolved=true WHERE id=$1', [reminder.id]);
  try {
    const { EmbedBuilder } = require('discord.js');
    const annRes = await query('SELECT * FROM winner_announcements WHERE game_id=$1 AND guild_id=$2', [reminder.ref_id, guildId]);
    if (annRes.rows.length) {
      await query('UPDATE winner_announcements SET status=\'claimed\' WHERE game_id=$1 AND guild_id=$2', [reminder.ref_id, guildId]);
      const ann = annRes.rows[0];
      const winnerCh = await client.channels.fetch(ann.channel_id);
      const msg = await winnerCh.messages.fetch(ann.message_id);
      if (msg.embeds[0]) {
        const claimedEmbed = EmbedBuilder.from(msg.embeds[0]).setColor(0x7F36F5).spliceFields(3, 1, { name: e('payout') + ' Status', value: e('checkmark') + ' Claimed — confirmed by <@' + btn.user.id + '>', inline: false });
        await msg.edit({ embeds: [claimedEmbed] });
      }
    }
  } catch {}
  await btn.channel.send(e('checkmark') + ' Payout confirmed by <@' + btn.user.id + '> for **' + reminder.prize + '**. Reminder stopped.');
  try { await btn.editReply({ content: e('checkmark') + ' Payout confirmed!', components: [] }); } catch {}
}

function startUnclaimedTimers(channelId, guildId, client) {
  clearUnclaimedTimers(channelId);
  const timers = [
    setTimeout(() => notifyUnclaimed(channelId, guildId, client, 1,  false), 1  * HR),
    setTimeout(() => notifyUnclaimed(channelId, guildId, client, 3,  false), 3  * HR),
    setTimeout(() => notifyUnclaimed(channelId, guildId, client, 6,  true),  6  * HR),
    setTimeout(() => notifyUnclaimed(channelId, guildId, client, 12, true),  12 * HR),
  ];
  unclaimedTimers.set(channelId, timers);
}

function clearUnclaimedTimers(channelId) {
  if (unclaimedTimers.has(channelId)) { unclaimedTimers.get(channelId).forEach(t => clearTimeout(t)); unclaimedTimers.delete(channelId); }
}

async function notifyUnclaimed(channelId, guildId, client, hours, tagAdmins) {
  try {
    const ticket = await query('SELECT * FROM ticket_logs WHERE channel_id=$1 AND status=\'open\' LIMIT 1', [channelId]);
    if (!ticket.rows.length || ticket.rows[0].claimed_by) return;
    const cfg = await query('SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1', [guildId]);
    if (!cfg.rows.length || !cfg.rows[0].staff_notif_channel_id) return;
    const notifCh = await client.channels.fetch(cfg.rows[0].staff_notif_channel_id);
    let adminMention = '';
    if (tagAdmins) { const admins = await query('SELECT user_id FROM staff WHERE role IN (\'admin\',\'owner\') AND active=true', []); adminMention = ' ' + admins.rows.map(r => '<@' + r.user_id + '>').join(' '); }
    await notifCh.send('<a:atention:1512916995543273642> Ticket <#' + channelId + '> has been unclaimed for **' + hours + ' hour' + (hours > 1 ? 's' : '') + '**.' + adminMention);
  } catch (err) { console.error('[Tickets] Unclaimed notify failed:', err.message); }
}

function startResponseTimers(channelId, guildId, claimedBy, client) {
  clearResponseTimer(channelId);
  const timers = [
    setTimeout(() => notifyNoResponse(channelId, guildId, claimedBy, client, 1,  false), 1  * HR),
    setTimeout(() => notifyNoResponse(channelId, guildId, claimedBy, client, 3,  false), 3  * HR),
    setTimeout(() => notifyNoResponse(channelId, guildId, claimedBy, client, 6,  true),  6  * HR),
    setTimeout(() => notifyNoResponse(channelId, guildId, claimedBy, client, 12, true),  12 * HR),
  ];
  responseTimers.set(channelId, timers);
}

function clearResponseTimer(channelId) {
  if (responseTimers.has(channelId)) { responseTimers.get(channelId).forEach(t => clearTimeout(t)); responseTimers.delete(channelId); }
}

async function notifyNoResponse(channelId, guildId, claimedBy, client, hours, tagAdmins) {
  try {
    const ticket = await query('SELECT * FROM ticket_logs WHERE channel_id=$1 AND status=\'open\' LIMIT 1', [channelId]);
    if (!ticket.rows.length) return;
    const cfg = await query('SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1', [guildId]);
    if (!cfg.rows.length || !cfg.rows[0].staff_notif_channel_id) return;
    const notifCh = await client.channels.fetch(cfg.rows[0].staff_notif_channel_id);
    let adminMention = '';
    if (tagAdmins) { const admins = await query('SELECT user_id FROM staff WHERE role IN (\'admin\',\'owner\') AND active=true', []); adminMention = ' ' + admins.rows.map(r => '<@' + r.user_id + '>').join(' '); }
    await notifCh.send('<a:atention:1512916995543273642> <@' + claimedBy + '> has not responded in <#' + channelId + '> for **' + hours + ' hour' + (hours > 1 ? 's' : '') + '**.' + adminMention);
  } catch (err) { console.error('[Tickets] Response notify failed:', err.message); }
}

function startMemberIdleTimers(channelOrThread, guildId, client) {
  const channelId = channelOrThread.id;
  clearMemberIdleTimers(channelId);
  const r1 = setTimeout(() => sendMemberReminder(channelId, client, 3),  3  * HR);
  const r2 = setTimeout(() => sendMemberReminder(channelId, client, 6),  6  * HR);
  const cl = setTimeout(() => autoCloseTicket(channelId, guildId, client), 12 * HR);
  activeTimers.set(channelId, { reminders: [r1, r2], closeTimer: cl });
}

function clearMemberIdleTimers(channelId) {
  if (activeTimers.has(channelId)) { const t = activeTimers.get(channelId); t.reminders.forEach(r => clearTimeout(r)); clearTimeout(t.closeTimer); activeTimers.delete(channelId); }
}

async function sendMemberReminder(channelId, client, hours) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    const ticketRes = await query('SELECT * FROM ticket_logs WHERE channel_id=$1 AND status=\'open\' LIMIT 1', [channelId]);
    if (!ticketRes.rows.length) return;
    const opener = ticketRes.rows[0].opened_by;
    const mention = opener && opener !== 'system' ? '<@' + opener + '>' : 'Hey there';
    await channel.send('<a:atention:1512916995543273642> ' + mention + ' please respond within the next ' + (12 - hours) + ' hours or this ticket will be automatically closed.');
  } catch (err) { console.error('[Tickets] Member reminder failed:', err.message); }
}

async function autoCloseTicket(channelId, guildId, client) {
  try {
    const ticketRes = await query('SELECT * FROM ticket_logs WHERE channel_id=$1 AND status=\'open\' LIMIT 1', [channelId]);
    if (!ticketRes.rows.length) return;
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    await channel.send('<a:atention:1512916995543273642> This ticket has been automatically closed due to 12 hours of inactivity.');
    if (channel.isThread && channel.isThread()) await channel.setArchived(true, 'Auto-closed due to inactivity');
    await query('UPDATE ticket_logs SET status=\'closed\', closed_at=NOW() WHERE channel_id=$1 AND status=\'open\'', [channelId]);
    clearMemberIdleTimers(channelId); clearResponseTimer(channelId); clearUnclaimedTimers(channelId);
    const cfg = await query('SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1', [guildId]);
    if (cfg.rows.length && cfg.rows[0].staff_notif_channel_id) {
      const notifCh = await client.channels.fetch(cfg.rows[0].staff_notif_channel_id);
      const t = ticketRes.rows[0];
      await notifCh.send('<a:atention:1512916995543273642> Ticket auto-closed (12hr inactivity). <#' + channelId + '> | Opened: <t:' + Math.floor(new Date(t.opened_at).getTime()/1000) + ':F>' + (t.claimed_by ? ' | Claimed by: <@' + t.claimed_by + '>' : ' | Unclaimed'));
    }
  } catch (err) { console.error('[Tickets] Auto-close failed:', err.message); }
}

async function handleChannelDelete(channel) {
  const isTicket = channel.name?.toLowerCase().includes('ticket');
  const parentIsTicket = channel.parent?.name?.toLowerCase().includes('ticket');
  if (!isTicket && !parentIsTicket) return;
  clearMemberIdleTimers(channel.id); clearResponseTimer(channel.id); clearUnclaimedTimers(channel.id);
  clearMemberIdleTimers(channel.id); clearResponseTimer(channel.id); clearUnclaimedTimers(channel.id);
  await query('UPDATE ticket_logs SET status=\'closed\', closed_at=NOW() WHERE channel_id=$1 AND status=\'open\'', [channel.id]);
}

module.exports = { handleTicketMessage, handleThreadCreate, handleChannelDelete, handleTicketClaim, handleTicketPayout };
