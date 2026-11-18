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
let toastTimer;

const panelDetails = {
  overview: ["Overview", "Your server, at a glance."],
  setup: ["Quick setup", "A few thoughtful settings make the bot feel at home."],
  commands: ["Command library", "Everything your community can ask the bot to do."],
  logs: ["Activity logs", "Recent slash-command activity for this server."]
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
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
  currentGuildId = guilds.some(guild => guild.id === rememberedId)
    ? rememberedId
    : guilds[0]?.id || "";
  if (currentGuildId) guildSelect.value = currentGuildId;
}

function setPanelHeading() {
  const [title, subtitle] = panelDetails[currentPanel];
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageSubtitle").textContent = subtitle;
  document.querySelectorAll(".nav-item").forEach(button => {
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
    minute: "2-digit"
  }).format(date);
}

function activityRows(logs) {
  if (!logs.length) {
    return '<div class="empty-state"><h2>Nothing logged yet</h2><p>Command activity will appear here after someone uses a slash command in this server.</p></div>';
  }
  return `<div class="activity-list">${logs.slice(0, 6).map(log => `
    <div class="activity-row">
      <span class="activity-command">/${escapeHtml(log.commandName)}</span>
      <span class="activity-user">${escapeHtml(log.userName)}</span>
      <span class="activity-time">${escapeHtml(formatTime(log.timestamp))}</span>
    </div>`).join("")}</div>`;
}

function renderOverview(logs) {
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
          <div><h2>Latest activity</h2><p>Only command metadata is stored; argument values are not collected.</p></div>
          <button class="text-link" type="button" data-open-panel="logs">View logs ↗</button>
        </div>
        ${activityRows(logs)}
      </section>
    </div>`;
}

function renderSetup() {
  const settings = currentOverview.settings;
  const channels = currentOverview.channels;
  const selectedChannel = settings.welcomeChannelId || "";
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
              ${channels.map(channel => `<option value="${escapeHtml(channel.id)}" ${channel.id === selectedChannel ? "selected" : ""}>#${escapeHtml(channel.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="welcomeMessage">Welcome message</label>
            <textarea id="welcomeMessage" name="welcomeMessage" maxlength="500" placeholder="Welcome {user} to {server}!">${escapeHtml(settings.welcomeMessage || "")}</textarea>
            <span class="field-hint">Placeholders: {user}, {server}, and {count}. Mentions are disabled in welcome messages.</span>
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
    const matches = currentOverview.commands.filter(command =>
      command.name.includes(query) || command.description.toLowerCase().includes(query)
    );
    list.innerHTML = matches.length
      ? matches.map(command => `<article class="command-card"><code>/${escapeHtml(command.name)}</code><p>${escapeHtml(command.description)}</p></article>`).join("")
      : '<div class="empty-state"><h2>No matching commands</h2><p>Try a different search.</p></div>';
  };
  input.addEventListener("input", draw);
  draw();
}

function renderLogs(logs) {
  panelContent.innerHTML = `
    <section class="panel">
      <div class="panel-heading"><div><h2>Command activity</h2><p>Most recent activity for ${escapeHtml(currentOverview.guild.name)}. Arguments are not logged.</p></div></div>
      ${logs.length ? `<div class="table-wrap"><table class="logs-table">
        <thead><tr><th>Command</th><th>Member</th><th>Channel</th><th>Result</th><th>Time</th></tr></thead>
        <tbody>${logs.map(log => `<tr>
          <td>/${escapeHtml(log.commandName)}</td>
          <td>${escapeHtml(log.userName)}</td>
          <td>${escapeHtml(log.channelId ? `#${log.channelId}` : "Unknown")}</td>
          <td><span class="status-pill ${log.outcome === "error" ? "error" : ""}">${escapeHtml(log.outcome)}</span></td>
          <td>${escapeHtml(formatTime(log.timestamp))}</td>
        </tr>`).join("")}</tbody>
      </table></div>` : '<div class="empty-state"><h2>No activity yet</h2><p>Use a slash command in this server and its metadata will appear here.</p></div>'}
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
        welcomeMessage: channelId ? welcomeMessage : null
      })
    });
    currentOverview.settings = result.settings;
    status.textContent = "Saved";
    showToast("Server settings saved.");
  } catch (error) {
    status.textContent = "";
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function loadPanel() {
  setPanelHeading();
  if (!currentGuildId || !currentOverview) {
    panelContent.innerHTML = '<div class="empty-state"><h2>No manageable servers found</h2><p>Join a server, give yourself Manage Server, and add the bot there. Then refresh this page.</p></div>';
    return;
  }

  if (currentPanel === "setup") {
    renderSetup();
    return;
  }
  if (currentPanel === "commands") {
    renderCommands();
    return;
  }

  panelContent.innerHTML = '<div class="loading-card"><span class="spinner"></span> Loading activity…</div>';
  try {
    const logs = await api(`/api/guilds/${encodeURIComponent(currentGuildId)}/logs`);
    if (currentPanel === "logs") renderLogs(logs);
    else renderOverview(logs);
  } catch (error) {
    panelContent.innerHTML = `<div class="empty-state"><h2>Couldn’t load activity</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function loadGuild(guildId) {
  if (!guildId) {
    currentOverview = null;
    document.getElementById("currentGuildName").textContent = "No server selected";
    await loadPanel();
    return;
  }
  currentGuildId = guildId;
  window.localStorage.setItem("orbit.guild", guildId);
  document.getElementById("currentGuildName").textContent =
    guilds.find(guild => guild.id === guildId)?.name || "Selected server";
  panelContent.innerHTML = '<div class="loading-card"><span class="spinner"></span> Loading your server…</div>';
  try {
    currentOverview = await api(`/api/guilds/${encodeURIComponent(guildId)}`);
    document.getElementById("currentGuildName").textContent = currentOverview.guild.name;
    await loadPanel();
  } catch (error) {
    showToast(error.message, true);
    panelContent.innerHTML = `<div class="empty-state"><h2>Couldn’t load this server</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function boot() {
  try {
    const session = await api("/api/me");
    csrfToken = session.csrfToken;
    setUser(session.user);
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
document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    currentPanel = button.dataset.panel;
    void loadPanel();
  });
});
panelContent.addEventListener("click", event => {
  const button = event.target.closest("[data-open-panel]");
  if (!button) return;
  currentPanel = button.dataset.openPanel;
  void loadPanel();
});
document.getElementById("logoutButton").addEventListener("click", async () => {
  try {
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
