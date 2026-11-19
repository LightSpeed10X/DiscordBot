export function isDiscordWebhookUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    ["discord.com", "discordapp.com"].includes(url.hostname) &&
    !url.port &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/api\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname)
  );
}

export async function sendDiscordWebhookLog(
  webhookUrl: string,
  embed: {
    title: string;
    color: number;
    timestamp: string;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
  }
): Promise<void> {
  if (!isDiscordWebhookUrl(webhookUrl)) throw new Error("Invalid Discord webhook URL.");
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [embed],
      allowed_mentions: { parse: [] }
    }),
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`Discord webhook request failed (HTTP ${response.status}).`);
}
