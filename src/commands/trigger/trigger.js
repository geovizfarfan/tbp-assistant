const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { e } = require('../../utils/appEmojis');
const { baseEmbed } = require('../../utils/embeds');

function isAdmin(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
    interaction.user.id === process.env.OWNER_ID;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trigger')
    .setDescription('Custom trigger words - typing one posts a message or reacts with emojis')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a new trigger word')
      .addStringOption(o => o.setName('word').setDescription('The exact word/phrase that triggers this, e.g. !yay').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('What happens when triggered').setRequired(true).addChoices(
        { name: 'Post a message', value: 'message' },
        { name: 'React with emojis', value: 'reaction' },
      ))
      .addStringOption(o => o.setName('message').setDescription('Text to post (for Message type)'))
      .addStringOption(o => o.setName('emojis').setDescription('Emojis to react with, space-separated (for Reaction type)'))
      .addRoleOption(o => o.setName('restricted_role').setDescription('Only this role can use it (Message type only - reactions stay open to everyone)')))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a trigger word')
      .addStringOption(o => o.setName('word').setDescription('The trigger word to remove').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all trigger words configured on this server')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const res = await query(
      `SELECT trigger_word FROM custom_triggers WHERE guild_id=$1 AND trigger_word ILIKE $2 ORDER BY trigger_word LIMIT 25`,
      [interaction.guild.id, `%${focused}%`]
    );
    return interaction.respond(res.rows.map(r => ({ name: r.trigger_word, value: r.trigger_word })));
  },

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addTrigger(interaction);
    if (sub === 'remove') return removeTrigger(interaction);
    if (sub === 'list') return listTriggers(interaction);
  },
};

async function addTrigger(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const word = interaction.options.getString('word').trim();
  const type = interaction.options.getString('type');
  const message = interaction.options.getString('message');
  const emojisRaw = interaction.options.getString('emojis');
  const restrictedRole = interaction.options.getRole('restricted_role');

  if (type === 'message' && !message) {
    return interaction.editReply(`${e('wrong')} \`message\` is required when type is "Post a message".`);
  }
  if (type === 'reaction' && !emojisRaw) {
    return interaction.editReply(`${e('wrong')} \`emojis\` is required when type is "React with emojis".`);
  }
  if (type === 'reaction' && restrictedRole) {
    return interaction.editReply(`${e('wrong')} Reaction triggers can't be role-restricted — those stay open to everyone. Only Message-type triggers support \`restricted_role\`.`);
  }

  const emojis = emojisRaw ? emojisRaw.trim().split(/\s+/) : null;

  const existing = await query(`SELECT id FROM custom_triggers WHERE guild_id=$1 AND trigger_word=$2`, [interaction.guildId, word]);
  if (existing.rows.length) {
    return interaction.editReply(`${e('wrong')} A trigger for **${word}** already exists — remove it first if you want to replace it.`);
  }

  await query(
    `INSERT INTO custom_triggers (guild_id, trigger_word, action_type, response_text, reaction_emojis, restricted_role_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [interaction.guildId, word, type, type === 'message' ? message : null, type === 'reaction' ? emojis : null, restrictedRole?.id || null, interaction.user.id]
  );

  const roleNote = restrictedRole ? ` — only <@&${restrictedRole.id}> can use it` : '';
  return interaction.editReply(`${e('checkmark')} Trigger **${word}** added — ${type === 'message' ? 'posts a message' : `reacts with ${emojis.join(' ')}`} when typed${roleNote}.`);
}

async function removeTrigger(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const word = interaction.options.getString('word').trim();
  const res = await query(`DELETE FROM custom_triggers WHERE guild_id=$1 AND trigger_word=$2 RETURNING id`, [interaction.guildId, word]);
  if (!res.rows.length) return interaction.editReply(`${e('wrong')} No trigger found for **${word}**.`);
  return interaction.editReply(`${e('checkmark')} Trigger **${word}** removed.`);
}

async function listTriggers(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const res = await query(`SELECT * FROM custom_triggers WHERE guild_id=$1 ORDER BY trigger_word`, [interaction.guildId]);
  if (!res.rows.length) return interaction.editReply('No trigger words configured yet. Add one with `/trigger add`.');

  const lines = res.rows.map(t => {
    const action = t.action_type === 'message'
      ? `posts: "${t.response_text.slice(0, 60)}${t.response_text.length > 60 ? '...' : ''}"`
      : `reacts: ${t.reaction_emojis.join(' ')}`;
    const roleNote = t.restricted_role_id ? ` — restricted to <@&${t.restricted_role_id}>` : '';
    return `**${t.trigger_word}** — ${action}${roleNote}`;
  }).join('\n');

  return interaction.editReply({ embeds: [baseEmbed(`${e('diamond')} Trigger Words`, '#d6c2ee', interaction.guild?.name).setDescription(lines)] });
}
