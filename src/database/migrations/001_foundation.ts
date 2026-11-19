export const version = 1;
export const sql = `
CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
  embed_color INTEGER NOT NULL DEFAULT 5793266 CHECK(embed_color BETWEEN 0 AND 16777215),
  welcome_channel_id TEXT,
  welcome_message TEXT,
  ticket_category_id TEXT,
  ticket_support_role_id TEXT,
  auto_moderation_enabled INTEGER NOT NULL DEFAULT 0 CHECK(auto_moderation_enabled IN (0,1)),
  leveling_enabled INTEGER NOT NULL DEFAULT 0 CHECK(leveling_enabled IN (0,1)),
  dashboard_webhook_url TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS member_xp (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  xp INTEGER NOT NULL CHECK(xp >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS tickets (
  ticket_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  opener_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets(guild_id, status);
CREATE TABLE IF NOT EXISTS ticket_staff_activity (
  activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  staff_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_staff_ticket ON ticket_staff_activity(ticket_id, created_at);
CREATE TABLE IF NOT EXISTS moderation_actions (
  action_id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  moderator_user_id TEXT,
  action TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_moderation_guild_user ON moderation_actions(guild_id, user_id, created_at);
CREATE TABLE IF NOT EXISTS moderation_warnings (
  warning_id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  moderator_user_id TEXT,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_warnings_guild_user ON moderation_warnings(guild_id, user_id, active);
CREATE TABLE IF NOT EXISTS command_audit (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  command_name TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  guild_name TEXT NOT NULL,
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  channel_id TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('completed','error')),
  source TEXT NOT NULL DEFAULT 'command' CHECK(source IN ('command','dashboard'))
);
CREATE INDEX IF NOT EXISTS idx_command_audit_guild_time ON command_audit(guild_id, timestamp);
CREATE TABLE IF NOT EXISTS dashboard_sessions (
  sid TEXT PRIMARY KEY,
  session_data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expires_at ON dashboard_sessions(expires_at);
CREATE TABLE IF NOT EXISTS guild_daily_activity (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  activity_date TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  member_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, activity_date)
);
CREATE TABLE IF NOT EXISTS guild_command_usage (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  command_name TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, usage_date, command_name)
);
CREATE TABLE IF NOT EXISTS guild_feature_permission_roles (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, feature, role_id)
);
CREATE INDEX IF NOT EXISTS idx_feature_roles_guild_feature ON guild_feature_permission_roles(guild_id, feature);
CREATE TABLE IF NOT EXISTS bot_presence (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  status TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  activity_text TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;
