import { randomInt } from "node:crypto";
import { getDatabase } from "./database/connection.js";

export interface LevelEntry {
  userId: string;
  xp: number;
  level: number;
}

const cooldowns = new Map<string, number>();

function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100));
}

export async function loadLevels(): Promise<void> {
  getDatabase().prepare("SELECT 1 FROM member_xp LIMIT 1").get();
}

export async function awardMessageXp(
  guildId: string,
  userId: string,
): Promise<LevelEntry | undefined> {
  const now = Date.now();
  const cooldownKey = `${guildId}:${userId}`;
  if ((cooldowns.get(cooldownKey) ?? 0) > now) return undefined;
  if (cooldowns.size > 10_000) {
    for (const [key, expiresAt] of cooldowns) {
      if (expiresAt <= now) cooldowns.delete(key);
    }
  }

  const db = getDatabase();
  const result = db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)").run(guildId);
    const previousXp =
      (
        db
          .prepare("SELECT xp FROM member_xp WHERE guild_id = ? AND user_id = ?")
          .get(guildId, userId) as { xp: number } | undefined
      )?.xp ?? 0;
    const xp = previousXp + randomInt(15, 26);
    db.prepare(
      `
      INSERT INTO member_xp (guild_id, user_id, xp) VALUES (?, ?, ?)
      ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = excluded.xp, updated_at = CURRENT_TIMESTAMP
    `,
    ).run(guildId, userId, xp);
    return { previousXp, xp };
  })();

  cooldowns.set(cooldownKey, now + 60_000);
  const previousLevel = levelForXp(result.previousXp);
  const level = levelForXp(result.xp);
  return level > previousLevel ? { userId, xp: result.xp, level } : undefined;
}

export function getLevel(guildId: string, userId: string): LevelEntry {
  const xp =
    (
      getDatabase()
        .prepare("SELECT xp FROM member_xp WHERE guild_id = ? AND user_id = ?")
        .get(guildId, userId) as { xp: number } | undefined
    )?.xp ?? 0;
  return { userId, xp, level: levelForXp(xp) };
}

export function getLeaderboard(guildId: string, limit = 10): LevelEntry[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 10;
  const rows = getDatabase()
    .prepare(
      `
    SELECT user_id, xp
    FROM member_xp
    WHERE guild_id = ?
    ORDER BY xp DESC, user_id ASC
    LIMIT ?
  `,
    )
    .all(guildId, safeLimit) as { user_id: string; xp: number }[];
  return rows.map((row) => ({ userId: row.user_id, xp: row.xp, level: levelForXp(row.xp) }));
}
