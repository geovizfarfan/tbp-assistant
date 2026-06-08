const { query } = require('../utils/database');

const activeTimers = new Map();
const staffIdleTimers = new Map();

async function handleThreadCreate(thread, client) {
  const parent = thread.parent;
  if (!parent) return;
  const isTicket = parent.name?.toLowerCase().includes('ticket') || thread.name?.toLowerCase().includes('ticket');
  if (!isTicket) return;
  await query(
    `INSERT INTO ticket_logs (guild_id, channel_id, opened_at, opened_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [thread.guildId, thread.id, new Date(), 'system']
  );
  startMemberIdleTimers(thread, thread.guildId, client);
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

  const staffRes = await query(`SELECT user_id FROM staff WHERE user_id=$1 AND active=true`, [message.author.id]);
  const isSenderStaff = staffRes.rows.length > 0;

  let ticketRes = await query(`SELECT * FROM ticket_logs WHERE guild_id=$1 AND channel_id=$2 AND status='open' LIMIT 1`, [guildId, channelId]);
  if (!ticketRes.rows.length) {
    await query(`INSERT INTO ticket_logs (guild_id, channel_id, opened_at, opened_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [guildId, channelId, message.createdAt, message.author.id]);
    ticketRes = await query(`SELECT * FROM ticket_logs WHERE guild_id=$1 AND channel_id=$2 AND status='open' LIMIT 1`, [guildId, channelId]);
  }
  const ticket = ticketRes.rows[0];
  if (!ticket) return;

  if (isSenderStaff) {
    if (!ticket.first_staff_reply_at) {
      const responseMs = message.createdAt - new Date(ticket.opened_at);
    const responseMinutes = Math.floor(responseMs / 60000);
    const responseHrs = Math.floor(responseMinutes / 60);
    const responseRem = responseMinutes % 60;
    const responseStr = responseHrs > 0
      ? (responseRem > 0 ? `${responseHrs}h ${responseRem}m` : `${responseHrs}h`)
      : `${responseMinutes}m`;
      const reqRes = await query(`SELECT ticket_response_limit_minutes FROM pay_requirements WHERE guild_id=$1`, [guildId]);
      const limit = reqRes.rows[0]?.ticket_response_limit_minutes || 30;
      const isLate = responseMinutes > limit;
      await query(`UPDATE ticket_logs SET first_staff_reply_at=$1, first_staff_responder=$2, response_time_minutes=$3, late_response=$4 WHERE id=$5`, [message.createdAt, message.author.id, responseMinutes, isLate, ticket.id]);
      if (isLate) {
        try {
          const cfg = await query(`SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1`, [guildId]);
          if (cfg.rows.length && cfg.rows[0].staff_notif_channel_id) {
            const notifCh = await message.client.channels.fetch(cfg.rows[0].staff_notif_channel_id);
            await notifCh.send(`<a:atention:1512916995543273642> <@${message.author.id}> took **${responseStr}** to respond in <#${channelId}> (limit: ${limit} min).`);
          }
        } catch {}
      }
    }
    clearStaffIdleTimers(channelId);
  } else {
    clearMemberIdleTimers(channelId);
    startMemberIdleTimers(channel, guildId, message.client);
    startStaffIdleTimers(channelId, guildId, message.client);
  }
}

function startStaffIdleTimers(channelId, guildId, client) {
  clearStaffIdleTimers(channelId);
  const HR = 60 * 60 * 1000;
  const r1 = setTimeout(() => notifyStaffIdle(channelId, guildId, client, 2, false), 2 * HR);
  const r2 = setTimeout(() => notifyStaffIdle(channelId, guildId, client, 6, true), 6 * HR);
  staffIdleTimers.set(channelId, [r1, r2]);
}

function clearStaffIdleTimers(channelId) {
  if (staffIdleTimers.has(channelId)) {
    staffIdleTimers.get(channelId).forEach(t => clearTimeout(t));
    staffIdleTimers.delete(channelId);
  }
}

