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
    .setName('wordfilter')
    .setDescription('Auto-delete messages containing specific words or phrases')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a word/phrase to auto-delete')
      .addStringOption(o => o.setName('phrase').setDescription('The word or phrase to filter').setRequired(true))
      .addStringOption(o => o.setName('match_type').setDescription('Match anywhere in the message, or the whole message exactly').addChoices(
        { name: 'Contains — flags if the phrase appears anywhere', value: 'contains' },
        { name: 'Exact — only if the entire message matches exactly', value: 'exact' },
      )))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a word/phrase from the filter')
      .addStringOption(o => o.setName('phrase').setDescription('The word or phrase to remove').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List every filtered word/phrase on this server')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const res = await query(
      `SELECT phrase FROM word_filters WHERE guild_id=$1 AND phrase ILIKE $2 ORDER BY phrase LIMIT 25`,
      [interaction.guild.id, `%${focused}%`]
    );
    return interaction.respond(res.rows.map(r => ({ name: r.phrase, value: r.phrase })));
  },

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addFilter(interaction);
    if (sub === 'remove') return removeFilter(interaction);
    if (sub === 'list') return listFilters(interaction);
  },
};

async function addFilter(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const phrase = interaction.options.getString('phrase').trim();
  const matchType = interaction.options.getString('match_type') || 'contains';

  const existing = await query(`SELECT id FROM word_filters WHERE guild_id=$1 AND phrase=$2 AND match_type=$3`, [interaction.guildId, phrase, matchType]);
  if (existing.rows.length) return interaction.editReply(`${e('wrong')} **${phrase}** (${matchType}) is already filtered.`);

  await query(
    `INSERT INTO word_filters (guild_id, phrase, match_type, created_by) VALUES ($1,$2,$3,$4)`,
    [interaction.guildId, phrase, matchType, interaction.user.id]
  );

  return interaction.editReply(`${e('checkmark')} Now auto-deleting messages that ${matchType === 'exact' ? 'exactly match' : 'contain'} **${phrase}**.`);
}

async function removeFilter(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const phrase = interaction.options.getString('phrase').trim();
  const res = await query(`DELETE FROM word_filters WHERE guild_id=$1 AND phrase=$2 RETURNING id`, [interaction.guildId, phrase]);
  if (!res.rows.length) return interaction.editReply(`${e('wrong')} **${phrase}** isn't currently filtered.`);
  return interaction.editReply(`${e('checkmark')} **${phrase}** removed from the filter.`);
}

async function listFilters(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(`SELECT phrase, match_type FROM word_filters WHERE guild_id=$1 ORDER BY phrase`, [interaction.guildId]);
  if (!res.rows.length) return interaction.editReply('No words/phrases are currently filtered.');

  const lines = res.rows.map(f => `**${f.phrase}** — ${f.match_type}`).join('\n');
  return interaction.editReply({ embeds: [baseEmbed(`${e('wrong')} Word Filter`, '#d6c2ee', interaction.guild?.name).setDescription(lines)] });
}
