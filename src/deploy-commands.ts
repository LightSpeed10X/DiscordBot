import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { config } from "./config.js";

const rest = new REST({ version: "10" }).setToken(config.token);

try {
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: commands });
  console.log(`Registered ${commands.length} slash commands.`);
} catch (error) {
  console.error("Could not register slash commands.", error instanceof Error ? error.name : "Unknown error");
  process.exitCode = 1;
}
