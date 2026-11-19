const signInView = document.getElementById("signInView");
const dashboardView = document.getElementById("dashboardView");
const errorView = document.getElementById("errorView");
const panelContent = document.getElementById("panelContent");
const guildSelect = document.getElementById("guildSelect");
const toast = document.getElementById("toast");

let csrfToken = "";
let guilds = [];
let currentGuildId = "";
let currentOverview = null;
let currentPanel = "overview";
let currentLogs = [];
let activityStream = null;
let analyticsPeriod = 30;
let toastTimer;

const panelDetails = {
  overview: ["Overview", "Your server, at a glance."],
  setup: ["Quick setup", "Configure welcomes, tickets, protection, and activity levels."],
  tools: ["Server tools", "Tune channels, announce updates, and manage members."],
  commands: ["Command library", "Everything your community can ask the bot to do."],
  logs: ["Activity logs", "Recent command and dashboard activity for this server."],
  analytics: ["Server analytics", "Compare activity, growth, moderation, and tickets."],
  status: ["Bot status", "Set the bot's global presence and activity."],
};

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function showView(view) {
  signInView.hidden = view !== signInView;
  dashboardView.hidden = view !== dashboardView;
  errorView.hidden = view !== errorView;
}

function showError(message) {
  document.getElementById("errorMessage").textContent = message;
  showView(errorView);
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function setUser(user) {
  const area = document.getElementById("accountArea");
  const avatar = document.getElementById("userAvatar");
  const username = user.globalName || user.username;
  document.getElementById("userName").textContent = username;
  if (user.avatar) {
    const extension = user.avatar.startsWith("a_") ? "gif" : "png";
    avatar.src = `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.${extension}?size=64`;
  } else {
    avatar.removeAttribute("src");
  }
  avatar.alt = `${username} avatar`;
  area.hidden = false;
  document.getElementById("botStatusNav").hidden = !user.isApplicationOwner;
}

function setGuildOptions() {
  guildSelect.replaceChildren();
  for (const guild of guilds) {
    const option = document.createElement("option");
    option.value = guild.id;
    option.textContent = guild.name;
    guildSelect.append(option);
  }
  guildSelect.disabled = guilds.length === 0;
  const rememberedId = window.localStorage.getItem("orbit.guild");
  currentGuildId = guilds.some((guild) => guild.id === rememberedId)
    ? rememberedId
    : guilds[0]?.id || "";
  if (currentGuildId) guildSelect.value = currentGuildId;
}

function setPanelHeading() {
  const [title, subtitle] = panelDetails[currentPanel];
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageSubtitle").textContent = subtitle;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.panel === currentPanel);
  });
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function activityRows(logs) {
  if (!logs.length) {
    return '<div class="empty-state"><h2>Nothing logged yet</h2><p>Command activity will appear here after someone uses a slash command in this server.</p></div>';
  }
  return `<div class="activity-list">${logs
    .slice(0, 6)
    .map(
      (log) => `
    <div class="activity-row">
      <span class="activity-command">${log.source === "dashboard" ? "Dashboard · " : "/"}${escapeHtml(log.commandName)}</span>
      <span class="activity-user">${escapeHtml(log.userName)}</span>
      <span class="activity-time">${escapeHtml(formatTime(log.timestamp))}</span>
    </div>`,
    )
    .join("")}</div>`;
}

function logKey(log) {
  return `${log.timestamp}:${log.userId}:${log.source || "command"}:${log.commandName}:${log.outcome}`;
}

function mergeLogs(primary, secondary) {
  const entries = new Map();
  for (const log of [...primary, ...secondary]) entries.set(logKey(log), log);
  return [...entries.values()]
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
    .slice(0, 100);
}

function connectActivityStream(guildId) {
  if (activityStream) activityStream.close();
  activityStream = null;
  if (!guildId || !window.EventSource) return;

  const stream = new EventSource(`/api/guilds/${encodeURIComponent(guildId)}/events`);
  activityStream = stream;
  stream.addEventListener("command-log", (event) => {
    try {
      const log = JSON.parse(event.data);
      currentLogs = mergeLogs([log], currentLogs);
      if (currentPanel === "overview") {
        const latestActivity = document.getElementById("latestActivityContent");
        if (latestActivity) latestActivity.innerHTML = activityRows(currentLogs);
      } else if (currentPanel === "logs") {
        const logsBody = document.getElementById("logsBody");
        if (logsBody) logsBody.innerHTML = logTableRows(currentLogs);
        else renderLogs(currentLogs);
      }
    } catch {
      showToast("A live activity update could not be displayed.", true);
    }
  });
}

