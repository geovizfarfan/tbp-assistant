# 👑 TBP Assistant Bot

Full staff accountability, raffle, giveaway, payout, schedule, and member wins tracker for Discord.

---

## Setup

### 1. Clone & install
```bash
git clone https://github.com/geovizfarfan/tbp-assistant
cd tbp-assistant
npm install
```

### 2. Configure environment
Copy `.env.example` to `.env` and fill in:
```
DISCORD_TOKEN=your_bot_token
GUILD_ID=your_guild_id
DATABASE_URL=postgresql://...
```

### 3. Database
Run `src/utils/schema.sql` against your PostgreSQL database (Railway dashboard → Postgres Console):
```sql
\i schema.sql
```
Or paste the schema directly into the Railway Postgres console.

### 4. Deploy (Railway)
Push to GitHub → Railway auto-deploys.
The bot registers slash commands automatically on startup.

---

## Commands

### 🎟️ Raffle
| Command | Description |
|---------|-------------|
| `/raffle start prize: amount: currency: ends:` | Start a raffle with a Join button |
| `/raffle end id:` | Manually end a raffle early |
| `/raffle list` | Show active raffles |

### 🎁 Giveaway
| Command | Description |
|---------|-------------|
| `/giveaway log prize: ends: link: amount: currency:` | Log a giveaway |
| `/giveaway end id: winner:` | End giveaway and log winner |
| `/giveaway payout id:` | Confirm payout paid |
| `/giveaway list` | List recent giveaways |

### 🎮 Game
| Command | Description |
|---------|-------------|
| `/game log game: link: prize: amount: currency:` | Log a hosted game |
| `/game end link: winner:` | End game and log winner |
| `/game payout id:` | Confirm game payout paid |

### 👤 Staff
| Command | Description |
|---------|-------------|
| `/staff add user: role: currency: pay:` | Add/update staff member |
| `/staff remove user:` | Deactivate staff |
| `/staff list` | Full staff list by role |
| `/staff report user:` | Full individual staff report |

### 📅 Schedule
| Command | Description |
|---------|-------------|
| `/schedule add date: time: type:` | Submit hosting availability |
| `/schedule checkin id:` | Check in to shift |
| `/schedule checkout id:` | Check out of shift |
| `/schedule list` | View upcoming schedules |
| `/schedule mark-missed id:` | [Admin] Mark a shift missed |

### 🏆 Member Wins
| Command | Description |
|---------|-------------|
| `/member-wins user:` | View all wins, payout status, timestamps |

### ⚙️ Admin
| Command | Description |
|---------|-------------|
| `/admin payroll` | Full payroll overview with due dates |
| `/admin paycheck-check user:` | Eligibility check for staff pay |
| `/admin late-payouts` | All pending/late payout records |
| `/admin missed-schedules` | All missed shift records |
| `/admin ticket-report` | Response times per staff |
| `/admin set-requirements` | Configure pay requirements |
| `/admin mark-paid user: amount:` | Log staff payment |

---

## Pay Eligibility Logic

The bot evaluates each staff member against requirements set via `/admin set-requirements`:

| Result | Condition |
|--------|-----------|
| ✅ Full Pay | All minimums met, no violations |
| ⚠️ Partial Pay | Below minimum hosted counts |
| 🔍 Admin Review | Exceeded late payout or missed shift limits |
| ❌ Not Eligible | Zero activity this period |

**Defaults:**
- Min games hosted: 10
- Min giveaways: 2
- Min raffles: 2
- Max late payouts: 3
- Max missed shifts: 1
- Ticket response limit: 30 minutes
- Pay period: 30 days

---

## Payout Reminder Escalation

After a winner is picked (raffle/giveaway/game), the bot auto-reminds:

| Time | Action |
|------|--------|
| 15 min | Tag host |
| 1 hour | Tag host + admins |
| 2 hours | Tag host + admins + mark Late |
| 24 hours | Appears on staff report |

---

## Ticket Tracking

The bot auto-detects channels with "ticket" in the name and tracks:
- Ticket open time
- First staff reply time
- Response time in minutes
- Late response flag (exceeds configured limit)

---

## File Structure

```
src/
  index.js               — Bot entry point + command loader
  commands/
    admin/admin.js        — /admin subcommands
    staff/staff.js        — /staff subcommands
    raffle/raffle.js      — /raffle subcommands
    giveaway/giveaway.js  — /giveaway subcommands
    games/game.js         — /game subcommands
    schedule/schedule.js  — /schedule subcommands
    member/member-wins.js — /member-wins
  utils/
    database.js           — PostgreSQL pool + initDB
    schema.sql            — Full DB schema
    embeds.js             — Shared embed helpers, timestamps
    eligibility.js        — Pay eligibility calculator
    reminders.js          — Payout reminder loop (runs every 5 min)
  events/
    ticketTracker.js      — Auto ticket response tracking
```
