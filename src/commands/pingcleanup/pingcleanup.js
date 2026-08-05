const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');
const { e } = require('../../utils/appEmojis');
const { baseEmbed } = require('../../utils/embeds');

function isAdmin(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
    interaction.user.id === process.env.OWNER_ID;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pingcleanup')
    .setDescription('Auto-delete a bare ping message (no embed) from another bot in a channel')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Turn this on for a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to watch').setRequired(true))
      .addIntegerOption(o => o.setName('delay_seconds').setDescription('Delay before deleting, in seconds (default: 30)')))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Turn this off for a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to stop watching').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List every channel this is active in')),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addPingCleanup(interaction);
    if (sub === 'remove') return removePingCleanup(interaction);
    if (sub === 'list') return listPingCleanup(interaction);
  },
};

async function addPingCleanup(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.options.getChannel('channel');
  const delaySeconds = interaction.options.getInteger('delay_seconds') || 30;

  await query(
    `INSERT INTO ping_cleanup_config (guild_id, channel_id, delay_seconds) VALUES ($1,$2,$3)
     ON CONFLICT (guild_id, channel_id) DO UPDATE SET delay_seconds=$3`,
    [interaction.guildId, channel.id, delaySeconds]
  );

  return interaction.editReply(`${e('checkmark')} In <#${channel.id}>, a bare ping message (no embed) from another bot will now be deleted ${delaySeconds}s after it's posted. Any separate message with an embed is left alone.`);
}

async function removePingCleanup(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.options.getChannel('channel');
  const res = await query(`DELETE FROM ping_cleanup_config WHERE guild_id=$1 AND channel_id=$2 RETURNING channel_id`, [interaction.guildId, channel.id]);
  if (!res.rows.length) return interaction.editReply(`${e('wrong')} <#${channel.id}> wasn't set up for this.`);
  return interaction.editReply(`${e('checkmark')} Turned off for <#${channel.id}>.`);
}

async function listPingCleanup(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(`SELECT channel_id, delay_seconds FROM ping_cleanup_config WHERE guild_id=$1`, [interaction.guildId]);
  if (!res.rows.length) return interaction.editReply('Not active in any channel yet.');

  const lines = res.rows.map(r => `<#${r.channel_id}> — ${r.delay_seconds}s delay`).join('\n');
  return interaction.editReply({ embeds: [baseEmbed(`${e('diamond')} Ping Cleanup`, '#d6c2ee', interaction.guild?.name).setDescription(lines)] });
}
