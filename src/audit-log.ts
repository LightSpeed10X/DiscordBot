import { getDatabase } from "./database/connection.js";
import { logFailure } from "./utils/logger.js";

export interface CommandAuditEntry {
  timestamp: string;
  commandName: string;
  userName: string;
  userId: string;
  guildName: string;
  guildId: string;
  channelId: string | null;
  outcome: "completed" | "error";
  source?: "command" | "dashboard";
}

interface StoredAuditEntry extends Omit<CommandAuditEntry, "source"> {
  source: "command" | "dashboard";
}

const commandLogListeners = new Map<string, Set<(entry: CommandAuditEntry) => void>>();

export function subscribeToCommandLogs(
  guildId: string,
  listener: (entry: CommandAuditEntry) => void,
): () => void {
  const listeners = commandLogListeners.get(guildId) ?? new Set();
  listeners.add(listener);
  commandLogListeners.set(guildId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) commandLogListeners.delete(guildId);
  };
}

function notifyCommandLogListeners(entry: CommandAuditEntry): void {
  for (const listener of commandLogListeners.get(entry.guildId) ?? []) {
    try {
      listener(entry);
    } catch (error) {
      logFailure("command.audit_listener_failed", error, { guildId: entry.guildId });
    }
  }
}

export async function recordCommandLog(entry: CommandAuditEntry): Promise<void> {
  if (!/^\d{17,20}$/.test(entry.guildId)) throw new Error("Invalid guild ID for command log.");
  if (!/^\d{17,20}$/.test(entry.userId)) throw new Error("Invalid user ID for command log.");
  const source = entry.source ?? "command";
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)").run(entry.guildId);
    db.prepare(
      `
      INSERT INTO command_audit (
        timestamp, command_name, user_name, user_id, guild_name, guild_id, channel_id, outcome, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      entry.timestamp,
      entry.commandName,
      entry.userName,
      entry.userId,
      entry.guildName,
      entry.guildId,
      entry.channelId,
      entry.outcome,
      source,
    );
    if (source === "command") {
      db.prepare(
        `
        INSERT INTO guild_command_usage (guild_id, usage_date, command_name, use_count)
        VALUES (?, date('now'), ?, 1)
        ON CONFLICT(guild_id, usage_date, command_name)
        DO UPDATE SET use_count = use_count + 1
      `,
      ).run(entry.guildId, entry.commandName);
    }
  })();
  notifyCommandLogListeners(entry);
}

export async function getRecentCommandLogs(
  guildId: string,
  requestedLimit = 100,
): Promise<CommandAuditEntry[]> {
  if (!/^\d{17,20}$/.test(guildId)) throw new Error("Invalid guild ID for command log.");
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(200, Math.trunc(requestedLimit)))
    : 100;
  const rows = getDatabase()
    .prepare(
      `
    SELECT timestamp, command_name, user_name, user_id, guild_name, guild_id, channel_id, outcome, source
    FROM command_audit
    WHERE guild_id = ?
    ORDER BY timestamp DESC, audit_id DESC
    LIMIT ?
  `,
    )
    .all(guildId, limit) as {
    timestamp: string;
    command_name: string;
    user_name: string;
    user_id: string;
    guild_name: string;
    guild_id: string;
    channel_id: string | null;
    outcome: "completed" | "error";
    source: "command" | "dashboard";
  }[];
  return rows.map((row): StoredAuditEntry => ({
    timestamp: row.timestamp,
    commandName: row.command_name,
    userName: row.user_name,
    userId: row.user_id,
    guildName: row.guild_name,
    guildId: row.guild_id,
    channelId: row.channel_id,
    outcome: row.outcome,
    source: row.source,
  }));
}
