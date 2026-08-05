const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { e } = require('../../utils/appEmojis');

const ROLE_LABELS = {
  owner: '<a:trophies:1512912823062364281> Owner',
  admin: '<:role:1524456992683593979> Admin',
  staff: '<:staff:1523146914701512764> Mod',
  host: '<a:tickets:1523139713278672996> Host',
};

function isAdmin(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
    interaction.user.id === process.env.OWNER_ID;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staffbio')
    .setDescription('Meet the Staff - per-server customizable staff intro profiles')
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Configure where profiles post and what questions to ask (admin only)')
      .addChannelOption(o => o.setName('channel').setDescription('Channel profiles get posted/updated in').setRequired(true))
      .addStringOption(o => o.setName('questions').setDescription('Up to 5 questions, separated by | — include an emoji in the text to show it').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Embed color hex, e.g. #d6c2ee')))
    .addSubcommand(sub => sub
      .setName('submit')
      .setDescription('Fill out (or update) your own staff intro profile'))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a staff member\'s profile (admin only)')
      .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') {
      if (!isAdmin(interaction)) return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
      return setupStaffBio(interaction);
    }
    if (sub === 'remove') {
      if (!isAdmin(interaction)) return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
      return removeStaffBio(interaction);
    }
    if (sub === 'submit') return submitStaffBio(interaction);
  },

  async handleModalSubmit(interaction) {
    if (!interaction.customId.startsWith('staffbio_modal')) return;
    return handleBioModal(interaction);
  },
};

async function setupStaffBio(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.options.getChannel('channel');
  const questionsRaw = interaction.options.getString('questions');
  const color = interaction.options.getString('color');

  const questions = questionsRaw.split('|').map(q => q.trim()).filter(Boolean).slice(0, 5);
  if (!questions.length) return interaction.editReply(`${e('wrong')} Couldn't parse any questions — separate them with \`|\`.`);

  await query(
    `INSERT INTO staff_bio_config (guild_id, channel_id, questions, embed_color) VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id) DO UPDATE SET channel_id=$2, questions=$3, embed_color=COALESCE($4, staff_bio_config.embed_color)`,
    [interaction.guildId, channel.id, questions.join('|'), color]
  );

  return interaction.editReply(`${e('checkmark')} Meet the Staff configured — profiles will post to <#${channel.id}> with ${questions.length} question${questions.length === 1 ? '' : 's'}. Staff can now run \`/staffbio submit\`.`);
}

async function submitStaffBio(interaction) {
  const cfgRes = await query(`SELECT * FROM staff_bio_config WHERE guild_id=$1`, [interaction.guildId]);
  const cfg = cfgRes.rows[0];
  if (!cfg) return interaction.reply({ content: `${e('wrong')} Meet the Staff isn't set up yet — ask an admin to run \`/staffbio setup\`.`, ephemeral: true });

  const staffRes = await query(`SELECT * FROM staff WHERE user_id=$1 AND active=true`, [interaction.user.id]);
  if (!staffRes.rows.length) return interaction.reply({ content: `${e('wrong')} Only active staff members can submit a profile.`, ephemeral: true });

  const questions = cfg.questions.split('|');
  const existingRes = await query(`SELECT answers FROM staff_bios WHERE guild_id=$1 AND user_id=$2`, [interaction.guildId, interaction.user.id]);
  const existingAnswers = existingRes.rows[0]?.answers || [];

  const modal = new ModalBuilder().setCustomId('staffbio_modal').setTitle('Meet the Staff — Your Intro'.slice(0, 45));
  questions.forEach((q, i) => {
    const input = new TextInputBuilder()
      .setCustomId(`q${i}`)
      .setLabel(q.slice(0, 45))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);
    if (existingAnswers[i]) input.setValue(existingAnswers[i]);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });

  return interaction.showModal(modal);
}

async function getRoleDisplay(guildId, role) {
  const col = role === 'admin' ? 'admin_role_id' : role === 'staff' ? 'mod_role_id' : null;
  if (col) {
    const res = await query(`SELECT ${col} FROM guild_config WHERE guild_id=$1`, [guildId]);
    const roleId = res.rows[0]?.[col];
    if (roleId) return `<@&${roleId}>`;
  }
  return ROLE_LABELS[role] || role;
}

async function handleBioModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const cfgRes = await query(`SELECT * FROM staff_bio_config WHERE guild_id=$1`, [interaction.guildId]);
  const cfg = cfgRes.rows[0];
  if (!cfg) return interaction.editReply(`${e('wrong')} Meet the Staff configuration was removed before you submitted.`);

  const staffRes = await query(`SELECT * FROM staff WHERE user_id=$1 AND active=true`, [interaction.user.id]);
  const staffRow = staffRes.rows[0];
  if (!staffRow) return interaction.editReply(`${e('wrong')} You're no longer an active staff member.`);

  const questions = cfg.questions.split('|');
  const answers = questions.map((q, i) => interaction.fields.getTextInputValue(`q${i}`));

  const embed = new EmbedBuilder()
    .setColor(cfg.embed_color || '#d6c2ee')
    .setTitle(`${e('purplesparkle')} Meet <@${interaction.user.id}>!`)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields({ name: `${e('trophies')} Role`, value: await getRoleDisplay(interaction.guildId, staffRow.role), inline: false });
  questions.forEach((q, i) => embed.addFields({ name: q, value: answers[i], inline: false }));

  const channel = await interaction.client.channels.fetch(cfg.channel_id).catch(() => null);
  if (!channel) return interaction.editReply(`${e('wrong')} The configured channel no longer exists — ask an admin to run \`/staffbio setup\` again.`);

  const existingRes = await query(`SELECT message_id FROM staff_bios WHERE guild_id=$1 AND user_id=$2`, [interaction.guildId, interaction.user.id]);
  const existingMsgId = existingRes.rows[0]?.message_id;

  let msg;
  if (existingMsgId) {
    msg = await channel.messages.fetch(existingMsgId).catch(() => null);
    if (msg) await msg.edit({ embeds: [embed] }).catch(() => { msg = null; });
  }
  if (!msg) {
    msg = await channel.send({ embeds: [embed] });
  }

  await query(
    `INSERT INTO staff_bios (guild_id, user_id, answers, message_id, updated_at) VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (guild_id, user_id) DO UPDATE SET answers=$3, message_id=$4, updated_at=NOW()`,
    [interaction.guildId, interaction.user.id, answers, msg.id]
  );

  return interaction.editReply(`${e('checkmark')} Your profile is ${existingMsgId ? 'updated' : 'posted'} in <#${cfg.channel_id}>!`);
}

async function removeStaffBio(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const user = interaction.options.getUser('user');

  const res = await query(`DELETE FROM staff_bios WHERE guild_id=$1 AND user_id=$2 RETURNING message_id`, [interaction.guildId, user.id]);
  if (!res.rows.length) return interaction.editReply(`${e('wrong')} <@${user.id}> doesn't have a profile.`);

  const cfgRes = await query(`SELECT channel_id FROM staff_bio_config WHERE guild_id=$1`, [interaction.guildId]);
  if (cfgRes.rows.length && res.rows[0].message_id) {
    const channel = await interaction.client.channels.fetch(cfgRes.rows[0].channel_id).catch(() => null);
    const msg = channel ? await channel.messages.fetch(res.rows[0].message_id).catch(() => null) : null;
    if (msg) await msg.delete().catch(() => {});
  }

  return interaction.editReply(`${e('checkmark')} Removed <@${user.id}>'s profile.`);
}
