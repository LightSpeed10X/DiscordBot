import "dotenv/config";
import {
  Client,
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  WebhookClient,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type NewsChannel,
  type TextChannel,
  type User,
} from "discord.js";
import type { Server } from "node:http";
import { randomInt } from "node:crypto";
import { performance } from "node:perf_hooks";
import { recordCommandLog } from "./audit-log.js";
import { config } from "./config.js";
import { startDashboard } from "./dashboard.js";
import { closeDatabase, initializeDatabase } from "./database/connection.js";
import { awardMessageXp, getLeaderboard, getLevel, loadLevels } from "./levels.js";
import { recordMemberCount, recordMessageActivity } from "./services/analytics.js";
import {
  createWarning,
  getModerationHistory,
  getWarnings,
  recordModerationAction,
  removeWarning,
} from "./services/moderation.js";
import {
  assignTicket,
  cancelTicketReservation,
  claimTicket,
  closeTicketRecord,
  findOpenTicket,
  findTicketByChannel,
  registerExistingTicket,
  registerOpenTicket,
  reopenTicketRecord,
  reserveTicket,
  setTicketPriority,
} from "./services/tickets.js";
import { log, logFailure } from "./utils/logger.js";
import { applyBotPresence, loadBotPresenceSettings } from "./presence.js";
import {
  botDataDirectory,
  getGuildSettings,
  loadGuildSettings,
  updateGuildSettings,
} from "./guild-settings.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
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
  "Very doubtful.",
];
const memes = [
  [
    "Me: I will make one small bot change.",
    "Also me: adds a ticket desk, live logs, and a dashboard.",
  ],
  ["The server is quiet for five minutes.", "The activity leaderboard: suspicious."],
  ["I asked the bot for a quick answer.", "It opened a private ticket to discuss the question."],
  ["When the config finally validates.", "The deploy button starts looking less scary."],
];
const jokes = [
  "Why did the Discord bot bring a map? It kept getting lost in the server channels.",
  "Why was the moderator calm during the outage? They had excellent server composure.",
  "What is a bot's favorite kind of music? Anything with a good command line.",
  "Why did the message go to school? It wanted to improve its punctuation.",
];
const errorReply =
  "That command could not be completed. Check the bot's permissions and try again.";
const deferredEphemeralCommands = new Set([
  "ticket",
  "settings",
  "clear",
  "slowmode",
  "timeout",
  "kick",
  "ban",
  "warn",
  "warnings",
  "history",
  "clearwarn",
]);

function logCommand(
  interaction: ChatInputCommandInteraction,
  outcome: "completed" | "error",
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
      source: "command",
      outcome,
    }).catch((error) => {
      logFailure("command.audit_write_failed", error, {
        commandName: interaction.commandName,
        guildId: interaction.guildId,
      });
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
          : "Direct message",
      },
      { name: "Channel ID", value: interaction.channelId ?? "Unknown" },
      { name: "Handler result", value: outcome },
    )
    .setTimestamp(interaction.createdAt);

  void logWebhook
    .send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    })
    .catch((error) => {
      logFailure("command.webhook_log_failed", error, {
        commandName: interaction.commandName,
        guildId: interaction.guildId,
      });
    });
}

function getGuildTextChannel(
  interaction: ChatInputCommandInteraction,
): TextChannel | NewsChannel | null {
  const channel = interaction.channel;
  if (channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement) {
    return channel;
  }
  return null;
}

async function replyPublicly(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  const options: InteractionReplyOptions = {
    content,
    allowedMentions: { parse: [] },
  };
  await sendInteractionReply(interaction, options);
}

