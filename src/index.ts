import {
  Client,
  ChannelType,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  GuildMember,
  PermissionFlagsBits,
  WebhookClient,
  type ChatInputCommandInteraction,
  type NewsChannel,
  type TextChannel,
  type User
} from "discord.js";
import { randomInt } from "node:crypto";
import { recordCommandLog } from "./audit-log.js";
import { syncAutoModerationRules } from "./auto-moderation.js";
import { config } from "./config.js";
import { startDashboard } from "./dashboard.js";
import { awardMessageXp, getLeaderboard, getLevel, loadLevels } from "./levels.js";
import {
  getGuildSettings,
  loadGuildSettings,
  updateGuildSettings
} from "./guild-settings.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages]
});
const logWebhook = config.logWebhookUrl
  ? new WebhookClient({ url: config.logWebhookUrl })
  : undefined;

const pollEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
const eightBallAnswers = [
  "It is certain.",
  "Without a doubt.",
  "You may rely on it.",
  "Signs point to yes.",
  "Ask again later.",
  "Better not tell you now.",
  "Cannot predict that right now.",
  "Don't count on it.",
  "My reply is no.",
  "Very doubtful."
];
const errorReply = "That command could not be completed. Check the bot's permissions and try again.";

function logCommand(
  interaction: ChatInputCommandInteraction,
  outcome: "completed" | "error"
): void {
  if (interaction.guildId && interaction.guild) {
    void recordCommandLog({
      timestamp: interaction.createdAt.toISOString(),
      commandName: interaction.commandName,
      userName: interaction.user.tag,
      userId: interaction.user.id,
      guildName: interaction.guild.name,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      outcome
    }).catch(error => {
      console.error(`Command audit log write failed (${error instanceof Error ? error.name : "unknown error"}).`);
    });
  }
  if (!logWebhook) return;

  const embed = new EmbedBuilder()
    .setColor(outcome === "error" ? 0xed4245 : 0x57f287)
    .setTitle(`/${interaction.commandName}`)
    .addFields(
      { name: "User", value: `${interaction.user.tag} (${interaction.user.id})` },
      {
        name: "Server",
        value: interaction.guild
          ? `${interaction.guild.name} (${interaction.guild.id})`
          : "Direct message"
      },
      { name: "Channel ID", value: interaction.channelId ?? "Unknown" },
      { name: "Handler result", value: outcome }
    )
    .setTimestamp(interaction.createdAt);

  void logWebhook.send({
    embeds: [embed],
    allowedMentions: { parse: [] }
  }).catch(error => {
    console.error(`Command log webhook failed (${error instanceof Error ? error.name : "unknown error"}).`);
  });
}

function getGuildTextChannel(interaction: ChatInputCommandInteraction): TextChannel | NewsChannel | null {
  const channel = interaction.channel;
  if (
    channel?.type === ChannelType.GuildText ||
    channel?.type === ChannelType.GuildAnnouncement
  ) {
    return channel;
  }
  return null;
}

async function replyPublicly(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  await interaction.reply({
    content,
    allowedMentions: { parse: [] }
  });
}

function isAllowed(
  interaction: ChatInputCommandInteraction,
  permission: bigint
): boolean {
  return interaction.memberPermissions?.has(permission) ?? false;
}

function embedColor(guildId: string | null): number {
  return guildId ? getGuildSettings(guildId).embedColor : 0x5865f2;
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "\\$1");
}

function validateModeratorTarget(
  actor: GuildMember,
  target: GuildMember,
  botMember: GuildMember,
  require: "moderatable" | "kickable" | "bannable"
): string | undefined {
  if (target.id === actor.id) return "You cannot target yourself.";
  if (target.id === botMember.id) return "I cannot target myself.";
  if (actor.id !== actor.guild.ownerId && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return "You can only moderate members with a lower role than yours.";
  }
  if (!target[require]) return "I cannot moderate that member. Check role hierarchy and bot permissions.";
  return undefined;
}

