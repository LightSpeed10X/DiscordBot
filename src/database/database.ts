import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { migrations } from "./migrations.js";
import { importLegacyData } from "./legacy-importer.js";

let database: Database.Database | undefined;

export async function initializeDatabase(dataDirectory: string): Promise<Database.Database> {
  if (database) throw new Error("Database is already initialized.");
  if (typeof dataDirectory !== "string" || dataDirectory.trim() === "") {
    throw new Error("A data directory is required.");
  }
  const directory = resolve(dataDirectory);
  await mkdir(directory, { recursive: true });
  const connection = new Database(resolve(directory, "bot.sqlite"));
  try {
    connection.pragma("foreign_keys = ON");
    connection.pragma("journal_mode = WAL");
    connection.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    );
    const applied = new Set(
      connection
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((row) => (row as { version: number }).version),
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      connection.transaction(() => {
        connection.exec(migration.sql);
        connection
          .prepare("INSERT INTO schema_migrations (version) VALUES (?)")
          .run(migration.version);
      })();
    }
    await importLegacyData(directory, connection);
    database = connection;
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

export function getDatabase(): Database.Database {
  if (!database) throw new Error("Database has not been initialized.");
  return database;
}

export function closeDatabase(): void {
  if (database) {
    database.close();
    database = undefined;
  }
}
