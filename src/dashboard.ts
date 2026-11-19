import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response
} from "express";
import session from "express-session";
import {
  ChannelType,
  Client,
  PermissionFlagsBits,
  type Guild
} from "discord.js";
import type { DashboardConfig } from "./config.js";
import { commands } from "./commands.js";
import { syncAutoModerationRules } from "./auto-moderation.js";
import { getRecentCommandLogs } from "./audit-log.js";
import { getLeaderboard } from "./levels.js";
import {
  getGuildSettings,
  updateGuildSettings,
  type GuildSettings
} from "./guild-settings.js";

interface DashboardUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

interface OAuthGuild {
  id: string;
  name: string;
  icon: string | null;
  permissions: string;
}

declare module "express-session" {
  interface SessionData {
    oauthState?: string;
    accessToken?: string;
    csrfToken?: string;
    user?: DashboardUser;
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
  }
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncRoute(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOAuthGuild(value: unknown): value is OAuthGuild {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    /^\d{17,20}$/.test(value.id) &&
    typeof value.name === "string" &&
    (typeof value.icon === "string" || value.icon === null) &&
    typeof value.permissions === "string"
  );
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });
}

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => error ? reject(error) : resolve());
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy(error => error ? reject(error) : resolve());
  });
}

function getSession(req: Request): { user: DashboardUser; accessToken: string } {
  if (!req.session.user || !req.session.accessToken) {
    throw new HttpError(401, "Please sign in with Discord.");
  }
  return { user: req.session.user, accessToken: req.session.accessToken };
}

function getGuildId(req: Request): string {
  const guildId = req.params.guildId;
  if (typeof guildId !== "string") throw new HttpError(400, "Invalid server ID.");
  return guildId;
}

function hasManageGuild(guild: OAuthGuild): boolean {
  return hasGuildPermission(guild, PermissionFlagsBits.ManageGuild);
}

function hasGuildPermission(guild: OAuthGuild, permission: bigint): boolean {
  try {
    return (BigInt(guild.permissions) & (permission | PermissionFlagsBits.Administrator)) !== 0n;
  } catch {
    return false;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function getRetryAfterMilliseconds(response: globalThis.Response): Promise<number> {
  const headerSeconds = Number.parseFloat(response.headers.get("retry-after") ?? "");
  let bodySeconds: number | undefined;
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.retry_after === "number" && Number.isFinite(body.retry_after)) {
      bodySeconds = body.retry_after;
    }
  } catch {
    bodySeconds = undefined;
  }
  const seconds = Number.isFinite(headerSeconds) && headerSeconds >= 0
    ? headerSeconds
    : bodySeconds ?? 1;
  return Math.max(100, Math.ceil(seconds * 1000));
}

