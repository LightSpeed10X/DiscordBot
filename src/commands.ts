import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder().setName("help").setDescription("Show the available bot commands"),
  new SlashCommandBuilder().setName("ping").setDescription("Check the bot and API latency"),
  new SlashCommandBuilder().setName("server").setDescription("Show information about this server"),
  new SlashCommandBuilder()
    .setName("user")
    .setDescription("Show profile information for a user")
    .addUserOption((option) => option.setName("target").setDescription("User to look up")),
  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a user's avatar")
    .addUserOption((option) =>
      option.setName("target").setDescription("User whose avatar to show"),
    ),
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("View a member's activity level")
    .addUserOption((option) =>
      option.setName("target").setDescription("Member whose rank to view"),
    ),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the server's activity leaderboard"),
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Open and manage a private support ticket")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("open")
        .setDescription("Create a private support ticket")
        .addStringOption((option) =>
          option.setName("subject").setDescription("Short ticket subject").setMaxLength(100),
        )
        .addStringOption((option) =>
          option
            .setName("details")
            .setDescription("Describe what you need help with")
            .setMaxLength(1000),
        )
        .addStringOption((option) =>
          option
            .setName("category")
            .setDescription("Ticket category")
            .addChoices(
              { name: "General", value: "general" },
              { name: "Technical", value: "technical" },
              { name: "Billing", value: "billing" },
              { name: "Other", value: "other" },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("close")
        .setDescription("Close this ticket and hide it from its opener")
        .addStringOption((option) =>
          option.setName("reason").setDescription("Reason for closing").setMaxLength(500),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("claim").setDescription("Assign this ticket to yourself"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("assign")
        .setDescription("Assign this ticket to a support team member")
        .addUserOption((option) =>
          option.setName("staff").setDescription("Staff member to assign").setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("priority")
        .setDescription("Set this ticket's priority")
        .addStringOption((option) =>
          option
            .setName("level")
            .setDescription("Ticket priority")
            .setRequired(true)
            .addChoices(
              { name: "Low", value: "low" },
              { name: "Normal", value: "normal" },
              { name: "High", value: "high" },
              { name: "Urgent", value: "urgent" },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("reopen").setDescription("Reopen a closed ticket"),
    ),
  new SlashCommandBuilder()
    .setName("meme")
    .setDescription("Get an original, text-based community meme"),
  new SlashCommandBuilder().setName("joke").setDescription("Get a light-hearted original joke"),
  new SlashCommandBuilder().setName("coinflip").setDescription("Flip a coin"),
  new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll a number within a range")
    .addIntegerOption((option) =>
      option
        .setName("minimum")
        .setDescription("Smallest possible result")
        .setMinValue(-1000000)
        .setMaxValue(1000000),
    )
    .addIntegerOption((option) =>
      option
        .setName("maximum")
        .setDescription("Largest possible result")
        .setMinValue(-1000000)
        .setMaxValue(1000000),
    ),
  new SlashCommandBuilder()
    .setName("choose")
    .setDescription("Choose one of several options at random")
    .addStringOption((option) =>
      option.setName("option1").setDescription("First choice").setRequired(true).setMaxLength(100),
    )
    .addStringOption((option) =>
      option.setName("option2").setDescription("Second choice").setRequired(true).setMaxLength(100),
    )
    .addStringOption((option) =>
      option.setName("option3").setDescription("Third choice").setMaxLength(100),
    )
    .addStringOption((option) =>
      option.setName("option4").setDescription("Fourth choice").setMaxLength(100),
    )
    .addStringOption((option) =>
      option.setName("option5").setDescription("Fifth choice").setMaxLength(100),
    )
    .addStringOption((option) =>
      option.setName("option6").setDescription("Sixth choice").setMaxLength(100),
    )
    .addStringOption((option) =>
      option.setName("option7").setDescription("Seventh choice").setMaxLength(100),
    )
    .addStringOption((option) =>
      option.setName("option8").setDescription("Eighth choice").setMaxLength(100),
    )
    .addStringOption((option) =>
      option.setName("option9").setDescription("Ninth choice").setMaxLength(100),
    )
    .addStringOption((option) =>
      option.setName("option10").setDescription("Tenth choice").setMaxLength(100),
    ),
  new SlashCommandBuilder()
    .setName("eightball")
    .setDescription("Get a magic 8-ball answer")
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription("Ask a yes-or-no question")
        .setRequired(true)
        .setMaxLength(200),
    ),
  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Create a reaction-based poll")
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription("The poll question")
        .setRequired(true)
        .setMaxLength(200),
    )
    .addStringOption((option) =>
      option.setName("choice1").setDescription("First choice").setRequired(true).setMaxLength(80),
    )
    .addStringOption((option) =>
      option.setName("choice2").setDescription("Second choice").setMaxLength(80),
    )
    .addStringOption((option) =>
      option.setName("choice3").setDescription("Third choice").setMaxLength(80),
    )
    .addStringOption((option) =>
      option.setName("choice4").setDescription("Fourth choice").setMaxLength(80),
    )
    .addStringOption((option) =>
      option.setName("choice5").setDescription("Fifth choice").setMaxLength(80),
    ),
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post an announcement in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Announcement text")
        .setRequired(true)
        .setMaxLength(2000),
    ),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Delete recent messages from this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Number of messages (1-100)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),
  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set this channel's slowmode")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((option) =>
      option
        .setName("seconds")
        .setDescription("Delay in seconds (0-21600)")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600),
    ),
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a server member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("target").setDescription("Member to timeout").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("minutes")
        .setDescription("Timeout duration in minutes (1-40320)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the timeout").setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a server member")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((option) =>
      option.setName("target").setDescription("Member to kick").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the kick").setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a server member")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) =>
      option.setName("target").setDescription("Member to ban").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("delete-days")
        .setDescription("Delete this many days of message history (0-7)")
        .setMinValue(0)
        .setMaxValue(7),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the ban").setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Record a warning for a server member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("target").setDescription("Member to warn").setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for the warning")
        .setRequired(true)
        .setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View a member's warnings")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("target").setDescription("Member whose warnings to view").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("history")
    .setDescription("View a member's moderation history")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("target").setDescription("Member whose history to view").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("clearwarn")
    .setDescription("Remove an active warning from a server member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("target").setDescription("Member whose warning to remove").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("warning-id")
        .setDescription("Warning ID to remove")
        .setRequired(true)
        .setMinValue(1),
    ),
  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Customize this server's bot settings")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand.setName("view").setDescription("View this server's customization"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("color")
        .setDescription("Set the bot's embed color")
        .addStringOption((option) =>
          option
            .setName("hex")
            .setDescription("Hex color, such as #5865F2")
            .setRequired(true)
            .setMinLength(7)
            .setMaxLength(7),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("welcome")
        .setDescription("Configure welcome messages")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Text channel for new-member greetings")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText),
        )
        .addStringOption((option) =>
          option
            .setName("message")
            .setDescription("Use {user}, {server}, and {count}")
            .setRequired(true)
            .setMaxLength(500),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("disable-welcome").setDescription("Turn off welcome messages"),
    ),
].map((command) => command.toJSON());
