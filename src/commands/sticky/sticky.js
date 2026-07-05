const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Manage sticky (persistent) messages in a channel')
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set a sticky message in the current channel')
      .addStringOption(o => o.setName('message').setDescription('The message to keep at the bottom').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex (default: #d6c2ee)'))
      .addStringOption(o => o.setName('title').setDescription('Optional embed title')))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove the sticky message from the current channel'))
    .addSubcommand(sub => sub
      .setName('edit')
      .setDescription('Edit the sticky message in the current channel')
      .addStringOption(o => o.setName('message').setDescription('New message content').setRequired(true))
      .addStringOption(o => o.setName('title').setDescription('New title (leave empty to keep current)'))
      .addStringOption(o => o.setName('color').setDescription('New embed color hex'))),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const sub     = interaction.options.getSubcommand();
    const channel = interaction.channel;

    if (sub === 'set') {
      const text  = interaction.options.getString('message').replace(/\\n/g, '\n');
      const color = interaction.options.getString('color') || '#d6c2ee';
      const title = interaction.options.getString('title') || null;

      const embed = new EmbedBuilder().setColor(color).setDescription(text);
      if (title) embed.setTitle(title);

      const msg = await channel.send({ embeds: [embed] });

      await query(`
        INSERT INTO sticky_messages (guild_id, channel_id, message_id, content, title, color)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (guild_id, channel_id) DO UPDATE SET
          message_id = EXCLUDED.message_id,
          content    = EXCLUDED.content,
          title      = EXCLUDED.title,
          color      = EXCLUDED.color
      `, [interaction.guild.id, channel.id, msg.id, text, title, color]);

      return interaction.editReply(`✅ Sticky message set in <#${channel.id}>. It will stay at the bottom.`);
    }

    if (sub === 'edit') {
      const text  = interaction.options.getString('message').replace(/\\n/g, '\n');
      const color = interaction.options.getString('color');
      const title = interaction.options.getString('title');

      const res = await query('SELECT * FROM sticky_messages WHERE guild_id = $1 AND channel_id = $2', [interaction.guild.id, channel.id]);
      if (!res.rows.length) return interaction.editReply('❌ No sticky message found in this channel. Use `/sticky set` first.');

      const sticky = res.rows[0];
      const newColor = color || sticky.color;
      const newTitle = title !== null ? title : sticky.title;

      // Delete old message
      const oldMsg = await channel.messages.fetch(sticky.message_id).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});

      // Post updated message
      const embed = new EmbedBuilder().setColor(newColor).setDescription(text);
      if (newTitle) embed.setTitle(newTitle);
      const newMsg = await channel.send({ embeds: [embed] });

      await query('UPDATE sticky_messages SET message_id = $1, content = $2, title = $3, color = $4 WHERE guild_id = $5 AND channel_id = $6',
        [newMsg.id, text, newTitle, newColor, interaction.guild.id, channel.id]);

      return interaction.editReply('✅ Sticky message updated!');
    }

    if (sub === 'remove') {
      const res = await query(
        'DELETE FROM sticky_messages WHERE guild_id = $1 AND channel_id = $2 RETURNING message_id',
        [interaction.guild.id, channel.id]
      );
      if (!res.rows.length) return interaction.editReply('❌ No sticky message found in this channel.');

      // Delete the actual message
      const oldMsg = await channel.messages.fetch(res.rows[0].message_id).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});

      return interaction.editReply(`✅ Sticky message removed from <#${channel.id}>.`);
    }
  },

  // Called from index.js on every messageCreate
  async handleStickyRepost(message, client) {
    if (message.author.bot) return;
    if (!message.guild) return;

    try {
      const res = await query(
        'SELECT * FROM sticky_messages WHERE guild_id = $1 AND channel_id = $2',
        [message.guild.id, message.channel.id]
      );
      if (!res.rows.length) return;

      const sticky = res.rows[0];

      // Delete old sticky message
      const oldMsg = await message.channel.messages.fetch(sticky.message_id).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => {});

      // Repost
      const embed = new EmbedBuilder().setColor(sticky.color || '#d6c2ee').setDescription(sticky.content);
      if (sticky.title) embed.setTitle(sticky.title);

      const newMsg = await message.channel.send({ embeds: [embed] });

      // Update stored message ID
      await query('UPDATE sticky_messages SET message_id = $1 WHERE guild_id = $2 AND channel_id = $3',
        [newMsg.id, message.guild.id, message.channel.id]);
    } catch (e) { /* ignore */ }
  },
};
