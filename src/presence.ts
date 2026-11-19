import { ActivityType, type Client } from "discord.js";
import { getDatabase } from "./database/connection.js";

export type BotPresenceStatus = "online" | "idle" | "dnd" | "invisible";
export type BotActivityType = "playing" | "listening" | "watching" | "competing";

export interface BotPresenceSettings {
  status: BotPresenceStatus;
  activityType: BotActivityType;
  activityText: string;
}

const defaultPresence: BotPresenceSettings = {
  status: "online",
  activityType: "playing",
  activityText: "",
};
const validStatuses = new Set<BotPresenceStatus>(["online", "idle", "dnd", "invisible"]);
const validActivityTypes = new Set<BotActivityType>([
  "playing",
  "listening",
  "watching",
  "competing",
]);
let presenceSettings: BotPresenceSettings = { ...defaultPresence };

function parsePresenceSettings(value: unknown): BotPresenceSettings {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    typeof value.status !== "string" ||
    !validStatuses.has(value.status as BotPresenceStatus) ||
    !("activityType" in value) ||
    typeof value.activityType !== "string" ||
    !validActivityTypes.has(value.activityType as BotActivityType) ||
    !("activityText" in value) ||
    typeof value.activityText !== "string" ||
    value.activityText.length > 128
  ) {
    throw new Error("Bot presence settings contain invalid values.");
  }
  return {
    status: value.status as BotPresenceStatus,
    activityType: value.activityType as BotActivityType,
    activityText: value.activityText,
  };
}

export async function loadBotPresenceSettings(): Promise<void> {
  const row = getDatabase()
    .prepare("SELECT status, activity_type, activity_text FROM bot_presence WHERE id = 1")
    .get() as { status: string; activity_type: string; activity_text: string } | undefined;
  presenceSettings = row
    ? parsePresenceSettings({
        status: row.status,
        activityType: row.activity_type,
        activityText: row.activity_text,
      })
    : { ...defaultPresence };
}

export function getBotPresenceSettings(): BotPresenceSettings {
  return { ...presenceSettings };
}

export function applyBotPresence(client: Client<true>): void {
  const activityTypes: Record<BotActivityType, ActivityType> = {
    playing: ActivityType.Playing,
    listening: ActivityType.Listening,
    watching: ActivityType.Watching,
    competing: ActivityType.Competing,
  };
  client.user.setPresence({
    status: presenceSettings.status,
    activities: presenceSettings.activityText
      ? [
          {
            name: presenceSettings.activityText,
            type: activityTypes[presenceSettings.activityType],
          },
        ]
      : [],
  });
}

export async function updateBotPresence(
  client: Client<true>,
  update: BotPresenceSettings,
): Promise<BotPresenceSettings> {
  const next = parsePresenceSettings(update);
  getDatabase()
    .prepare(
      `
    INSERT INTO bot_presence (id, status, activity_type, activity_text, updated_at)
    VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      activity_type = excluded.activity_type,
      activity_text = excluded.activity_text,
      updated_at = CURRENT_TIMESTAMP
  `,
    )
    .run(next.status, next.activityType, next.activityText);
  presenceSettings = next;
  applyBotPresence(client);
  return getBotPresenceSettings();
}
