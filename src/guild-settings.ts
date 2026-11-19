import { resolve } from "node:path";
import { getDatabase } from "./database/connection.js";
import { isDiscordWebhookUrl } from "./webhooks.js";

export const botDataDirectory = resolve(process.env.BOT_DATA_DIR?.trim() || "data");

export interface GuildSettings {
  embedColor: number;
  welcomeChannelId?: string;
  welcomeMessage?: string;
  ticketCategoryId?: string;
  ticketSupportRoleId?: string;
  autoModerationEnabled: boolean;
  levelingEnabled: boolean;
  dashboardWebhookUrl?: string;
}

interface StoredGuildSettings {
  guild_id: string;
  embed_color: number;
  welcome_channel_id: string | null;
  welcome_message: string | null;
  ticket_category_id: string | null;
  ticket_support_role_id: string | null;
  auto_moderation_enabled: number;
  leveling_enabled: number;
  dashboard_webhook_url: string | null;
}

const guildSettings = new Map<string, GuildSettings>();

function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function fromDatabase(row: StoredGuildSettings): GuildSettings {
  return {
    embedColor: row.embed_color,
    ...(row.welcome_channel_id ? { welcomeChannelId: row.welcome_channel_id } : {}),
    ...(row.welcome_message !== null ? { welcomeMessage: row.welcome_message } : {}),
    ...(row.ticket_category_id ? { ticketCategoryId: row.ticket_category_id } : {}),
    ...(row.ticket_support_role_id ? { ticketSupportRoleId: row.ticket_support_role_id } : {}),
    autoModerationEnabled: row.auto_moderation_enabled === 1,
    levelingEnabled: row.leveling_enabled === 1,
    ...(row.dashboard_webhook_url ? { dashboardWebhookUrl: row.dashboard_webhook_url } : {}),
  };
}

export async function loadGuildSettings(): Promise<void> {
  const rows = getDatabase().prepare("SELECT * FROM guild_settings").all() as StoredGuildSettings[];
  guildSettings.clear();
  for (const row of rows) guildSettings.set(row.guild_id, fromDatabase(row));
}

export function getGuildSettings(guildId: string): GuildSettings {
  const settings = guildSettings.get(guildId);
  return settings
    ? { ...settings }
    : {
        embedColor: 0x5865f2,
        autoModerationEnabled: false,
        levelingEnabled: false,
      };
}

export async function updateGuildSettings(
  guildId: string,
  update: Partial<GuildSettings>,
): Promise<GuildSettings> {
  if (!isSnowflake(guildId)) throw new Error("Invalid guild ID.");
  const next = { ...getGuildSettings(guildId), ...update };
  if (!Number.isInteger(next.embedColor) || next.embedColor < 0 || next.embedColor > 0xffffff) {
    throw new Error("Embed color must be a valid 24-bit color.");
  }
  if (
    typeof next.autoModerationEnabled !== "boolean" ||
    typeof next.levelingEnabled !== "boolean"
  ) {
    throw new Error("Feature settings must be enabled or disabled.");
  }
  if (
    next.dashboardWebhookUrl !== undefined &&
    (typeof next.dashboardWebhookUrl !== "string" || !isDiscordWebhookUrl(next.dashboardWebhookUrl))
  ) {
    throw new Error("Dashboard webhook URL must be a valid Discord webhook URL.");
  }
  if (
    (next.welcomeChannelId === undefined) !== (next.welcomeMessage === undefined) ||
    (next.welcomeChannelId !== undefined && !isSnowflake(next.welcomeChannelId)) ||
    (next.welcomeMessage !== undefined &&
      (typeof next.welcomeMessage !== "string" || next.welcomeMessage.length > 500))
  ) {
    throw new Error("Welcome settings are invalid.");
  }
  if (
    (next.ticketCategoryId !== undefined && !isSnowflake(next.ticketCategoryId)) ||
    (next.ticketSupportRoleId !== undefined && !isSnowflake(next.ticketSupportRoleId))
  ) {
    throw new Error("Ticket settings are invalid.");
  }

  const db = getDatabase();
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)").run(guildId);
    db.prepare(
      `
      INSERT INTO guild_settings (
        guild_id, embed_color, welcome_channel_id, welcome_message, ticket_category_id,
        ticket_support_role_id, auto_moderation_enabled, leveling_enabled, dashboard_webhook_url,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id) DO UPDATE SET
        embed_color = excluded.embed_color,
        welcome_channel_id = excluded.welcome_channel_id,
        welcome_message = excluded.welcome_message,
        ticket_category_id = excluded.ticket_category_id,
        ticket_support_role_id = excluded.ticket_support_role_id,
        auto_moderation_enabled = excluded.auto_moderation_enabled,
        leveling_enabled = excluded.leveling_enabled,
        dashboard_webhook_url = excluded.dashboard_webhook_url,
        updated_at = CURRENT_TIMESTAMP
    `,
    ).run(
      guildId,
      next.embedColor,
      next.welcomeChannelId ?? null,
      next.welcomeMessage ?? null,
      next.ticketCategoryId ?? null,
      next.ticketSupportRoleId ?? null,
      Number(next.autoModerationEnabled),
      Number(next.levelingEnabled),
      next.dashboardWebhookUrl ?? null,
    );
  })();
  guildSettings.set(guildId, next);
  return { ...next };
}
