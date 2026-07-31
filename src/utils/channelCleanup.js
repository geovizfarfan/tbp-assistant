const { query } = require('./database');

// Compares every channel reference in the database against the guild's
// current live channel list, and clears anything pointing to a channel
// that's already gone. Covers the same tables/columns as the channelDelete
// listener in index.js — this is the one-time catch-up for channels that
// were deleted before that listener existed.
async function cleanupDeletedChannelRefs(guild) {
  const liveIds = new Set(guild.channels.cache.map(c => c.id));
  const gid = guild.id;
  let cleared = 0;

  async function cleanupTable(table, column) {
    const res = await query(`SELECT DISTINCT ${column} AS cid FROM ${table} WHERE guild_id=$1 AND ${column} IS NOT NULL`, [gid]);
    const staleIds = res.rows.map(r => r.cid).filter(cid => !liveIds.has(cid));
    for (const cid of staleIds) {
      const del = await query(`DELETE FROM ${table} WHERE guild_id=$1 AND ${column}=$2`, [gid, cid]);
      cleared += del.rowCount;
    }
  }

  async function cleanupColumn(table, column) {
    const res = await query(`SELECT ${column} AS cid FROM ${table} WHERE guild_id=$1 AND ${column} IS NOT NULL`, [gid]);
    const cid = res.rows[0]?.cid;
    if (cid && !liveIds.has(cid)) {
      await query(`UPDATE ${table} SET ${column}=NULL WHERE guild_id=$1`, [gid]);
      cleared++;
    }
  }

  await cleanupTable('rr_channel_config', 'channel_id');
  await cleanupTable('rumble_slaughter_config', 'channel_id');
  await cleanupTable('rr_season_channels', 'channel_id');
  await cleanupTable('sticky_messages', 'channel_id');
  await cleanupTable('custom_embeds', 'channel_id');
  await cleanupTable('level_excluded_channels', 'channel_id');
  await cleanupTable('pingpanel_sticky', 'channel_id');
  await cleanupTable('role_panels', 'channel_id');
  await cleanupTable('ticket_panels', 'channel_id');
  await cleanupTable('game_schedule_board', 'channel_id');

  await cleanupColumn('guild_config', 'winner_channel_id');
  await cleanupColumn('guild_config', 'ticket_channel_id');
  await cleanupColumn('guild_config', 'schedule_channel_id');
  await cleanupColumn('guild_config', 'staff_notif_channel_id');
  await cleanupColumn('guild_config', 'game_transcript_channel_id');
  await cleanupColumn('guild_config', 'ban_log_channel_id');
  await cleanupColumn('ticket_config', 'category_id');
  await cleanupColumn('ticket_config', 'transcript_channel_id');
  await cleanupColumn('ticket_config', 'staff_channel_id');
  await cleanupColumn('level_config', 'levelup_channel_id');
  await cleanupColumn('rr_guild_config', 'log_channel_id');
  await cleanupColumn('rr_guild_config', 'achievement_log_channel_id');
  await cleanupColumn('verify_config', 'rules_channel_id');
  await cleanupColumn('verify_config', 'captcha_channel_id');
  await cleanupColumn('verify_config', 'welcome_channel_id');
  await cleanupColumn('shop_config', 'shop_channel_id');
  await cleanupColumn('shop_config', 'fulfillment_channel_id');
  await cleanupColumn('grind_config', 'panel_channel_id');

  return cleared;
}

// Same idea as cleanupDeletedChannelRefs, but for roles. rr_channel_config and
// rumble_slaughter_config have one row PER CHANNEL (not one per guild), so
// those need every row checked individually rather than just the first.
async function cleanupDeletedRoleRefs(guild) {
  const liveIds = new Set(guild.roles.cache.map(r => r.id));
  const gid = guild.id;
  let cleared = 0;

  async function cleanupTable(table, column) {
    const res = await query(`SELECT DISTINCT ${column} AS rid FROM ${table} WHERE guild_id=$1 AND ${column} IS NOT NULL`, [gid]);
    const staleIds = res.rows.map(r => r.rid).filter(rid => !liveIds.has(rid));
    for (const rid of staleIds) {
      const del = await query(`DELETE FROM ${table} WHERE guild_id=$1 AND ${column}=$2`, [gid, rid]);
      cleared += del.rowCount;
    }
  }

  async function cleanupColumn(table, column) {
    const res = await query(`SELECT ${column} AS rid FROM ${table} WHERE guild_id=$1 AND ${column} IS NOT NULL`, [gid]);
    const rid = res.rows[0]?.rid;
    if (rid && !liveIds.has(rid)) {
      await query(`UPDATE ${table} SET ${column}=NULL WHERE guild_id=$1`, [gid]);
      cleared++;
    }
  }

  // Multi-row-per-guild tables — check every row's role columns individually.
  async function cleanupMultiRow(table, columns) {
    const res = await query(`SELECT * FROM ${table} WHERE guild_id=$1`, [gid]);
    for (const row of res.rows) {
      const updates = {};
      for (const col of columns) {
        if (row[col] && !liveIds.has(row[col])) updates[col] = null;
      }
      if (Object.keys(updates).length) {
        const setClauses = Object.keys(updates).map((c, i) => `${c}=$${i + 3}`).join(', ');
        await query(`UPDATE ${table} SET ${setClauses} WHERE guild_id=$1 AND channel_id=$2`,
          [gid, row.channel_id, ...Object.values(updates)]);
        cleared += Object.keys(updates).length;
      }
    }
  }

  await cleanupTable('giveaway_bonus_roles', 'role_id');
  await cleanupTable('giveaway_required_roles', 'role_id');
  await cleanupTable('wheel_role_bonuses', 'role_id');
  await cleanupTable('role_panel_options', 'role_id');
  await cleanupTable('pingpanel_sticky', 'role_id');

  await cleanupColumn('guild_config', 'admin_role_id');
  await cleanupColumn('guild_config', 'mod_role_id');
  await cleanupColumn('guild_config', 'game_ping_role_id');
  await cleanupColumn('verify_config', 'verified_role_id');
  await cleanupColumn('ticket_config', 'staff_role_id');
  await cleanupColumn('goosdate_config', 'role_id');
  await cleanupColumn('grind_config', 'role_id');

  // shop_items: null the role_id on affected items rather than deleting the
  // item itself (would lose the name/price/etc for something still purchasable).
  const shopRes = await query(`SELECT id, role_id FROM shop_items WHERE guild_id=$1 AND role_id IS NOT NULL`, [gid]);
  for (const item of shopRes.rows) {
    if (!liveIds.has(item.role_id)) {
      await query(`UPDATE shop_items SET role_id=NULL WHERE id=$1`, [item.id]);
      cleared++;
    }
  }

  await cleanupMultiRow('rr_channel_config', ['winner_role_id', 'ping_role1_id', 'ping_role2_id', 'ping_role3_id']);
  await cleanupMultiRow('rumble_slaughter_config', ['winner_role_id', 'ping_role_id', 'ping_role2_id', 'ping_role3_id']);

  return cleared;
}

module.exports = { cleanupDeletedChannelRefs, cleanupDeletedRoleRefs };
