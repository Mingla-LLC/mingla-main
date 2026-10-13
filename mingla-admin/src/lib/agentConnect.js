// Issue #3802 (Wave 4) — everything the My agent page decides, as pure
// functions: the lines a person pastes to connect their agent, what the
// status line says, why a key stopped, what an agent can and cannot do, and
// the words for every answer the server can give.
//
// Pure module: no React, no Supabase import, no browser storage. A key is
// only ever an argument here; nothing in this file keeps one.

import { parseServerError } from "./crmModel.js";

/** The agents a person can connect. `letter` is the one inside a key. */
export const AGENTS = [
  { id: "claude", label: "Claude", product: "Claude Code", envVar: "MINGLA_CLAUDE_KEY", letter: "c" },
  { id: "codex", label: "Codex", product: "Codex", envVar: "MINGLA_CODEX_KEY", letter: "x" },
];

export const OS_OPTIONS = [
  { value: "mac", label: "macOS or Linux" },
  { value: "windows", label: "Windows" },
];

/** What the connect lines show in place of a key that is no longer on screen. */
export const KEY_PLACEHOLDER = "<your key>";

export function agentDef(agentId) {
  return AGENTS.find((a) => a.id === agentId) || null;
}

export function agentLabel(agentId) {
  return agentDef(agentId)?.label || "Agent";
}

/** A key as the server makes it: nothing else is ever put into a line. */
export function isAgentKey(value) {
  return typeof value === "string" && /^mgla_[cx]_[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * The address agents connect to, from the app's own server address. Returns
 * "" when that address is missing or is not a plain web address, so a line is
 * never built from something that could break out of its quotes.
 */
export function agentEndpoint(supabaseUrl) {
  if (typeof supabaseUrl !== "string") return "";
  const base = supabaseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(base)) return "";
  return `${base}/functions/v1/team-agent`;
}

/**
 * The lines to paste, for one agent on one kind of computer.
 *
 * Returns { steps, simpler, notes } or null when there is no address.
 *   steps    the recommended way: the key lives in an environment variable,
 *            and the connector line holds only the variable's name
 *   simpler  one paste; the key is stored in the agent's own settings file
 *   notes    plain sentences shown under the lines
 * Each line is { id, label, text, hasKey }. `hasKey` says the line carries
 * the key itself (so the page can say "this line holds your key").
 * `key` is the key while it is on screen; anything else shows a placeholder.
 */
export function connectLines({ agent, os, endpoint, key }) {
  const def = agentDef(agent);
  if (!def || !endpoint) return null;
  const k = isAgentKey(key) ? key : KEY_PLACEHOLDER;
  const windows = os === "windows";
  const keep = windows
    ? { id: "keep", label: "1. Keep the key on your computer, not in a file an agent can read back", text: `setx ${def.envVar} "${k}"`, hasKey: true }
    : {
      id: "keep",
      label: "1. Keep the key in your shell, not in a file an agent can read back",
      text: `echo 'export ${def.envVar}="${k}"' >> ~/.zshrc && source ~/.zshrc`,
      hasKey: true,
    };

  if (def.id === "claude") {
    const json = JSON.stringify({ type: "http", url: endpoint, headers: { Authorization: `Bearer \${${def.envVar}}` } });
    return {
      steps: [
        keep,
        {
          id: "add",
          label: windows ? "2. Open a new terminal window, then add Mingla to Claude Code" : "2. Add Mingla to Claude Code, for every project",
          text: `claude mcp add-json --scope user mingla '${json}'`,
          hasKey: false,
        },
      ],
      simpler: {
        id: "simple",
        label: "One paste. The key is stored in Claude Code's own settings file on this computer.",
        text: `claude mcp add --transport http --scope user mingla ${endpoint} --header "Authorization: Bearer ${k}"`,
        hasKey: true,
      },
      notes: [
        windows
          ? "If the second line is refused, use the simpler line below."
          : "On Linux with bash, write ~/.bashrc in place of ~/.zshrc.",
        "Using the Code tab of the Claude desktop app? An app opened from the Dock or the Start menu may not see the variable. Use the simpler line.",
        "Then check it: run claude mcp list. Mingla should say Connected.",
      ],
    };
  }

  const file = windows ? "%USERPROFILE%\\.codex\\config.toml" : "~/.codex/config.toml";
  return {
    steps: [
      keep,
      {
        id: "add",
        label: `2. Add these lines to ${file}`,
        text: `[mcp_servers.mingla]\nurl = "${endpoint}"\nbearer_token_env_var = "${def.envVar}"`,
        hasKey: false,
      },
    ],
    simpler: {
      id: "simple",
      label: `Add these lines to ${file} instead. The key is stored in that file.`,
      text: `[mcp_servers.mingla]\nurl = "${endpoint}"\nhttp_headers = { "Authorization" = "Bearer ${k}" }`,
      hasKey: true,
    },
    notes: [
      "The Codex command line, its editor extension and the desktop app all read that one file.",
      "The desktop app opened from the Dock or the Start menu may not see the variable. Use the simpler lines for it.",
      windows ? "Open a new terminal window after the first line, then start Codex again." : "On Linux with bash, write ~/.bashrc in place of ~/.zshrc. Then start Codex again.",
    ],
  };
}

// ── Keys as the server lists them ──────────────────────────────────────────

/** The active key for an agent, or null. */
export function activeKey(keys, agentId) {
  return (Array.isArray(keys) ? keys : []).find((k) => k && k.agent === agentId && !k.revoked_at) || null;
}

/** The most recently stopped key for an agent, or null. */
export function lastStoppedKey(keys, agentId) {
  const stopped = (Array.isArray(keys) ? keys : []).filter((k) => k && k.agent === agentId && k.revoked_at);
  stopped.sort((a, b) => String(b.revoked_at).localeCompare(String(a.revoked_at)));
  return stopped[0] || null;
}

/**
 * What an agent calls itself, made short and safe to show. It is whatever the
 * agent sent, so it is shown as plain text and never trusted.
 */
export function clientName(raw) {
  if (typeof raw !== "string") return "";
  // Printable ASCII only: this text was chosen by whoever holds the key.
  const text = raw.replace(/[^\x20-\x7E]/g, "").trim();
  if (!text) return "";
  const cc = text.match(/^claude-code\/(\d+)\.(\d+)/i);
  if (cc) return `Claude Code ${cc[1]}.${cc[2]}`;
  const cx = text.match(/^codex[a-z_-]*\/(\d+)\.(\d+)/i);
  if (cx) return `Codex ${cx[1]}.${cx[2]}`;
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** "just now", "12 minutes ago", "3 hours ago", "5 days ago", or a date. */
export function agoWords(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 90) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d < 31) return d === 1 ? "1 day ago" : `${d} days ago`;
  return `on ${dayWords(iso)}`;
}

