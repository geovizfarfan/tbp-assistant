const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, adjustBalance } = require('../utils/playAndRegretDb');
const { query } = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sins')
    .setDescription('Check or manage Sins balances (synced from Play & Regret)')
    .addSubcommand(sub =>
      sub
        .setName('balance')
        .setDescription("Check a user's Sins balance")
        .addUserOption(opt =>
          opt.setName('user').setDescription('User to check (defaults to you)').setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('give')
        .setDescription('Give (or take) Sins from a user')
        .addUserOption(opt =>
          opt.setName('user').setDescription('User to adjust').setRequired(true)
        )
        .addIntegerOption(opt =>
          opt
            .setName('amount')
            .setDescription('Amount to give. Use a negative number to take Sins away.')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('reason').setDescription('Reason for this adjustment').setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'balance') {
      const target = interaction.options.getUser('user') || interaction.user;
      const balance = await getBalance(target.id);

      if (balance === null) {
        return interaction.reply({
          content: `${target.username} doesn't have a Sins balance yet.`,
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setDescription(`**${target.username}** has **${balance.toLocaleString()}** Sins`)
        .setThumbnail(target.displayAvatarURL());

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'give') {
      const staffRes = await query('SELECT role FROM staff WHERE user_id=$1 AND active=true', [interaction.user.id]);
      const staffRole = staffRes.rows[0]?.role;
      const isAdminOrOwner = ['admin', 'owner'].includes(staffRole);

      if (!isAdminOrOwner) {
        return interaction.reply({
          content: 'You do not have permission to use this command.',
          ephemeral: true,
        });
      }

      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const reason = interaction.options.getString('reason') || 'No reason provided';

      const newBalance = await adjustBalance(target.id, target.username, amount);

      const verb = amount >= 0 ? 'Gave' : 'Took';
      const embed = new EmbedBuilder()
        .setColor(amount >= 0 ? 0x2ecc71 : 0xe74c3c)
        .setDescription(
          `${verb} **${Math.abs(amount).toLocaleString()}** Sins ${amount >= 0 ? 'to' : 'from'} **${target.username}**\n` +
          `> **Reason:** ${reason}\n` +
          `New balance: **${newBalance.toLocaleString()}**`
        );

      return interaction.reply({ embeds: [embed] });
    }
  },
};
