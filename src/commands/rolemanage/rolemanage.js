const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { e } = require('../../utils/appEmojis');

function isStaffOrAdmin(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
    interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) ||
    interaction.user.id === process.env.OWNER_ID;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolemanage')
    .setDescription('Add or remove a role from a member')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a role to a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to add').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a role from a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true))),

  async execute(interaction) {
    if (!isStaffOrAdmin(interaction)) {
      return interaction.reply({ content: `${e('wrong')} You need Manage Roles permission for this.`, ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addRole(interaction);
    if (sub === 'remove') return removeRole(interaction);
  },
};

async function addRole(interaction) {
  const user = interaction.options.getUser('user');
  const role = interaction.options.getRole('role');
  await interaction.deferReply();

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.editReply(`${e('wrong')} Couldn't find that member in this server.`);

  if (member.roles.cache.has(role.id)) {
    return interaction.editReply(`${e('wrong')} <@${user.id}> already has ${role}.`);
  }

  const added = await member.roles.add(role).then(() => true).catch(() => false);
  if (!added) return interaction.editReply(`${e('wrong')} Couldn't add ${role} — my role needs to be positioned above it in the server's role list.`);
  return interaction.editReply(`${e('checkmark')} Added ${role} to <@${user.id}>.`);
}

async function removeRole(interaction) {
  const user = interaction.options.getUser('user');
  const role = interaction.options.getRole('role');
  await interaction.deferReply();

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.editReply(`${e('wrong')} Couldn't find that member in this server.`);

  if (!member.roles.cache.has(role.id)) {
    return interaction.editReply(`${e('wrong')} <@${user.id}> doesn't have ${role}.`);
  }

  const removed = await member.roles.remove(role).then(() => true).catch(() => false);
  if (!removed) return interaction.editReply(`${e('wrong')} Couldn't remove ${role} — my role needs to be positioned above it in the server's role list.`);
  return interaction.editReply(`${e('checkmark')} Removed ${role} from <@${user.id}>.`);
}
