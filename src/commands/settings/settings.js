const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { baseEmbed, COLORS } = require('../../utils/embeds');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure bot settings for this server')
    .addSubcommand(sub => sub
      .setName('channels')
      .setDescription('Set key channels for this server')
      .addChannelOption(o => o.setName('schedule').setDescription('Game schedule board channel').setRequired(false))
      .addChannelOption(o => o.setName('winners').setDescription('Winner announcements channel').setRequired(false))
      .addChannelOption(o => o.setName('ticket').setDescription('Ticket channel').setRequired(false))
      .addChannelOption(o => o.setName('staff_notif').setDescription('Staff notifications channel').setRequired(false))
      .addChannelOption(o => o.setName('boost').setDescription('Server boost announcement channel').setRequired(false))
      .addChannelOption(o => o.setName('transcript').setDescription('Game transcripts channel').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('roles')
      .setDescription('Set key roles for this server')
      .addRoleOption(o => o.setName('mod').setDescription('Mod role (ticket 1hr/3hr pings)').setRequired(false))
      .addRoleOption(o => o.setName('admin').setDescription('Admin role (ticket 6hr/12hr pings)').setRequired(false))
      .addRoleOption(o => o.setName('game_ping').setDescription('Game ping role (new game/raffle alerts)').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('timezone')
      .setDescription('Set the server timezone for daily goal resets')
      .addStringOption(o => o.setName('timezone').setDescription('e.g. America/New_York, Europe/London').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('requirements')
      .setDescription('Set staff pay requirements for this server')
      .addIntegerOption(o => o.setName('min_games').setDescription('Min games per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_auto_games').setDescription('Min auto-games per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_raffles').setDescription('Min raffles per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_giveaways').setDescription('Min giveaways per period').setRequired(false))
      .addIntegerOption(o => o.setName('max_late_payouts').setDescription('Max late payouts allowed').setRequired(false))
      .addIntegerOption(o => o.setName('bonus_per_game').setDescription('Bonus currency per game hosted').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('daily-goals')
      .setDescription('Set daily goals per staff role')
      .addStringOption(o => o.setName('role').setDescription('Staff role').setRequired(true)
        .addChoices(
          { name: 'Owner',       value: 'owner'       },
          { name: 'Admin',       value: 'admin'       },
          { name: 'Mod',         value: 'staff'       },
          { name: 'Host',        value: 'host'        },
          { name: 'Rumble Host', value: 'rumble_host' },
        ))
      .addIntegerOption(o => o.setName('games').setDescription('Daily games goal').setRequired(false))
      .addIntegerOption(o => o.setName('autogames').setDescription('Daily auto-games goal').setRequired(false))
      .addIntegerOption(o => o.setName('payouts').setDescription('Daily payouts goal').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('claim-time')
      .setDescription('Set how long winners have to claim their prize')
      .addIntegerOption(o => o.setName('default').setDescription('Hours for regular winners (default: 6)').setRequired(false))
      .addIntegerOption(o => o.setName('booster').setDescription('Hours for boosters (default: 12)').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('goosdate')
      .setDescription('Configure Goos Date reminder channel and role')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post reminders in').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to ping').setRequired(true))
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable reminders?').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('summary')
      .setDescription('View all current server settings at a glance')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'channels')    return setChannels(interaction);
    if (sub === 'roles')       return setRoles(interaction);
    if (sub === 'timezone')    return setTimezone(interaction);
    if (sub === 'requirements') return setRequirements(interaction);
    if (sub === 'daily-goals') return setDailyGoals(interaction);
    if (sub === 'claim-time')  return setClaimTime(interaction);
    if (sub === 'goosdate')    return setGoosdate(interaction);
    if (sub === 'summary')     return summary(interaction);
  },
};

async function setChannels(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const schedule  = interaction.options.getChannel('schedule');
  const winners   = interaction.options.getChannel('winners');
  const ticket    = interaction.options.getChannel('ticket');
  const staffNotif = interaction.options.getChannel('staff_notif');
  const boost      = interaction.options.getChannel('boost');
  const transcript = interaction.options.getChannel('transcript');
  if (!schedule && !winners && !ticket && !staffNotif && !transcript && !boost) {
    return interaction.editReply({ content: e('wrong') + ' Please provide at least one channel.' });
  }
  await query(
    `INSERT INTO guild_config (guild_id, schedule_channel_id, winner_channel_id, ticket_channel_id, staff_notif_channel_id, game_transcript_channel_id, boost_channel_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (guild_id) DO UPDATE SET
       schedule_channel_id        = COALESCE($2, guild_config.schedule_channel_id),
       winner_channel_id          = COALESCE($3, guild_config.winner_channel_id),
       ticket_channel_id          = COALESCE($4, guild_config.ticket_channel_id),
       staff_notif_channel_id     = COALESCE($5, guild_config.staff_notif_channel_id),
       boost_channel_id           = COALESCE($7, guild_config.boost_channel_id),
       game_transcript_channel_id = COALESCE($6, guild_config.game_transcript_channel_id),
       updated_at = NOW()`,
    [interaction.guildId, schedule?.id||null, winners?.id||null, ticket?.id||null, staffNotif?.id||null, transcript?.id||null, boost?.id||null]
  );
  const lines = [];
  if (schedule)    lines.push(e('checkmark') + ' Game schedule board → <#' + schedule.id + '>');
  if (winners)     lines.push(e('checkmark') + ' Winner announcements → <#' + winners.id + '>');
  if (boost)       lines.push(e('checkmark') + ' Boost announcements → <#' + boost.id + '>');
  if (ticket)      lines.push(e('checkmark') + ' Ticket channel → <#' + ticket.id + '>');
  if (staffNotif)  lines.push(e('checkmark') + ' Staff notifications → <#' + staffNotif.id + '>');
  if (transcript)  lines.push(e('checkmark') + ' Game transcripts → <#' + transcript.id + '>');
  await interaction.editReply({ content: lines.join('\n') });
}

async function setRoles(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const mod      = interaction.options.getRole('mod');
  const admin    = interaction.options.getRole('admin');
  const gamePing = interaction.options.getRole('game_ping');
  if (!mod && !admin && !gamePing) {
    return interaction.editReply({ content: e('wrong') + ' Please provide at least one role.' });
  }
  await query(
    `INSERT INTO guild_config (guild_id, mod_role_id, admin_role_id, game_ping_role_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id) DO UPDATE SET
       mod_role_id       = COALESCE($2, guild_config.mod_role_id),
       admin_role_id     = COALESCE($3, guild_config.admin_role_id),
       game_ping_role_id = COALESCE($4, guild_config.game_ping_role_id),
       updated_at = NOW()`,
    [interaction.guildId, mod?.id||null, admin?.id||null, gamePing?.id||null]
  );
  const lines = [];
  if (mod)      lines.push(e('checkmark') + ' Mod role → <@&' + mod.id + '>');
  if (admin)    lines.push(e('checkmark') + ' Admin role → <@&' + admin.id + '>');
  if (gamePing) lines.push(e('checkmark') + ' Game ping role → <@&' + gamePing.id + '>');
  await interaction.editReply({ content: lines.join('\n') });
}

async function setTimezone(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const timezone = interaction.options.getString('timezone');
  await query(
    `INSERT INTO guild_config (guild_id, timezone) VALUES ($1,$2)
     ON CONFLICT (guild_id) DO UPDATE SET timezone=$2, updated_at=NOW()`,
    [interaction.guildId, timezone]
  );
  await interaction.editReply({ content: e('checkmark') + ' Timezone set to **' + timezone + '**.' });
}

async function setRequirements(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const fields = {
    min_games:      interaction.options.getInteger('min_games'),
    min_rumble:     interaction.options.getInteger('min_auto_games'),
    min_raffles:    interaction.options.getInteger('min_raffles'),
    min_giveaways:  interaction.options.getInteger('min_giveaways'),
    max_late_payouts: interaction.options.getInteger('max_late_payouts'),
    bonus_per_game: interaction.options.getInteger('bonus_per_game'),
  };
  const setClauses = [];
  const vals = [interaction.guildId];
  let idx = 2;
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null) { setClauses.push(k + '=$' + idx++); vals.push(v); }
  }
  if (setClauses.length === 0) return interaction.editReply({ content: e('wrong') + ' No fields provided.' });
  await query(
    'INSERT INTO pay_requirements (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO UPDATE SET ' + setClauses.join(', '),
    vals
  );
  await interaction.editReply({ content: e('checkmark') + ' Pay requirements updated.' });
}

