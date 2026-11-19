import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDatabase, getDatabase, initializeDatabase } from "../dist/database/connection.js";

const guildId = "12345678901234567";
const userId = "12345678901234568";

test("imports legacy data once and persists repository updates", async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "discordbot-db-"));
  try {
    await mkdir(path.join(dataDirectory, "logs"));
    await writeFile(
      path.join(dataDirectory, "guild-settings.json"),
      JSON.stringify({
        [guildId]: {
          embedColor: 123,
          autoModerationEnabled: true,
          levelingEnabled: true,
        },
      }),
    );
    await writeFile(
      path.join(dataDirectory, "levels.json"),
      JSON.stringify({
        [guildId]: { [userId]: { xp: 99 } },
      }),
    );
    await writeFile(
      path.join(dataDirectory, "bot-presence.json"),
      JSON.stringify({
        status: "online",
        activityType: "playing",
        activityText: "",
      }),
    );
    await writeFile(
      path.join(dataDirectory, "logs", `${guildId}.jsonl`),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        commandName: "ping",
        userName: "tester",
        userId,
        guildName: "Test server",
        guildId,
        channelId: null,
        outcome: "completed",
      })}\n`,
    );

    await initializeDatabase(dataDirectory);
    const settings = await import("../dist/guild-settings.js");
    const levels = await import("../dist/levels.js");
    const audit = await import("../dist/audit-log.js");
    const tickets = await import("../dist/services/tickets.js");
    const moderation = await import("../dist/services/moderation.js");
    const analytics = await import("../dist/services/analytics.js");
    const featurePermissions = await import("../dist/services/feature-permissions.js");
    const { SqliteSessionStore } = await import("../dist/dashboard/session-store.js");
    const database = getDatabase();

    await settings.loadGuildSettings();
    assert.equal(settings.getGuildSettings(guildId).embedColor, 123);
    assert.equal(levels.getLevel(guildId, userId).xp, 99);
    assert.equal((await audit.getRecentCommandLogs(guildId)).length, 1);
    assert.equal(database.prepare("SELECT count(*) AS count FROM legacy_imports").get().count, 4);

    await settings.updateGuildSettings(guildId, { embedColor: 456 });
    await audit.recordCommandLog({
      timestamp: new Date().toISOString(),
      commandName: "settings",
      userName: "tester",
      userId,
      guildName: "Test server",
      guildId,
      channelId: null,
      outcome: "completed",
    });
    const reservationId = tickets.reserveTicket(guildId, userId);
    assert.ok(reservationId);
    assert.equal(tickets.reserveTicket(guildId, userId), undefined);
    const ticket = tickets.registerOpenTicket({
      ticketId: reservationId,
      guildId,
      channelId: "12345678901234569",
      openerUserId: userId,
      subject: "Help",
      category: "technical",
    });
    tickets.claimTicket(ticket, userId);
    tickets.assignTicket(ticket, userId, "12345678901234570");
    tickets.setTicketPriority(ticket, userId, "urgent");
    tickets.closeTicketRecord(ticket, userId, "Resolved");
    assert.equal(tickets.findOpenTicket(guildId, userId), undefined);
    tickets.reopenTicketRecord(ticket, userId);
    assert.equal(tickets.findOpenTicket(guildId, userId).priority, "urgent");

    const warningId = moderation.createWarning({
      guildId,
      targetUserId: userId,
      moderatorUserId: "12345678901234570",
      reason: "Test warning",
    });
    assert.equal(moderation.getWarnings(guildId, userId)[0].active, true);
    assert.equal(moderation.getModerationHistory(guildId, userId)[0].action, "warn");
    moderation.removeWarning(guildId, warningId, userId, "12345678901234570");
    assert.equal(moderation.getWarnings(guildId, userId)[0].active, false);

    analytics.recordMessageActivity(guildId, 42);
    analytics.recordMemberCount(guildId, 43);
    const featureRoles = {
      settings: [],
      analytics: ["12345678901234570"],
      activity: [],
      moderation: [],
      server_tools: [],
      tickets: [],
    };
    featurePermissions.setGuildFeatureRoles(guildId, featureRoles);
    assert.deepEqual(featurePermissions.getGuildFeatureRoles(guildId), featureRoles);
    const assignedMemberGuild = {
      id: guildId,
      members: {
        fetch: async () => ({ roles: { cache: new Map([["12345678901234570", {}]]) } }),
      },
    };
    assert.equal(
      await featurePermissions.memberHasDashboardFeature(
        assignedMemberGuild,
        "12345678901234571",
        "analytics",
      ),
      true,
    );
    assert.equal(
      await featurePermissions.memberHasDashboardFeature(
        assignedMemberGuild,
        "12345678901234571",
        "moderation",
      ),
      false,
    );
    assert.throws(
      () =>
        featurePermissions.setGuildFeatureRoles(guildId, {
          ...featureRoles,
          analytics: ["not-a-discord-role-id"],
        }),
      /invalid role ID/,
    );
    assert.equal(analytics.getGuildAnalytics(guildId, 7).dailyActivity[0].messages, 1);
    assert.equal(analytics.getGuildAnalytics(guildId, 7).dailyActivity[0].members, 43);

    const store = new SqliteSessionStore();
    const sessionValue = {
      cookie: {
        originalMaxAge: 60_000,
        expires: new Date(Date.now() + 60_000).toISOString(),
      },
      csrfToken: "test-csrf-token",
    };
    await new Promise((resolve, reject) =>
      store.set("session-id", sessionValue, (error) => (error ? reject(error) : resolve())),
    );
    const loadedSession = await new Promise((resolve, reject) =>
      store.get("session-id", (error, value) => (error ? reject(error) : resolve(value))),
    );
    assert.equal(loadedSession.csrfToken, sessionValue.csrfToken);
    await new Promise((resolve, reject) =>
      store.set(
        "expired-session-id",
        {
          cookie: { expires: new Date(Date.now() - 1).toISOString() },
        },
        (error) => (error ? reject(error) : resolve()),
      ),
    );
    const expiredSession = await new Promise((resolve, reject) =>
      store.get("expired-session-id", (error, value) => (error ? reject(error) : resolve(value))),
    );
    assert.equal(expiredSession, null);
    await new Promise((resolve, reject) =>
      store.destroy("session-id", (error) => (error ? reject(error) : resolve())),
    );
    closeDatabase();

    await initializeDatabase(dataDirectory);
    await settings.loadGuildSettings();
    assert.equal(settings.getGuildSettings(guildId).embedColor, 456);
    assert.equal((await audit.getRecentCommandLogs(guildId)).length, 2);
    assert.equal(getDatabase().prepare("SELECT count(*) AS count FROM member_xp").get().count, 1);
    assert.equal(
      getDatabase().prepare("SELECT count(*) AS count FROM legacy_imports").get().count,
      4,
    );
    assert.equal(
      getDatabase().prepare("SELECT count(*) AS count FROM ticket_staff_activity").get().count,
      6,
    );
    assert.equal(
      getDatabase()
        .prepare("SELECT count(*) AS count FROM moderation_warnings WHERE active = 0")
        .get().count,
      1,
    );
    assert.equal(
      getDatabase().prepare("SELECT count(*) AS count FROM dashboard_sessions").get().count,
      0,
    );
    assert.ok(
      (await readFile(path.join(dataDirectory, "guild-settings.json"), "utf8")).includes(
        '"embedColor":123',
      ),
    );
  } finally {
    closeDatabase();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
