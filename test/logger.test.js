import assert from "node:assert/strict";
import test from "node:test";
import { getSafeStartupErrorMessage } from "../dist/utils/logger.js";

test("startup diagnostics retain the reason while redacting configured secrets", () => {
  const previousToken = process.env.DISCORD_TOKEN;
  const previousWebhook = process.env.BOT_LOG_WEBHOOK_URL;
  process.env.DISCORD_TOKEN = "test-secret-token";
  process.env.BOT_LOG_WEBHOOK_URL =
    "https://discord.com/api/webhooks/12345678901234567/test-webhook-token";

  try {
    const message = getSafeStartupErrorMessage(
      new Error(
        "Login failed with test-secret-token; configured https://discord.com/api/webhooks/12345678901234567/test-webhook-token; unexpected https://discord.com/api/webhooks/12345678901234567/other-token",
      ),
    );
    assert.equal(
      message,
      "Login failed with [redacted]; configured [redacted]; unexpected [redacted webhook URL]",
    );
  } finally {
    if (previousToken === undefined) delete process.env.DISCORD_TOKEN;
    else process.env.DISCORD_TOKEN = previousToken;
    if (previousWebhook === undefined) delete process.env.BOT_LOG_WEBHOOK_URL;
    else process.env.BOT_LOG_WEBHOOK_URL = previousWebhook;
  }
});