async function getModerationMembers(
  interaction: ChatInputCommandInteraction,
  targetUser: User
): Promise<{ actor: GuildMember; bot: GuildMember; target: GuildMember }> {
  if (!interaction.guild) throw new Error("Guild-only command");
  const [actor, bot, target] = await Promise.all([
    interaction.guild.members.fetch(interaction.user.id),
    interaction.guild.members.fetchMe(),
    interaction.guild.members.fetch(targetUser.id)
  ]);
  return { actor, bot, target };
}

async function executeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  switch (interaction.commandName) {
    case "help": {
      await interaction.reply({
        content: [
          "**Utilities:** `/ping`, `/server`, `/user`, `/avatar`, `/poll`",
          "**Levels:** `/rank`, `/leaderboard`",
          "**Fun:** `/coinflip`, `/roll`, `/choose`, `/eightball`",
          "**Moderation:** `/clear`, `/slowmode`, `/timeout`, `/kick`, `/ban`",
          "**Server customization:** `/settings view`, `/settings color`, `/settings welcome`, `/settings disable-welcome`",
          "**Other:** `/announce`"
        ].join("\n")
      });
      return;
    }
    case "ping": {
      const roundTrip = Date.now() - interaction.createdTimestamp;
      await interaction.reply({
        content: `Round-trip: ${roundTrip}ms | Gateway: ${Math.round(client.ws.ping)}ms`
      });
      return;
    }
    case "server": {
      if (!interaction.guild) {
        await replyPublicly(interaction, "This command is only available in a server.");
        return;
      }
      const guild = interaction.guild;
      const embed = new EmbedBuilder()
        .setColor(embedColor(interaction.guildId))
        .setTitle(guild.name)
        .addFields(
          { name: "Members", value: String(guild.memberCount), inline: true },
          { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
          { name: "Server ID", value: guild.id, inline: true }
        );
      const icon = guild.iconURL({ size: 256 });
      if (icon) embed.setThumbnail(icon);
      await interaction.reply({ embeds: [embed] });
      return;
    }
    case "user": {
      const user = interaction.options.getUser("target") ?? interaction.user;
      const embed = new EmbedBuilder()
        .setColor(embedColor(interaction.guildId))
        .setTitle(user.tag)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: "Account created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` },
          { name: "Bot account", value: user.bot ? "Yes" : "No", inline: true },
          { name: "User ID", value: user.id, inline: true }
        );
      await interaction.reply({ embeds: [embed] });
      return;
    }
    case "avatar": {
      const user = interaction.options.getUser("target") ?? interaction.user;
      const avatar = user.displayAvatarURL({ size: 1024 });
      const embed = new EmbedBuilder()
        .setColor(embedColor(interaction.guildId))
        .setTitle(`${user.username}'s avatar`)
        .setImage(avatar)
        .setURL(avatar);
      await interaction.reply({ embeds: [embed] });
      return;
    }
    case "rank": {
      if (!interaction.guildId) {
        await replyPublicly(interaction, "Rank is only available in a server.");
        return;
      }
      const target = interaction.options.getUser("target") ?? interaction.user;
      const entry = getLevel(interaction.guildId, target.id);
      const currentLevelXp = entry.xp - entry.level ** 2 * 100;
      const nextLevelXp = (entry.level + 1) ** 2 * 100 - entry.level ** 2 * 100;
      const embed = new EmbedBuilder()
        .setColor(embedColor(interaction.guildId))
        .setTitle(`${target.username}'s activity rank`)
        .setThumbnail(target.displayAvatarURL({ size: 128 }))
        .addFields(
          { name: "Level", value: String(entry.level), inline: true },
          { name: "Total XP", value: entry.xp.toLocaleString(), inline: true },
          { name: "Progress", value: `${currentLevelXp} / ${nextLevelXp} XP` }
        );
      await interaction.reply({ embeds: [embed] });
      return;
    }
    case "leaderboard": {
      if (!interaction.guildId) {
        await replyPublicly(interaction, "The leaderboard is only available in a server.");
        return;
      }
      const leaderboard = getLeaderboard(interaction.guildId);
      const description = leaderboard.length
        ? leaderboard.map((entry, index) =>
          `**${index + 1}.** <@${entry.userId}> — Level ${entry.level} · ${entry.xp.toLocaleString()} XP`
        ).join("\n")
        : "No activity has been recorded yet.";
      const embed = new EmbedBuilder()
        .setColor(embedColor(interaction.guildId))
        .setTitle(`${interaction.guild?.name ?? "Server"} activity leaderboard`)
        .setDescription(description);
      await interaction.reply({
        embeds: [embed],
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "coinflip": {
      await interaction.reply(`🪙 **${randomInt(2) === 0 ? "Heads" : "Tails"}!**`);
      return;
    }
    case "roll": {
      const minimum = interaction.options.getInteger("minimum") ?? 1;
      const maximum = interaction.options.getInteger("maximum") ?? 6;
      if (minimum > maximum) {
        await replyPublicly(interaction, "The minimum must be less than or equal to the maximum.");
        return;
      }
      await interaction.reply(`🎲 You rolled **${randomInt(minimum, maximum + 1)}** (${minimum}–${maximum}).`);
      return;
    }
    case "choose": {
      const choices = Array.from({ length: 10 }, (_, index) =>
        interaction.options.getString(`option${index + 1}`)
      ).filter((choice): choice is string => choice !== null);
      const choice = choices[randomInt(choices.length)];
      await interaction.reply({
        content: `🎯 I choose: **${escapeMarkdown(choice)}**`,
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "eightball": {
      const answer = eightBallAnswers[randomInt(eightBallAnswers.length)];
      await interaction.reply(`🎱 ${answer}`);
      return;
    }
    case "poll": {
      const channel = getGuildTextChannel(interaction);
      if (!channel) {
        await replyPublicly(interaction, "Create polls in a server text channel.");
        return;
      }
      const choices = [1, 2, 3, 4, 5]
        .map(index => interaction.options.getString(`choice${index}`))
        .filter((choice): choice is string => choice !== null);
      const question = interaction.options.getString("question", true);
      const embed = new EmbedBuilder()
        .setColor(embedColor(interaction.guildId))
        .setTitle("Poll")
        .setDescription(
          `**${question}**\n\n${choices
            .map((choice, index) => `${pollEmojis[index]} ${choice}`)
            .join("\n")}`
        )
        .setFooter({ text: `Poll by ${interaction.user.username}` });
      const message = await interaction.reply({
        embeds: [embed],
        allowedMentions: { parse: [] },
        fetchReply: true
      });
      for (const emoji of pollEmojis.slice(0, choices.length)) {
        await message.react(emoji);
      }
      return;
    }
    case "settings": {
      if (!interaction.guild) {
        await replyPublicly(interaction, "Server settings are only available in a server.");
        return;
      }
      if (!isAllowed(interaction, PermissionFlagsBits.ManageGuild)) {
        await replyPublicly(interaction, "You need Manage Server to customize this bot.");
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      const settings = getGuildSettings(interaction.guild.id);
      if (subcommand === "view") {
        const welcomeSummary = settings.welcomeChannelId
          ? `Enabled in <#${settings.welcomeChannelId}>\nMessage: ${settings.welcomeMessage}`
          : "Disabled";
        await replyPublicly(
          interaction,
          `**Server bot settings**\nEmbed color: \`#${settings.embedColor.toString(16).padStart(6, "0").toUpperCase()}\`\nWelcome messages: ${welcomeSummary}\nAuto-moderation: ${settings.autoModerationEnabled ? "Enabled" : "Disabled"}\nLevels: ${settings.levelingEnabled ? "Enabled" : "Disabled"}`
        );
        return;
      }
      if (subcommand === "color") {
        const color = interaction.options.getString("hex", true);
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
          await replyPublicly(interaction, "Enter a hex color in the format `#5865F2`.");
          return;
        }
        await updateGuildSettings(interaction.guild.id, {
          embedColor: Number.parseInt(color.slice(1), 16)
        });
        await replyPublicly(interaction, `Embed color updated to \`${color.toUpperCase()}\`.`);
        return;
      }
      if (subcommand === "welcome") {
        const selectedChannel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
        const message = interaction.options.getString("message", true).trim();
        if (!message) {
          await replyPublicly(interaction, "Welcome message cannot be empty.");
          return;
        }
        const channel = await interaction.guild.channels.fetch(selectedChannel.id);
        if (!channel || channel.type !== ChannelType.GuildText) {
          await replyPublicly(interaction, "Choose a regular server text channel.");
          return;
        }
        const botMember = await interaction.guild.members.fetchMe();
        if (
          !channel.permissionsFor(botMember)?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages
          ])
        ) {
          await replyPublicly(interaction, "I need View Channel and Send Messages in the selected channel.");
          return;
        }
        await updateGuildSettings(interaction.guild.id, {
          welcomeChannelId: channel.id,
          welcomeMessage: message
        });
        await replyPublicly(
          interaction,
          `Welcome messages enabled in <#${channel.id}>. Available placeholders: \`{user}\`, \`{server}\`, and \`{count}\`.`
        );
        return;
      }
      await updateGuildSettings(interaction.guild.id, {
        welcomeChannelId: undefined,
        welcomeMessage: undefined
      });
      await replyPublicly(interaction, "Welcome messages disabled.");
      return;
    }
    case "announce": {
      if (!isAllowed(interaction, PermissionFlagsBits.ManageMessages)) {
        await replyPublicly(interaction, "You need Manage Messages to make an announcement.");
        return;
      }
      if (!getGuildTextChannel(interaction)) {
        await replyPublicly(interaction, "Make announcements in a server text channel.");
        return;
      }
      await interaction.reply({
        content: interaction.options.getString("message", true),
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "clear": {
      if (!isAllowed(interaction, PermissionFlagsBits.ManageMessages)) {
        await replyPublicly(interaction, "You need Manage Messages to clear messages.");
        return;
      }
      const channel = getGuildTextChannel(interaction);
      if (!channel) {
        await replyPublicly(interaction, "This command requires a server text channel.");
        return;
      }
      const amount = interaction.options.getInteger("amount", true);
      const deleted = await channel.bulkDelete(amount, true);
      await replyPublicly(interaction, `Deleted ${deleted.size} recent message(s). Messages older than 14 days are skipped by Discord.`);
      return;
    }
    case "slowmode": {
      if (!isAllowed(interaction, PermissionFlagsBits.ManageChannels)) {
        await replyPublicly(interaction, "You need Manage Channels to change slowmode.");
        return;
      }
      const channel = getGuildTextChannel(interaction);
      if (!channel) {
        await replyPublicly(interaction, "This command requires a server text channel.");
        return;
      }
      const seconds = interaction.options.getInteger("seconds", true);
      await channel.setRateLimitPerUser(seconds, `Changed by ${interaction.user.tag}`);
      await replyPublicly(interaction, seconds === 0 ? "Slowmode disabled." : `Slowmode set to ${seconds} second(s).`);
      return;
    }
    case "timeout": {
      if (!isAllowed(interaction, PermissionFlagsBits.ModerateMembers)) {
        await replyPublicly(interaction, "You need Moderate Members to use timeouts.");
        return;
      }
      const targetUser = interaction.options.getUser("target", true);
      const { actor, bot, target } = await getModerationMembers(interaction, targetUser);
      const denial = validateModeratorTarget(actor, target, bot, "moderatable");
      if (denial) {
        await replyPublicly(interaction, denial);
        return;
      }
      const minutes = interaction.options.getInteger("minutes", true);
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      await target.timeout(minutes * 60_000, reason);
      await replyPublicly(interaction, `Timed out **${target.user.tag}** for ${minutes} minute(s).`);
      return;
    }
    case "kick": {
      if (!isAllowed(interaction, PermissionFlagsBits.KickMembers)) {
        await replyPublicly(interaction, "You need Kick Members to use this command.");
        return;
      }
      const targetUser = interaction.options.getUser("target", true);
      const { actor, bot, target } = await getModerationMembers(interaction, targetUser);
      const denial = validateModeratorTarget(actor, target, bot, "kickable");
      if (denial) {
        await replyPublicly(interaction, denial);
        return;
      }
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      await target.kick(reason);
      await replyPublicly(interaction, `Kicked **${target.user.tag}**.`);
      return;
    }
    case "ban": {
      if (!isAllowed(interaction, PermissionFlagsBits.BanMembers)) {
        await replyPublicly(interaction, "You need Ban Members to use this command.");
        return;
      }
      const targetUser = interaction.options.getUser("target", true);
      const { actor, bot, target } = await getModerationMembers(interaction, targetUser);
      const denial = validateModeratorTarget(actor, target, bot, "bannable");
      if (denial) {
        await replyPublicly(interaction, denial);
        return;
      }
      const deleteDays = interaction.options.getInteger("delete-days") ?? 0;
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      await target.ban({ deleteMessageSeconds: deleteDays * 86_400, reason });
      await replyPublicly(interaction, `Banned **${target.user.tag}**.`);
      return;
    }
    default:
      await replyPublicly(interaction, "Unknown command.");
  }
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Ready as ${readyClient.user.tag}`);
  if (config.dashboard) {
    void startDashboard(readyClient, config.dashboard, config.clientId).catch(error => {
      console.error(`Dashboard startup failed (${error instanceof Error ? error.message : "unknown error"}).`);
    });
  } else {
    console.log("Dashboard disabled. Configure DISCORD_CLIENT_SECRET and DASHBOARD_SESSION_SECRET to enable it.");
  }
});

client.on(Events.GuildMemberAdd, async member => {
  const settings = getGuildSettings(member.guild.id);
  if (!settings.welcomeChannelId || !settings.welcomeMessage) return;
  try {
    const channel = await member.guild.channels.fetch(settings.welcomeChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.error(`Welcome channel is missing or not a text channel in guild ${member.guild.id}.`);
      return;
    }
    const botMember = member.guild.members.me;
    if (
      !botMember ||
      !channel.permissionsFor(botMember)?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages
      ])
    ) {
      console.error(`Bot cannot send welcome messages in guild ${member.guild.id}.`);
      return;
    }
    const content = settings.welcomeMessage
      .replaceAll("{user}", member.user.username)
      .replaceAll("{server}", member.guild.name)
      .replaceAll("{count}", String(member.guild.memberCount));
    await channel.send({ content, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error(`Welcome message failed in guild ${member.guild.id} (${error instanceof Error ? error.name : "unknown error"}).`);
  }
});

client.on(Events.MessageCreate, message => {
  if (!message.guild || message.author.bot || !getGuildSettings(message.guild.id).levelingEnabled) return;
  void awardMessageXp(message.guild.id, message.author.id).then(async entry => {
    if (!entry || !message.channel.isSendable()) return;
    await message.channel.send({
      content: `${message.author.username} reached level ${entry.level}!`,
      allowedMentions: { parse: [] }
    });
  }).catch(error => {
    console.error(`Message XP update failed in guild ${message.guildId} (${error instanceof Error ? error.name : "unknown error"}).`);
  });
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await executeCommand(interaction);
    logCommand(interaction, "completed");
  } catch (error) {
    logCommand(interaction, "error");
    console.error(
      `Command /${interaction.commandName} failed (${error instanceof Error ? error.name : "unknown error"}).`
    );
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: errorReply, embeds: [] });
      } else {
        await replyPublicly(interaction, errorReply);
      }
    } catch (replyError) {
      console.error(
        `Could not send command error response (${replyError instanceof Error ? replyError.name : "unknown error"}).`
      );
    }
  }
});

client.on(Events.Error, error => {
  console.error(`Discord client error (${error.name}).`);
});

try {
  await loadGuildSettings();
  await loadLevels();
  await client.login(config.token);
} catch (error) {
  console.error(`Bot startup failed (${error instanceof Error ? error.message : "unknown error"}).`);
  process.exitCode = 1;
}
