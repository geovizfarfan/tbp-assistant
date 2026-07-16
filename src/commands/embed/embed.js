const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Post a custom embed')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create and post a custom embed')
      .addStringOption(o => o.setName('description').setDescription('Body text (use \\n for new lines)').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post in (default: current channel)'))
      .addStringOption(o => o.setName('title').setDescription('Embed title'))
      .addStringOption(o => o.setName('color').setDescription('Hex color, e.g. #d6c2ee'))
      .addStringOption(o => o.setName('image').setDescription('Image URL (large, shown at the bottom)'))
      .addStringOption(o => o.setName('thumbnail').setDescription('Thumbnail URL (small, shown top-right)'))
      .addStringOption(o => o.setName('footer').setDescription('Footer text'))
      .addStringOption(o => o.setName('author').setDescription('Author name shown above the title'))),

  async execute(interaction) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
      interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);
    if (!isAdmin) return interaction.reply({ content: '❌ You need Manage Messages permission to use this.', ephemeral: true });

    const channel     = interaction.options.getChannel('channel') || interaction.channel;
    const title       = interaction.options.getString('title');
    const description = interaction.options.getString('description').replace(/\\n/g, '\n');
    const color       = interaction.options.getString('color') || '#d6c2ee';
    const image       = interaction.options.getString('image');
    const thumbnail   = interaction.options.getString('thumbnail');
    const footer      = interaction.options.getString('footer');
    const author      = interaction.options.getString('author');

    await interaction.deferReply({ ephemeral: true });

    const hexColor = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#d6c2ee';
    const embed = new EmbedBuilder().setColor(hexColor).setDescription(description);
    if (title) embed.setTitle(title);
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (footer) embed.setFooter({ text: footer });
    if (author) embed.setAuthor({ name: author });

    const msg = await channel.send({ embeds: [embed] }).catch((err) => {
      console.error('[Embed] Failed to send:', err.message);
      return null;
    });

    if (!msg) return interaction.editReply('❌ Failed to post — check the image/thumbnail URLs are valid, and that Veloura can post in that channel.');
    return interaction.editReply(`✅ Embed posted in <#${channel.id}>.`);
  },
};
