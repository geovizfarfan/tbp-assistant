const { query } = require('./database');

const ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;       // 24 hours of inactivity -> archive
const DELETE_AFTER_MS  = 7 * 24 * 60 * 60 * 1000;   // 1 week archived -> permanently delete

async function touchActivity(threadId) {
  // Reset both timers and un-archive if needed. Caller is responsible for actually
  // un-archiving the Discord thread itself if status was 'archived'.
  await query(
    "UPDATE private_rooms SET last_activity_at=NOW(), archived_at=NULL, status='active' WHERE thread_id=$1 AND status IN ('active','archived')",
    [threadId]
  );
}

async function checkInactiveRooms(client) {
  try {
    // Stage 1: archive rooms inactive for 24+ hours
    const archiveCutoff = new Date(Date.now() - ARCHIVE_AFTER_MS);
    const toArchive = await query(
      "SELECT * FROM private_rooms WHERE status='active' AND last_activity_at < $1",
      [archiveCutoff]
    );

    for (const room of toArchive.rows) {
      try {
        const thread = await client.channels.fetch(room.thread_id);
        await thread.setArchived(true, 'Private room inactive for 24+ hours');
      } catch (err) {
        console.error('[PrivateRooms] Could not archive thread', room.thread_id, '-', err.message);
      }
      await query("UPDATE private_rooms SET status='archived', archived_at=NOW() WHERE id=$1", [room.id]);
    }
    if (toArchive.rows.length) {
      console.log('[PrivateRooms] Archived', toArchive.rows.length, 'inactive room(s).');
    }

    // Stage 2: permanently delete rooms archived for 1+ week
    const deleteCutoff = new Date(Date.now() - DELETE_AFTER_MS);
    const toDelete = await query(
      "SELECT * FROM private_rooms WHERE status='archived' AND archived_at < $1",
      [deleteCutoff]
    );

    for (const room of toDelete.rows) {
      try {
        const thread = await client.channels.fetch(room.thread_id);
        await thread.delete('Private room archived for 1+ week with no activity');
      } catch (err) {
        console.error('[PrivateRooms] Could not delete thread', room.thread_id, '-', err.message);
      }
      await query("UPDATE private_rooms SET status='deleted' WHERE id=$1", [room.id]);
    }
    if (toDelete.rows.length) {
      console.log('[PrivateRooms] Permanently deleted', toDelete.rows.length, 'room(s).');
    }
  } catch (err) {
    console.error('[PrivateRooms] Cleanup check failed:', err.message);
  }
}

function startPrivateRoomCleanupLoop(client) {
  setInterval(() => checkInactiveRooms(client), 5 * 60 * 1000);
  console.log('[PrivateRooms] Cleanup loop started.');
}

module.exports = { touchActivity, checkInactiveRooms, startPrivateRoomCleanupLoop };