async function setDailyGoals(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const role      = interaction.options.getString('role');
  const games     = interaction.options.getInteger('games');
  const autogames = interaction.options.getInteger('autogames');
  const payouts   = interaction.options.getInteger('payouts');
  if (games === null && autogames === null && payouts === null) {
    return interaction.editReply({ content: e('wrong') + ' Please provide at least one goal.' });
  }
  await query(
    `INSERT INTO daily_goals (guild_id, role, games, autogames, payouts) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (guild_id, role) DO UPDATE SET games=COALESCE($3,daily_goals.games), autogames=COALESCE($4,daily_goals.autogames), payouts=COALESCE($5,daily_goals.payouts), updated_at=NOW()`,
    [interaction.guildId, role, games, autogames, payouts]
  );
  const roleLabels = { owner:'Owner', admin:'Admin', staff:'Mod', host:'Host', rumble_host:'Rumble Host' };
  await interaction.editReply({ content: e('checkmark') + ' Daily goals set for **' + (roleLabels[role]||role) + '**.' });
}

async function setClaimTime(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const defaultHours = interaction.options.getInteger('default');
  const boosterHours = interaction.options.getInteger('booster');
  if (defaultHours === null && boosterHours === null) {
    return interaction.editReply({ content: e('wrong') + ' Please provide at least one value.' });
  }
  await query(
    `INSERT INTO guild_config (guild_id, claim_hours_default, claim_hours_booster)
     VALUES ($1,$2,$3)
     ON CONFLICT (guild_id) DO UPDATE SET
       claim_hours_default = COALESCE($2, guild_config.claim_hours_default),
       claim_hours_booster = COALESCE($3, guild_config.claim_hours_booster),
       updated_at = NOW()`,
    [interaction.guildId, defaultHours, boosterHours]
  );
  const lines = [];
  if (defaultHours !== null) lines.push(e('checkmark') + ' Default claim window → **' + defaultHours + ' hours**');
  if (boosterHours !== null) lines.push(e('checkmark') + ' Booster claim window → **' + boosterHours + ' hours**');
  await interaction.editReply({ content: lines.join('\n') });
}

