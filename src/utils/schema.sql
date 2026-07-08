-- TBP Assistant Bot Database Schema

-- Staff / Role tracking
CREATE TABLE IF NOT EXISTS staff (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','staff','host')),
  joined_staff_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE,
  pay_currency TEXT DEFAULT 'MEE6' CHECK (pay_currency IN ('MEE6','SINS','OOS')),
  last_paid_at TIMESTAMPTZ,
  next_pay_due_at TIMESTAMPTZ,
  pay_amount INTEGER DEFAULT 0,
  added_by TEXT,
  notes TEXT
);

-- Pay periods
CREATE TABLE IF NOT EXISTS pay_periods (
  id SERIAL PRIMARY KEY,
  staff_id TEXT REFERENCES staff(user_id),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  amount_owed INTEGER DEFAULT 0,
  amount_paid INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'MEE6',
  paid_at TIMESTAMPTZ,
  on_time BOOLEAN,
  late_reason TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pay requirements config (per guild)
CREATE TABLE IF NOT EXISTS pay_requirements (
  guild_id TEXT PRIMARY KEY,
  min_games_hosted INTEGER DEFAULT 10,
  min_giveaways_hosted INTEGER DEFAULT 2,
  min_raffles_hosted INTEGER DEFAULT 2,
  max_late_payouts INTEGER DEFAULT 3,
  max_missed_shifts INTEGER DEFAULT 1,
  ticket_response_limit_minutes INTEGER DEFAULT 30,
  pay_period_days INTEGER DEFAULT 30,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raffles
CREATE TABLE IF NOT EXISTS raffles (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  host_id TEXT NOT NULL,
  prize TEXT NOT NULL,
  prize_amount INTEGER,
  currency TEXT DEFAULT 'MEE6',
  ends_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  winner_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  payout_status TEXT DEFAULT 'pending' CHECK (payout_status IN ('pending','paid','not_claimed','n/a')),
  payout_confirmed_at TIMESTAMPTZ,
  payout_confirmed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raffle entries
CREATE TABLE IF NOT EXISTS raffle_entries (
  id SERIAL PRIMARY KEY,
  raffle_id INTEGER REFERENCES raffles(id),
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(raffle_id, user_id)
);

-- Giveaways
CREATE TABLE IF NOT EXISTS giveaways (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  message_link TEXT,
  host_id TEXT NOT NULL,
  prize TEXT NOT NULL,
  prize_amount INTEGER,
  currency TEXT DEFAULT 'MEE6',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  winner_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  payout_status TEXT DEFAULT 'pending' CHECK (payout_status IN ('pending','paid','late')),
  payout_confirmed_at TIMESTAMPTZ,
  payout_confirmed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Game logs
CREATE TABLE IF NOT EXISTS game_logs (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT,
  message_link TEXT,
  host_id TEXT NOT NULL,
  game_name TEXT NOT NULL,
  prize TEXT,
  prize_amount INTEGER,
  currency TEXT DEFAULT 'MEE6',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  winner_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  payout_status TEXT DEFAULT 'pending' CHECK (payout_status IN ('pending','paid','late','n/a')),
  payout_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payout reminders (active tracking)
CREATE TABLE IF NOT EXISTS payout_reminders (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('raffle','giveaway','game')),
  ref_id INTEGER NOT NULL,
  host_id TEXT NOT NULL,
  winner_id TEXT NOT NULL,
  prize TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  last_reminded_at TIMESTAMPTZ,
  reminder_count INTEGER DEFAULT 0,
  escalation_level INTEGER DEFAULT 0,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Staff schedules
CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  scheduled_date DATE NOT NULL,
  time_start TEXT NOT NULL,
  time_end TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Games','Giveaway','Raffle','General','Other')),
  checked_in_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','missed','late')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ticket tracking
CREATE TABLE IF NOT EXISTS ticket_logs (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  ticket_number TEXT,
  opened_at TIMESTAMPTZ NOT NULL,
  opened_by TEXT NOT NULL,
  first_staff_reply_at TIMESTAMPTZ,
  first_staff_responder TEXT,
  response_time_minutes INTEGER,
  closed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'open' CHECK (status IN ('open','closed')),
  late_response BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Member wins (aggregated view friendly)
CREATE TABLE IF NOT EXISTS member_wins (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('raffle','giveaway','game')),
  ref_id INTEGER NOT NULL,
  prize TEXT NOT NULL,
  prize_amount INTEGER,
  currency TEXT,
  host_id TEXT,
  won_at TIMESTAMPTZ NOT NULL,
  payout_status TEXT DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Game schedule board (one pinned message per guild the bot manages)
CREATE TABLE IF NOT EXISTS game_schedule_board (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raffle prize image URLs (built-in + custom)
CREATE TABLE IF NOT EXISTS raffle_images (
  guild_id TEXT NOT NULL,
  prize_key TEXT NOT NULL,
  image_url TEXT NOT NULL,
  PRIMARY KEY (guild_id, prize_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role);
CREATE INDEX IF NOT EXISTS idx_raffles_guild ON raffles(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_giveaways_guild ON giveaways(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_game_logs_guild ON game_logs(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_member_wins_user ON member_wins(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_staff ON schedules(guild_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_payout_reminders_active ON payout_reminders(resolved, guild_id);

-- Boosters
CREATE TABLE IF NOT EXISTS boosters (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  boost_tier TEXT DEFAULT 'basic' CHECK (boost_tier IN ('basic','standard','premium')),
  amount_owed INTEGER DEFAULT 0,
  currency TEXT DEFAULT 'Crowns',
  last_paid_at TIMESTAMPTZ,
  next_pay_due_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE,
  added_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_boosters_guild ON boosters(guild_id, active);

-- Guild config (winner channel, ticket channel, etc.)
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  winner_channel_id TEXT,
  ticket_channel_id TEXT,
  schedule_channel_id TEXT,
  staff_notif_channel_id TEXT,
  game_transcript_channel_id TEXT,
  mod_role_id TEXT,
  admin_role_id TEXT,
  game_ping_role_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wheel role-based bonus entries
CREATE TABLE IF NOT EXISTS wheel_role_bonuses (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  role_name TEXT,
  bonus_entries INTEGER NOT NULL CHECK (bonus_entries > 0),
  added_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(guild_id, role_id)
);

-- Private rooms (auto-archiving private threads)
CREATE TABLE IF NOT EXISTS private_rooms (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  parent_channel_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','archived','deleted')),
  UNIQUE(guild_id, user_id, status)
);

-- Goos Date reminder config
CREATE TABLE IF NOT EXISTS goosdate_config (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  last_sent_minute_key TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AFK status tracking (global across all servers)
CREATE TABLE IF NOT EXISTS afk_status (
  user_id TEXT PRIMARY KEY,
  reason TEXT DEFAULT 'AFK',
  set_at TIMESTAMPTZ DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ
);

-- Add claim time columns to guild_config if they don't exist
-- (handled via ALTER TABLE in Railway console since table already exists)
-- claim_hours_default INTEGER DEFAULT 6
-- claim_hours_booster INTEGER DEFAULT 12

-- Rumble Royale integration
CREATE TABLE IF NOT EXISTS rr_channel_config (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  winner_role_id TEXT,
  ping_role1_id TEXT,
  ping_role2_id TEXT,
  ping_role3_id TEXT,
  next_channel_id TEXT,
  reward_amount BIGINT DEFAULT 0,
  battle_image TEXT,
  embed_color TEXT DEFAULT '#cab2fb',
  last_host TEXT,
  total_games INT DEFAULT 0,
  total_players INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rr_stats (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT,
  user_id TEXT NOT NULL,
  username TEXT,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  games INT DEFAULT 0,
  UNIQUE(guild_id, user_id)
);

-- RR guild config (log channel)
CREATE TABLE IF NOT EXISTS rr_guild_config (
  guild_id TEXT PRIMARY KEY,
  log_channel_id TEXT
);

-- RR achievements (tracks who collected all roles)
CREATE TABLE IF NOT EXISTS rr_achievements (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  achieved_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(guild_id, user_id)
);

ALTER TABLE rr_achievements ADD COLUMN IF NOT EXISTS completions INT DEFAULT 1;

ALTER TABLE rr_channel_config ADD COLUMN IF NOT EXISTS battle_title TEXT DEFAULT NULL;
ALTER TABLE rr_channel_config ADD COLUMN IF NOT EXISTS battle_description TEXT DEFAULT NULL;

-- RR Seasons
CREATE TABLE IF NOT EXISTS rr_seasons (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rr_season_channels (
  id SERIAL PRIMARY KEY,
  season_id INT NOT NULL,
  channel_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  UNIQUE(season_id, channel_id)
);

-- Rumble Grind temp channels
CREATE TABLE IF NOT EXISTS grind_config (
  guild_id TEXT PRIMARY KEY,
  panel_channel_id TEXT,
  panel_message_id1 TEXT,
  panel_message_id2 TEXT,
  role_id TEXT,
  max_channels INT DEFAULT 50,
  duration_hours INT DEFAULT 1,
  embed_color TEXT DEFAULT '#d6c2ee'
);

CREATE TABLE IF NOT EXISTS grind_channels (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS pingpanel_sticky (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  message_id TEXT,
  title TEXT,
  description TEXT,
  color TEXT DEFAULT '#d6c2ee',
  UNIQUE(guild_id, channel_id)
);

ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS boost_channel_id TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS sticky_messages (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  content TEXT NOT NULL,
  title TEXT,
  color TEXT DEFAULT '#d6c2ee',
  UNIQUE(guild_id, channel_id)
);

-- Ticket system
CREATE TABLE IF NOT EXISTS ticket_config (
  guild_id TEXT PRIMARY KEY,
  staff_role_id TEXT,
  category_id TEXT,
  transcript_channel_id TEXT,
  max_open INT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ticket_panels (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#d6c2ee',
  open_message TEXT,
  single_button BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS ticket_types (
  id SERIAL PRIMARY KEY,
  panel_id INT NOT NULL,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT,
  description TEXT,
  questions TEXT,
  open_message TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type_name TEXT,
  panel_id INT,
  status TEXT DEFAULT 'open',
  rating INT,
  closed_at TIMESTAMPTZ,
  closed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS purge_role_id TEXT DEFAULT NULL;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS claimed_by TEXT DEFAULT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS close_reason TEXT DEFAULT NULL;

ALTER TABLE ticket_config ADD COLUMN IF NOT EXISTS staff_channel_id TEXT DEFAULT NULL;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS transcript_message_id TEXT DEFAULT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS transcript_channel_id TEXT DEFAULT NULL;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS staff_message_id TEXT DEFAULT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS staff_channel_id_ref TEXT DEFAULT NULL;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS staff_message_id TEXT DEFAULT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS staff_channel_id_ref TEXT DEFAULT NULL;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS staff_message_id TEXT DEFAULT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS staff_channel_id_ref TEXT DEFAULT NULL;

ALTER TABLE rr_channel_config ADD COLUMN IF NOT EXISTS other_reward TEXT DEFAULT NULL;
ALTER TABLE rr_channel_config ADD COLUMN IF NOT EXISTS host_description TEXT DEFAULT NULL;

ALTER TABLE rr_channel_config ADD COLUMN IF NOT EXISTS other_reward TEXT DEFAULT NULL;
ALTER TABLE rr_channel_config ADD COLUMN IF NOT EXISTS host_description TEXT DEFAULT NULL;
ALTER TABLE rr_channel_config ADD COLUMN IF NOT EXISTS announce_style TEXT DEFAULT 'embed';

CREATE TABLE IF NOT EXISTS shop_config (
  guild_id TEXT PRIMARY KEY,
  shop_channel_id TEXT,
  fulfillment_channel_id TEXT,
  message_id TEXT
);

CREATE TABLE IF NOT EXISTS shop_items (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price BIGINT NOT NULL,
  type TEXT NOT NULL,
  role_id TEXT,
  emoji TEXT,
  limit_per_user INT,
  duration_hours INT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  position INT NOT NULL DEFAULT 0
);
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General';

CREATE TABLE IF NOT EXISTS shop_panel_messages (
  guild_id TEXT NOT NULL,
  category TEXT NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, category)
);

CREATE TABLE IF NOT EXISTS shop_purchases (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  chosen_emoji TEXT,
  expires_at TIMESTAMPTZ,
  expired BOOLEAN NOT NULL DEFAULT FALSE,
  purchased_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_panels (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#d6c2ee',
  style TEXT NOT NULL DEFAULT 'dropdown',
  UNIQUE (guild_id, name)
);

CREATE TABLE IF NOT EXISTS role_panel_options (
  id SERIAL PRIMARY KEY,
  panel_id INTEGER NOT NULL REFERENCES role_panels(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (panel_id, role_id)
);

CREATE TABLE IF NOT EXISTS pay_sellers (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS payment_methods (
  guild_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  paypal TEXT,
  venmo TEXT,
  cashapp TEXT,
  applepay TEXT,
  zelle TEXT,
  PRIMARY KEY (guild_id, seller_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  amount_paid NUMERIC DEFAULT 0,
  service TEXT NOT NULL,
  method TEXT NOT NULL,
  notes TEXT,
  status TEXT DEFAULT 'unpaid',
  paid_at TIMESTAMPTZ,
  paid_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
