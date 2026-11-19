import { randomInt } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { botDataDirectory } from "./guild-settings.js";

export interface LevelEntry {
  userId: string;
  xp: number;
  level: number;
}

interface StoredLevel {
  xp: number;
}

type StoredLevels = Record<string, Record<string, StoredLevel>>;

const levelsPath = resolve(botDataDirectory, "levels.json");
const levels: StoredLevels = {};
const cooldowns = new Map<string, number>();
let saveQueue: Promise<void> = Promise.resolve();

function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100));
}

function isSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLevels(value: unknown): StoredLevels {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Level data must contain an object.");
  }
  const parsed: StoredLevels = {};
  for (const [guildId, members] of Object.entries(value)) {
    if (!isSnowflake(guildId) || typeof members !== "object" || members === null || Array.isArray(members)) {
      throw new Error("Level data contains an invalid server entry.");
    }
    const parsedMembers: Record<string, StoredLevel> = {};
    for (const [userId, record] of Object.entries(members)) {
      if (
        !isSnowflake(userId) ||
        !isRecord(record) ||
        typeof record.xp !== "number" ||
        !Number.isSafeInteger(record.xp) ||
        record.xp < 0
      ) {
        throw new Error("Level data contains an invalid member entry.");
      }
      parsedMembers[userId] = { xp: record.xp };
    }
    parsed[guildId] = parsedMembers;
  }
  return parsed;
}

async function saveLevels(): Promise<void> {
  const operation = saveQueue.then(async () => {
    const temporaryPath = `${levelsPath}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(levelsPath), { recursive: true });
      await writeFile(temporaryPath, JSON.stringify(levels, null, 2), { encoding: "utf8", flag: "w" });
      await rename(temporaryPath, levelsPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  });
  saveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function loadLevels(): Promise<void> {
  try {
    const content = await readFile(levelsPath, "utf8");
    Object.assign(levels, parseLevels(JSON.parse(content) as unknown));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw new Error("Could not load level data. Check the levels file before restarting.", { cause: error });
  }
}

export async function awardMessageXp(guildId: string, userId: string): Promise<LevelEntry | undefined> {
  const now = Date.now();
  const cooldownKey = `${guildId}:${userId}`;
  if ((cooldowns.get(cooldownKey) ?? 0) > now) return undefined;
  cooldowns.set(cooldownKey, now + 60_000);

  const members = levels[guildId] ?? (levels[guildId] = {});
  const record = members[userId] ?? (members[userId] = { xp: 0 });
  const previousLevel = levelForXp(record.xp);
  record.xp += randomInt(15, 26);
  const currentLevel = levelForXp(record.xp);
  await saveLevels();
  return currentLevel > previousLevel
    ? { userId, xp: record.xp, level: currentLevel }
    : undefined;
}

export function getLevel(guildId: string, userId: string): LevelEntry {
  const xp = levels[guildId]?.[userId]?.xp ?? 0;
  return { userId, xp, level: levelForXp(xp) };
}

export function getLeaderboard(guildId: string, limit = 10): LevelEntry[] {
  return Object.entries(levels[guildId] ?? {})
    .map(([userId, record]) => ({ userId, xp: record.xp, level: levelForXp(record.xp) }))
    .sort((left, right) => right.xp - left.xp)
    .slice(0, limit);
}
