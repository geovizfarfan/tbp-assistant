const { query } = require('./database');

// EDT (March-October, roughly) — times in America/New_York local clock time, HH:MM 24hr.
const EDT_TIMES = [
  '15:19', '16:02', '16:20', '17:12', '17:21', '18:22', '19:23', '19:32',
  '20:00', '21:01', '21:11', '22:02', '22:22', '23:03', '23:33', '00:04',
  '00:44', '01:05', '01:55', '02:06', '03:07', '04:08', '05:09', '06:01',
  '06:10', '07:11', '08:12', '08:21', '09:13', '09:31', '09:37', '10:14',
  '10:41', '11:15', '11:51', '12:16', '13:17', '14:18',
];

// EST (October-March, roughly) — times in America/New_York local clock time, HH:MM 24hr.
const EST_TIMES = [
  '14:19', '15:02', '15:20', '16:12', '16:21', '17:22', '18:23', '18:32',
  '19:00', '20:01', '20:11', '21:02', '21:22', '22:03', '22:33', '23:04',
  '23:44', '00:05', '00:55', '01:06', '02:07', '03:08', '04:09', '05:01',
  '05:10', '06:11', '07:12', '07:21', '08:13', '08:31', '08:37', '09:14',
  '09:41', '10:15', '10:51', '11:16', '12:17', '13:18',
];

/**
 * Determines whether America/New_York is currently observing daylight time (EDT)
 * by comparing the UTC offset string Intl reports for "now".
 */
function isCurrentlyEDT() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  }).formatToParts(now);
  const tzPart = parts.find(p => p.type === 'timeZoneName');
  return tzPart && tzPart.value === 'EDT';
}

function getActiveSchedule() {
  return isCurrentlyEDT() ? EDT_TIMES : EST_TIMES;
}

function getCurrentNYTimeKey() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = parts.find(p => p.type === 'hour').value;
  const minute = parts.find(p => p.type === 'minute').value;
  return `${hour}:${minute}`;
}

function getCurrentNYDateKey() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

async function checkGoosDate(client) {
  try {
    const cfgRes = await query(`SELECT * FROM goosdate_config WHERE enabled=true`);
    if (!cfgRes.rows.length) return;

    const currentTime = getCurrentNYTimeKey();
    const schedule = getActiveSchedule();
    if (!schedule.includes(currentTime)) return;

    const dateKey = getCurrentNYDateKey();
    const minuteKey = `${dateKey}-${currentTime}`;

    for (const cfg of cfgRes.rows) {
      if (cfg.last_sent_minute_key === minuteKey) continue; // already sent this exact slot

      try {
        const channel = await client.channels.fetch(cfg.channel_id);
        await channel.send({
          content: `<@&${cfg.role_id}>`,
          embeds: [{
            description:
              '## <a:purplesparkle:1512912828489793626><:bullet1:1520457476032561285> GOOS DATE <:bullet1:1520457476032561285><a:purplesparkle:1512912828489793626>\n' +
              'ᴛʏᴘᴇ ?ᴅᴀᴛᴇ ᴛᴏ ᴄʟᴀɪᴍ ʏᴏᴜʀ ɢᴏᴏs ᴡɪᴛʜɪɴ 1 ᴍɪɴᴜᴛᴇ! <a:goosrotate:1520470791806914570>',
            color: 0x7F36F5,
          }],
        });
        await query(`UPDATE goosdate_config SET last_sent_minute_key=$1 WHERE guild_id=$2`, [minuteKey, cfg.guild_id]);
        console.log('[GoosDate] Sent reminder for', cfg.guild_id, 'at', minuteKey);
      } catch (err) {
        console.error('[GoosDate] Failed to send for guild', cfg.guild_id, '-', err.message);
      }
    }
  } catch (err) {
    console.error('[GoosDate] Check failed:', err.message);
  }
}

function startGoosDateLoop(client) {
  setInterval(() => checkGoosDate(client), 30 * 1000); // check every 30s for minute-precision firing
  console.log('[GoosDate] Reminder loop started.');
}

module.exports = { startGoosDateLoop, checkGoosDate };
