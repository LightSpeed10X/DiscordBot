import "dotenv/config";
import { isDiscordWebhookUrl } from "./webhooks.js";

export interface DashboardConfig {
  clientSecret: string;
  sessionSecret: string;
  baseUrl: string;
  port: number;
  secureCookies: boolean;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function optionalSnowflake(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!/^\d{17,20}$/.test(value)) {
    throw new Error(`${name} must be a Discord ID containing 17-20 digits`);
  }
  return value;
}

function optionalDashboardConfig(): DashboardConfig | undefined {
  const clientSecret = optionalEnv("DISCORD_CLIENT_SECRET");
  const sessionSecret = optionalEnv("DASHBOARD_SESSION_SECRET");
  if (!clientSecret && !sessionSecret) return undefined;
  if (!clientSecret || !sessionSecret) {
    throw new Error("Dashboard setup requires both DISCORD_CLIENT_SECRET and DASHBOARD_SESSION_SECRET");
  }
  if (sessionSecret.length < 32) {
    throw new Error("DASHBOARD_SESSION_SECRET must be at least 32 characters long");
  }

  const baseUrlText = optionalEnv("DASHBOARD_BASE_URL") ?? "http://localhost:3000";
  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlText);
  } catch {
    throw new Error("DASHBOARD_BASE_URL must be a valid origin");
  }
  const isLocalHost = ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    (baseUrl.protocol === "http:" && !isLocalHost) ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash ||
    baseUrl.username ||
    baseUrl.password
  ) {
    throw new Error("DASHBOARD_BASE_URL must be HTTPS, or localhost over HTTP");
  }

  const port = Number(optionalEnv("DASHBOARD_PORT") ?? (baseUrl.port || "3000"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DASHBOARD_PORT must be an integer from 1 to 65535");
  }

  return {
    clientSecret,
    sessionSecret,
    baseUrl: baseUrl.origin,
    port,
    secureCookies: baseUrl.protocol === "https:"
  };
}

function optionalDiscordWebhookUrl(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!isDiscordWebhookUrl(value)) {
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
  logWebhookUrl: optionalDiscordWebhookUrl("BOT_LOG_WEBHOOK_URL"),
  dashboard: optionalDashboardConfig()
};
