import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface GuildSettings {
  embedColor: number;
  welcomeChannelId?: string;
  welcomeMessage?: string;
}

const settingsPath = resolve(process.env.BOT_DATA_DIR?.trim() || "data", "guild-settings.json");
const guildSettings = new Map<string, GuildSettings>();
let saveQueue: Promise<void> = Promise.resolve();

function isSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function parseSettings(value: unknown): Map<string, GuildSettings> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Guild settings file must contain an object.");
  }

  const parsed = new Map<string, GuildSettings>();
  for (const [guildId, settings] of Object.entries(value)) {
    if (!isSnowflake(guildId) || typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      throw new Error("Guild settings file contains an invalid entry.");
    }

    const record = settings as Record<string, unknown>;
    if (
      !Number.isInteger(record.embedColor) ||
      (record.embedColor as number) < 0 ||
      (record.embedColor as number) > 0xffffff
    ) {
      throw new Error(`Guild settings for ${guildId} contain an invalid embed color.`);
    }

    const setting: GuildSettings = { embedColor: record.embedColor as number };
    if (record.welcomeChannelId !== undefined) {
      if (!isSnowflake(record.welcomeChannelId)) {
        throw new Error(`Guild settings for ${guildId} contain an invalid welcome channel.`);
      }
      setting.welcomeChannelId = record.welcomeChannelId;
    }
    if (record.welcomeMessage !== undefined) {
      if (typeof record.welcomeMessage !== "string" || record.welcomeMessage.length > 500) {
        throw new Error(`Guild settings for ${guildId} contain an invalid welcome message.`);
      }
      setting.welcomeMessage = record.welcomeMessage;
    }
    if ((setting.welcomeChannelId === undefined) !== (setting.welcomeMessage === undefined)) {
      throw new Error(`Guild settings for ${guildId} must define both welcome fields or neither.`);
    }
    parsed.set(guildId, setting);
  }
  return parsed;
}

export async function loadGuildSettings(): Promise<void> {
  try {
    const content = await readFile(settingsPath, "utf8");
    const parsed = parseSettings(JSON.parse(content) as unknown);
    guildSettings.clear();
    for (const [guildId, settings] of parsed) guildSettings.set(guildId, settings);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw new Error("Could not load guild settings. Check the settings file before restarting.", { cause: error });
  }
}

export function getGuildSettings(guildId: string): GuildSettings {
  return guildSettings.get(guildId) ?? { embedColor: 0x5865f2 };
}

export async function updateGuildSettings(
  guildId: string,
  update: Partial<GuildSettings>
): Promise<GuildSettings> {
  const operation = saveQueue.then(async () => {
    if (!isSnowflake(guildId)) throw new Error("Invalid guild ID.");
    const previous = guildSettings.get(guildId);
    const next = { ...getGuildSettings(guildId), ...update };
    if (!Number.isInteger(next.embedColor) || next.embedColor < 0 || next.embedColor > 0xffffff) {
      throw new Error("Embed color must be a valid 24-bit color.");
    }
    if (
      (next.welcomeChannelId === undefined) !== (next.welcomeMessage === undefined) ||
      (next.welcomeChannelId !== undefined && !isSnowflake(next.welcomeChannelId)) ||
      (next.welcomeMessage !== undefined && next.welcomeMessage.length > 500)
    ) {
      throw new Error("Welcome settings are invalid.");
    }

    guildSettings.set(guildId, next);
    const snapshot = JSON.stringify(Object.fromEntries(guildSettings), null, 2);
    const temporaryPath = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(settingsPath), { recursive: true });
      await writeFile(temporaryPath, snapshot, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, settingsPath);
      return next;
    } catch (error) {
      if (previous) guildSettings.set(guildId, previous);
      else guildSettings.delete(guildId);
      throw error;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  });
  saveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
