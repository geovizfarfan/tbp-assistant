const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set or clear your AFK status')
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set yourself as AFK')
      .addStringOption(o => o.setName('reason').setDescription('Why are you AFK?').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear your AFK status manually')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') return setAFK(interaction);
    if (sub === 'clear') return clearAFK(interaction);
  },
};

async function setAFK(interaction) {
  const reason = interaction.options.getString('reason') || 'AFK';
  await query(
    `INSERT INTO afk_status (user_id, reason, set_at)
     VALUES ($1,$2,NOW())
     ON CONFLICT (user_id) DO UPDATE SET reason=$2, set_at=NOW(), last_notified_at=NULL`,
    [interaction.user.id, reason]
  );
  await interaction.reply({
    content: `<a:offline:1522061617213341786> You are now AFK globally — **${reason}**`,
    ephemeral: true,
  });
}

async function clearAFK(interaction) {
  const res = await query(
    `DELETE FROM afk_status WHERE user_id=$1 RETURNING *`,
    [interaction.user.id]
  );
  if (!res.rows.length) {
    return interaction.reply({ content: `${e('wrong')} You are not currently AFK.`, ephemeral: true });
  }
  await interaction.reply({
    content: `${e('checkmark')} Your AFK status has been cleared.`,
    ephemeral: true,
  });
}
