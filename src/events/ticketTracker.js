const { query } = require('../utils/database');

// Active ticket timers: channelId -> { reminders: [timeoutId], closeTimer: timeoutId }
const activeTimers = new Map();

async function handleThreadCreate(thread, client) {
  const parent = thread.parent;
  if (!parent) return;
  const isTicket = parent.name?.toLowerCase().includes('ticket') || thread.name?.toLowerCase().includes('ticket');
  if (!isTicket) return;

  const guildId = thread.guildId;
  const now = new Date();

  await query(
    `INSERT INTO ticket_logs (guild_id, channel_id, opened_at, opened_by)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [guildId, thread.id, now, 'system']
  );

  console.log(`[Tickets] New ticket thread: ${thread.name}`);
  startIdleTimers(thread, guildId, client);
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

  // Check if sender is staff
  const staffRes = await query(
    `SELECT user_id FROM staff WHERE user_id=$1 AND active=true`,
    [message.author.id]
  );
  const isSenderStaff = staffRes.rows.length > 0;

  // Get or create ticket log
  let ticketRes = await query(
    `SELECT * FROM ticket_logs WHERE guild_id=$1 AND channel_id=$2 AND status='open' LIMIT 1`,
    [guildId, channelId]
  );

  if (!ticketRes.rows.length) {
    await query(
      `INSERT INTO ticket_logs (guild_id, channel_id, opened_at, opened_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [guildId, channelId, message.createdAt, message.author.id]
    );
    ticketRes = await query(
      `SELECT * FROM ticket_logs WHERE guild_id=$1 AND channel_id=$2 AND status='open' LIMIT 1`,
      [guildId, channelId]
    );
  }

  const ticket = ticketRes.rows[0];
  if (!ticket) return;

  if (isSenderStaff) {
    // Staff replied — log first response time if not already set
    if (!ticket.first_staff_reply_at) {
      const responseTimeMs = message.createdAt - new Date(ticket.opened_at);
      const responseMinutes = Math.floor(responseTimeMs / 60000);
      const reqRes = await query(`SELECT ticket_response_limit_minutes FROM pay_requirements WHERE guild_id=$1`, [guildId]);
      const limit = reqRes.rows[0]?.ticket_response_limit_minutes || 30;
      await query(
        `UPDATE ticket_logs SET first_staff_reply_at=$1, first_staff_responder=$2, response_time_minutes=$3, late_response=$4 WHERE id=$5`,
        [message.createdAt, message.author.id, responseMinutes, responseMinutes > limit, ticket.id]
      );
    }
  } else {
    // Member replied — reset idle timers
    if (activeTimers.has(channelId)) {
      const timers = activeTimers.get(channelId);
      timers.reminders.forEach(t => clearTimeout(t));
      clearTimeout(timers.closeTimer);
      activeTimers.delete(channelId);
    }
    // Restart idle timers since member just replied (staff needs to respond again)
    startIdleTimers(channel, guildId, message.client);
  }
}

function startIdleTimers(channelOrThread, guildId, client) {
  const channelId = channelOrThread.id;

  // Clear any existing timers
  if (activeTimers.has(channelId)) {
    const old = activeTimers.get(channelId);
    old.reminders.forEach(t => clearTimeout(t));
    clearTimeout(old.closeTimer);
  }

  const HR = 60 * 60 * 1000;

  const r1 = setTimeout(() => sendIdleReminder(channelId, guildId, client, 3), 3 * HR);
  const r2 = setTimeout(() => sendIdleReminder(channelId, guildId, client, 6), 6 * HR);
  const close = setTimeout(() => autoCloseTicket(channelId, guildId, client), 12 * HR);

  activeTimers.set(channelId, { reminders: [r1, r2], closeTimer: close });
}

async function sendIdleReminder(channelId, guildId, client, hours) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    const ticketRes = await query(
      `SELECT * FROM ticket_logs WHERE channel_id=$1 AND status='open' LIMIT 1`,
      [channelId]
    );
    if (!ticketRes.rows.length) return;
    const opener = ticketRes.rows[0].opened_by;
    const mention = opener && opener !== 'system' ? `<@${opener}>` : 'Hey there';
    await channel.send(`${mention} Just a reminder — please respond to this ticket within the next ${12 - hours} hours or it will be automatically closed.`);
  } catch (err) {
    console.error(`[Tickets] Reminder failed for ${channelId}:`, err.message);
  }
}

async function autoCloseTicket(channelId, guildId, client) {
  try {
    const ticketRes = await query(
      `SELECT * FROM ticket_logs WHERE channel_id=$1 AND status='open' LIMIT 1`,
      [channelId]
    );
    if (!ticketRes.rows.length) return;

    const channel = await client.channels.fetch(channelId);
    if (!channel) return;

    await channel.send('This ticket has been automatically closed due to 12 hours of inactivity.');

    // Archive/lock the thread
    if (channel.isThread && channel.isThread()) {
      await channel.setArchived(true, 'Auto-closed due to inactivity');
    }

    await query(
      `UPDATE ticket_logs SET status='closed', closed_at=NOW() WHERE channel_id=$1 AND status='open'`,
      [channelId]
    );

    activeTimers.delete(channelId);

    // Notify staff channel
    const configRes = await query(`SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1`, [guildId]);
    if (configRes.rows.length && configRes.rows[0].staff_notif_channel_id) {
      const notifChannel = await client.channels.fetch(configRes.rows[0].staff_notif_channel_id);
      const ticket = ticketRes.rows[0];
      await notifChannel.send(`Ticket auto-closed due to 12hrs inactivity. Thread: <#${channelId}> | Opened: <t:${Math.floor(new Date(ticket.opened_at).getTime()/1000)}:F>`);
    }
  } catch (err) {
    console.error(`[Tickets] Auto-close failed for ${channelId}:`, err.message);
  }
}

async function handleChannelDelete(channel) {
  const isTicket = channel.name?.toLowerCase().includes('ticket');
  const parentIsTicket = channel.parent?.name?.toLowerCase().includes('ticket');
  if (!isTicket && !parentIsTicket) return;
  if (activeTimers.has(channel.id)) {
    const timers = activeTimers.get(channel.id);
    timers.reminders.forEach(t => clearTimeout(t));
    clearTimeout(timers.closeTimer);
    activeTimers.delete(channel.id);
  }
  await query(
    `UPDATE ticket_logs SET status='closed', closed_at=NOW() WHERE channel_id=$1 AND status='open'`,
    [channel.id]
  );
}

module.exports = { handleTicketMessage, handleThreadCreate, handleChannelDelete };
