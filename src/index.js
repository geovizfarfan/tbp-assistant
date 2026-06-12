require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const { initDB } = require('./utils/database');
const { startReminderLoop } = require('./utils/reminders');
const { handleTicketMessage, handleThreadCreate, handleChannelDelete } = require('./events/ticketTracker');
const { loadAppEmojis } = require('./utils/appEmojis');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = new Collection();

// Load all commands recursively
function loadCommands(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommands(fullPath);
    } else if (entry.name.endsWith('.js')) {
      const cmd = require(fullPath);
      if (cmd.data && cmd.execute) {
        client.commands.set(cmd.data.name, cmd);
        console.log(`[Commands] Loaded: ${cmd.data.name}`);
      }
    }
  }
}

loadCommands(path.join(__dirname, 'commands'));


async function restoreRaffles(client) {
  try {
    const { query } = require('./utils/database');
    const now = new Date();
    const res = await query(
      `SELECT * FROM raffles WHERE status='active'`,
      []
    );
    console.log(`[Raffles] Restoring ${res.rows.length} active raffles...`);
    for (const raffle of res.rows) {
      const endsAt = new Date(raffle.ends_at);
      const msLeft = endsAt.getTime() - now.getTime();
      const { default: autoEnd } = await import('./commands/raffle/autoEndRaffle.js').catch(() => ({ default: null }));
      if (msLeft <= 0) {
        // Already expired - end it now
        const { autoEndRaffle } = require('./commands/raffle/raffle.js');
        if (autoEndRaffle) await autoEndRaffle(client, raffle.id, raffle.guild_id, raffle.channel_id, raffle.message_id);
      } else {
        // Reschedule
        const { autoEndRaffle } = require('./commands/raffle/raffle.js');
        if (autoEndRaffle) setTimeout(() => autoEndRaffle(client, raffle.id, raffle.guild_id, raffle.channel_id, raffle.message_id), msLeft);
        console.log(`[Raffles] Raffle #${raffle.id} rescheduled, ends in ${Math.round(msLeft/60000)}min`);
      }
    }
  } catch (err) {
    console.error('[Raffles] Restore failed:', err.message);
  }
}

client.once('ready', async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  await loadAppEmojis(client.user.id, process.env.DISCORD_TOKEN);
  await restoreRaffles(client);
  await initDB();
  startReminderLoop(client);

  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commands = [...client.commands.values()].map(c => c.data.toJSON());
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands }
    );
    console.log(`[Commands] Registered ${commands.length} commands to guild ${process.env.GUILD_ID}`);
  } catch (err) {
    console.error('[Commands] Failed to register:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[Command Error] ${interaction.commandName}:`, err);
    const msg = { content: '❌ An error occurred.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

// Ticket tracking
client.on('messageCreate', handleTicketMessage);
client.on('channelDelete', handleChannelDelete);
client.on('threadCreate', (thread) => handleThreadCreate(thread, client));

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  // Raffle join button
  if (interaction.customId === 'raffle_join') {
    try {
      const { query } = require('./utils/database');
      const { e } = require('./utils/appEmojis');
      const raffleRes = await query(
        `SELECT * FROM raffles WHERE channel_id=$1 AND message_id=$2 AND status='active'`,
        [interaction.channelId, interaction.message.id]
      );
      if (!raffleRes.rows.length) {
        return interaction.reply({ content: 'This raffle has ended.', ephemeral: true });
      }
      const raffle = raffleRes.rows[0];
      await query(
        `INSERT INTO raffle_entries (raffle_id, user_id, username) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [raffle.id, interaction.user.id, interaction.user.username]
      );
      const countRes = await query(`SELECT COUNT(*) FROM raffle_entries WHERE raffle_id=$1`, [raffle.id]);
      const count = parseInt(countRes.rows[0].count);
      try {
        const { baseEmbed, tsF, tsR, COLORS } = require('./utils/embeds');
        const prizeText = raffle.prize_amount ? `${raffle.prize_amount} ${raffle.prize}` : raffle.prize || 'Prize';
        const updatedEmbed = baseEmbed(`${e('raffle')} RAFFLE`, COLORS.lightpurple, interaction.guild?.name)
          .setDescription(`**Prize:** ${prizeText}\n**Host:** <@${raffle.host_id}>\n**Ends:** ${tsF(raffle.ends_at)} (${tsR(raffle.ends_at)})`)
          .addFields({ name: `${e('members')} Entries`, value: `${count} entered` })
          .setFooter({ text: `${interaction.guild?.name} — Click Join Raffle to enter!` });
        await interaction.message.edit({ embeds: [updatedEmbed] });
      } catch {}
      await interaction.reply({ content: `${e('checkmark')} You're in the raffle! Good luck!`, ephemeral: true });
    } catch (err) {
      console.error('[RaffleJoin] Error:', err.message);
      await interaction.reply({ content: 'Something went wrong joining the raffle.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (!['game_ping_join', 'game_ping_leave'].includes(interaction.customId)) return;
  try {
    const { query } = require('./utils/database');
    const cfg = await query(`SELECT game_ping_role_id FROM guild_config WHERE guild_id=$1`, [interaction.guildId]);
    if (!cfg.rows.length || !cfg.rows[0].game_ping_role_id) return interaction.reply({ content: 'Game ping role not configured.', ephemeral: true });
    const roleId = cfg.rows[0].game_ping_role_id;
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (interaction.customId === 'game_ping_join') {
      await member.roles.add(roleId);
      await interaction.reply({ content: '🔔 You will now be pinged for new games!', ephemeral: true });
    } else {
      await member.roles.remove(roleId);
      await interaction.reply({ content: '🔕 You will no longer be pinged for new games.', ephemeral: true });
    }
  } catch (err) {
    console.error('[GamePing] Button error:', err.message);
    await interaction.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);

