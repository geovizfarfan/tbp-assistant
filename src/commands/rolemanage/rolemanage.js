const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');

function isStaffOrAdmin(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
    interaction.member.permissions.has(PermissionFlagsBits.ManageRoles) ||
    interaction.user.id === process.env.OWNER_ID;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolemanage')
    .setDescription('Add or remove roles from members')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a role to a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to add').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a role from a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('bulk-remove')
      .setDescription('Remove a role from multiple members, or everyone who has it')
      .addRoleOption(o => o.setName('role').setDescription('Role to strip').setRequired(true))
      .addBooleanOption(o => o.setName('all').setDescription('Remove from every member who has this role').setRequired(false))
      .addStringOption(o => o.setName('users').setDescription('Type @ to mention specific members (ignored if "all" is True)').setRequired(false))),

  async execute(interaction) {
    if (!isStaffOrAdmin(interaction)) {
      return interaction.reply({ content: `${e('wrong')} You need Manage Roles permission for this.`, ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addRole(interaction);
    if (sub === 'remove') return removeRole(interaction);
    if (sub === 'bulk-remove') return bulkRemove(interaction);
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

async function bulkRemove(interaction) {
  const role = interaction.options.getRole('role');
  const all = interaction.options.getBoolean('all');
  const usersRaw = interaction.options.getString('users');

  if (!all && !usersRaw) {
    return interaction.reply({ content: `${e('wrong')} Set \`all:True\` to remove from everyone, or provide \`users\` for specific members.`, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  let targets;
  if (all) {
    // Ensure the role's member cache is fresh before iterating.
    await interaction.guild.members.fetch();
    targets = [...role.members.values()];
  } else {
    const ids = [...usersRaw.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
    if (!ids.length) return interaction.editReply(`${e('wrong')} Couldn't find any member mentions in that — type @ to mention them.`);
    targets = [];
    for (const id of ids) {
      const member = await interaction.guild.members.fetch(id).catch(() => null);
      if (member && member.roles.cache.has(role.id)) targets.push(member);
    }
  }

  if (!targets.length) {
    return interaction.editReply(`${e('wrong')} No one to remove ${role} from — either none of the specified members have it, or nobody has it at all.`);
  }

  let removed = 0, failed = 0;
  for (const member of targets) {
    await member.roles.remove(role).then(() => removed++).catch(() => failed++);
  }

  const embed = new EmbedBuilder()
    .setColor(failed ? '#faa61a' : '#2ecc71')
    .setDescription(
      `${e('checkmark')} Removed ${role} from **${removed}** member${removed === 1 ? '' : 's'}.` +
      (failed ? `\n${e('wrong')} Failed on ${failed} (likely a role hierarchy issue — my role needs to be above ${role}).` : '')
    );

  return interaction.editReply({ embeds: [embed] });
}
