import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { config } from "./config.js";
import { log, logFailure } from "./utils/logger.js";

const rest = new REST({ version: "10" }).setToken(config.token);

try {
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: commands });
  log("info", "commands.registered", {
    count: commands.length,
    scope: config.guildId ? "guild" : "global",
  });
} catch (error) {
  logFailure("commands.registration_failed", error);
  process.exitCode = 1;
}
