import { DiscordAPIError, type Guild } from "discord.js";
import { getDatabase } from "../database/connection.js";

export const dashboardFeatures = [
  "settings",
  "analytics",
  "activity",
  "moderation",
  "server_tools",
  "tickets",
] as const;

export type DashboardFeature = (typeof dashboardFeatures)[number];
export type DashboardFeatureRoles = Record<DashboardFeature, string[]>;

export function createEmptyDashboardFeatureRoles(): DashboardFeatureRoles {
  return {
    settings: [],
    analytics: [],
    activity: [],
    moderation: [],
    server_tools: [],
    tickets: [],
  };
}

export function getGuildFeatureRoles(guildId: string): DashboardFeatureRoles {
  const result = createEmptyDashboardFeatureRoles();
  const rows = getDatabase()
    .prepare("SELECT feature, role_id FROM guild_feature_permission_roles WHERE guild_id = ?")
    .all(guildId) as { feature: string; role_id: string }[];
  for (const row of rows) {
    if (dashboardFeatures.includes(row.feature as DashboardFeature)) {
      result[row.feature as DashboardFeature].push(row.role_id);
    }
  }
  return result;
}

export function setGuildFeatureRoles(guildId: string, roles: DashboardFeatureRoles): void {
  const entries = dashboardFeatures.map((feature) => {
    const roleIds = roles[feature];
    if (!Array.isArray(roleIds) || roleIds.length > 10) {
      throw new Error(`Feature ${feature} must have at most ten staff roles.`);
    }
    const uniqueRoleIds = [...new Set(roleIds)];
    if (uniqueRoleIds.some((roleId) => !/^\d{17,20}$/.test(roleId))) {
      throw new Error(`Feature ${feature} contains an invalid role ID.`);
    }
    return [feature, uniqueRoleIds] as const;
  });
  const db = getDatabase();
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)").run(guildId);
    db.prepare("DELETE FROM guild_feature_permission_roles WHERE guild_id = ?").run(guildId);
    const insert = db.prepare(`
      INSERT INTO guild_feature_permission_roles (guild_id, feature, role_id)
      VALUES (?, ?, ?)
    `);
    for (const [feature, roleIds] of entries) {
      for (const roleId of roleIds) insert.run(guildId, feature, roleId);
    }
  })();
}

export async function memberHasDashboardFeature(
  guild: Guild,
  userId: string,
  feature: DashboardFeature,
): Promise<boolean> {
  const permittedRoles = getGuildFeatureRoles(guild.id)[feature];
  if (!permittedRoles.length) return false;
  try {
    const member = await guild.members.fetch(userId);
    return permittedRoles.some((roleId) => member.roles.cache.has(roleId));
  } catch (error) {
    if (error instanceof DiscordAPIError && error.status === 404) return false;
    throw error;
  }
}

export async function memberHasAnyDashboardFeature(guild: Guild, userId: string): Promise<boolean> {
  const permittedRoles = Object.values(getGuildFeatureRoles(guild.id)).flat();
  if (!permittedRoles.length) return false;
  try {
    const member = await guild.members.fetch(userId);
    return permittedRoles.some((roleId) => member.roles.cache.has(roleId));
  } catch (error) {
    if (error instanceof DiscordAPIError && error.status === 404) return false;
    throw error;
  }
}
