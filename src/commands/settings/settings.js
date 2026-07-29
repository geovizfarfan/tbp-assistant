const { SlashCommandBuilder } = require('discord.js');
const { e } = require('../../utils/appEmojis');
const { baseEmbed, COLORS } = require('../../utils/embeds');
const { query } = require('../../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure bot settings for this server')
    .addSubcommand(sub => sub
      .setName('requirements')
      .setDescription('Set staff pay requirements — per role, or Default for anyone without an override')
      .addStringOption(o => o.setName('role').setDescription('Staff role').setRequired(true)
        .addChoices(
          { name: 'Default (fallback for any role without its own)', value: 'default' },
          { name: 'Owner',       value: 'owner'       },
          { name: 'Admin',       value: 'admin'       },
          { name: 'Mod',         value: 'staff'       },
          { name: 'Host',        value: 'host'        },
          { name: 'Rumble Host', value: 'rumble_host' },
        ))
      .addIntegerOption(o => o.setName('min_games').setDescription('Min games per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_auto_games').setDescription('Min auto-games per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_raffles').setDescription('Min raffles per period').setRequired(false))
      .addIntegerOption(o => o.setName('min_giveaways').setDescription('Min giveaways per period').setRequired(false))
      .addIntegerOption(o => o.setName('bonus_per_game').setDescription('Bonus currency per game hosted').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('daily-goals')
      .setDescription('Set daily goals per staff role')
      .addStringOption(o => o.setName('role').setDescription('Staff role').setRequired(true)
        .addChoices(
          { name: 'Owner',       value: 'owner'       },
          { name: 'Admin',       value: 'admin'       },
          { name: 'Mod',         value: 'staff'       },
          { name: 'Host',        value: 'host'        },
          { name: 'Rumble Host', value: 'rumble_host' },
        ))
      .addIntegerOption(o => o.setName('games').setDescription('Daily games goal').setRequired(false))
      .addIntegerOption(o => o.setName('autogames').setDescription('Daily auto-games goal').setRequired(false))
      .addIntegerOption(o => o.setName('payouts').setDescription('Daily payouts goal').setRequired(false))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'requirements') return setRequirements(interaction);
    if (sub === 'daily-goals') return setDailyGoals(interaction);
  },
};




async function setRequirements(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const role = interaction.options.getString('role');
  const fields = {
    min_games_hosted:      interaction.options.getInteger('min_games'),
    min_rumble:            interaction.options.getInteger('min_auto_games'),
    min_raffles_hosted:    interaction.options.getInteger('min_raffles'),
    min_giveaways_hosted:  interaction.options.getInteger('min_giveaways'),
    bonus_per_game:        interaction.options.getInteger('bonus_per_game'),
  };
  if (Object.values(fields).every(v => v === null)) {
    return interaction.editReply({ content: e('wrong') + ' Please provide at least one field.' });
  }
  await query(
    `INSERT INTO pay_requirements (guild_id, role, min_games_hosted, min_rumble, min_raffles_hosted, min_giveaways_hosted, bonus_per_game)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (guild_id, role) DO UPDATE SET
       min_games_hosted     = COALESCE($3, pay_requirements.min_games_hosted),
       min_rumble           = COALESCE($4, pay_requirements.min_rumble),
       min_raffles_hosted   = COALESCE($5, pay_requirements.min_raffles_hosted),
       min_giveaways_hosted = COALESCE($6, pay_requirements.min_giveaways_hosted),
       bonus_per_game       = COALESCE($7, pay_requirements.bonus_per_game),
       updated_at = NOW()`,
    [interaction.guildId, role, fields.min_games_hosted, fields.min_rumble, fields.min_raffles_hosted, fields.min_giveaways_hosted, fields.bonus_per_game]
  );
  const roleLabels = { default: 'Default', owner: 'Owner', admin: 'Admin', staff: 'Mod', host: 'Host', rumble_host: 'Rumble Host' };
  await interaction.editReply({ content: e('checkmark') + ' Pay requirements updated for **' + (roleLabels[role] || role) + '**.' });
}

async function setDailyGoals(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const role      = interaction.options.getString('role');
  const games     = interaction.options.getInteger('games');
  const autogames = interaction.options.getInteger('autogames');
  const payouts   = interaction.options.getInteger('payouts');
  if (games === null && autogames === null && payouts === null) {
    return interaction.editReply({ content: e('wrong') + ' Please provide at least one goal.' });
  }
  await query(
    `INSERT INTO daily_goals (guild_id, role, games, autogames, payouts) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (guild_id, role) DO UPDATE SET games=COALESCE($3,daily_goals.games), autogames=COALESCE($4,daily_goals.autogames), payouts=COALESCE($5,daily_goals.payouts), updated_at=NOW()`,
    [interaction.guildId, role, games, autogames, payouts]
  );
  const roleLabels = { owner:'Owner', admin:'Admin', staff:'Mod', host:'Host', rumble_host:'Rumble Host' };
  await interaction.editReply({ content: e('checkmark') + ' Daily goals set for **' + (roleLabels[role]||role) + '**.' });
}