/** "14 Oct" (this year) or "14 Oct 2025". */
export function dayWords(iso, now = Date.now()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear();
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}${sameYear ? "" : ` ${d.getUTCFullYear()}`}`;
}

/**
 * The status line for one agent: { state, variant, text }.
 *   state  "none" | "unused" | "connected"
 */
export function agentStatus(key, agentId, now = Date.now()) {
  const label = agentLabel(agentId);
  if (!key) return { state: "none", variant: "default", text: "Not connected" };
  if (!key.last_used_at) return { state: "unused", variant: "warning", text: "Key created · not used yet" };
  const parts = [`Connected: ${label}`, `last used ${agoWords(key.last_used_at, now)}`];
  const client = clientName(key.last_used_client);
  if (client) parts.push(client);
  return { state: "connected", variant: "success", text: parts.join(" · ") };
}

/** Why a key stopped working, in plain words. Never a code. */
export function stoppedWords(key, idleDays = 90, now = Date.now()) {
  if (!key || !key.revoked_at) return "";
  const when = dayWords(key.revoked_at, now);
  const on = when ? ` on ${when}` : "";
  switch (key.revoke_reason) {
    case "replaced":
      return `You replaced this key${on}.`;
    case "self":
      return `You disconnected this agent${on}.`;
    case "owner":
      return key.revoked_by_me ? `You disconnected this agent${on}.` : `The owner disconnected this agent${on}.`;
    case "access_removed":
      return `This key was turned off${on} when team access was removed.`;
    case "address_rule":
      return `This key was turned off${on} because the account can now sign in another way. Ask the owner.`;
    case "idle":
      return `Unused for ${idleDays} days, so this key was turned off${on}.`;
    default:
      return `This key was turned off${on}.`;
  }
}

// ── What it can do ──────────────────────────────────────────────────────────

/**
 * What a connected agent can do today, in the words of the page. One entry
 * per tool the connector offers (a test compares this list with the
 * connector's own list, so the page cannot promise a tool that is not there).
 */
export const AGENT_ABILITIES = [
  { tool: "get_started", group: "Your day", title: "Learns the pipelines", detail: "Stages, ICPs, regions, the team and the house rules, so nobody has to explain them." },
  { tool: "my_day", group: "Your day", title: "Reads your day", detail: "What is due today or overdue, stage counts, targets and new beta leads." },
  { tool: "find_records", group: "Find and check", title: "Finds hosts and creators", detail: "By name, stage, ICP, region, owner or due date, with the last touch and the last reply. Counts by stage, ICP, region or owner." },
  { tool: "get_record", group: "Find and check", title: "Opens a card", detail: "One host or creator with its links and its log." },
  { tool: "check_names", group: "Find and check", title: "Checks names", detail: "Whether up to 50 names are already in a pipeline, exactly or nearly." },
  { tool: "find_mingla_link", group: "Find and check", title: "Finds a Mingla brand or place", detail: "To see whether a host already has an account or a listing." },
  { tool: "list_beta_leads", group: "Beta leads", title: "Reads beta leads", detail: "Who asked to join, and which are already hosts. A contact name and email, never a phone number." },
  { tool: "team_summary", group: "Team", title: "Reads the team's numbers", detail: "This week by person, everything due and targets.", adminOnly: true },
];

/** The abilities this role is offered, grouped in page order. */
export function abilitiesFor(role) {
  const admin = role === "owner" || role === "admin";
  const groups = [];
  for (const a of AGENT_ABILITIES) {
    if (a.adminOnly && !admin) continue;
    let g = groups.find((x) => x.group === a.group);
    if (!g) {
      g = { group: a.group, items: [] };
      groups.push(g);
    }
    g.items.push(a);
  }
  return groups;
}

/** What arrives next. Shown as "not yet", never as something to try. */
export const AGENT_NOT_YET = [
  "Add hosts and creators, update them, move stages and log touches.",
  "Write drafts for you to send. You always send.",
  "Claude in the browser or on your phone signs in a different way. That is coming; for now use Claude Code or Codex.",
];

export const AGENT_GUARDRAILS = [
  "It never sends an email, DM or WhatsApp. A person sends.",
  "It sees only what your role sees.",
  "It cannot delete, manage keys or manage the team.",
  "Right now it reads. It cannot change a card yet.",
  "Every request it makes is recorded under your name, with the agent it came through.",
  "If it is refused, it is told why in plain words, so it can tell you.",
];

export const NOT_WORKING_CHECKS = [
  "Open a new terminal window, so it picks up the key.",
  "Paste each line whole, on one line.",
  "Restart your agent after adding Mingla.",
];

// ── Server answers in plain words ───────────────────────────────────────────

const AGENT_GENERIC = "That didn't work. Try again, and if it keeps happening tell an admin.";
const AGENT_LOAD_GENERIC = "Couldn't load your agent settings. Check your connection and try again.";
const AGENT_WORDS = {
  network: "You seem to be offline, so that didn't go through. Check your connection and try again.",
  signed_out: "Your sign-in ran out. Reload the page and sign in again.",
  not_ready: "My agent isn't switched on yet. Try again in a few minutes, or tell an admin.",
  not_found: "That key is no longer here. Nothing was changed.",
  invalid_agent: "Choose Claude or Codex.",
  try_again: "Something else changed at the same moment, so nothing was saved. Try again.",
  unknown: AGENT_GENERIC,
};
const AGENT_FORBIDDEN = "Your account can't use My agent. Ask the owner to give you team access.";

function tokenOf(err) {
  if (err && typeof err.token === "string") return { token: err.token, message: typeof err.message === "string" ? err.message : "" };
  const parsed = parseServerError(err);
  return { token: parsed.token, message: parsed.message };
}

/** A sentence, not a bare word or a token. */
function isSentence(text, token) {
  return text !== "" && text !== token && /\s/.test(text) && !/^[a-z_]+$/.test(text);
}

/**
 * The words to show for an answer from a key function. Never a raw error,
 * never a code, never a token: a token this page does not know gets the
 * generic line.
 */
export function agentErrorWords(err) {
  const { token, message } = tokenOf(err);
  if (token === "forbidden") return isSentence(message.trim(), token) ? message.trim() : AGENT_FORBIDDEN;
  return Object.hasOwn(AGENT_WORDS, token) ? AGENT_WORDS[token] : AGENT_GENERIC;
}

/** The same, for something that failed to LOAD. */
export function agentLoadErrorWords(err) {
  const { token } = tokenOf(err);
  if (token === "unknown" || token === "try_again" || token === "network") return AGENT_LOAD_GENERIC;
  return agentErrorWords(err);
}

export const AGENT_OFFLINE_WORDS =
  "You're offline. You can read this page, but a key can't be created, replaced or disconnected until you're back.";

// ── The owner's view ────────────────────────────────────────────────────────

/**
 * One row per person from the owner's overview: who has which agent
 * connected. Never a key: the server does not send one.
 */
export function overviewRows(overview, now = Date.now()) {
  const people = Array.isArray(overview?.people) ? overview.people : [];
  const rows = [];
  for (const p of people) {
    if (!p || typeof p.email !== "string") continue;
    let row = rows.find((r) => r.email === p.email);
    if (!row) {
      row = { email: p.email, name: typeof p.display_name === "string" && p.display_name ? p.display_name : p.email, role: p.role || "", agents: [] };
      rows.push(row);
    }
    if (p.connected && p.key_id) {
      row.agents.push({
        agent: p.agent,
        label: agentLabel(p.agent),
        keyId: p.key_id,
        line: p.last_used_at ? `used ${agoWords(p.last_used_at, now)}` : "not used yet",
      });
    }
  }
  return rows;
}
