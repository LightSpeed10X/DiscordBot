# Discord Bot

A secure, customizable all-in-one Discord bot starter built with TypeScript and
discord.js. It includes moderation, Discord-native spam protection, activity
levels, server/user utilities, polls, announcements, welcome messages,
per-server embed colors, and fun commands. Commands are registered as slash
commands and privileged actions are permission- and role-hierarchy-checked.

## Requirements

- Node.js 20.11 or newer
- A Discord application and bot created in the
  [Discord Developer Portal](https://discord.com/developers/applications)

## Setup

1. Copy `.env.example` to `.env` and set `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`.
   Set `DISCORD_GUILD_ID` to register commands instantly in one server during
   development. Leave it empty to register global commands. Optionally set
   `BOT_DATA_DIR` to choose where server customizations are stored. Set
   `BOT_LOG_WEBHOOK_URL` to a Discord webhook URL to receive slash-command logs;
   leave it empty to disable webhook logging.
2. To enable the local web dashboard, set `DISCORD_CLIENT_SECRET` and a
   `DASHBOARD_SESSION_SECRET` of at least 32 characters. Add
   `http://localhost:3000/auth/callback` to the application's OAuth2 redirect
   URLs in the Developer Portal. The dashboard is disabled if these secrets are
   unset. `DASHBOARD_BASE_URL` and `DASHBOARD_PORT` are optional.
3. In the Developer Portal, enable **Server Members Intent** under *Bot →
   Privileged Gateway Intents*. Invite the bot with the `bot` and
   `applications.commands` scopes. Grant only the permissions required for the
   features you intend to use (listed below).
4. Install dependencies and build:

   ```sh
   npm install
   npm run build
   npm run deploy:commands
   npm start
   ```

Never commit `.env`, share the bot token, or put credentials in source code.
If a token is exposed, reset it immediately in the Developer Portal.
To enable command logs, create a webhook in a dedicated Discord channel and add
its URL as `BOT_LOG_WEBHOOK_URL` in `.env`. Treat this URL as a secret too.

## Commands

| Command | Purpose | Required permission |
| --- | --- | --- |
| `/help` | Show available commands | None |
| `/ping` | Check bot/API latency | None |
| `/server` | Show server details | Embed Links (bot) |
| `/user` | Show a user's profile details | Embed Links (bot) |
| `/avatar` | Show a user's avatar | Embed Links (bot) |
| `/rank` | Show a member's activity level | None |
| `/leaderboard` | Show the server's activity leaderboard | None |
| `/coinflip` | Flip a coin | None |
| `/roll` | Roll a number in a chosen range | None |
| `/choose` | Choose randomly from up to ten options | None |
| `/eightball` | Get a magic 8-ball answer | None |
| `/poll` | Create a reaction-based poll with up to five choices | Send Messages, Embed Links, Add Reactions (bot) |
| `/settings view` | View this server's bot settings | Manage Server (user) |
| `/settings color` | Customize embed color per server | Manage Server (user) |
| `/settings welcome` | Configure a welcome channel and message | Manage Server (user); View Channel, Send Messages (bot) |
| `/settings disable-welcome` | Turn off welcome messages | Manage Server (user) |
| Dashboard → Quick setup | Configure welcome, spam protection, and activity levels | Manage Server (user); Manage Server (bot) for automod |
| Dashboard → Server tools | Set slowmode, post announcements, clear recent messages, and timeout a member | Manage Channels, Manage Messages, or Moderate Members (user and bot, by action) |
| `/announce` | Post an announcement in the current channel | Manage Messages (user); Send Messages (bot) |
| `/clear` | Bulk-delete up to 100 recent messages | Manage Messages (user and bot) |
| `/slowmode` | Set the current channel's slowmode | Manage Channels (user and bot) |
| `/timeout` | Timeout a member for up to 28 days | Moderate Members (user and bot) |
| `/kick` | Remove a member from the server | Kick Members (user and bot) |
| `/ban` | Ban a member and optionally delete up to 7 days of messages | Ban Members (user and bot) |

Moderation commands reject self-targets, the bot itself, members above the
moderator's role, and targets the bot cannot moderate. Discord's own permission
checks remain authoritative. Do not grant Administrator unless truly needed.

## Security and operations

- Secrets are loaded from environment variables and are never printed.
- Slash commands require fewer gateway intents than message-based command bots;
  this bot does not read arbitrary message content. Activity leveling counts
  message events without accessing or storing message text.
- Activity leveling is opt-in per server, awards 15–25 XP at most once per
  member per minute, and stores totals in `data/levels.json`. Rank progression
  uses a quadratic XP threshold; `/rank` and `/leaderboard` expose current totals.
- Optional auto-moderation creates Discord-native spam and mention-spam rules
  owned by the bot. Discord applies those rules; the bot does not inspect message
  text. The bot needs Manage Server permission to create or edit these rules.
- Dashboard activity can be sent to a per-server Discord webhook configured in
  Quick setup. If none is set, `BOT_LOG_WEBHOOK_URL` is used when configured.
  Webhook URLs are stored in the local settings file, never returned to the
  browser, and never included in audit messages. Treat the settings directory as
  secret-bearing and keep it out of source control and untrusted backups.
  Announcement contents are not copied to the webhook.
- Enable the **Server Members Intent** in the Developer Portal. It is used only
  for fetching members and checking role hierarchy before moderation actions.
- All slash-command replies, including settings and moderation results, are
  visible to everyone in the channel. Polls and announcements, random choices,
  and welcome messages disable mention parsing to prevent accidental mass
  mentions.
- When `BOT_LOG_WEBHOOK_URL` is configured, command logs include the command,
  timestamp, user name and ID, server/channel IDs, and whether the handler
  completed or errored. Option values are not logged. Treat the webhook URL as
  a secret and do not share or commit it.
- The optional local dashboard is served only on `127.0.0.1`, uses Discord OAuth,
  and only lists servers where the signed-in user has Manage Server and the bot
  is installed. It keeps recent command metadata locally under `BOT_DATA_DIR`.
  Do not expose this development dashboard to the public internet; production
  deployment needs HTTPS and a persistent session store.
- Discord permission and role checks are applied both to command definitions
  and at runtime for privileged operations.
- Per-server settings are stored as JSON under `BOT_DATA_DIR` (default: `data/`).
  Back up this directory if you want to preserve customizations. Malformed
  settings fail startup rather than silently discarding configuration.
- The bot does not read arbitrary message content. When command logging is
  enabled, it records command metadata but never command option values.

Welcome templates support `{user}`, `{server}`, and `{count}`. Only members
with Manage Server can change welcome settings or the server's embed color.

## Local dashboard

After OAuth is configured and the bot is running, open
`http://localhost:3000`. Sign in with Discord to see servers where you have
Manage Server and the bot is installed. The dashboard includes an overview, server setup, activity levels, Discord
auto-moderation, channel slowmode controls, announcements, recent-message
cleanup, member timeouts, a command browser, and recent command activity.
Moderation actions check the signed-in user's permissions, the bot's channel
permissions, and (for timeouts) role hierarchy.

The bot must be online to handle commands. Re-run `npm run deploy:commands`
after changing slash command definitions.
