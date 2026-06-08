const { query } = require('../utils/database');

async function handleTicketMessage(message) {
  if (message.author.bot) return;
  const channel = message.channel;
  const isThread = channel.isThread && channel.isThread();
  const parent = isThread ? channel.parent : channel;
  if (!parent) return;
  const isTicketChannel = parent.name?.toLowerCase().includes('ticket') || channel.name?.toLowerCase().includes('ticket');
  if (!isTicketChannel) return;

  const guildId = message.guildId;
  const channelId = channel.id;

  const existing = await query(
    `SELECT * FROM ticket_logs WHERE guild_id=$1 AND channel_id=$2 AND status='open' LIMIT 1`,
    [guildId, channelId]
  );

  if (!existing.rows.length) {
    await query(
      `INSERT INTO ticket_logs (guild_id, channel_id, opened_at, opened_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [guildId, channelId, message.createdAt, message.author.id]
    );
    return;
  }

  const ticket = existing.rows[0];
  if (!ticket.first_staff_reply_at) {
    const staffRes = await query(
      `SELECT user_id FROM staff WHERE user_id=$1 AND active=true`,
      [message.author.id]
    );
    if (!staffRes.rows.length) return;

    const responseTimeMs = message.createdAt - new Date(ticket.opened_at);
    const responseMinutes = Math.floor(responseTimeMs / 60000);
    const reqRes = await query(`SELECT ticket_response_limit_minutes FROM pay_requirements WHERE guild_id=$1`, [guildId]);
    const limit = reqRes.rows[0]?.ticket_response_limit_minutes || 30;
    const isLate = responseMinutes > limit;

    await query(
      `UPDATE ticket_logs SET first_staff_reply_at=$1, first_staff_responder=$2, response_time_minutes=$3, late_response=$4 WHERE id=$5`,
      [message.createdAt, message.author.id, responseMinutes, isLate, ticket.id]
    );
  }
}

async function handleThreadCreate(thread) {
  const parent = thread.parent;
  if (!parent) return;
  const isTicketChannel = parent.name?.toLowerCase().includes('ticket') || thread.name?.toLowerCase().includes('ticket');
  if (!isTicketChannel) return;

  await query(
    `INSERT INTO ticket_logs (guild_id, channel_id, opened_at, opened_by)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [thread.guildId, thread.id, new Date(), 'system']
  );
  console.log(`[Tickets] Thread ticket opened: ${thread.name}`);
}

async function handleChannelDelete(channel) {
  const isTicket = channel.name?.toLowerCase().includes('ticket');
  const parentIsTicket = channel.parent?.name?.toLowerCase().includes('ticket');
  if (!isTicket && !parentIsTicket) return;
  await query(
    `UPDATE ticket_logs SET status='closed', closed_at=NOW() WHERE channel_id=$1 AND status='open'`,
    [channel.id]
  );
}

module.exports = { handleTicketMessage, handleThreadCreate, handleChannelDelete };