function renderOverview(logs, leaderboard) {
  currentLogs = logs;
  const settings = currentOverview.settings;
  const welcomeConfigured = Boolean(settings.welcomeChannelId && settings.welcomeMessage);
  panelContent.innerHTML = `
    <div class="stat-grid">
      <article class="stat-card">
        <div class="stat-top"><span>Community size</span><span class="stat-icon">◎</span></div>
        <div class="stat-value">${Number(currentOverview.guild.memberCount).toLocaleString()}</div>
        <div class="stat-caption">members in this server</div>
      </article>
      <article class="stat-card">
        <div class="stat-top"><span>Command library</span><span class="stat-icon">⌘</span></div>
        <div class="stat-value">${currentOverview.commands.length}</div>
        <div class="stat-caption">slash commands ready to explore</div>
      </article>
      <article class="stat-card">
        <div class="stat-top"><span>Welcome messages</span><span class="stat-icon">✳</span></div>
        <div class="stat-value">${welcomeConfigured ? "Active" : "Off"}</div>
        <div class="stat-caption">${welcomeConfigured ? "new members get a greeting" : "finish setup to turn them on"}</div>
      </article>
      <article class="stat-card">
        <div class="stat-top"><span>Auto-moderation</span><span class="stat-icon">◆</span></div>
        <div class="stat-value">${settings.autoModerationEnabled ? "Active" : "Off"}</div>
        <div class="stat-caption">Discord spam and mention protection</div>
      </article>
      <article class="stat-card">
        <div class="stat-top"><span>Activity levels</span><span class="stat-icon">↗</span></div>
        <div class="stat-value">${settings.levelingEnabled ? "Active" : "Off"}</div>
        <div class="stat-caption">message activity XP rewards</div>
      </article>
    </div>
    <div class="content-grid">
      <section class="panel">
        <div class="panel-heading">
          <div><h2>Quick access</h2><p>Useful tools, just one click away.</p></div>
          <button class="text-link" type="button" data-open-panel="commands">All commands ↗</button>
        </div>
        <div class="quick-grid">
          <div class="quick-card"><span class="quick-icon">✳</span><span><strong>Welcome flow</strong><small>${welcomeConfigured ? "Configured" : "Not configured yet"}</small></span></div>
          <div class="quick-card"><span class="quick-icon">#</span><span><strong>Embed color</strong><small>#${settings.embedColor.toString(16).padStart(6, "0").toUpperCase()}</small></span></div>
          <div class="quick-card"><span class="quick-icon">⌘</span><span><strong>Command library</strong><small>${currentOverview.commands.length} available commands</small></span></div>
          <div class="quick-card"><span class="quick-icon">≋</span><span><strong>Activity trail</strong><small>Recent command usage</small></span></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div><h2>Setup checklist</h2><p>Make Orbit yours in a few steps.</p></div>
          <button class="text-link" type="button" data-open-panel="setup">Configure ↗</button>
        </div>
        <div class="setup-list">
          <div class="setup-step"><span class="checkmark">✓</span><span>Bot is connected to this server</span></div>
          <div class="setup-step"><span class="checkmark ${welcomeConfigured ? "" : "pending"}">${welcomeConfigured ? "✓" : "·"}</span><span>Welcome messages ${welcomeConfigured ? "are set up" : "are ready to configure"}</span></div>
          <div class="setup-step"><span class="checkmark">✓</span><span>Server-specific settings are available</span></div>
        </div>
      </section>
      <section class="panel span-all">
        <div class="panel-heading">
          <div><h2>Latest activity</h2><p>Only command/action metadata is stored; message content and arguments are omitted.</p></div>
          <button class="text-link" type="button" data-open-panel="logs">View logs ↗</button>
        </div>
        <div id="latestActivityContent">${activityRows(logs)}</div>
      </section>
      <section class="panel span-all">
        <div class="panel-heading">
          <div><h2>Activity leaderboard</h2><p>Members ranked by message activity XP.</p></div>
        </div>
        ${
          leaderboard.length
            ? `<div class="activity-list">${leaderboard
                .slice(0, 5)
                .map(
                  (entry, index) => `
            <div class="activity-row">
              <span class="activity-command">#${index + 1} ${escapeHtml(entry.username)}</span>
              <span class="activity-user">Level ${entry.level}</span>
              <span class="activity-time">${Number(entry.xp).toLocaleString()} XP</span>
            </div>`,
                )
                .join("")}</div>`
            : '<div class="empty-state"><h2>No levels yet</h2><p>Enable activity levels in Quick setup to start the leaderboard.</p></div>'
        }
      </section>
    </div>`;
}

