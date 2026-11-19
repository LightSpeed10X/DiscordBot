import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { isDiscordWebhookUrl } from "../webhooks.js";

type RecordValue = Record<string, unknown>;
const snowflake = /^\d{17,20}$/;

function record(value: unknown, label: string): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as RecordValue;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a non-empty string.`);
  return value;
}
function id(value: unknown, label: string): string {
  const result = string(value, label);
  if (!snowflake.test(result)) throw new Error(`${label} must be a Discord snowflake.`);
  return result;
}
function boolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}
function addGuild(db: Database.Database, guildId: string): void {
  db.prepare("INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)").run(guildId);
}
function hash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function importLegacyData(
  dataDirectory: string,
  db: Database.Database,
): Promise<void> {
  const candidates = [
    "guild-settings.json",
    "levels.json",
    "bot-presence.json",
    ...(await logFiles(dataDirectory)),
  ];
  for (const relativePath of candidates) {
    const path = resolve(dataDirectory, relativePath);
    let content: Buffer;
    try {
      content = await readFile(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw new Error(`Could not read legacy source ${relativePath}.`, { cause: error });
    }
    const contentHash = hash(content);
    const previous = db
      .prepare("SELECT content_hash FROM legacy_imports WHERE source_path = ?")
      .get(relativePath) as { content_hash: string } | undefined;
    if (previous) {
      if (previous.content_hash !== contentHash) {
        throw new Error(`Legacy source ${relativePath} changed after it was imported.`);
      }
      continue;
    }
    const parsed = relativePath.endsWith(".jsonl")
      ? parseJsonLines(content.toString("utf8"), relativePath)
      : parseJson(content.toString("utf8"), relativePath);
    db.transaction(() => {
      if (relativePath === "guild-settings.json") importSettings(db, parsed);
      else if (relativePath === "levels.json") importLevels(db, parsed);
      else if (relativePath === "bot-presence.json") importPresence(db, parsed);
      else importLogs(db, parsed as unknown[], relativePath);
      db.prepare("INSERT INTO legacy_imports (source_path, content_hash) VALUES (?, ?)").run(
        relativePath,
        contentHash,
      );
    })();
  }
}

async function logFiles(directory: string): Promise<string[]> {
  try {
    const files = (await readdir(resolve(directory, "logs"), { withFileTypes: true })).filter(
      (entry) => entry.isFile() && entry.name.endsWith(".jsonl"),
    );
    for (const file of files) {
      if (!snowflake.test(file.name.slice(0, -".jsonl".length))) {
        throw new Error(`Legacy log filename ${file.name} is invalid.`);
      }
    }
    return files.map((entry) => `logs/${entry.name}`).sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
function parseJson(content: string, path: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Legacy source ${path} is not valid JSON.`, { cause: error });
  }
}
function parseJsonLines(content: string, path: string): unknown[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(`Legacy source ${path} has invalid JSON on line ${index + 1}.`, {
          cause: error,
        });
      }
    });
}
function importSettings(db: Database.Database, value: unknown): void {
  const settings = record(value, "guild-settings.json");
  const insert = db.prepare(`
    INSERT INTO guild_settings
      (guild_id, embed_color, welcome_channel_id, welcome_message, ticket_category_id,
       ticket_support_role_id, auto_moderation_enabled, leveling_enabled, dashboard_webhook_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [guildId, raw] of Object.entries(settings)) {
    id(guildId, "Guild ID");
    const item = record(raw, `Guild settings for ${guildId}`);
    const color = item.embedColor;
    if (!Number.isSafeInteger(color) || (color as number) < 0 || (color as number) > 0xffffff) {
      throw new Error(`Guild settings for ${guildId} contain an invalid embed color.`);
    }
    const welcomeChannel =
      item.welcomeChannelId === undefined ? null : id(item.welcomeChannelId, "Welcome channel");
    const welcomeMessage =
      item.welcomeMessage === undefined ? null : string(item.welcomeMessage, "Welcome message");
    if (
      (welcomeChannel === null) !== (welcomeMessage === null) ||
      (welcomeMessage !== null && welcomeMessage.length > 500)
    ) {
      throw new Error(`Guild settings for ${guildId} contain invalid welcome settings.`);
    }
    const category =
      item.ticketCategoryId === undefined ? null : id(item.ticketCategoryId, "Ticket category");
    const role =
      item.ticketSupportRoleId === undefined
        ? null
        : id(item.ticketSupportRoleId, "Ticket support role");
    const webhook = item.dashboardWebhookUrl === undefined ? null : item.dashboardWebhookUrl;
    if (webhook !== null && !isDiscordWebhookUrl(webhook)) {
      throw new Error(`Guild settings for ${guildId} contain an invalid dashboard webhook URL.`);
    }
    addGuild(db, guildId);
    insert.run(
      guildId,
      color,
      welcomeChannel,
      welcomeMessage,
      category,
      role,
      boolean(item.autoModerationEnabled, "Auto moderation", false) ? 1 : 0,
      boolean(item.levelingEnabled, "Leveling", false) ? 1 : 0,
      webhook,
    );
  }
}
function importLevels(db: Database.Database, value: unknown): void {
  const levels = record(value, "levels.json");
  const insert = db.prepare("INSERT INTO member_xp (guild_id, user_id, xp) VALUES (?, ?, ?)");
  for (const [guildId, membersRaw] of Object.entries(levels)) {
    id(guildId, "Guild ID");
    const members = record(membersRaw, `Levels for ${guildId}`);
    addGuild(db, guildId);
    for (const [userId, raw] of Object.entries(members)) {
      id(userId, "User ID");
      const item = record(raw, `Level entry for ${guildId}/${userId}`);
      if (!Number.isSafeInteger(item.xp) || (item.xp as number) < 0)
        throw new Error(`Invalid XP for ${guildId}/${userId}.`);
      insert.run(guildId, userId, item.xp);
    }
  }
}
function importPresence(db: Database.Database, value: unknown): void {
  const item = record(value, "bot-presence.json");
  const status = string(item.status, "Presence status");
  const activityType = string(item.activityType, "Presence activity type");
  if (typeof item.activityText !== "string") {
    throw new Error("Presence activity text must be a string.");
  }
  const activityText = item.activityText;
  if (
    !["online", "idle", "dnd", "invisible"].includes(status) ||
    !["playing", "listening", "watching", "competing"].includes(activityType) ||
    activityText.length > 128
  ) {
    throw new Error("bot-presence.json contains invalid presence values.");
  }
  db.prepare(
    "INSERT INTO bot_presence (id, status, activity_type, activity_text) VALUES (1, ?, ?, ?)",
  ).run(status, activityType, activityText);
}
function importLogs(db: Database.Database, values: unknown[], path: string): void {
  const fileGuildId = path.slice("logs/".length, -".jsonl".length);
  const insert = db.prepare(`
    INSERT INTO command_audit
      (timestamp, command_name, user_name, user_id, guild_name, guild_id, channel_id, outcome, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [index, raw] of values.entries()) {
    const item = record(raw, `${path} line ${index + 1}`);
    const guildId = id(item.guildId, "Guild ID");
    if (guildId !== fileGuildId)
      throw new Error(`${path} line ${index + 1} has a mismatched guild ID.`);
    const userId = id(item.userId, "User ID");
    const channelId = item.channelId === null ? null : id(item.channelId, "Channel ID");
    const outcome = item.outcome;
    if (outcome !== "completed" && outcome !== "error")
      throw new Error(`${path} line ${index + 1} has invalid outcome.`);
    const source = item.source === undefined ? "command" : item.source;
    if (source !== "command" && source !== "dashboard")
      throw new Error(`${path} line ${index + 1} has invalid source.`);
    addGuild(db, guildId);
    insert.run(
      string(item.timestamp, "Timestamp"),
      string(item.commandName, "Command name"),
      string(item.userName, "User name"),
      userId,
      string(item.guildName, "Guild name"),
      guildId,
      channelId,
      outcome,
      source,
    );
  }
}
