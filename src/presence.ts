import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ActivityType, type Client } from "discord.js";
import { botDataDirectory } from "./guild-settings.js";

export type BotPresenceStatus = "online" | "idle" | "dnd" | "invisible";
export type BotActivityType = "playing" | "listening" | "watching" | "competing";

export interface BotPresenceSettings {
  status: BotPresenceStatus;
  activityType: BotActivityType;
  activityText: string;
}

const presencePath = resolve(botDataDirectory, "bot-presence.json");
const defaultPresence: BotPresenceSettings = {
  status: "online",
  activityType: "playing",
  activityText: ""
};
const validStatuses = new Set<BotPresenceStatus>(["online", "idle", "dnd", "invisible"]);
const validActivityTypes = new Set<BotActivityType>(["playing", "listening", "watching", "competing"]);
let presenceSettings: BotPresenceSettings = { ...defaultPresence };
let saveQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePresenceSettings(value: unknown): BotPresenceSettings {
  if (
    !isRecord(value) ||
    typeof value.status !== "string" ||
    !validStatuses.has(value.status as BotPresenceStatus) ||
    typeof value.activityType !== "string" ||
    !validActivityTypes.has(value.activityType as BotActivityType) ||
    typeof value.activityText !== "string" ||
    value.activityText.length > 128
  ) {
    throw new Error("Bot presence settings contain invalid values.");
  }
  return {
    status: value.status as BotPresenceStatus,
    activityType: value.activityType as BotActivityType,
    activityText: value.activityText
  };
}

export async function loadBotPresenceSettings(): Promise<void> {
  try {
    const contents = await readFile(presencePath, "utf8");
    presenceSettings = parsePresenceSettings(JSON.parse(contents) as unknown);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      presenceSettings = { ...defaultPresence };
      return;
    }
    throw new Error("Could not load bot presence settings.", { cause: error });
  }
}

export function getBotPresenceSettings(): BotPresenceSettings {
  return { ...presenceSettings };
}

export function applyBotPresence(client: Client<true>): void {
  const activityTypes: Record<BotActivityType, ActivityType> = {
    playing: ActivityType.Playing,
    listening: ActivityType.Listening,
    watching: ActivityType.Watching,
    competing: ActivityType.Competing
  };
  client.user.setPresence({
    status: presenceSettings.status,
    activities: presenceSettings.activityText
      ? [{ name: presenceSettings.activityText, type: activityTypes[presenceSettings.activityType] }]
      : []
  });
}

export async function updateBotPresence(
  client: Client<true>,
  update: BotPresenceSettings
): Promise<BotPresenceSettings> {
  const next = parsePresenceSettings(update);
  const operation = saveQueue.then(async () => {
    const temporaryPath = `${presencePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(presencePath), { recursive: true });
      await writeFile(temporaryPath, JSON.stringify(next, null, 2), {
        encoding: "utf8",
        flag: "wx"
      });
      await rename(temporaryPath, presencePath);
      presenceSettings = next;
      applyBotPresence(client);
      return getBotPresenceSettings();
    } finally {
      await rm(temporaryPath, { force: true });
    }
  });
  saveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
