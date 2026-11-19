import { getDatabase } from "../database/connection.js";

export interface GuildAnalytics {
  periodDays: number;
  dailyActivity: Array<{ date: string; messages: number; members: number }>;
  commandUsage: Array<{ date: string; command: string; uses: number }>;
  moderationActions: Array<{ action: string; count: number }>;
  tickets: Array<{ status: string; count: number }>;
  comparison: {
    messagesThisWeek: number;
    messagesLastWeek: number;
    memberChange: number;
  };
}

function ensureGuild(guildId: string): void {
  getDatabase().prepare("INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)").run(guildId);
}

export function recordMessageActivity(guildId: string, memberCount: number): void {
  const db = getDatabase();
  db.transaction(() => {
    ensureGuild(guildId);
    db.prepare(
      `
      INSERT INTO guild_daily_activity (guild_id, activity_date, message_count, member_count)
      VALUES (?, date('now'), 1, ?)
      ON CONFLICT(guild_id, activity_date) DO UPDATE SET
        message_count = message_count + 1,
        member_count = excluded.member_count
    `,
    ).run(guildId, memberCount);
  })();
}

export function recordMemberCount(guildId: string, memberCount: number): void {
  const db = getDatabase();
  db.transaction(() => {
    ensureGuild(guildId);
    db.prepare(
      `
      INSERT INTO guild_daily_activity (guild_id, activity_date, member_count)
      VALUES (?, date('now'), ?)
      ON CONFLICT(guild_id, activity_date) DO UPDATE SET member_count = excluded.member_count
    `,
    ).run(guildId, memberCount);
  })();
}

export function getGuildAnalytics(guildId: string, periodDays: number): GuildAnalytics {
  const db = getDatabase();
  const startDate = new Date(Date.now() - (periodDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const activityRows = db
    .prepare(
      `
    SELECT activity_date, message_count, member_count
    FROM guild_daily_activity
    WHERE guild_id = ? AND activity_date >= ?
    ORDER BY activity_date
  `,
    )
    .all(guildId, startDate) as {
    activity_date: string;
    message_count: number;
    member_count: number;
  }[];
  const commandRows = db
    .prepare(
      `
    SELECT usage_date, command_name, use_count
    FROM guild_command_usage
    WHERE guild_id = ? AND usage_date >= ?
    ORDER BY usage_date, command_name
  `,
    )
    .all(guildId, startDate) as {
    usage_date: string;
    command_name: string;
    use_count: number;
  }[];
  const moderationRows = db
    .prepare(
      `
    SELECT action, COUNT(*) AS count
    FROM moderation_actions
    WHERE guild_id = ? AND created_at >= ?
    GROUP BY action
    ORDER BY count DESC, action
  `,
    )
    .all(guildId, `${startDate}T00:00:00.000Z`) as { action: string; count: number }[];
  const ticketRows = db
    .prepare(
      `
    SELECT status, COUNT(*) AS count
    FROM tickets
    WHERE guild_id = ?
    GROUP BY status
    ORDER BY status
  `,
    )
    .all(guildId) as { status: string; count: number }[];

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const fourteenDaysAgo = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
  const activityForPeriod = db.prepare(`
    SELECT COALESCE(SUM(message_count), 0) AS messages
    FROM guild_daily_activity
    WHERE guild_id = ? AND activity_date BETWEEN ? AND ?
  `);
  const messagesThisWeek = (
    activityForPeriod.get(guildId, sevenDaysAgo, today) as { messages: number }
  ).messages;
  const messagesLastWeek = (
    activityForPeriod.get(
      guildId,
      fourteenDaysAgo,
      new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
    ) as { messages: number }
  ).messages;
  const memberCountRows = activityRows.filter((row) => row.member_count > 0);
  const memberChange =
    memberCountRows.length > 1
      ? memberCountRows[memberCountRows.length - 1].member_count - memberCountRows[0].member_count
      : 0;

  return {
    periodDays,
    dailyActivity: activityRows.map((row) => ({
      date: row.activity_date,
      messages: row.message_count,
      members: row.member_count,
    })),
    commandUsage: commandRows.map((row) => ({
      date: row.usage_date,
      command: row.command_name,
      uses: row.use_count,
    })),
    moderationActions: moderationRows,
    tickets: ticketRows,
    comparison: { messagesThisWeek, messagesLastWeek, memberChange },
  };
}