async function replyPrivately(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  const options: InteractionReplyOptions = {
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
  await sendInteractionReply(interaction, options);
}

async function sendInteractionReply(
  interaction: ChatInputCommandInteraction,
  options: Pick<InteractionReplyOptions, "content" | "allowedMentions" | "flags">,
): Promise<void> {
  if (interaction.deferred) {
    await interaction.editReply({
      content: options.content,
      allowedMentions: options.allowedMentions,
    });
  } else if (interaction.replied) {
    await interaction.followUp(options);
  } else {
    await interaction.reply(options);
  }
}

function isTicketTextChannel(channel: unknown): channel is TextChannel {
  return Boolean(
    channel &&
    typeof channel === "object" &&
    "type" in channel &&
    channel.type === ChannelType.GuildText,
  );
}

async function executeTicketCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await replyPrivately(interaction, "Tickets are only available in a server.");
    return;
  }

  const settings = getGuildSettings(guild.id);
  const botMember = await guild.members.fetchMe();
  const requiredBotPermissions = [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
  ];

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "open") {
    if (!botMember.permissions.has(requiredBotPermissions)) {
      await replyPrivately(
        interaction,
        "The bot needs Manage Channels and Manage Roles to create private tickets.",
      );
      return;
    }

    if (settings.ticketCategoryId) {
      const category = await guild.channels.fetch(settings.ticketCategoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        await replyPrivately(
          interaction,
          "The configured ticket category is no longer available. Ask a server manager to update it.",
        );
        return;
      }
    }
    if (settings.ticketSupportRoleId && !guild.roles.cache.has(settings.ticketSupportRoleId)) {
      const role = await guild.roles.fetch(settings.ticketSupportRoleId);
      if (!role) {
        await replyPrivately(
          interaction,
          "The configured ticket support role is no longer available. Ask a server manager to update it.",
        );
        return;
      }
    }

    const activeTicket = findOpenTicket(guild.id, interaction.user.id);
    if (activeTicket) {
      await replyPrivately(
        interaction,
        `You already have an open ticket: <#${activeTicket.channelId}>`,
      );
      return;
    }

    const ticketTopic = `orbit-ticket:${interaction.user.id}:open`;
    const existing = guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildText && channel.topic === ticketTopic,
    );
    if (existing) {
      registerExistingTicket({
        guildId: guild.id,
        channelId: existing.id,
        openerUserId: interaction.user.id,
      });
      await replyPrivately(interaction, `You already have an open ticket: <#${existing.id}>`);
      return;
    }

    const ticketId = reserveTicket(guild.id, interaction.user.id);
    if (!ticketId) {
      const currentTicket = findOpenTicket(guild.id, interaction.user.id);
      await replyPrivately(
        interaction,
        currentTicket
          ? `You already have an open ticket: <#${currentTicket.channelId}>`
          : "Your ticket is already being created. Please wait a moment.",
      );
      return;
    }

    const usernameSlug =
      interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 24) || "member";
    const permissionOverwrites = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: botMember.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      },
      ...(settings.ticketSupportRoleId
        ? [
            {
              id: settings.ticketSupportRoleId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
          ]
        : []),
    ];
    const subject = interaction.options.getString("subject")?.trim();
    const details = interaction.options.getString("details")?.trim();
    const category = interaction.options.getString("category") ?? "general";
    let channel: TextChannel | undefined;
    try {
      channel = await guild.channels.create({
        name: `ticket-${usernameSlug}-${interaction.user.id.slice(-4)}`,
        type: ChannelType.GuildText,
        ...(settings.ticketCategoryId ? { parent: settings.ticketCategoryId } : {}),
        topic: ticketTopic,
        permissionOverwrites,
        reason: `Private support ticket opened by ${interaction.user.id}`,
      });
      registerOpenTicket({
        ticketId,
        guildId: guild.id,
        channelId: channel.id,
        openerUserId: interaction.user.id,
        subject: subject || null,
        category,
      });
      await channel.send({
        content: [
          `<@${interaction.user.id}> opened a support ticket.`,
          `**Category:** ${category}`,
          subject ? `**Subject:** ${subject}` : "",
          details || "Please describe what you need help with.",
        ]
          .filter(Boolean)
          .join("\n"),
        allowedMentions: { parse: [], users: [interaction.user.id] },
      });
    } catch (error) {
      cancelTicketReservation(ticketId);
      if (channel && !findTicketByChannel(guild.id, channel.id)) {
        try {
          await channel.delete("Ticket initialization failed");
        } catch (cleanupError) {
          logFailure("ticket.incomplete_channel_cleanup_failed", cleanupError, {
            channelId: channel.id,
            guildId: guild.id,
          });
        }
      }
      throw error;
    }
    await replyPrivately(interaction, `Your private ticket is ready: <#${channel.id}>`);
    return;
  }

  const channel = interaction.channel;
  if (!isTicketTextChannel(channel)) {
    await replyPrivately(interaction, "Use ticket management commands inside a ticket channel.");
    return;
  }
  const ticketMatch = /^orbit-ticket:(\d{17,20}):(open|closed)$/.exec(channel.topic ?? "");
  if (!ticketMatch) {
    await replyPrivately(interaction, "This channel is not a managed support ticket.");
    return;
  }

  const openerId = ticketMatch[1];
  const topicStatus = ticketMatch[2] as "open" | "closed";
  const ticket =
    findTicketByChannel(guild.id, channel.id) ??
    registerExistingTicket({
      guildId: guild.id,
      channelId: channel.id,
      openerUserId: openerId,
      status: topicStatus,
    });
  const actor = await guild.members.fetch(interaction.user.id);
  const canManage =
    actor.permissions.has(PermissionFlagsBits.ManageChannels) ||
    Boolean(settings.ticketSupportRoleId && actor.roles.cache.has(settings.ticketSupportRoleId));

  if (subcommand === "close") {
    if (actor.id !== openerId && !canManage) {
      await replyPrivately(
        interaction,
        "Only the ticket opener or the configured support team can close this ticket.",
      );
      return;
    }
    if (ticket.status !== "open") {
      await replyPrivately(interaction, "This ticket is already closed.");
      return;
    }
    if (!channel.permissionsFor(botMember)?.has(requiredBotPermissions)) {
      await replyPrivately(
        interaction,
        "The bot needs Manage Channels and Manage Roles to close this ticket.",
      );
      return;
    }
    const reason = interaction.options.getString("reason")?.trim() || "No reason provided";
    const messages = await channel.messages.fetch({ limit: 100 });
    const transcript = Array.from(messages.values())
      .reverse()
      .map((message) => {
        const attachments = Array.from(message.attachments.values())
          .map((attachment) => `  Attachment: ${attachment.url}`)
          .join("\n");
        return [
          `[${message.createdAt.toISOString()}] ${message.author.tag}: ${message.content}`,
          attachments,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n")
      .slice(0, 100_000);
    const canAttachTranscript = channel
      .permissionsFor(botMember)
      ?.has(PermissionFlagsBits.AttachFiles);
    if (canAttachTranscript) {
      await channel.send({
        files: [
          new AttachmentBuilder(Buffer.from(transcript || "No messages to include.", "utf8"), {
            name: `ticket-${ticket.ticketId.slice(0, 8)}-transcript.txt`,
          }),
        ],
        allowedMentions: { parse: [] },
      });
    }
    await channel.permissionOverwrites.edit(openerId, {
      ViewChannel: false,
      SendMessages: false,
    });
    if (!channel.name.startsWith("closed-")) {
      await channel.setName(`closed-${channel.name}`.slice(0, 100));
    }
    await channel.setTopic(`orbit-ticket:${openerId}:closed`);
    await channel.send({
      content: `Ticket closed by ${interaction.user.username}. Reason: ${reason}${
        canAttachTranscript ? "" : " (Transcript unavailable: the bot needs Attach Files.)"
      }`,
      allowedMentions: { parse: [] },
    });
    closeTicketRecord(ticket, actor.id, reason);
    await replyPrivately(interaction, "Ticket closed. It remains available to the support team.");
    return;
  }

  if (subcommand === "reopen") {
    if (!canManage) {
      await replyPrivately(interaction, "Only the configured support team can reopen a ticket.");
      return;
    }
    if (ticket.status !== "closed") {
      await replyPrivately(interaction, "This ticket is already open.");
      return;
    }
    const otherTicket = findOpenTicket(guild.id, openerId);
    if (otherTicket && otherTicket.ticketId !== ticket.ticketId) {
      await replyPrivately(
        interaction,
        `The opener already has another open ticket: <#${otherTicket.channelId}>`,
      );
      return;
    }
    await channel.permissionOverwrites.edit(openerId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
    if (channel.name.startsWith("closed-")) {
      await channel.setName(channel.name.slice("closed-".length));
    }
    await channel.setTopic(`orbit-ticket:${openerId}:open`);
    reopenTicketRecord(ticket, actor.id);
    await channel.send({ content: "Ticket reopened.", allowedMentions: { parse: [] } });
    await replyPrivately(interaction, "Ticket reopened.");
    return;
  }

  if (!canManage) {
    await replyPrivately(
      interaction,
      "Only the configured support team can manage ticket assignments or priority.",
    );
    return;
  }
  if (ticket.status !== "open") {
    await replyPrivately(interaction, "This ticket is closed. Reopen it before making changes.");
    return;
  }
  if (subcommand === "claim") {
    if (
      ticket.assignedStaffId &&
      ticket.assignedStaffId !== actor.id &&
      !actor.permissions.has(PermissionFlagsBits.ManageChannels)
    ) {
      await replyPrivately(interaction, "This ticket is already assigned to another staff member.");
      return;
    }
    claimTicket(ticket, actor.id);
    await channel.send({
      content: `Ticket claimed by <@${actor.id}>.`,
      allowedMentions: { parse: [], users: [actor.id] },
    });
    await replyPrivately(interaction, "Ticket assigned to you.");
    return;
  }
  if (subcommand === "assign") {
    const targetUser = interaction.options.getUser("staff", true);
    const target = await guild.members.fetch(targetUser.id);
    if (
      target.id === botMember.id ||
      (!target.permissions.has(PermissionFlagsBits.ManageChannels) &&
        !(settings.ticketSupportRoleId && target.roles.cache.has(settings.ticketSupportRoleId)))
    ) {
      await replyPrivately(interaction, "Choose a member of the configured support team.");
      return;
    }
    assignTicket(ticket, actor.id, target.id);
    await channel.send({
      content: `Ticket assigned to <@${target.id}> by <@${actor.id}>.`,
      allowedMentions: { parse: [], users: [target.id, actor.id] },
    });
    await replyPrivately(interaction, `Ticket assigned to ${target.user.tag}.`);
    return;
  }
  const priority = interaction.options.getString("level", true);
  if (priority !== "low" && priority !== "normal" && priority !== "high" && priority !== "urgent") {
    await replyPrivately(interaction, "Choose a valid ticket priority.");
    return;
  }
  setTicketPriority(ticket, actor.id, priority);
  await channel.send({
    content: `Ticket priority set to **${priority}** by <@${actor.id}>.`,
    allowedMentions: { parse: [], users: [actor.id] },
  });
  await replyPrivately(interaction, `Ticket priority set to ${priority}.`);
}

function isAllowed(interaction: ChatInputCommandInteraction, permission: bigint): boolean {
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
  require: "moderatable" | "kickable" | "bannable",
): string | undefined {
  if (target.id === actor.id) return "You cannot target yourself.";
  if (target.id === botMember.id) return "I cannot target myself.";
  if (
    actor.id !== actor.guild.ownerId &&
    actor.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    return "You can only moderate members with a lower role than yours.";
  }
  if (!target[require])
    return "I cannot moderate that member. Check role hierarchy and bot permissions.";
  return undefined;
}

function validateWarningTarget(
  actor: GuildMember,
  target: GuildMember,
  botMember: GuildMember,
): string | undefined {
  if (target.id === actor.id) return "You cannot warn yourself.";
  if (target.id === botMember.id) return "The bot cannot be warned.";
  if (
    actor.id !== actor.guild.ownerId &&
    actor.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    return "You can only moderate members with a lower role than yours.";
  }
  if (botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return "The bot's highest role must be above the member's highest role.";
  }
  return undefined;
}

function tryRecordModerationAction(input: Parameters<typeof recordModerationAction>[0]): boolean {
  try {
    recordModerationAction(input);
    return true;
  } catch (error) {
    logFailure("moderation.audit_write_failed", error, { guildId: input.guildId });
    return false;
  }
}

async function getModerationMembers(
  interaction: ChatInputCommandInteraction,
  targetUser: User,
): Promise<{ actor: GuildMember; bot: GuildMember; target: GuildMember }> {
  if (!interaction.guild) throw new Error("Guild-only command");
  const [actor, bot, target] = await Promise.all([
    interaction.guild.members.fetch(interaction.user.id),
    interaction.guild.members.fetchMe(),
    interaction.guild.members.fetch(targetUser.id),
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
          "**Fun:** `/coinflip`, `/roll`, `/choose`, `/eightball`, `/meme`, `/joke`",
          "**Tickets:** `/ticket open`, `/ticket close`",
          "**Moderation:** `/clear`, `/slowmode`, `/timeout`, `/kick`, `/ban`",
          "**Server customization:** `/settings view`, `/settings color`, `/settings welcome`, `/settings disable-welcome`",
          "**Other:** `/announce`",
        ].join("\n"),
      });
      return;
    }
    case "ping": {
      const roundTrip = Date.now() - interaction.createdTimestamp;
      await interaction.reply({
        content: `Round-trip: ${roundTrip}ms | Gateway: ${Math.round(client.ws.ping)}ms`,
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
          {
            name: "Created",
            value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
            inline: true,
          },
          { name: "Server ID", value: guild.id, inline: true },
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
          { name: "User ID", value: user.id, inline: true },
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
          { name: "Progress", value: `${currentLevelXp} / ${nextLevelXp} XP` },
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
        ? leaderboard
            .map(
              (entry, index) =>
                `**${index + 1}.** <@${entry.userId}> — Level ${entry.level} · ${entry.xp.toLocaleString()} XP`,
            )
            .join("\n")
        : "No activity has been recorded yet.";
      const embed = new EmbedBuilder()
        .setColor(embedColor(interaction.guildId))
        .setTitle(`${interaction.guild?.name ?? "Server"} activity leaderboard`)
        .setDescription(description);
      await interaction.reply({
        embeds: [embed],
        allowedMentions: { parse: [] },
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
      await interaction.reply(
        `🎲 You rolled **${randomInt(minimum, maximum + 1)}** (${minimum}–${maximum}).`,
      );
      return;
    }
    case "choose": {
      const choices = Array.from({ length: 10 }, (_, index) =>
        interaction.options.getString(`option${index + 1}`),
      ).filter((choice): choice is string => choice !== null);
      const choice = choices[randomInt(choices.length)];
      await interaction.reply({
        content: `🎯 I choose: **${escapeMarkdown(choice)}**`,
        allowedMentions: { parse: [] },
      });
      return;
    }
    case "eightball": {
      const answer = eightBallAnswers[randomInt(eightBallAnswers.length)];
      await interaction.reply(`🎱 ${answer}`);
      return;
    }
    case "meme": {
      const [setup, punchline] = memes[randomInt(memes.length)];
      const embed = new EmbedBuilder()
        .setColor(embedColor(interaction.guildId))
        .setTitle("A little community humor")
        .setDescription(`**${setup}**\n\n${punchline}`)
        .setFooter({ text: "Original text meme" });
      await interaction.reply({ embeds: [embed] });
      return;
    }
    case "joke": {
      await interaction.reply(jokes[randomInt(jokes.length)]);
      return;
    }
    case "ticket": {
      await executeTicketCommand(interaction);
      return;
    }
    case "poll": {
      const channel = getGuildTextChannel(interaction);
      if (!channel) {
        await replyPublicly(interaction, "Create polls in a server text channel.");
        return;
      }
      const choices = [1, 2, 3, 4, 5]
        .map((index) => interaction.options.getString(`choice${index}`))
        .filter((choice): choice is string => choice !== null);
      const question = interaction.options.getString("question", true);
      const embed = new EmbedBuilder()
        .setColor(embedColor(interaction.guildId))
        .setTitle("Poll")
        .setDescription(
          `**${question}**\n\n${choices
            .map((choice, index) => `${pollEmojis[index]} ${choice}`)
            .join("\n")}`,
        )
        .setFooter({ text: `Poll by ${interaction.user.username}` });
      const message = await interaction.reply({
        embeds: [embed],
        allowedMentions: { parse: [] },
        fetchReply: true,
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
        const ticketSummary = settings.ticketCategoryId
          ? `Category <#${settings.ticketCategoryId}>${settings.ticketSupportRoleId ? ` · Support <@&${settings.ticketSupportRoleId}>` : ""}`
          : "Default category";
        await replyPublicly(
          interaction,
          `**Server bot settings**\nEmbed color: \`#${settings.embedColor.toString(16).padStart(6, "0").toUpperCase()}\`\nWelcome messages: ${welcomeSummary}\nTickets: ${ticketSummary}\nAuto-moderation: ${settings.autoModerationEnabled ? "Enabled" : "Disabled"}\nLevels: ${settings.levelingEnabled ? "Enabled" : "Disabled"}`,
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
          embedColor: Number.parseInt(color.slice(1), 16),
        });
        await replyPublicly(interaction, `Embed color updated to \`${color.toUpperCase()}\`.`);
        return;
      }
      if (subcommand === "welcome") {
        const selectedChannel = interaction.options.getChannel("channel", true, [
          ChannelType.GuildText,
        ]);
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
          !channel
            .permissionsFor(botMember)
            ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
        ) {
          await replyPublicly(
            interaction,
            "I need View Channel and Send Messages in the selected channel.",
          );
          return;
        }
        await updateGuildSettings(interaction.guild.id, {
          welcomeChannelId: channel.id,
          welcomeMessage: message,
        });
        await replyPublicly(
          interaction,
          `Welcome messages enabled in <#${channel.id}>. Available placeholders: \`{user}\`, \`{server}\`, and \`{count}\`.`,
        );
        return;
      }
      await updateGuildSettings(interaction.guild.id, {
        welcomeChannelId: undefined,
        welcomeMessage: undefined,
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
        allowedMentions: { parse: [] },
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
      await replyPublicly(
        interaction,
        `Deleted ${deleted.size} recent message(s). Messages older than 14 days are skipped by Discord.`,
      );
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
      await replyPublicly(
        interaction,
        seconds === 0 ? "Slowmode disabled." : `Slowmode set to ${seconds} second(s).`,
      );
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
      const auditSaved = tryRecordModerationAction({
        guildId: interaction.guildId!,
        targetUserId: target.id,
        moderatorUserId: actor.id,
        action: "timeout",
        reason,
        expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
      });
      await replyPublicly(
        interaction,
        `Timed out **${target.user.tag}** for ${minutes} minute(s).${
          auditSaved ? "" : " Warning: the moderation action could not be saved to history."
        }`,
      );
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
      const auditSaved = tryRecordModerationAction({
        guildId: interaction.guildId!,
        targetUserId: target.id,
        moderatorUserId: actor.id,
        action: "kick",
        reason,
      });
      await replyPublicly(
        interaction,
        `Kicked **${target.user.tag}**.${
          auditSaved ? "" : " Warning: the moderation action could not be saved to history."
        }`,
      );
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
      const auditSaved = tryRecordModerationAction({
        guildId: interaction.guildId!,
        targetUserId: target.id,
        moderatorUserId: actor.id,
        action: "ban",
        reason,
      });
      await replyPublicly(
        interaction,
        `Banned **${target.user.tag}**.${
          auditSaved ? "" : " Warning: the moderation action could not be saved to history."
        }`,
      );
      return;
    }
    case "warn": {
      if (!isAllowed(interaction, PermissionFlagsBits.ModerateMembers)) {
        await replyPrivately(interaction, "You need Moderate Members to warn a member.");
        return;
      }
      const targetUser = interaction.options.getUser("target", true);
      const { actor, bot, target } = await getModerationMembers(interaction, targetUser);
      const denial = validateWarningTarget(actor, target, bot);
      if (denial) {
        await replyPrivately(interaction, denial);
        return;
      }
      const reason = interaction.options.getString("reason", true).trim();
      const warningId = createWarning({
        guildId: interaction.guildId!,
        targetUserId: target.id,
        moderatorUserId: actor.id,
        reason,
      });
      await replyPrivately(
        interaction,
        `Warning #${warningId} recorded for **${target.user.tag}**.`,
      );
      return;
    }
    case "warnings": {
      if (!isAllowed(interaction, PermissionFlagsBits.ModerateMembers)) {
        await replyPrivately(interaction, "You need Moderate Members to view member warnings.");
        return;
      }
      const target = interaction.options.getUser("target", true);
      const warnings = getWarnings(interaction.guildId!, target.id).slice(0, 10);
      const description = warnings.length
        ? warnings
            .map(
              (warning) =>
                `#${warning.warningId} · ${warning.active ? "Active" : "Removed"} · <t:${Math.floor(
                  Date.parse(warning.createdAt) / 1000,
                )}:d>\n${escapeMarkdown(warning.reason).slice(0, 160)}`,
            )
            .join("\n\n")
        : "No warnings are recorded for this member.";
      await replyPrivately(interaction, `**Warnings for ${target.tag}**\n${description}`);
      return;
    }
    case "history": {
      if (!isAllowed(interaction, PermissionFlagsBits.ModerateMembers)) {
        await replyPrivately(interaction, "You need Moderate Members to view moderation history.");
        return;
      }
      const target = interaction.options.getUser("target", true);
      const actions = getModerationHistory(interaction.guildId!, target.id).slice(0, 10);
      const description = actions.length
        ? actions
            .map(
              (action) =>
                `**${action.action}** · <t:${Math.floor(Date.parse(action.createdAt) / 1000)}:d> · ${
                  action.moderatorUserId ? `<@${action.moderatorUserId}>` : "Unknown moderator"
                }\n${escapeMarkdown(action.reason ?? "No reason provided").slice(0, 120)}`,
            )
            .join("\n\n")
        : "No moderation actions are recorded for this member.";
      await replyPrivately(interaction, `**Moderation history for ${target.tag}**\n${description}`);
      return;
    }
    case "clearwarn": {
      if (!isAllowed(interaction, PermissionFlagsBits.ModerateMembers)) {
        await replyPrivately(interaction, "You need Moderate Members to remove a warning.");
        return;
      }
      const targetUser = interaction.options.getUser("target", true);
      const { actor, bot, target } = await getModerationMembers(interaction, targetUser);
      const denial = validateWarningTarget(actor, target, bot);
      if (denial) {
        await replyPrivately(interaction, denial);
        return;
      }
      const warningId = interaction.options.getInteger("warning-id", true);
      removeWarning(interaction.guildId!, warningId, target.id, actor.id);
      await replyPrivately(
        interaction,
        `Warning #${warningId} removed from **${target.user.tag}**.`,
      );
      return;
    }
    default:
      await replyPublicly(interaction, "Unknown command.");
  }
}

let dashboardServer: Server | undefined;

client.once(Events.ClientReady, async (readyClient) => {
  log("info", "discord.client_ready", { botTag: readyClient.user.tag });
  try {
    await readyClient.application.fetch();
  } catch (error) {
    logFailure("discord.application_fetch_failed", error);
  }
  applyBotPresence(readyClient);
  const levelingGuildCount = readyClient.guilds.cache.filter(
    (guild) => getGuildSettings(guild.id).levelingEnabled,
  ).size;
  for (const guild of readyClient.guilds.cache.values()) {
    recordMemberCount(guild.id, guild.memberCount);
  }
  log("info", "leveling.guilds_loaded", { count: levelingGuildCount });
  if (config.dashboard) {
    void startDashboard(readyClient, config.dashboard, config.clientId, config.logWebhookUrl)
      .then((server) => {
        dashboardServer = server;
        log("info", "dashboard.started", { baseUrl: config.dashboard?.baseUrl });
      })
      .catch((error) => logFailure("dashboard.start_failed", error));
  } else {
    log("info", "dashboard.disabled");
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  recordMemberCount(member.guild.id, member.guild.memberCount);
  const settings = getGuildSettings(member.guild.id);
  if (!settings.welcomeChannelId || !settings.welcomeMessage) return;
  try {
    const channel = await member.guild.channels.fetch(settings.welcomeChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      log("warn", "welcome.channel_unavailable", { guildId: member.guild.id });
      return;
    }
    const botMember = member.guild.members.me;
    if (
      !botMember ||
      !channel
        .permissionsFor(botMember)
        ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])
    ) {
      log("warn", "welcome.permission_missing", { guildId: member.guild.id });
      return;
    }
    const content = settings.welcomeMessage
      .replaceAll("{user}", member.user.username)
      .replaceAll("{server}", member.guild.name)
      .replaceAll("{count}", String(member.guild.memberCount));
    await channel.send({ content, allowedMentions: { parse: [] } });
  } catch (error) {
    logFailure("welcome.send_failed", error, { guildId: member.guild.id });
  }
});

client.on(Events.GuildMemberRemove, (member) => {
  recordMemberCount(member.guild.id, member.guild.memberCount);
});

client.on(Events.MessageCreate, (message) => {
  if (!message.guild || message.author.bot) return;
  try {
    recordMessageActivity(message.guild.id, message.guild.memberCount);
  } catch (error) {
    logFailure("analytics.message_record_failed", error, { guildId: message.guild.id });
  }
  if (!getGuildSettings(message.guild.id).levelingEnabled) return;
  void awardMessageXp(message.guild.id, message.author.id)
    .then(async (entry) => {
      if (!entry || !message.channel.isSendable()) return;
      await message.channel.send({
        content: `${message.author.username} reached level ${entry.level}!`,
        allowedMentions: { parse: [] },
      });
    })
    .catch((error) => {
      logFailure("leveling.message_xp_failed", error, { guildId: message.guildId });
    });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const startedAt = performance.now();
  try {
    if (deferredEphemeralCommands.has(interaction.commandName)) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    await executeCommand(interaction);
    logCommand(interaction, "completed");
    log("info", "discord.command_completed", {
      commandName: interaction.commandName,
      guildId: interaction.guildId,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    logCommand(interaction, "error");
    logFailure("discord.command_failed", error, {
      commandName: interaction.commandName,
      guildId: interaction.guildId,
      durationMs: Math.round(performance.now() - startedAt),
    });
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: errorReply, embeds: [] });
      } else {
        await replyPublicly(interaction, errorReply);
      }
    } catch (replyError) {
      logFailure("discord.command_error_response_failed", replyError, {
        commandName: interaction.commandName,
        guildId: interaction.guildId,
      });
    }
  }
});

client.on(Events.Error, (error) => {
  logFailure("discord.client_error", error);
});

let shutdownPromise: Promise<void> | undefined;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    log("info", "application.shutdown_started", { signal });
    const server = dashboardServer;
    dashboardServer = undefined;
    if (server) {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      server.closeAllConnections();
      await closed;
    }
    client.destroy();
    closeDatabase();
    log("info", "application.shutdown_completed", { signal });
  })();
  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error) => {
      logFailure("application.shutdown_failed", error, { signal });
      process.exitCode = 1;
    });
  });
}

try {
  await initializeDatabase(botDataDirectory);
  await loadGuildSettings();
  await loadLevels();
  await loadBotPresenceSettings();
  await client.login(config.token);
} catch (error) {
  client.destroy();
  closeDatabase();
  logFailure("application.startup_failed", error);
  process.exitCode = 1;
}