async function discordApi<T>(path: string, accessToken: string): Promise<T> {
  let lastError: unknown;
  const maxAttempts = 3;
  const maximumAutomaticWaitMs = 5_000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`https://discord.com/api/v10${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfterMs = await getRetryAfterMilliseconds(response);
          if (attempt < maxAttempts - 1 && retryAfterMs <= maximumAutomaticWaitMs) {
            await sleep(retryAfterMs);
            continue;
          }
          const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
          throw new HttpError(
            503,
            `Discord is temporarily rate-limiting dashboard requests. Retry in about ${retryAfterSeconds} second(s).`,
            retryAfterSeconds
          );
        }
        if (attempt < maxAttempts - 1 && response.status >= 500) {
          await sleep(500);
          continue;
        }
        throw new HttpError(
          response.status === 401 ? 401 : 502,
          response.status === 401
            ? "Discord sign-in expired. Please sign in again."
            : `Discord API request failed (HTTP ${response.status}).`
        );
      }
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError) throw error;
      if (attempt < maxAttempts - 1) {
        await sleep(500);
      }
    }
  }
  throw new HttpError(502, `Discord API request failed: ${lastError instanceof Error ? lastError.name : "network error"}.`);
}

const oauthGuildCache = new Map<string, {
  expiresAt: number;
  value: Promise<OAuthGuild[]>;
}>();
const oauthGuildCacheTtlMs = 15_000;

async function fetchOAuthGuilds(accessToken: string): Promise<OAuthGuild[]> {
  const cacheKey = createHash("sha256").update(accessToken).digest("hex");
  const cached = oauthGuildCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = (async () => {
    const response: unknown = await discordApi("/users/@me/guilds", accessToken);
    if (!Array.isArray(response) || !response.every(isOAuthGuild)) {
      throw new HttpError(502, "Discord returned an invalid server list.");
    }
    return response;
  })();
  oauthGuildCache.set(cacheKey, { expiresAt: Date.now() + oauthGuildCacheTtlMs, value });
  if (oauthGuildCache.size > 256) {
    for (const [key, entry] of oauthGuildCache) {
      if (entry.expiresAt <= Date.now() || oauthGuildCache.size > 256) oauthGuildCache.delete(key);
    }
  }
  try {
    return await value;
  } catch (error) {
    if (oauthGuildCache.get(cacheKey)?.value === value) oauthGuildCache.delete(cacheKey);
    throw error;
  }
}

async function authorizeGuild(
  client: Client<true>,
  accessToken: string,
  guildId: string,
  requiredPermission?: { permission: bigint; message: string }
): Promise<Guild> {
  if (!/^\d{17,20}$/.test(guildId)) throw new HttpError(400, "Invalid server ID.");
  const userGuilds = await fetchOAuthGuilds(accessToken);
  const userGuild = userGuilds.find(guild => guild.id === guildId);
  if (!userGuild || !hasManageGuild(userGuild)) {
    throw new HttpError(403, "You need Manage Server to access this server.");
  }
  if (requiredPermission && !hasGuildPermission(userGuild, requiredPermission.permission)) {
    throw new HttpError(403, requiredPermission.message);
  }
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new HttpError(404, "The bot is not in this server.");
  return guild;
}

function verifyDashboardMutation(req: Request, baseUrl: string): void {
  if (
    req.get("origin") !== baseUrl ||
    !req.session.csrfToken ||
    req.get("x-csrf-token") !== req.session.csrfToken
  ) {
    throw new HttpError(403, "Your session could not be verified.");
  }
}

function getPublicDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");
}

export async function startDashboard(
  client: Client<true>,
  config: DashboardConfig,
  clientId: string
): Promise<Server> {
  const app = express();
  const publicDirectory = getPublicDirectory();
  const redirectUri = `${config.baseUrl}/auth/callback`;
  const cookieName = "dcbot.sid";

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' https://cdn.discordapp.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    );
    next();
  });
  app.use(session({
    name: cookieName,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000
    }
  }));
  app.use(express.json({ limit: "32kb" }));
  app.use(express.static(publicDirectory, { index: false, maxAge: 0 }));

  app.get("/", (_req, res) => {
    res.sendFile(resolve(publicDirectory, "index.html"));
  });

  app.get("/auth/login", asyncRoute(async (req, res) => {
    const state = randomBytes(32).toString("hex");
    req.session.oauthState = state;
    await saveSession(req);
    const parameters = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds",
      state
    });
    res.redirect(`https://discord.com/oauth2/authorize?${parameters.toString()}`);
  }));

  app.get("/auth/callback", asyncRoute(async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    if (
      !code ||
      !state ||
      !req.session.oauthState ||
      !safeEqual(state, req.session.oauthState)
    ) {
      throw new HttpError(400, "Discord sign-in could not be verified. Please try again.");
    }

    const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!tokenResponse.ok) {
      throw new HttpError(502, "Discord sign-in failed while exchanging the authorization code.");
    }
    const tokenBody: unknown = await tokenResponse.json();
    if (!isRecord(tokenBody) || typeof tokenBody.access_token !== "string") {
      throw new HttpError(502, "Discord returned an invalid sign-in response.");
    }

    const profile: unknown = await discordApi("/users/@me", tokenBody.access_token);
    if (
      !isRecord(profile) ||
      typeof profile.id !== "string" ||
      !/^\d{17,20}$/.test(profile.id) ||
      typeof profile.username !== "string" ||
      !(
        typeof profile.global_name === "string" ||
        profile.global_name === null ||
        profile.global_name === undefined
      ) ||
      !(typeof profile.avatar === "string" || profile.avatar === null || profile.avatar === undefined)
    ) {
      throw new HttpError(502, "Discord returned an invalid user profile.");
    }

    await regenerateSession(req);
    req.session.user = {
      id: profile.id,
      username: profile.username,
      globalName: typeof profile.global_name === "string" ? profile.global_name : null,
      avatar: typeof profile.avatar === "string" ? profile.avatar : null
    };
    req.session.accessToken = tokenBody.access_token;
    req.session.csrfToken = randomBytes(32).toString("hex");
    await saveSession(req);
    res.redirect("/");
  }));

  app.post("/auth/logout", asyncRoute(async (req, res) => {
    getSession(req);
    if (req.get("origin") !== config.baseUrl || !req.session.csrfToken ||
      req.get("x-csrf-token") !== req.session.csrfToken) {
      throw new HttpError(403, "Your session could not be verified.");
    }
    await destroySession(req);
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: "lax"
    });
    res.status(204).end();
  }));

  app.get("/api/me", (req, res) => {
    if (!req.session.user || !req.session.csrfToken) {
      res.status(401).json({ error: "Please sign in with Discord." });
      return;
    }
    res.json({
      user: req.session.user,
      csrfToken: req.session.csrfToken
    });
  });

  app.get("/api/guilds", asyncRoute(async (req, res) => {
    const { accessToken } = getSession(req);
    const guilds = await fetchOAuthGuilds(accessToken);
    res.json(guilds
      .filter(guild => hasManageGuild(guild) && client.guilds.cache.has(guild.id))
      .map(guild => {
        const botGuild = client.guilds.cache.get(guild.id);
        return {
          id: guild.id,
          name: guild.name,
          icon: guild.icon && botGuild
            ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
            : null,
          memberCount: botGuild?.memberCount ?? 0
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name)));
  }));

  app.get("/api/guilds/:guildId", asyncRoute(async (req, res) => {
    const { accessToken } = getSession(req);
    const guild = await authorizeGuild(client, accessToken, getGuildId(req));
    const channels = guild.channels.cache
      .filter(channel => channel.type === ChannelType.GuildText)
      .map(channel => ({
        id: channel.id,
        name: channel.name,
        slowmodeSeconds: channel.rateLimitPerUser
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    res.json({
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ size: 128 }),
        memberCount: guild.memberCount
      },
      settings: getGuildSettings(guild.id),
      channels,
      commands: commands.map(command => ({
        name: command.name,
        description: command.description
      }))
    });
  }));

  app.get("/api/guilds/:guildId/logs", asyncRoute(async (req, res) => {
    const { accessToken } = getSession(req);
    const guild = await authorizeGuild(client, accessToken, getGuildId(req));
    res.json(await getRecentCommandLogs(guild.id, 100));
  }));

  app.get("/api/guilds/:guildId/leaderboard", asyncRoute(async (req, res) => {
    const { accessToken } = getSession(req);
    const guild = await authorizeGuild(client, accessToken, getGuildId(req));
    res.json(getLeaderboard(guild.id, 10).map(entry => ({
      ...entry,
      username: guild.members.cache.get(entry.userId)?.displayName ?? `User ${entry.userId}`
    })));
  }));

  app.put("/api/guilds/:guildId/channels/slowmode", asyncRoute(async (req, res) => {
    const { accessToken } = getSession(req);
    verifyDashboardMutation(req, config.baseUrl);
    const guild = await authorizeGuild(client, accessToken, getGuildId(req), {
      permission: PermissionFlagsBits.ManageChannels,
      message: "You need Manage Channels to change slowmode."
    });
    const body: unknown = req.body;
    if (
      !isRecord(body) ||
      typeof body.channelId !== "string" ||
      !/^\d{17,20}$/.test(body.channelId) ||
      typeof body.seconds !== "number" ||
      !Number.isInteger(body.seconds) ||
      body.seconds < 0 ||
      body.seconds > 21600
    ) {
      throw new HttpError(400, "Choose a text channel and a slowmode from 0 to 21,600 seconds.");
    }
    const channel = await guild.channels.fetch(body.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new HttpError(400, "Choose a regular server text channel.");
    }
    const botMember = await guild.members.fetchMe();
    if (!channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
      throw new HttpError(400, "The bot needs Manage Channels in the selected channel.");
    }
    await channel.setRateLimitPerUser(body.seconds, "Changed from the dashboard");
    res.json({ channelId: channel.id, seconds: body.seconds });
  }));

  app.post("/api/guilds/:guildId/announcements", asyncRoute(async (req, res) => {
    const { accessToken } = getSession(req);
    verifyDashboardMutation(req, config.baseUrl);
    const guild = await authorizeGuild(client, accessToken, getGuildId(req), {
      permission: PermissionFlagsBits.ManageMessages,
      message: "You need Manage Messages to post a dashboard announcement."
    });
    const body: unknown = req.body;
    if (
      !isRecord(body) ||
      typeof body.channelId !== "string" ||
      !/^\d{17,20}$/.test(body.channelId) ||
      typeof body.message !== "string" ||
      body.message.trim().length === 0 ||
      body.message.length > 2000
    ) {
      throw new HttpError(400, "Choose a text channel and enter an announcement of up to 2,000 characters.");
    }
    const channel = await guild.channels.fetch(body.channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new HttpError(400, "Choose a regular server text channel.");
    }
    const botMember = await guild.members.fetchMe();
    if (!channel.permissionsFor(botMember)?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages
    ])) {
      throw new HttpError(400, "The bot needs View Channel and Send Messages in the selected channel.");
    }
    const message = await channel.send({
      content: body.message.trim(),
      allowedMentions: { parse: [] }
    });
    res.status(201).json({ messageId: message.id });
  }));

  app.put("/api/guilds/:guildId/settings", asyncRoute(async (req, res) => {
    const { accessToken } = getSession(req);
    verifyDashboardMutation(req, config.baseUrl);

    const guild = await authorizeGuild(client, accessToken, getGuildId(req));
    const body: unknown = req.body;
    if (
      !isRecord(body) ||
      typeof body.embedColor !== "string" ||
      !/^#[0-9a-fA-F]{6}$/.test(body.embedColor) ||
      typeof body.autoModerationEnabled !== "boolean" ||
      typeof body.levelingEnabled !== "boolean"
    ) {
      throw new HttpError(400, "Enter valid feature settings and a six-digit hex embed color.");
    }

    const autoModerationEnabled = body.autoModerationEnabled;
    const levelingEnabled = body.levelingEnabled;
    const update: Partial<GuildSettings> = {
      embedColor: Number.parseInt(body.embedColor.slice(1), 16),
      autoModerationEnabled,
      levelingEnabled
    };
    if (body.welcomeChannelId === null && body.welcomeMessage === null) {
      update.welcomeChannelId = undefined;
      update.welcomeMessage = undefined;
    } else if (
      typeof body.welcomeChannelId === "string" &&
      /^\d{17,20}$/.test(body.welcomeChannelId) &&
      typeof body.welcomeMessage === "string" &&
      body.welcomeMessage.trim().length > 0 &&
      body.welcomeMessage.length <= 500
    ) {
      const channel = await guild.channels.fetch(body.welcomeChannelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw new HttpError(400, "Choose a regular server text channel.");
      }
      const botMember = await guild.members.fetchMe();
      if (!channel.permissionsFor(botMember)?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages
      ])) {
        throw new HttpError(400, "The bot needs View Channel and Send Messages in the welcome channel.");
      }
      update.welcomeChannelId = channel.id;
      update.welcomeMessage = body.welcomeMessage.trim();
    } else {
      throw new HttpError(400, "Choose a welcome channel and enter a message of up to 500 characters.");
    }

    if (autoModerationEnabled !== getGuildSettings(guild.id).autoModerationEnabled) {
      await syncAutoModerationRules(guild, autoModerationEnabled);
    }
    const settings = await updateGuildSettings(guild.id, update);
    res.json({ settings });
  }));

  app.get(/.*/, (_req, res) => {
    res.sendFile(resolve(publicDirectory, "index.html"));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) {
      console.error(`Dashboard request failed (${error instanceof Error ? error.message : "unknown error"}).`);
    }
    if (res.headersSent) return;
    if (error instanceof HttpError && error.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    res.status(status).json({
      error: error instanceof HttpError ? error.message : "Dashboard request failed."
    });
  });

  const server = app.listen(config.port, "127.0.0.1");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("listening", resolvePromise);
    server.once("error", rejectPromise);
  });
  console.log(`Dashboard listening on ${config.baseUrl}`);
  return server;
}
