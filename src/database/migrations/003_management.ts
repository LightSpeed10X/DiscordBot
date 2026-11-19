export const version = 3;
export const sql = `
ALTER TABLE tickets ADD COLUMN subject TEXT;
ALTER TABLE tickets ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK(priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE tickets ADD COLUMN assigned_staff_id TEXT;
ALTER TABLE tickets ADD COLUMN closed_by TEXT;
ALTER TABLE tickets ADD COLUMN close_reason TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_one_open_per_member
  ON tickets(guild_id, opener_user_id) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_guild_channel ON tickets(guild_id, channel_id);

CREATE TABLE IF NOT EXISTS ticket_reservations (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  opener_user_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(guild_id, opener_user_id)
);
CREATE INDEX IF NOT EXISTS idx_ticket_reservations_expires ON ticket_reservations(expires_at);
`;
