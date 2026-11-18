import "dotenv/config";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalSnowflake(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!/^\d{17,20}$/.test(value)) {
    throw new Error(`${name} must be a Discord ID containing 17-20 digits`);
  }
  return value;
}

function optionalDiscordWebhookUrl(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid Discord webhook URL`);
  }
  if (
    url.protocol !== "https:" ||
    !["discord.com", "discordapp.com"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/api\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname)
  ) {
    throw new Error(`${name} must be a valid Discord webhook URL`);
  }
  return value;
}

function requiredSnowflake(name: string): string {
  const value = requiredEnv(name);
  if (!/^\d{17,20}$/.test(value)) {
    throw new Error(`${name} must be a Discord ID containing 17-20 digits`);
  }
  return value;
}

export const config = {
  token: requiredEnv("DISCORD_TOKEN"),
  clientId: requiredSnowflake("DISCORD_CLIENT_ID"),
  guildId: optionalSnowflake("DISCORD_GUILD_ID"),
  logWebhookUrl: optionalDiscordWebhookUrl("BOT_LOG_WEBHOOK_URL")
};
