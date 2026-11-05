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
  guildId: optionalSnowflake("DISCORD_GUILD_ID")
};
