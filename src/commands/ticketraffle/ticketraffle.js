const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { query } = require('../../utils/database');
const { e } = require('../../utils/appEmojis');
const { baseEmbed } = require('../../utils/embeds');
const path = require('path');

const RAFFLE_EMOJI = '<:raffle:1512914674402853085>';

function isAdmin(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
    interaction.user.id === process.env.OWNER_ID;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketraffle')
    .setDescription('Ticket-based raffles - grant tickets manually, draw a winner weighted by ticket count')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a new ticket raffle')
      .addStringOption(o => o.setName('name').setDescription('Raffle name').setRequired(true))
      .addStringOption(o => o.setName('prize').setDescription('What the winner gets').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('grant')
      .setDescription('Give a member tickets for a raffle')
      .addStringOption(o => o.setName('name').setDescription('Raffle name').setRequired(true).setAutocomplete(true))
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption(o => o.setName('tickets').setDescription('Number of tickets to add').setRequired(true).setMinValue(1)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove tickets from a member (correction)')
      .addStringOption(o => o.setName('name').setDescription('Raffle name').setRequired(true).setAutocomplete(true))
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption(o => o.setName('tickets').setDescription('Number of tickets to remove').setRequired(true).setMinValue(1)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all raffles, or view one raffle\'s entrants')
      .addStringOption(o => o.setName('name').setDescription('Raffle name (blank = list all)').setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('draw')
      .setDescription('Draw a winner - random, weighted by ticket count')
      .addStringOption(o => o.setName('name').setDescription('Raffle name').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('end')
      .setDescription('Cancel a raffle without drawing')
      .addStringOption(o => o.setName('name').setDescription('Raffle name').setRequired(true).setAutocomplete(true))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'name') {
      const res = await query(
        `SELECT name FROM ticket_raffles WHERE guild_id=$1 AND status='active' AND name ILIKE $2 ORDER BY created_at DESC LIMIT 25`,
        [interaction.guild.id, `%${focused.value}%`]
      );
      return interaction.respond(res.rows.map(r => ({ name: r.name, value: r.name })));
    }
    return interaction.respond([]);
  },

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: `${e('wrong')} Admin only.`, ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return createRaffle(interaction);
    if (sub === 'grant') return grantTickets(interaction);
    if (sub === 'remove') return removeTickets(interaction);
    if (sub === 'list') return listRaffles(interaction);
    if (sub === 'draw') return drawWinner(interaction);
    if (sub === 'end') return endRaffle(interaction);
  },
};

async function createRaffle(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const name = interaction.options.getString('name');
  const prize = interaction.options.getString('prize');

  const existing = await query(`SELECT id FROM ticket_raffles WHERE guild_id=$1 AND name=$2 AND status='active'`, [interaction.guildId, name]);
  if (existing.rows.length) return interaction.editReply(`${e('wrong')} A raffle named **${name}** is already active.`);

  await query(
    `INSERT INTO ticket_raffles (guild_id, name, prize, created_by) VALUES ($1,$2,$3,$4)`,
    [interaction.guildId, name, prize || null, interaction.user.id]
  );

  return interaction.editReply(`${e('checkmark')} Raffle **${name}** created${prize ? ` — prize: **${prize}**` : ''}. Grant tickets with \`/ticketraffle grant\`.`);
}

async function grantTickets(interaction) {
  await interaction.deferReply();
  const name = interaction.options.getString('name');
  const user = interaction.options.getUser('user');
  const tickets = interaction.options.getInteger('tickets');

  const raffleRes = await query(`SELECT * FROM ticket_raffles WHERE guild_id=$1 AND name=$2 AND status='active'`, [interaction.guildId, name]);
  const raffle = raffleRes.rows[0];
  if (!raffle) return interaction.editReply(`${e('wrong')} No active raffle named **${name}**.`);

  const res = await query(
    `INSERT INTO ticket_raffle_entries (raffle_id, user_id, tickets) VALUES ($1,$2,$3)
     ON CONFLICT (raffle_id, user_id) DO UPDATE SET tickets = ticket_raffle_entries.tickets + $3
     RETURNING tickets`,
    [raffle.id, user.id, tickets]
  );

  return interaction.editReply(`${e('checkmark')} <@${user.id}> — you were given **${tickets}** ${RAFFLE_EMOJI} ticket${tickets === 1 ? '' : 's'} for **${name}** by <@${interaction.user.id}> — you now have **${res.rows[0].tickets}** total.`);
}

async function removeTickets(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const name = interaction.options.getString('name');
  const user = interaction.options.getUser('user');
  const tickets = interaction.options.getInteger('tickets');

  const raffleRes = await query(`SELECT * FROM ticket_raffles WHERE guild_id=$1 AND name=$2 AND status='active'`, [interaction.guildId, name]);
  const raffle = raffleRes.rows[0];
  if (!raffle) return interaction.editReply(`${e('wrong')} No active raffle named **${name}**.`);

  const entryRes = await query(`SELECT tickets FROM ticket_raffle_entries WHERE raffle_id=$1 AND user_id=$2`, [raffle.id, user.id]);
  if (!entryRes.rows.length) return interaction.editReply(`${e('wrong')} <@${user.id}> has no tickets for **${name}**.`);

  const newTotal = Math.max(0, entryRes.rows[0].tickets - tickets);
  await query(`UPDATE ticket_raffle_entries SET tickets=$1 WHERE raffle_id=$2 AND user_id=$3`, [newTotal, raffle.id, user.id]);

  return interaction.editReply(`${e('checkmark')} Removed **${tickets}** ticket${tickets === 1 ? '' : 's'} from <@${user.id}> for **${name}** — they now have **${newTotal}**.`);
}

async function listRaffles(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const name = interaction.options.getString('name');

  if (!name) {
    const res = await query(
      `SELECT r.*, COALESCE(SUM(en.tickets), 0) AS total_tickets, COUNT(en.id) AS entrant_count
       FROM ticket_raffles r LEFT JOIN ticket_raffle_entries en ON en.raffle_id = r.id
       WHERE r.guild_id=$1 AND r.status='active' GROUP BY r.id ORDER BY r.created_at DESC`,
      [interaction.guildId]
    );
    if (!res.rows.length) return interaction.editReply('No active ticket raffles. Create one with `/ticketraffle create`.');

    const lines = res.rows.map(r => `**${r.name}**${r.prize ? ` — ${r.prize}` : ''} — ${r.total_tickets} ticket(s) across ${r.entrant_count} member(s)`).join('\n');
    return interaction.editReply({ embeds: [baseEmbed(`${RAFFLE_EMOJI} Active Ticket Raffles`, '#d6c2ee', interaction.guild?.name).setDescription(lines)] });
  }

  const raffleRes = await query(`SELECT * FROM ticket_raffles WHERE guild_id=$1 AND name=$2`, [interaction.guildId, name]);
  const raffle = raffleRes.rows[0];
  if (!raffle) return interaction.editReply(`${e('wrong')} No raffle named **${name}**.`);

  const entRes = await query(`SELECT * FROM ticket_raffle_entries WHERE raffle_id=$1 AND tickets > 0 ORDER BY tickets DESC`, [raffle.id]);
  const totalTickets = entRes.rows.reduce((sum, r) => sum + r.tickets, 0);
  const entryLines = entRes.rows.length
    ? entRes.rows.map(en => `<@${en.user_id}> — ${en.tickets} ticket${en.tickets === 1 ? '' : 's'} (${totalTickets ? ((en.tickets / totalTickets) * 100).toFixed(1) : 0}% odds)`).join('\n')
    : 'No tickets granted yet.';

  const statusLine = raffle.status === 'drawn'
    ? `\nStatus: **Drawn** — winner: <@${raffle.winner_id}> (${raffle.winner_tickets}/${raffle.total_tickets} tickets)`
    : `\nStatus: **${raffle.status}**`;

  return interaction.editReply({ embeds: [baseEmbed(`${RAFFLE_EMOJI} Raffle: ${raffle.name}`, '#d6c2ee', interaction.guild?.name)
    .setDescription((raffle.prize ? `Prize: **${raffle.prize}**` : '') + statusLine)
    .addFields({ name: `Entrants — ${totalTickets} total tickets`, value: entryLines })] });
}

async function drawWinner(interaction) {
  await interaction.deferReply();
  const name = interaction.options.getString('name');

  const raffleRes = await query(`SELECT * FROM ticket_raffles WHERE guild_id=$1 AND name=$2 AND status='active'`, [interaction.guildId, name]);
  const raffle = raffleRes.rows[0];
  if (!raffle) return interaction.editReply(`${e('wrong')} No active raffle named **${name}**.`);

  const entRes = await query(`SELECT * FROM ticket_raffle_entries WHERE raffle_id=$1 AND tickets > 0`, [raffle.id]);
  if (!entRes.rows.length) return interaction.editReply(`${e('wrong')} **${name}** has no tickets to draw from.`);

  const totalTickets = entRes.rows.reduce((sum, r) => sum + r.tickets, 0);
  let roll = Math.floor(Math.random() * totalTickets);
  let winner = null;
  for (const en of entRes.rows) {
    roll -= en.tickets;
    if (roll < 0) { winner = en; break; }
  }

  await query(
    `UPDATE ticket_raffles SET status='drawn', winner_id=$1, winner_tickets=$2, total_tickets=$3, drawn_at=NOW() WHERE id=$4`,
    [winner.user_id, winner.tickets, totalTickets, raffle.id]
  );

  const attachment = new AttachmentBuilder(path.join(__dirname, '../../../assets/raffle_ticket.png'), { name: 'raffle_ticket.png' });

  const embed = baseEmbed(`<a:purplesparkle:1512912828489793626> ${raffle.name}`, '#d6c2ee', interaction.guild?.name)
    .setThumbnail('attachment://raffle_ticket.png')
    .setDescription(
      `${RAFFLE_EMOJI} <@${winner.user_id}> won the ticket raffle!\n` +
      `They had **${winner.tickets}** of **${totalTickets}** total tickets (${((winner.tickets / totalTickets) * 100).toFixed(1)}% odds).`
    );

  return interaction.editReply({ content: `🎉 <@${winner.user_id}>`, embeds: [embed], files: [attachment] });
}

async function endRaffle(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const name = interaction.options.getString('name');

  const res = await query(`UPDATE ticket_raffles SET status='cancelled' WHERE guild_id=$1 AND name=$2 AND status='active' RETURNING id`, [interaction.guildId, name]);
  if (!res.rows.length) return interaction.editReply(`${e('wrong')} No active raffle named **${name}**.`);

  return interaction.editReply(`${e('checkmark')} **${name}** cancelled — no winner drawn.`);
}