async function setGoosdate(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.options.getChannel('channel');
  const role    = interaction.options.getRole('role');
  const enabled = interaction.options.getBoolean('enabled') ?? true;
  await query(
    `INSERT INTO goosdate_config (guild_id, channel_id, role_id, enabled)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id) DO UPDATE SET channel_id=$2, role_id=$3, enabled=$4`,
    [interaction.guildId, channel.id, role.id, enabled]
  );
  await interaction.editReply({
    content: e('checkmark') + ' Goos Date reminders → ' + channel.toString() + ' | ' + role.toString() + ' | **' + (enabled ? 'ON' : 'OFF') + '**'
  });
}

async function summary(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const cfgRes  = await query('SELECT * FROM guild_config WHERE guild_id=$1', [interaction.guildId]);
  const reqRes  = await query('SELECT * FROM pay_requirements WHERE guild_id=$1', [interaction.guildId]);
  const goalRes = await query('SELECT * FROM daily_goals WHERE guild_id=$1 ORDER BY role', [interaction.guildId]);
  const goosRes = await query('SELECT * FROM goosdate_config WHERE guild_id=$1', [interaction.guildId]);

  const embed = baseEmbed(e('purplesparkle') + ' Server Settings', COLORS.tbppurple, interaction.guild?.name);
  const cfg = cfgRes.rows[0] || {};

  embed.addFields({
    name: e('controller') + ' Channels',
    value:
      'Schedule: ' + (cfg.schedule_channel_id ? '<#' + cfg.schedule_channel_id + '>' : 'Not set') + '\n' +
      'Winners: ' + (cfg.winner_channel_id ? '<#' + cfg.winner_channel_id + '>' : 'Not set') + '\n' +
      'Ticket: ' + (cfg.ticket_channel_id ? '<#' + cfg.ticket_channel_id + '>' : 'Not set') + '\n' +
      'Staff Notif: ' + (cfg.staff_notif_channel_id ? '<#' + cfg.staff_notif_channel_id + '>' : 'Not set') + '\n' +
      'Transcripts: ' + (cfg.game_transcript_channel_id ? '<#' + cfg.game_transcript_channel_id + '>' : 'Not set'),
    inline: false,
  });

  embed.addFields({
    name: e('members') + ' Roles',
    value:
      'Mod: ' + (cfg.mod_role_id ? '<@&' + cfg.mod_role_id + '>' : 'Not set') + '\n' +
      'Admin: ' + (cfg.admin_role_id ? '<@&' + cfg.admin_role_id + '>' : 'Not set') + '\n' +
      'Game Ping: ' + (cfg.game_ping_role_id ? '<@&' + cfg.game_ping_role_id + '>' : 'Not set'),
    inline: false,
  });

  embed.addFields({
    name: e('RojasClock') + ' General',
    value:
      'Timezone: **' + (cfg.timezone || 'America/New_York') + '**\n' +
      'Claim Time (default): **' + (cfg.claim_hours_default || 6) + 'h**\n' +
      'Claim Time (booster): **' + (cfg.claim_hours_booster || 12) + 'h**',
    inline: false,
  });

  if (reqRes.rows.length) {
    const r = reqRes.rows[0];
    embed.addFields({
      name: e('payday') + ' Pay Requirements',
      value:
        'Min Games: **' + (r.min_games || r.min_games_hosted || 'N/A') + '** | Min Auto-Games: **' + (r.min_rumble || 'N/A') + '**\n' +
        'Min Raffles: **' + (r.min_raffles || r.min_raffles_hosted || 'N/A') + '** | Bonus/Game: **' + (r.bonus_per_game || 'N/A') + '**',
      inline: false,
    });
  }

  if (goalRes.rows.length) {
    const roleLabels = { owner:'Owner', admin:'Admin', staff:'Mod', host:'Host', rumble_host:'Rumble Host' };
    const goalLines = goalRes.rows.map(g =>
      '**' + (roleLabels[g.role]||g.role) + ':** ' + g.games + ' games | ' + g.autogames + ' auto | ' + g.payouts + ' payouts'
    );
    embed.addFields({ name: e('confetti') + ' Daily Goals', value: goalLines.join('\n'), inline: false });
  }

  if (goosRes.rows.length) {
    const g = goosRes.rows[0];
    embed.addFields({
      name: e('purplesparkle') + ' Goos Date',
      value: 'Channel: <#' + g.channel_id + '> | Role: <@&' + g.role_id + '> | **' + (g.enabled ? 'ON' : 'OFF') + '**',
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