function renderAnalytics(data) {
  const commandRows = data.commandUsage.slice(-15).reverse();
  panelContent.innerHTML = `
    <div class="panel-heading">
      <div><h2>Server activity</h2><p>Aggregated activity only; message content is never stored.</p></div>
      <label class="field">Period
        <select id="analyticsDays">
          ${[7, 30, 90].map((days) => `<option value="${days}" ${days === data.periodDays ? "selected" : ""}>${days} days</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="stat-grid">
      <article class="stat-card"><div class="stat-top"><span>Messages this week</span></div><div class="stat-value">${data.comparison.messagesThisWeek.toLocaleString()}</div><div class="stat-caption">Previous week: ${data.comparison.messagesLastWeek.toLocaleString()}</div></article>
      <article class="stat-card"><div class="stat-top"><span>Member change</span></div><div class="stat-value">${data.comparison.memberChange > 0 ? "+" : ""}${data.comparison.memberChange.toLocaleString()}</div><div class="stat-caption">Across the selected period</div></article>
      <article class="stat-card"><div class="stat-top"><span>Command activity</span></div><div class="stat-value">${data.commandUsage.reduce((sum, item) => sum + item.uses, 0).toLocaleString()}</div><div class="stat-caption">Tracked slash commands</div></article>
      <article class="stat-card"><div class="stat-top"><span>Moderation actions</span></div><div class="stat-value">${data.moderationActions.reduce((sum, item) => sum + item.count, 0).toLocaleString()}</div><div class="stat-caption">${data.tickets.reduce((sum, item) => sum + item.count, 0).toLocaleString()} tickets total</div></article>
    </div>
    <div class="content-grid">
      <section class="panel">
        <div class="panel-heading"><div><h2>Daily activity</h2><p>Message counts and member snapshots by day.</p></div></div>
        <div class="table-wrap"><table class="logs-table"><thead><tr><th>Date</th><th>Messages</th><th>Members</th></tr></thead><tbody>
          ${
            data.dailyActivity.length
              ? data.dailyActivity
                  .slice(-15)
                  .reverse()
                  .map(
                    (row) =>
                      `<tr><td>${escapeHtml(row.date)}</td><td>${row.messages.toLocaleString()}</td><td>${row.members.toLocaleString()}</td></tr>`,
                  )
                  .join("")
              : '<tr><td colspan="3">No activity recorded yet.</td></tr>'
          }
        </tbody></table></div>
      </section>
      <section class="panel">
        <div class="panel-heading"><div><h2>Command usage</h2><p>Most recent command totals.</p></div></div>
        <div class="table-wrap"><table class="logs-table"><thead><tr><th>Date</th><th>Command</th><th>Uses</th></tr></thead><tbody>
          ${commandRows.length ? commandRows.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>/${escapeHtml(row.command)}</td><td>${row.uses.toLocaleString()}</td></tr>`).join("") : '<tr><td colspan="3">No commands recorded yet.</td></tr>'}
        </tbody></table></div>
      </section>
      <section class="panel">
        <div class="panel-heading"><div><h2>Moderation</h2><p>Recorded actions in the selected period.</p></div></div>
        <div class="activity-list">${data.moderationActions.length ? data.moderationActions.map((item) => `<div class="activity-row"><span class="activity-command">${escapeHtml(item.action)}</span><span>${item.count.toLocaleString()}</span></div>`).join("") : '<div class="empty-state"><p>No moderation actions recorded.</p></div>'}</div>
      </section>
      <section class="panel">
        <div class="panel-heading"><div><h2>Tickets</h2><p>Current ticket states.</p></div></div>
        <div class="activity-list">${data.tickets.length ? data.tickets.map((item) => `<div class="activity-row"><span class="activity-command">${escapeHtml(item.status)}</span><span>${item.count.toLocaleString()}</span></div>`).join("") : '<div class="empty-state"><p>No tickets recorded.</p></div>'}</div>
      </section>
    </div>`;
}

function renderSetup() {
  const settings = currentOverview.settings;
  const channels = currentOverview.channels;
  const categories = currentOverview.ticketCategories;
  const roles = currentOverview.roles;
  const featureRoles = settings.featurePermissionRoles || {};
  const selectedChannel = settings.welcomeChannelId || "";
  const roleSelectors = currentOverview.canManageFeatureRoles
    ? [
        ["analytics", "Analytics and leaderboards"],
        ["activity", "Activity logs"],
        ["moderation", "Moderation tools and history"],
        ["server_tools", "Announcements, channels, and member tools"],
        ["tickets", "Ticket management"],
        ["settings", "Server bot settings"],
      ]
        .map(([feature, label]) => {
          const assignedRoles = featureRoles[feature] || [];
          return `<div class="field">
      <label for="dashboardRoles_${feature}">${label}</label>
      <select id="dashboardRoles_${feature}" multiple size="3">
        ${roles.map((role) => `<option value="${escapeHtml(role.id)}" ${assignedRoles.includes(role.id) ? "selected" : ""}>@${escapeHtml(role.name)}</option>`).join("")}
      </select>
    </div>`;
        })
        .join("")
    : "";
  panelContent.innerHTML = `
    <div class="setup-layout">
      <section class="panel">
        <div class="panel-heading"><div><h2>Server personalization</h2><p>These preferences are saved separately for this server.</p></div></div>
        <form id="settingsForm">
          <div class="field">
            <label for="embedColor">Embed accent color</label>
            <input id="embedColor" name="embedColor" type="color" value="#${settings.embedColor.toString(16).padStart(6, "0")}">
            <span class="field-hint">Used for informational embeds such as polls and server details.</span>
          </div>
          <div class="field">
            <label for="welcomeChannel">Welcome channel</label>
            <select id="welcomeChannel" name="welcomeChannel">
              <option value="">Welcome messages off</option>
              ${channels.map((channel) => `<option value="${escapeHtml(channel.id)}" ${channel.id === selectedChannel ? "selected" : ""}>#${escapeHtml(channel.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="welcomeMessage">Welcome message</label>
            <textarea id="welcomeMessage" name="welcomeMessage" maxlength="500" placeholder="Welcome {user} to {server}!">${escapeHtml(settings.welcomeMessage || "")}</textarea>
            <span class="field-hint">Placeholders: {user}, {server}, and {count}. Mentions are disabled in welcome messages.</span>
          </div>
          <div class="field">
            <label for="ticketCategory">Ticket category</label>
            <select id="ticketCategory" name="ticketCategory">
              <option value="">Use the server's default channel list</option>
              ${categories.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === settings.ticketCategoryId ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}
            </select>
            <span class="field-hint">New private ticket channels will be created here.</span>
          </div>
          <div class="field">
            <label for="ticketSupportRole">Ticket support role</label>
            <select id="ticketSupportRole" name="ticketSupportRole">
              <option value="">No additional support role</option>
              ${roles.map((role) => `<option value="${escapeHtml(role.id)}" ${role.id === settings.ticketSupportRoleId ? "selected" : ""}>@${escapeHtml(role.name)}</option>`).join("")}
            </select>
            <span class="field-hint">Members with this role can view and reply in open tickets.</span>
          </div>
          <div class="field">
            <label>Dashboard staff roles</label>
            <span class="field-hint">${currentOverview.canManageFeatureRoles ? "Selected roles grant access only to their listed dashboard area. Members with Manage Server retain full access." : "Only members with Manage Server can change dashboard role assignments."}</span>
          </div>
          ${roleSelectors}
          <div class="field feature-toggle">
            <label for="autoModerationEnabled">Discord auto-moderation</label>
            <div class="toggle-row">
              <input id="autoModerationEnabled" name="autoModerationEnabled" type="checkbox" ${settings.autoModerationEnabled ? "checked" : ""}>
              <span>Block Discord-detected spam and excessive mentions.</span>
            </div>
            <span class="field-hint">Creates or manages Orbit-owned rules in Discord. The bot needs Manage Server permission.</span>
          </div>
          <div class="field feature-toggle">
            <label for="levelingEnabled">Activity levels</label>
            <div class="toggle-row">
              <input id="levelingEnabled" name="levelingEnabled" type="checkbox" ${settings.levelingEnabled ? "checked" : ""}>
              <span>Earn XP for messages and announce level-ups.</span>
            </div>
            <span class="field-hint">Messages are counted for XP but their content is not read or stored. One XP award per member per minute.</span>
          </div>
          <div class="field">
            <label for="dashboardWebhookUrl">Dashboard activity webhook</label>
            <input id="dashboardWebhookUrl" name="dashboardWebhookUrl" type="url" maxlength="300" autocomplete="off" placeholder="https://discord.com/api/webhooks/…">
            <span class="field-hint">${settings.dashboardWebhookConfigured ? "A webhook is saved. Leave blank to keep it. The URL is never displayed after saving." : "Send dashboard changes to a private Discord channel. The webhook URL is stored as a secret."}</span>
            ${settings.dashboardWebhookConfigured ? `<label class="toggle-row webhook-remove"><input id="clearDashboardWebhook" type="checkbox"> Remove saved webhook</label>` : '<input id="clearDashboardWebhook" type="checkbox" hidden>'}
          </div>
          <div class="form-actions"><button class="primary-button" type="submit">Save settings</button><span id="saveStatus" class="field-hint"></span></div>
        </form>
      </section>
      <aside class="setup-tip"><strong>QUICK SETUP</strong>
        Pick a text channel to enable greetings. Leave the channel blank to disable them.
        The bot needs permission to view and send messages in the selected channel.
        Your server’s settings are kept separate from every other server using this bot.
      </aside>
    </div>`;

  document.getElementById("settingsForm").addEventListener("submit", saveSettings);
}

function formatSlowmode(seconds) {
  if (seconds === 0) return "Off";
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return `${seconds} seconds`;
}

function renderServerTools() {
  const channels = currentOverview.channels;
  const channelOptions = channels.length
    ? channels
        .map(
          (channel) =>
            `<option value="${escapeHtml(channel.id)}">#${escapeHtml(channel.name)}</option>`,
        )
        .join("")
    : '<option value="">No text channels available</option>';
  const slowmodeValues = [
    ...new Set([
      0,
      5,
      10,
      15,
      30,
      60,
      120,
      300,
      600,
      900,
      1800,
      3600,
      7200,
      21600,
      ...channels.map((channel) => channel.slowmodeSeconds),
    ]),
  ].sort((left, right) => left - right);
  const initialSlowmode = channels[0]?.slowmodeSeconds ?? 0;
  panelContent.innerHTML = `
    <div class="tools-grid">
      <section class="panel tool-card">
        <div class="panel-heading">
          <div><h2>Channel slowmode</h2><p>Set a message delay for a text channel.</p></div>
          <span class="tool-badge">MANAGE CHANNELS</span>
        </div>
        <form id="slowmodeForm" class="tool-form">
          <div class="field">
            <label for="slowmodeChannel">Text channel</label>
            <select id="slowmodeChannel" name="channelId" required>${channelOptions}</select>
          </div>
          <div class="field">
            <label for="slowmodeSeconds">Delay</label>
            <select id="slowmodeSeconds" name="seconds" ${channels.length ? "" : "disabled"}>
              ${slowmodeValues.map((seconds) => `<option value="${seconds}" ${seconds === initialSlowmode ? "selected" : ""}>${formatSlowmode(seconds)}</option>`).join("")}
            </select>
          </div>
          <div class="form-actions"><button class="primary-button" type="submit" ${channels.length ? "" : "disabled"}>Apply slowmode</button><span id="slowmodeStatus" class="field-hint" role="status"></span></div>
        </form>
        <p class="tool-footnote">Both you and the bot need Manage Channels in this server.</p>
      </section>
      <section class="panel tool-card">
        <div class="panel-heading">
          <div><h2>Post an announcement</h2><p>Send a message to a server text channel.</p></div>
          <span class="tool-badge">MANAGE MESSAGES</span>
        </div>
        <form id="announcementForm" class="tool-form">
          <div class="field">
            <label for="announcementChannel">Text channel</label>
            <select id="announcementChannel" name="channelId" required>${channelOptions}</select>
          </div>
          <div class="field">
            <label for="announcementMessage">Message</label>
            <textarea id="announcementMessage" name="message" maxlength="2000" required placeholder="Write an announcement for your community…"></textarea>
            <span class="field-hint">Up to 2,000 characters. Mass mentions are disabled.</span>
          </div>
          <div class="form-actions"><button class="primary-button" type="submit" ${channels.length ? "" : "disabled"}>Post announcement</button><span id="announcementStatus" class="field-hint" role="status"></span></div>
        </form>
        <p class="tool-footnote">You need Manage Messages. The bot needs permission to view and send messages in the selected channel.</p>
      </section>
      <section class="panel tool-card">
        <div class="panel-heading">
          <div><h2>Clear recent messages</h2><p>Bulk-delete up to 100 messages from a text channel.</p></div>
          <span class="tool-badge">MANAGE MESSAGES</span>
        </div>
        <form id="clearMessagesForm" class="tool-form">
          <div class="field">
            <label for="clearChannel">Text channel</label>
            <select id="clearChannel" name="channelId" required>${channelOptions}</select>
          </div>
          <div class="field">
            <label for="clearAmount">Number of messages</label>
            <input id="clearAmount" name="amount" type="number" min="1" max="100" value="10" required>
          </div>
          <div class="form-actions"><button class="danger-button" type="submit" ${channels.length ? "" : "disabled"}>Clear messages</button><span id="clearStatus" class="field-hint" role="status"></span></div>
        </form>
        <p class="tool-footnote">Discord skips messages older than 14 days. The bot also needs Manage Messages.</p>
      </section>
      <section class="panel tool-card">
        <div class="panel-heading">
          <div><h2>Timeout a member</h2><p>Temporarily restrict a member for up to 28 days.</p></div>
          <span class="tool-badge">MODERATE MEMBERS</span>
        </div>
        <form id="timeoutForm" class="tool-form">
          <div class="field">
            <label for="timeoutUserId">Member user ID</label>
            <input id="timeoutUserId" name="userId" inputmode="numeric" pattern="[0-9]{17,20}" maxlength="20" placeholder="Discord user ID" required>
          </div>
          <div class="field">
            <label for="timeoutDuration">Duration</label>
            <select id="timeoutDuration" name="durationMinutes">
              <option value="10">10 minutes</option>
              <option value="60">1 hour</option>
              <option value="1440">1 day</option>
              <option value="10080">7 days</option>
              <option value="40320">28 days</option>
            </select>
          </div>
          <div class="field">
            <label for="timeoutReason">Reason</label>
            <textarea id="timeoutReason" name="reason" maxlength="500" placeholder="Optional moderator note"></textarea>
          </div>
          <div class="form-actions"><button class="danger-button" type="submit">Apply timeout</button><span id="timeoutStatus" class="field-hint" role="status"></span></div>
        </form>
        <p class="tool-footnote">Role hierarchy and Discord permissions are checked before the timeout is applied.</p>
      </section>
      <section class="panel tool-card">
        <div class="panel-heading">
          <div><h2>Send a direct message</h2><p>Send one staff message to a member of this server.</p></div>
          <span class="tool-badge">MANAGE MESSAGES</span>
        </div>
        <form id="memberDmForm" class="tool-form">
          <div class="field">
            <label for="dmUserId">Member user ID</label>
            <input id="dmUserId" name="userId" inputmode="numeric" pattern="[0-9]{17,20}" maxlength="20" placeholder="Discord user ID" required>
          </div>
          <div class="field">
            <label for="dmMessage">Message</label>
            <textarea id="dmMessage" name="message" maxlength="1000" required placeholder="Write a respectful, one-to-one message…"></textarea>
            <span class="field-hint">Up to 1,000 characters. Mentions are disabled. The message content is not logged.</span>
          </div>
          <label class="toggle-row"><input id="dmConfirm" type="checkbox" required> I confirm this is an appropriate one-to-one message.</label>
          <div class="form-actions"><button class="danger-button" type="submit">Send direct message</button><span id="dmStatus" class="field-hint" role="status"></span></div>
        </form>
        <p class="tool-footnote">Requires Manage Messages. Limited to five DMs per server per hour and one per recipient per hour.</p>
      </section>
    </div>`;
  const slowmodeChannel = document.getElementById("slowmodeChannel");
  const slowmodeSelect = document.getElementById("slowmodeSeconds");
  slowmodeChannel.addEventListener("change", () => {
    const channel = channels.find((item) => item.id === slowmodeChannel.value);
    if (channel) slowmodeSelect.value = String(channel.slowmodeSeconds);
  });
  document.getElementById("slowmodeForm").addEventListener("submit", setSlowmode);
  document.getElementById("announcementForm").addEventListener("submit", postAnnouncement);
  document.getElementById("clearMessagesForm").addEventListener("submit", clearMessages);
  document.getElementById("timeoutForm").addEventListener("submit", timeoutMember);
  document.getElementById("memberDmForm").addEventListener("submit", sendMemberDm);
}

