# Discord Bot

A secure, customizable all-in-one Discord bot starter built with TypeScript and
discord.js. It includes moderation, server/user utilities, polls, announcements,
welcome messages, per-server embed colors, and fun commands. Commands are
registered as slash commands and privileged actions are permission- and
role-hierarchy-checked.

## Requirements

- Node.js 20.11 or newer
- A Discord application and bot created in the
  [Discord Developer Portal](https://discord.com/developers/applications)

## Setup

1. Copy `.env.example` to `.env` and set `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`.
   Set `DISCORD_GUILD_ID` to register commands instantly in one server during
   development. Leave it empty to register global commands. Optionally set
   `BOT_DATA_DIR` to choose where server customizations are stored.
2. In the Developer Portal, enable **Server Members Intent** under *Bot →
   Privileged Gateway Intents*. Invite the bot with the `bot` and
   `applications.commands` scopes. Grant only the permissions required for the
   features you intend to use (listed below).
3. Install dependencies and build:

   ```sh
   npm install
   npm run build
   npm run deploy:commands
   npm start
   ```

Never commit `.env`, share the bot token, or put credentials in source code.
If a token is exposed, reset it immediately in the Developer Portal.

## Commands

| Command | Purpose | Required permission |
| --- | --- | --- |
| `/help` | Show available commands | None |
| `/ping` | Check bot/API latency | None |
| `/server` | Show server details | Embed Links (bot) |
| `/user` | Show a user's profile details | Embed Links (bot) |
| `/avatar` | Show a user's avatar | Embed Links (bot) |
| `/coinflip` | Flip a coin | None |
| `/roll` | Roll a number in a chosen range | None |
| `/choose` | Choose randomly from up to ten options | None |
| `/eightball` | Get a magic 8-ball answer | None |
| `/poll` | Create a reaction-based poll with up to five choices | Send Messages, Embed Links, Add Reactions (bot) |
| `/settings view` | View this server's bot settings | Manage Server (user) |
| `/settings color` | Customize embed color per server | Manage Server (user) |
| `/settings welcome` | Configure a welcome channel and message | Manage Server (user); View Channel, Send Messages (bot) |
| `/settings disable-welcome` | Turn off welcome messages | Manage Server (user) |
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
  this bot does not read arbitrary message content.
- Enable the **Server Members Intent** in the Developer Portal. It is used only
  for fetching members and checking role hierarchy before moderation actions.
- Replies to moderation actions are private where practical. Polls and
  announcements, random choices, and welcome messages disable mention parsing
  to prevent accidental mass mentions.
- Discord permission and role checks are applied both to command definitions
  and at runtime for privileged operations.
- Per-server settings are stored as JSON under `BOT_DATA_DIR` (default: `data/`).
  Back up this directory if you want to preserve customizations. Malformed
  settings fail startup rather than silently discarding configuration.
- The bot does not collect message content or track user activity.

Welcome templates support `{user}`, `{server}`, and `{count}`. Only members
with Manage Server can change welcome settings or the server's embed color.

The bot must be online to handle commands. Re-run `npm run deploy:commands`
after changing slash command definitions.
