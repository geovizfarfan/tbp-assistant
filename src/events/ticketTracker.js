const { query } = require('../utils/database');

/**
 * Called on messageCreate to track ticket response times.
 * Assumes ticket channels have "ticket" in their name.
 */
async function handleTicketMessage(message) {
  if (message.author.bot) return;

  const channel = message.channel;
  // Only track in ticket channels
  if (!channel.name?.toLowerCase().includes('ticket')) return;

  const guildId = message.guildId;

  // Check if ticket exists
  const existing = await query(
    `SELECT * FROM ticket_logs WHERE guild_id=$1 AND channel_id=$2 AND status='open' LIMIT 1`,
    [guildId, channel.id]
  );

  if (!existing.rows.length) {
    // New ticket detected
    await query(
      `INSERT INTO ticket_logs (guild_id, channel_id, opened_at, opened_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [guildId, channel.id, message.createdAt, message.author.id]
    );
    return;
  }

  const ticket = existing.rows[0];

  // If this is the first staff reply
  if (!ticket.first_staff_reply_at) {
    // Check if author is staff
    const staffRes = await query(
      `SELECT user_id FROM staff WHERE user_id=$1 AND active=true`,
      [message.author.id]
    );
    if (!staffRes.rows.length) return;

    const responseTimeMs = message.createdAt - new Date(ticket.opened_at);
    const responseMinutes = Math.floor(responseTimeMs / 60000);

    // Fetch requirements
    const reqRes = await query(`SELECT ticket_response_limit_minutes FROM pay_requirements WHERE guild_id=$1`, [guildId]);
    const limit = reqRes.rows[0]?.ticket_response_limit_minutes || 30;
    const isLate = responseMinutes > limit;

    await query(
      `UPDATE ticket_logs SET first_staff_reply_at=$1, first_staff_responder=$2, response_time_minutes=$3, late_response=$4
       WHERE id=$5`,
      [message.createdAt, message.author.id, responseMinutes, isLate, ticket.id]
    );
  }
}

/**
 * Called when a ticket channel is deleted (ticket closed).
 */
async function handleChannelDelete(channel) {
  if (!channel.name?.toLowerCase().includes('ticket')) return;
  await query(
    `UPDATE ticket_logs SET status='closed', closed_at=NOW() WHERE channel_id=$1 AND status='open'`,
    [channel.id]
  );
}

module.exports = { handleTicketMessage, handleChannelDelete };
