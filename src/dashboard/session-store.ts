import session from "express-session";
import { getDatabase } from "../database/connection.js";

type StoreCallback = (error?: Error | null) => void;

export class SqliteSessionStore extends session.Store {
  override get(
    sessionId: string,
    callback: (error: Error | null, session?: session.SessionData | null) => void,
  ): void {
    try {
      const row = getDatabase()
        .prepare("SELECT session_data, expires_at FROM dashboard_sessions WHERE sid = ?")
        .get(sessionId) as { session_data: string; expires_at: number } | undefined;
      if (!row) {
        callback(null, null);
        return;
      }
      if (row.expires_at <= Date.now()) {
        getDatabase().prepare("DELETE FROM dashboard_sessions WHERE sid = ?").run(sessionId);
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(row.session_data) as session.SessionData);
    } catch (error) {
      callback(error instanceof Error ? error : new Error("Could not read dashboard session."));
    }
  }

  override set(sessionId: string, value: session.SessionData, callback?: StoreCallback): void {
    try {
      const expiresAt = value.cookie.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + (value.cookie.originalMaxAge ?? 8 * 60 * 60 * 1000);
      getDatabase()
        .prepare(
          "INSERT INTO dashboard_sessions (sid, session_data, expires_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(sid) DO UPDATE SET session_data = excluded.session_data, expires_at = excluded.expires_at",
        )
        .run(sessionId, JSON.stringify(value), expiresAt);
      callback?.(null);
    } catch (error) {
      callback?.(
        error instanceof Error ? error : new Error("Could not persist dashboard session."),
      );
    }
  }

  override touch(sessionId: string, value: session.SessionData, callback?: StoreCallback): void {
    try {
      const expiresAt = value.cookie.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + (value.cookie.originalMaxAge ?? 8 * 60 * 60 * 1000);
      getDatabase()
        .prepare("UPDATE dashboard_sessions SET expires_at = ? WHERE sid = ?")
        .run(expiresAt, sessionId);
      callback?.(null);
    } catch (error) {
      callback?.(error instanceof Error ? error : new Error("Could not extend dashboard session."));
    }
  }

  override destroy(sessionId: string, callback?: StoreCallback): void {
    try {
      getDatabase().prepare("DELETE FROM dashboard_sessions WHERE sid = ?").run(sessionId);
      callback?.(null);
    } catch (error) {
      callback?.(
        error instanceof Error ? error : new Error("Could not destroy dashboard session."),
      );
    }
  }

  clearExpired(): void {
    getDatabase().prepare("DELETE FROM dashboard_sessions WHERE expires_at <= ?").run(Date.now());
  }
}
