export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const output = JSON.stringify(record);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
}

export function logFailure(event: string, error: unknown, fields: LogFields = {}): void {
  log("error", event, {
    ...fields,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
}

export function getSafeStartupErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown error";

  let message = error.message;
  for (const name of [
    "DISCORD_TOKEN",
    "DISCORD_CLIENT_SECRET",
    "DASHBOARD_SESSION_SECRET",
    "BOT_LOG_WEBHOOK_URL",
  ]) {
    const secret = process.env[name];
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message
    .replace(
      /https?:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[^\s"'<>]+/gi,
      "[redacted webhook URL]",
    )
    .slice(0, 500);
}