async function renderBotStatus() {
  panelContent.innerHTML =
    '<div class="loading-card"><span class="spinner"></span> Loading bot status…</div>';
  try {
    const presence = await api("/api/bot/presence");
    panelContent.innerHTML = `
      <div class="setup-layout">
        <section class="panel">
          <div class="panel-heading"><div><h2>Global bot presence</h2><p>This status is shared across every server.</p></div></div>
          <form id="botPresenceForm">
            <div class="field">
              <label for="presenceStatus">Status</label>
              <select id="presenceStatus">
                ${[
                  ["online", "Online"],
                  ["idle", "Idle"],
                  ["dnd", "Do not disturb"],
                  ["invisible", "Invisible"],
                ]
                  .map(
                    ([value, label]) =>
                      `<option value="${value}" ${presence.status === value ? "selected" : ""}>${label}</option>`,
                  )
                  .join("")}
              </select>
            </div>
            <div class="field">
              <label for="presenceActivityType">Activity type</label>
              <select id="presenceActivityType">
                ${[
                  ["playing", "Playing"],
                  ["listening", "Listening to"],
                  ["watching", "Watching"],
                  ["competing", "Competing in"],
                ]
                  .map(
                    ([value, label]) =>
                      `<option value="${value}" ${presence.activityType === value ? "selected" : ""}>${label}</option>`,
                  )
                  .join("")}
              </select>
            </div>
            <div class="field">
              <label for="presenceActivityText">Activity text</label>
              <input id="presenceActivityText" maxlength="128" value="${escapeHtml(presence.activityText)}" placeholder="Leave blank to clear the activity">
              <span class="field-hint">Up to 128 characters. Only the application owner can change global presence.</span>
            </div>
            <div class="form-actions"><button class="primary-button" type="submit">Save bot status</button><span id="presenceStatusMessage" class="field-hint" role="status"></span></div>
          </form>
        </section>
        <aside class="setup-tip"><strong>GLOBAL CONTROL</strong>
          The selected status and activity apply to the bot everywhere it is installed.
          Settings are saved locally and restored when the bot restarts.
        </aside>
      </div>`;
    document.getElementById("botPresenceForm").addEventListener("submit", saveBotPresence);
  } catch (error) {
    panelContent.innerHTML = `<div class="empty-state"><h2>Couldn’t load bot status</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderCommands() {
  panelContent.innerHTML = `
    <section class="panel">
      <div class="panel-heading">
        <div><h2>Slash commands</h2><p>Browse what the bot can do in this server.</p></div>
        <input id="commandSearch" class="search-input" type="search" placeholder="Filter commands…" aria-label="Filter commands">
      </div>
      <div id="commandList" class="command-list"></div>
    </section>`;
  const input = document.getElementById("commandSearch");
  const list = document.getElementById("commandList");
  const draw = () => {
    const query = input.value.trim().toLowerCase();
    const matches = currentOverview.commands.filter(
      (command) =>
        command.name.includes(query) || command.description.toLowerCase().includes(query),
    );
    list.innerHTML = matches.length
      ? matches
          .map(
            (command) =>
              `<article class="command-card"><code>/${escapeHtml(command.name)}</code><p>${escapeHtml(command.description)}</p></article>`,
          )
          .join("")
      : '<div class="empty-state"><h2>No matching commands</h2><p>Try a different search.</p></div>';
  };
  input.addEventListener("input", draw);
  draw();
}

function logTableRows(logs) {
  return logs
    .map(
      (log) => `<tr>
    <td>${log.source === "dashboard" ? "Dashboard · " : "/"}${escapeHtml(log.commandName)}</td>
    <td>${escapeHtml(log.userName)}</td>
    <td>${escapeHtml(log.channelId ? `#${log.channelId}` : "Unknown")}</td>
    <td><span class="status-pill ${log.outcome === "error" ? "error" : ""}">${escapeHtml(log.outcome)}</span></td>
    <td>${escapeHtml(formatTime(log.timestamp))}</td>
  </tr>`,
    )
    .join("");
}

function renderLogs(logs) {
  currentLogs = logs;
  panelContent.innerHTML = `
    <section class="panel">
      <div class="panel-heading"><div><h2>Server activity</h2><p>Recent commands and dashboard actions for ${escapeHtml(currentOverview.guild.name)}. Message content and command arguments are not logged.</p></div></div>
      ${
        logs.length
          ? `<div class="table-wrap"><table class="logs-table">
        <thead><tr><th>Command</th><th>Member</th><th>Channel</th><th>Result</th><th>Time</th></tr></thead>
        <tbody id="logsBody">${logTableRows(logs)}</tbody>
      </table></div>`
          : '<div class="empty-state"><h2>No activity yet</h2><p>Use a slash command in this server and its metadata will appear here.</p></div>'
      }
    </section>`;
}

async function saveSettings(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const status = document.getElementById("saveStatus");
  const channelId = document.getElementById("welcomeChannel").value || null;
  const welcomeMessage = document.getElementById("welcomeMessage").value;
  if (channelId && !welcomeMessage.trim()) {
    showToast("Add a welcome message or turn welcomes off.", true);
    return;
  }

  button.disabled = true;
  status.textContent = "Saving…";
  try {
    const result = await api(`/api/guilds/${encodeURIComponent(currentGuildId)}/settings`, {
      method: "PUT",
      body: JSON.stringify({
        embedColor: document.getElementById("embedColor").value,
        welcomeChannelId: channelId,
        welcomeMessage: channelId ? welcomeMessage : null,
        autoModerationEnabled: document.getElementById("autoModerationEnabled").checked,
        levelingEnabled: document.getElementById("levelingEnabled").checked,
        ticketCategoryId: document.getElementById("ticketCategory").value || null,
        ticketSupportRoleId: document.getElementById("ticketSupportRole").value || null,
        dashboardWebhookUrl: document.getElementById("dashboardWebhookUrl").value,
        clearDashboardWebhook: document.getElementById("clearDashboardWebhook").checked,
        featurePermissionRoles: currentOverview.canManageFeatureRoles
          ? Object.fromEntries(
              ["analytics", "activity", "moderation", "server_tools", "tickets", "settings"].map(
                (feature) => [
                  feature,
                  Array.from(
                    document.getElementById(`dashboardRoles_${feature}`).selectedOptions,
                  ).map((option) => option.value),
                ],
              ),
            )
          : undefined,
      }),
    });
    currentOverview.settings = result.settings;
    document.getElementById("dashboardWebhookUrl").value = "";
    status.textContent = "Saved";
    showToast("Server settings saved.");
  } catch (error) {
    status.textContent = "";
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function setSlowmode(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const status = document.getElementById("slowmodeStatus");
  button.disabled = true;
  status.textContent = "Applying…";
  try {
    const channelId = document.getElementById("slowmodeChannel").value;
    const seconds = Number(document.getElementById("slowmodeSeconds").value);
    await api(`/api/guilds/${encodeURIComponent(currentGuildId)}/channels/slowmode`, {
      method: "PUT",
      body: JSON.stringify({ channelId, seconds }),
    });
    const channel = currentOverview.channels.find((item) => item.id === channelId);
    if (channel) channel.slowmodeSeconds = seconds;
    status.textContent = "Updated";
    showToast(`Slowmode ${seconds ? `set to ${formatSlowmode(seconds)}` : "disabled"}.`);
  } catch (error) {
    status.textContent = "";
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function postAnnouncement(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const status = document.getElementById("announcementStatus");
  const message = document.getElementById("announcementMessage").value.trim();
  if (!message) {
    showToast("Enter an announcement message.", true);
    return;
  }
  button.disabled = true;
  status.textContent = "Posting…";
  try {
    await api(`/api/guilds/${encodeURIComponent(currentGuildId)}/announcements`, {
      method: "POST",
      body: JSON.stringify({
        channelId: document.getElementById("announcementChannel").value,
        message,
      }),
    });
    document.getElementById("announcementMessage").value = "";
    status.textContent = "Posted";
    showToast("Announcement posted.");
  } catch (error) {
    status.textContent = "";
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function clearMessages(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const status = document.getElementById("clearStatus");
  button.disabled = true;
  status.textContent = "Clearing…";
  try {
    const result = await api(`/api/guilds/${encodeURIComponent(currentGuildId)}/moderation/clear`, {
      method: "POST",
      body: JSON.stringify({
        channelId: document.getElementById("clearChannel").value,
        amount: Number(document.getElementById("clearAmount").value),
      }),
    });
    status.textContent = "Complete";
    showToast(`Deleted ${result.deleted} recent message(s).`);
  } catch (error) {
    status.textContent = "";
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function timeoutMember(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const status = document.getElementById("timeoutStatus");
  const userId = document.getElementById("timeoutUserId").value.trim();
  if (!/^\d{17,20}$/.test(userId)) {
    showToast("Enter a valid Discord member ID.", true);
    return;
  }
  button.disabled = true;
  status.textContent = "Applying…";
  try {
    const durationMinutes = Number(document.getElementById("timeoutDuration").value);
    const result = await api(
      `/api/guilds/${encodeURIComponent(currentGuildId)}/moderation/timeout`,
      {
        method: "POST",
        body: JSON.stringify({
          userId,
          durationMinutes,
          reason: document.getElementById("timeoutReason").value,
        }),
      },
    );
    document.getElementById("timeoutUserId").value = "";
    document.getElementById("timeoutReason").value = "";
    status.textContent = "Applied";
    showToast(
      result.auditSaved
        ? `Timeout applied for ${formatSlowmode(durationMinutes * 60)}.`
        : "Timeout applied, but moderation history could not be saved.",
      !result.auditSaved,
    );
  } catch (error) {
    status.textContent = "";
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function sendMemberDm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const status = document.getElementById("dmStatus");
  const userId = document.getElementById("dmUserId").value.trim();
  const message = document.getElementById("dmMessage").value.trim();
  if (!/^\d{17,20}$/.test(userId) || !message || !document.getElementById("dmConfirm").checked) {
    showToast("Enter a member ID and message, then confirm the direct message.", true);
    return;
  }
  button.disabled = true;
  status.textContent = "Sending…";
  try {
    await api(`/api/guilds/${encodeURIComponent(currentGuildId)}/dm`, {
      method: "POST",
      body: JSON.stringify({ userId, message, confirm: true }),
    });
    document.getElementById("dmUserId").value = "";
    document.getElementById("dmMessage").value = "";
    document.getElementById("dmConfirm").checked = false;
    status.textContent = "Sent";
    showToast("Direct message sent.");
  } catch (error) {
    status.textContent = "";
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function saveBotPresence(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const statusMessage = document.getElementById("presenceStatusMessage");
  button.disabled = true;
  statusMessage.textContent = "Saving…";
  try {
    await api("/api/bot/presence", {
      method: "PUT",
      body: JSON.stringify({
        status: document.getElementById("presenceStatus").value,
        activityType: document.getElementById("presenceActivityType").value,
        activityText: document.getElementById("presenceActivityText").value,
      }),
    });
    statusMessage.textContent = "Saved";
    showToast("Bot presence updated.");
  } catch (error) {
    statusMessage.textContent = "";
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function loadPanel() {
  setPanelHeading();
  if (currentPanel === "status") {
    await renderBotStatus();
    return;
  }
  if (!currentGuildId || !currentOverview) {
    panelContent.innerHTML =
      '<div class="empty-state"><h2>No manageable servers found</h2><p>Join a server, give yourself Manage Server, and add the bot there. Then refresh this page.</p></div>';
    return;
  }

  if (currentPanel === "setup") {
    renderSetup();
    return;
  }
  if (currentPanel === "tools") {
    renderServerTools();
    return;
  }
  if (currentPanel === "commands") {
    renderCommands();
    return;
  }
  if (currentPanel === "analytics") {
    panelContent.innerHTML =
      '<div class="loading-card"><span class="spinner"></span> Loading server analytics…</div>';
    try {
      const analytics = await api(
        `/api/guilds/${encodeURIComponent(currentGuildId)}/analytics?days=${analyticsPeriod}`,
      );
      if (currentPanel === "analytics") renderAnalytics(analytics);
    } catch (error) {
      panelContent.innerHTML = `<div class="empty-state"><h2>Couldn’t load analytics</h2><p>${escapeHtml(error.message)}</p><button class="ghost-button" type="button" data-retry-panel>Try again</button></div>`;
    }
    return;
  }

  panelContent.innerHTML =
    '<div class="loading-card"><span class="spinner"></span> Loading activity…</div>';
  try {
    const [logs, leaderboard] = await Promise.all([
      api(`/api/guilds/${encodeURIComponent(currentGuildId)}/logs`),
      currentPanel === "overview"
        ? api(`/api/guilds/${encodeURIComponent(currentGuildId)}/leaderboard`)
        : Promise.resolve([]),
    ]);
    currentLogs = mergeLogs(logs, currentLogs);
    if (currentPanel === "logs") renderLogs(currentLogs);
    else renderOverview(currentLogs, leaderboard);
  } catch (error) {
    panelContent.innerHTML = `<div class="empty-state"><h2>Couldn’t load activity</h2><p>${escapeHtml(error.message)}</p><button class="ghost-button" type="button" data-retry-panel>Try again</button></div>`;
  }
}

async function loadGuild(guildId) {
  if (!guildId) {
    connectActivityStream("");
    currentOverview = null;
    currentLogs = [];
    document.getElementById("currentGuildName").textContent = "No server selected";
    await loadPanel();
    return;
  }
  currentGuildId = guildId;
  window.localStorage.setItem("orbit.guild", guildId);
  document.getElementById("currentGuildName").textContent =
    guilds.find((guild) => guild.id === guildId)?.name || "Selected server";
  panelContent.innerHTML =
    '<div class="loading-card"><span class="spinner"></span> Loading your server…</div>';
  try {
    currentOverview = await api(`/api/guilds/${encodeURIComponent(guildId)}`);
    document.getElementById("currentGuildName").textContent = currentOverview.guild.name;
    currentLogs = [];
    connectActivityStream(guildId);
    await loadPanel();
  } catch (error) {
    showToast(error.message, true);
    panelContent.innerHTML = `<div class="empty-state"><h2>Couldn’t load this server</h2><p>${escapeHtml(error.message)}</p><button class="ghost-button" type="button" data-retry-guild>Try again</button></div>`;
  }
}

async function boot() {
  try {
    const session = await api("/api/me");
    csrfToken = session.csrfToken;
    setUser({ ...session.user, isApplicationOwner: session.isApplicationOwner });
    showView(dashboardView);
    guilds = await api("/api/guilds");
    setGuildOptions();
    if (!guilds.length) {
      currentOverview = null;
      await loadPanel();
      return;
    }
    await loadGuild(currentGuildId);
  } catch (error) {
    if (error.message === "Please sign in with Discord.") {
      showView(signInView);
      return;
    }
    showError(error.message);
  }
}

guildSelect.addEventListener("change", () => loadGuild(guildSelect.value));
panelContent.addEventListener("change", (event) => {
  if (event.target.id === "analyticsDays") {
    analyticsPeriod = Number(event.target.value);
    void loadPanel();
  }
});
document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    currentPanel = button.dataset.panel;
    void loadPanel();
  });
});
panelContent.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-panel]");
  if (button) {
    currentPanel = button.dataset.openPanel;
    void loadPanel();
    return;
  }
  if (event.target.closest("[data-retry-panel]")) {
    void loadPanel();
    return;
  }
  if (event.target.closest("[data-retry-guild]")) void loadGuild(currentGuildId);
});
document.getElementById("logoutButton").addEventListener("click", async () => {
  try {
    if (activityStream) activityStream.close();
    await api("/auth/logout", { method: "POST" });
    window.location.reload();
  } catch (error) {
    showToast(error.message, true);
  }
});
document.getElementById("retryButton").addEventListener("click", () => {
  showView(dashboardView);
  void boot();
});

void boot();
