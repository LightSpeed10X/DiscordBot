export const version = 2;
export const sql = `
CREATE TABLE IF NOT EXISTS legacy_imports (
  source_path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;
