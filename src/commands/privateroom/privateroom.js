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

  const customTitle = interaction.options.getString('title');
  const description = interaction.options.getString('description') ||
    '## <a:lock:1520456965245898903> <a:purplesparkle:1512912828489793626> ' + (customTitle || 'Private Gambling Rooms') + '\n' +
    '**Press the button to create your private room.**\n' +
    '<:vertical_line:1520457297476845741> <:bullet:1512973213645410335> Private access for you.\n' +
    '<:vertical_line:1520457297476845741> <:bullet:1512973213645410335> Archives after 24 hours of inactivity\n' +
    '<:vertical_line:1520457297476845741> <:bullet:1512973213645410335> Activity resets the timer\n' +
    '<:vertical_line:1520457297476845741> <:bullet:1512973213645410335> Deletes permanently after 1 week archived';

  const embed = new EmbedBuilder()
    .setColor(COLORS.tbppurple)
    .setDescription(description)
    .setFooter({ text: interaction.guild?.name || '' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('privateroom_create')
      .setLabel('Create Private Gambling Room')
      .setEmoji('🎲')
      .setStyle(ButtonStyle.Success)
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.editReply({ content: `${e('checkmark')} Private room button posted!` });
}
