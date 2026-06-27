const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('goosdate')
    .setDescription('Manage Goos Date reminders')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Set the channel and role for Goos Date reminders')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post reminders in').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to ping').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('toggle')
      .setDescription('Turn Goos Date reminders on or off')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable reminders?').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Check current Goos Date reminder settings')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setup(interaction);
    if (sub === 'toggle') return toggle(interaction);
    if (sub === 'status') return status(interaction);
  },
};

async function setup(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');

  await query(
    `INSERT INTO goosdate_config (guild_id, channel_id, role_id, enabled)
     VALUES ($1,$2,$3,true)
     ON CONFLICT (guild_id) DO UPDATE SET channel_id=$2, role_id=$3, enabled=true`,
    [interaction.guildId, channel.id, role.id]
  );

  await interaction.editReply({
    content: `${e('checkmark')} Goos Date reminders will post in ${channel.toString()} and ping ${role.toString()}.`,
  });
}

async function toggle(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const enabled = interaction.options.getBoolean('enabled');

  const res = await query(
    `UPDATE goosdate_config SET enabled=$1, updated_at=NOW() WHERE guild_id=$2 RETURNING *`,
    [enabled, interaction.guildId]
  );

  if (!res.rows.length) {
    return interaction.editReply({ content: `${e('wrong')} Goos Date hasn't been set up yet. Use /goosdate setup first.` });
  }

  await interaction.editReply({
    content: `${e('checkmark')} Goos Date reminders are now **${enabled ? 'ON' : 'OFF'}**.`,
  });
}

async function status(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(`SELECT * FROM goosdate_config WHERE guild_id=$1`, [interaction.guildId]);

  if (!res.rows.length) {
    return interaction.editReply({ content: 'Goos Date has not been set up yet. Use /goosdate setup.' });
  }

  const cfg = res.rows[0];
  await interaction.editReply({
    content:
      `${e('purplesparkle')} **Goos Date Settings**\n` +
      `Channel: <#${cfg.channel_id}>\n` +
      `Role: <@&${cfg.role_id}>\n` +
      `Status: **${cfg.enabled ? 'ON' : 'OFF'}**`,
  });
}
