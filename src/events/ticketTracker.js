const { query } = require('../utils/database');

async function handleThreadCreate(thread, client) {
  const parent = thread.parent;
  if (!parent) return;
  const isTicket = parent.name?.toLowerCase().includes('ticket') || thread.name?.toLowerCase().includes('ticket');
  if (!isTicket) return;

  const guildId = thread.guildId;
  await query(
    `INSERT INTO ticket_logs (guild_id, channel_id, opened_at, opened_by, status)
     VALUES ($1,$2,$3,$4,'open') ON CONFLICT DO NOTHING`,
    [guildId, thread.id, new Date(), 'system']
  );

  console.log(`[Tickets] New ticket: ${thread.name}`);

  // 1hr reminder if no staff has responded
  setTimeout(async () => {
    try {
      const ticket = await query(
        `SELECT * FROM ticket_logs WHERE channel_id=$1 AND status='open' LIMIT 1`,
        [thread.id]
      );
      if (!ticket.rows.length) return;
      if (ticket.rows[0].first_staff_reply_at) return;

      const cfg = await query(
        `SELECT staff_notif_channel_id, mod_role_id FROM guild_config WHERE guild_id=$1`,
        [guildId]
      );
      if (!cfg.rows.length || !cfg.rows[0].staff_notif_channel_id) return;

      const notifCh = await client.channels.fetch(cfg.rows[0].staff_notif_channel_id);
      const modMention = cfg.rows[0].mod_role_id ? `<@&${cfg.rows[0].mod_role_id}>` : '';
      const jumpLink = `https://discord.com/channels/${guildId}/${thread.id}`;
      await notifCh.send(`<a:atention:1512916995543273642> Ticket <#${thread.id}> has had no staff response for **1 hour**. [Jump to ticket](${jumpLink})${modMention ? ' ' + modMention : ''} `);
    } catch (err) {
      console.error('[Tickets] 1hr reminder failed:', err.message);
    }
  }, 60 * 60 * 1000);
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

  const staffRes = await query(
    `SELECT user_id FROM staff WHERE user_id=$1 AND active=true`,
    [message.author.id]
  );
  const isSenderStaff = staffRes.rows.length > 0;

  if (!isSenderStaff) return;

  // Log first staff reply time
  const ticketRes = await query(
    `SELECT * FROM ticket_logs WHERE guild_id=$1 AND channel_id=$2 AND status='open' LIMIT 1`,
    [guildId, channelId]
  );
  if (!ticketRes.rows.length) return;
  const ticket = ticketRes.rows[0];

  if (!ticket.first_staff_reply_at) {
    const responseMinutes = Math.floor((message.createdAt - new Date(ticket.opened_at)) / 60000);
    await query(
      `UPDATE ticket_logs SET first_staff_reply_at=$1, first_staff_responder=$2, response_time_minutes=$3 WHERE id=$4`,
      [message.createdAt, message.author.id, responseMinutes, ticket.id]
    );
  }
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
