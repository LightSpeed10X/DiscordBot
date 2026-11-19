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
