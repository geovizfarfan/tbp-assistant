const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rrsetup')
    .setDescription('Admin: Configure Rumble Royale tracking for a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to monitor').setRequired(true))
    .addIntegerOption(o => o.setName('reward').setDescription('Sins to give winner').setRequired(true).setMinValue(1))
    .addRoleOption(o => o.setName('ping_role1').setDescription('Role to ping on battle start').setRequired(true))
    .addRoleOption(o => o.setName('winner_role').setDescription('Role to assign to winner'))
    .addRoleOption(o => o.setName('ping_role2').setDescription('Second role to ping on battle start'))
    .addRoleOption(o => o.setName('ping_role3').setDescription('Third role to ping on battle start'))
    .addChannelOption(o => o.setName('next_channel').setDescription('Next battle room to link'))
    .addAttachmentOption(o => o.setName('image').setDescription('Upload image or GIF for battle start announcement'))
    .addStringOption(o => o.setName('image_url').setDescription('Or paste an image URL instead of uploading'))
    .addStringOption(o => o.setName('embed_color').setDescription('Embed color hex (default: #d6c2ee)'))
    .addStringOption(o => o.setName('reaction_emoji').setDescription('Emoji to auto-react to winner messages (e.g. <:rumble:123> or 🏆)')),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const channel       = interaction.options.getChannel('channel');
    const winnerRole    = interaction.options.getRole('winner_role');
    const pingRole1     = interaction.options.getRole('ping_role1');
    const pingRole2     = interaction.options.getRole('ping_role2');
    const pingRole3     = interaction.options.getRole('ping_role3');
    const nextChannel   = interaction.options.getChannel('next_channel');
    const reward        = interaction.options.getInteger('reward');
    const imageAttach   = interaction.options.getAttachment('image');
    const image         = imageAttach?.url || interaction.options.getString('image_url') || null;
    const color         = interaction.options.getString('embed_color') || '#d6c2ee';
    const reactionEmoji = interaction.options.getString('reaction_emoji') || null;

    await query(`
      INSERT INTO rr_channel_config
        (channel_id, guild_id, winner_role_id, ping_role1_id, ping_role2_id, ping_role3_id,
         next_channel_id, reward_amount, battle_image, embed_color, reaction_emoji, total_games, total_players)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,0)
      ON CONFLICT (channel_id) DO UPDATE SET
        winner_role_id  = EXCLUDED.winner_role_id,
        ping_role1_id   = EXCLUDED.ping_role1_id,
        ping_role2_id   = EXCLUDED.ping_role2_id,
        ping_role3_id   = EXCLUDED.ping_role3_id,
        next_channel_id = EXCLUDED.next_channel_id,
        reward_amount   = EXCLUDED.reward_amount,
        battle_image    = EXCLUDED.battle_image,
        embed_color     = EXCLUDED.embed_color,
        reaction_emoji  = EXCLUDED.reaction_emoji
    `, [
      channel.id, interaction.guild.id,
      winnerRole?.id || null,
      pingRole1?.id || null, pingRole2?.id || null, pingRole3?.id || null,
      nextChannel?.id || null, reward, image || null, color, reactionEmoji,
    ]);

    const pingList = [pingRole1, pingRole2, pingRole3].filter(Boolean)
      .map(r => `<@&${r.id}>`).join(', ') || '—';

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle('<a:trophies:1512912823062364281> Rumble Royale Channel Configured!')
      .setDescription(`Monitoring <#${channel.id}> for Rumble Royale battles.\nRun \`/rrsetup\` again to update settings.`)
      .addFields(
        { name: '<a:trophies:1512912823062364281> Winner Role',    value: winnerRole ? `<@&${winnerRole.id}>` : '—', inline: true },
        { name: '<a:purplesparkle:1512912828489793626> Ping Roles', value: pingList,                                  inline: true },
        { name: '<a:moneybag:1522373120147849226> Reward',          value: `${reward.toLocaleString()} sins`,          inline: true },
        { name: '<a:rumblesword:1522372420894330921> Next Room',    value: nextChannel ? `<#${nextChannel.id}>` : '—', inline: true },
        { name: '<a:Fire:1522374930681823433> Image',               value: image ? '✓ Set' : '—',                      inline: true },
        { name: '🎨 Embed Color',                                   value: color,                                       inline: true },
        { name: '✨ Reaction Emoji',                                value: reactionEmoji || '—',                        inline: true },
      );

    return interaction.editReply({ embeds: [embed] });
  },
};
