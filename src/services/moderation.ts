import { getDatabase } from "../database/connection.js";

export interface ModerationActionRecord {
  actionId: number;
  action: string;
  targetUserId: string;
  moderatorUserId: string | null;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface WarningRecord {
  warningId: number;
  targetUserId: string;
  moderatorUserId: string | null;
  reason: string;
  createdAt: string;
  active: boolean;
}

function assertSnowflake(value: string, label: string): void {
  if (!/^\d{17,20}$/.test(value)) throw new Error(`Invalid ${label}.`);
}

export function recordModerationAction(input: {
  guildId: string;
  targetUserId: string;
  moderatorUserId: string;
  action: string;
  reason: string | null;
  expiresAt?: string | null;
}): void {
  assertSnowflake(input.guildId, "guild ID");
  assertSnowflake(input.targetUserId, "target user ID");
  assertSnowflake(input.moderatorUserId, "moderator user ID");
  if (!/^[a-z_]{1,32}$/.test(input.action)) throw new Error("Invalid moderation action.");
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)").run(input.guildId);
    db.prepare(
      `
      INSERT INTO moderation_actions
        (guild_id, user_id, moderator_user_id, action, reason, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      input.guildId,
      input.targetUserId,
      input.moderatorUserId,
      input.action,
      input.reason,
      new Date().toISOString(),
      input.expiresAt ?? null,
    );
  })();
}

export function createWarning(input: {
  guildId: string;
  targetUserId: string;
  moderatorUserId: string;
  reason: string;
}): number {
  assertSnowflake(input.guildId, "guild ID");
  assertSnowflake(input.targetUserId, "target user ID");
  assertSnowflake(input.moderatorUserId, "moderator user ID");
  const reason = input.reason.trim();
  if (!reason || reason.length > 500)
    throw new Error("A warning reason of up to 500 characters is required.");
  const db = getDatabase();
  return db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)").run(input.guildId);
    const result = db
      .prepare(
        `
      INSERT INTO moderation_warnings (guild_id, user_id, moderator_user_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(
        input.guildId,
        input.targetUserId,
        input.moderatorUserId,
        reason,
        new Date().toISOString(),
      );
    db.prepare(
      `
      INSERT INTO moderation_actions
        (guild_id, user_id, moderator_user_id, action, reason, created_at)
      VALUES (?, ?, ?, 'warn', ?, ?)
    `,
    ).run(
      input.guildId,
      input.targetUserId,
      input.moderatorUserId,
      reason,
      new Date().toISOString(),
    );
    return Number(result.lastInsertRowid);
  })();
}

export function getWarnings(guildId: string, targetUserId: string): WarningRecord[] {
  const rows = getDatabase()
    .prepare(
      `
    SELECT warning_id, user_id, moderator_user_id, reason, created_at, active
    FROM moderation_warnings
    WHERE guild_id = ? AND user_id = ?
    ORDER BY warning_id DESC
    LIMIT 50
  `,
    )
    .all(guildId, targetUserId) as {
    warning_id: number;
    user_id: string;
    moderator_user_id: string | null;
    reason: string;
    created_at: string;
    active: number;
  }[];
  return rows.map((row) => ({
    warningId: row.warning_id,
    targetUserId: row.user_id,
    moderatorUserId: row.moderator_user_id,
    reason: row.reason,
    createdAt: row.created_at,
    active: row.active === 1,
  }));
}

export function getModerationHistory(
  guildId: string,
  targetUserId: string,
): ModerationActionRecord[] {
  const rows = getDatabase()
    .prepare(
      `
    SELECT action_id, action, user_id, moderator_user_id, reason, created_at, expires_at
    FROM moderation_actions
    WHERE guild_id = ? AND user_id = ?
    ORDER BY created_at DESC, action_id DESC
    LIMIT 50
  `,
    )
    .all(guildId, targetUserId) as {
    action_id: number;
    action: string;
    user_id: string;
    moderator_user_id: string | null;
    reason: string | null;
    created_at: string;
    expires_at: string | null;
  }[];
  return rows.map((row) => ({
    actionId: row.action_id,
    action: row.action,
    targetUserId: row.user_id,
    moderatorUserId: row.moderator_user_id,
    reason: row.reason,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

export function removeWarning(
  guildId: string,
  warningId: number,
  targetUserId: string,
  moderatorUserId: string,
): string {
  assertSnowflake(guildId, "guild ID");
  assertSnowflake(moderatorUserId, "moderator user ID");
  const db = getDatabase();
  return db.transaction(() => {
    const warning = db
      .prepare(
        `
      SELECT user_id, reason
      FROM moderation_warnings
      WHERE guild_id = ? AND warning_id = ? AND user_id = ? AND active = 1
    `,
      )
      .get(guildId, warningId, targetUserId) as { user_id: string; reason: string } | undefined;
    if (!warning) throw new Error("Active warning not found.");
    db.prepare(
      "UPDATE moderation_warnings SET active = 0 WHERE guild_id = ? AND warning_id = ?",
    ).run(guildId, warningId);
    db.prepare(
      `
      INSERT INTO moderation_actions
        (guild_id, user_id, moderator_user_id, action, reason, created_at)
      VALUES (?, ?, ?, 'warning_removed', ?, ?)
    `,
    ).run(guildId, warning.user_id, moderatorUserId, warning.reason, new Date().toISOString());
    return warning.user_id;
  })();
}