async function notifyStaffIdle(channelId, guildId, client, hours, tagAdmins) {
  try {
    const cfg = await query(`SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1`, [guildId]);
    if (!cfg.rows.length || !cfg.rows[0].staff_notif_channel_id) return;
    const notifCh = await client.channels.fetch(cfg.rows[0].staff_notif_channel_id);
    let adminMention = '';
    if (tagAdmins) {
      const admins = await query(`SELECT user_id FROM staff WHERE role IN ('admin','owner') AND active=true`, []);
      adminMention = admins.rows.map(r => `<@${r.user_id}>`).join(' ');
    }
    await notifCh.send(`<a:atention:1512916995543273642> A member in <#${channelId}> has not received a staff response in **${hours} hours**.${adminMention ? ' ' + adminMention : ''}`);
  } catch (err) {
    console.error('[Tickets] Staff idle notify failed:', err.message);
  }
}

function startMemberIdleTimers(channelOrThread, guildId, client) {
  const channelId = channelOrThread.id;
  clearMemberIdleTimers(channelId);
  const HR = 60 * 60 * 1000;
  const r1 = setTimeout(() => sendMemberReminder(channelId, client, 3), 3 * HR);
  const r2 = setTimeout(() => sendMemberReminder(channelId, client, 6), 6 * HR);
  const close = setTimeout(() => autoCloseTicket(channelId, guildId, client), 12 * HR);
  activeTimers.set(channelId, { reminders: [r1, r2], closeTimer: close });
}

function clearMemberIdleTimers(channelId) {
  if (activeTimers.has(channelId)) {
    const t = activeTimers.get(channelId);
    t.reminders.forEach(r => clearTimeout(r));
    clearTimeout(t.closeTimer);
    activeTimers.delete(channelId);
  }
}

async function sendMemberReminder(channelId, client, hours) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    const ticketRes = await query(`SELECT * FROM ticket_logs WHERE channel_id=$1 AND status='open' LIMIT 1`, [channelId]);
    if (!ticketRes.rows.length) return;
    const opener = ticketRes.rows[0].opened_by;
    const mention = opener && opener !== 'system' ? `<@${opener}>` : 'Hey there';
    await channel.send(`<a:atention:1512916995543273642> ${mention} please respond within the next ${12 - hours} hours or this ticket will be automatically closed.`);
  } catch (err) {
    console.error('[Tickets] Member reminder failed:', err.message);
  }
}

async function autoCloseTicket(channelId, guildId, client) {
  try {
    const ticketRes = await query(`SELECT * FROM ticket_logs WHERE channel_id=$1 AND status='open' LIMIT 1`, [channelId]);
    if (!ticketRes.rows.length) return;
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    await channel.send('<a:atention:1512916995543273642> This ticket has been automatically closed due to 12 hours of inactivity.');
    if (channel.isThread && channel.isThread()) await channel.setArchived(true, 'Auto-closed due to inactivity');
    await query(`UPDATE ticket_logs SET status='closed', closed_at=NOW() WHERE channel_id=$1 AND status='open'`, [channelId]);
    clearMemberIdleTimers(channelId);
    clearStaffIdleTimers(channelId);
    const cfg = await query(`SELECT staff_notif_channel_id FROM guild_config WHERE guild_id=$1`, [guildId]);
    if (cfg.rows.length && cfg.rows[0].staff_notif_channel_id) {
      const notifCh = await client.channels.fetch(cfg.rows[0].staff_notif_channel_id);
      const t = ticketRes.rows[0];
      await notifCh.send(`<a:atention:1512916995543273642> Ticket auto-closed (12hr inactivity). <#${channelId}> | Opened: <t:${Math.floor(new Date(t.opened_at).getTime()/1000)}:F>`);
    }
  } catch (err) {
    console.error('[Tickets] Auto-close failed:', err.message);
  }
}

async function handleChannelDelete(channel) {
  const isTicket = channel.name?.toLowerCase().includes('ticket');
  const parentIsTicket = channel.parent?.name?.toLowerCase().includes('ticket');
  if (!isTicket && !parentIsTicket) return;
  clearMemberIdleTimers(channel.id);
  clearStaffIdleTimers(channel.id);
  await query(`UPDATE ticket_logs SET status='closed', closed_at=NOW() WHERE channel_id=$1 AND status='open'`, [channel.id]);
}

module.exports = { handleTicketMessage, handleThreadCreate, handleChannelDelete };
