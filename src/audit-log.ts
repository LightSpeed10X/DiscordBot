import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { resolve } from "node:path";
import { botDataDirectory } from "./guild-settings.js";

export interface CommandAuditEntry {
  timestamp: string;
  commandName: string;
  userName: string;
  userId: string;
  guildName: string;
  guildId: string;
  channelId: string | null;
  outcome: "completed" | "error";
}

const logsDirectory = resolve(botDataDirectory, "logs");
const maxLogFileBytes = 2 * 1024 * 1024;
const maxStoredEntries = 2000;
let saveQueue: Promise<void> = Promise.resolve();

function isSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

function getLogPath(guildId: string): string {
  if (!isSnowflake(guildId)) throw new Error("Invalid guild ID for command log.");
  return resolve(logsDirectory, `${guildId}.jsonl`);
}

function isCommandAuditEntry(value: unknown): value is CommandAuditEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.timestamp === "string" &&
    typeof entry.commandName === "string" &&
    typeof entry.userName === "string" &&
    typeof entry.userId === "string" &&
    typeof entry.guildName === "string" &&
    typeof entry.guildId === "string" &&
    (entry.channelId === null || typeof entry.channelId === "string") &&
    (entry.outcome === "completed" || entry.outcome === "error")
  );
}

export async function recordCommandLog(entry: CommandAuditEntry): Promise<void> {
  const operation = saveQueue.then(async () => {
    const path = getLogPath(entry.guildId);
    await mkdir(logsDirectory, { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");

    const file = await stat(path);
    if (file.size <= maxLogFileBytes) return;

    const lines = (await readFile(path, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxStoredEntries);
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  });
  saveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function getRecentCommandLogs(
  guildId: string,
  requestedLimit = 100
): Promise<CommandAuditEntry[]> {
  const path = getLogPath(guildId);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(200, Math.trunc(requestedLimit)))
    : 100;
  await saveQueue;

  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw new Error("Could not read command logs.", { cause: error });
  }

  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .reverse()
    .map(line => {
      const parsed: unknown = JSON.parse(line);
      if (!isCommandAuditEntry(parsed) || parsed.guildId !== guildId) {
        throw new Error("Command log file contains an invalid entry.");
      }
      return parsed;
    });
}
