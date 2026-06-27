const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { baseEmbed, COLORS } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('private-room')
    .setDescription('Manage the private room creation button')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Post the Create Private Room button in this channel')
      .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(false))
      .addStringOption(o => o.setName('description').setDescription('Embed description').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setupButton(interaction);
  },
};

async function setupButton(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const title = interaction.options.getString('title') || 'Private Rooms';
  const description = interaction.options.getString('description') ||
    'Press the button to create your **private room**.\n\n' +
    '• Private access for just you and staff\n' +
    '• Auto-deletes after **3 days of inactivity**\n' +
    '• Sending a message resets the timer';

  const embed = baseEmbed(`${e('purplesparkle')} ${title}`, COLORS.tbppurple, interaction.guild?.name)
    .setDescription(description);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('privateroom_create')
      .setLabel('Create Private Room')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Success)
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: `${e('checkmark')} Private room button posted!` });
}
