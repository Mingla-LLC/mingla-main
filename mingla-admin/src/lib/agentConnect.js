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
 * The time zone of this browser as an IANA name ("America/New_York"), or
 * null when the browser will not say. Sent when a key is made, so the
 * agent's "today" is the date on this person's screen.
 */
export function browserTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && /^[A-Za-z0-9_+/-]{1,64}$/.test(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** What the card says about the dates an agent with this key will use. */
export function zoneWords(key) {
  if (!key) return "";
  return typeof key.time_zone === "string" && key.time_zone
    ? `Your agent's "today" follows ${key.time_zone.replace(/_/g, " ")}, the time zone this key was made in.`
    : `No time zone is recorded for this key, so your agent's "today" is the date in UTC. Replace the key from this browser to set it.`;
}

/**
 * The lines to paste, for one agent on one kind of computer.
 *
 * Returns { steps, simpler, notes, untested } or null when there is no
 * address.
 *   steps     the recommended way: the key lives in an environment variable,
 *             and the connector line holds only the variable's name
 *   simpler   one paste; the key is stored in the agent's own settings file
 *   notes     plain sentences shown under the lines
 *   untested  true when these lines were not run on that kind of computer
 * Each line is { id, label, text, hasKey, where }. `hasKey` says the line
 * carries the key itself; `where` says, in plain words, where the key ends
 * up after the line runs and how to take it out again.
 * `key` is the key while it is on screen; anything else shows a placeholder.
 */
export function connectLines({ agent, os, endpoint, key }) {
  const def = agentDef(agent);
  if (!def || !endpoint) return null;
  const k = isAgentKey(key) ? key : KEY_PLACEHOLDER;
  const windows = os === "windows";
  const keep = windows
    ? {
      id: "keep",
      label: "1. Save the key as a variable for your Windows account",
      text: `setx ${def.envVar} "${k}"`,
      hasKey: true,
      where: `The key is saved in your Windows account's environment variables, readable by any program you run. To remove it: reg delete HKCU\\Environment /v ${def.envVar} /f`,
    }
    : {
      id: "keep",
      label: "1. Save the key in your shell profile",
      text: `echo 'export ${def.envVar}="${k}"' >> ~/.zshrc && source ~/.zshrc`,
      hasKey: true,
      where: "The key ends up as one line in ~/.zshrc on this computer, readable by any program you run, and outside your project folders. To remove it, delete that line.",
    };
  const untestedNote = "These Windows lines were not run on Windows here. They follow the documented forms; if one is refused, use the simpler way below and tell an admin.";

  if (def.id === "claude") {
    const json = JSON.stringify({ type: "http", url: endpoint, headers: { Authorization: `Bearer \${${def.envVar}}` } });
    return {
      untested: windows,
      steps: [
        keep,
        {
          id: "add",
          label: windows
            ? "2. In a new Command Prompt window (cmd, not PowerShell), add Mingla to Claude Code"
            : "2. Add Mingla to Claude Code, for every project",
          // Command Prompt has no single quotes: the JSON goes in double
          // quotes with its own quotes escaped. It names the variable only.
          text: windows
            ? `claude mcp add-json --scope user mingla "${json.replace(/"/g, '\\"')}"`
            : `claude mcp add-json --scope user mingla '${json}'`,
          hasKey: false,
          where: "This line names the variable and holds no key. To remove Mingla from Claude Code: claude mcp remove mingla --scope user",
        },
      ],
      simpler: {
        id: "simple",
        label: "One paste, in any terminal. The key is stored in Claude Code's own settings file.",
        text: `claude mcp add --transport http --scope user mingla ${endpoint} --header "Authorization: Bearer ${k}"`,
        hasKey: true,
        where: "The key ends up in Claude Code's settings file in your home folder (.claude.json), readable by any program you run. To remove it: claude mcp remove mingla --scope user",
      },
      notes: [
        windows ? untestedNote : "On Linux with bash, write ~/.bashrc in place of ~/.zshrc.",
        "Using the Code tab of the Claude desktop app? An app opened from the Dock or the Start menu may not see the variable. Use the simpler line.",
        "Then check it: run claude mcp list. Mingla should say Connected.",
      ],
    };
  }

  const file = windows ? "%USERPROFILE%\\.codex\\config.toml" : "~/.codex/config.toml";
  return {
    untested: windows,
    steps: [
      keep,
      {
        id: "add",
        label: `2. Add these lines to ${file}`,
        text: `[mcp_servers.mingla]\nurl = "${endpoint}"\nbearer_token_env_var = "${def.envVar}"`,
        hasKey: false,
        where: "These lines name the variable and hold no key. To remove Mingla from Codex, delete them.",
      },
    ],
    simpler: {
      id: "simple",
      label: `Add these lines to ${file} instead. The key is stored in that file.`,
      text: `[mcp_servers.mingla]\nurl = "${endpoint}"\nhttp_headers = { "Authorization" = "Bearer ${k}" }`,
      hasKey: true,
      where: "The key ends up in that file, readable by any program you run. To remove it, delete these lines.",
    },
    notes: [
      "The Codex command line, its editor extension and the desktop app all read that one file.",
      "The desktop app opened from the Dock or the Start menu may not see the variable. Use the simpler lines for it.",
      windows ? untestedNote : "On Linux with bash, write ~/.bashrc in place of ~/.zshrc. Then start Codex again.",
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
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
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

// ── After a create or replace that did not answer ──────────────────────────

/**
 * What to say when a create or replace failed or never answered. No answer
 * is not the same as "nothing happened": the server may have made the new
 * key (ending the old one) before the answer was lost, so the page reads the
 * person's keys again and this decides from what it found.
 *   before  the id of the active key for that agent before asking, or null
 *   after   the id now, null for none, undefined when it could not be read
 *   words   the plain words for the error itself
 * Returns { kind, problem, notice, toastVariant, toastTitle, toastWords, replaceAgain }.
 *   kind "unchanged"  nothing was made; the key the person has still works
 *   kind "unseen"     a key was made but could not be shown (the old one,
 *                     if any, no longer works); replacing again is safe
 *   kind "unknown"    the keys could not be read either: never claim that
 *                     nothing happened
 */
export function createOutcome({ before = null, after, label = "agent", words = "" }) {
  if (after === undefined) {
    return {
      kind: "unknown",
      problem: before
        ? `We couldn't tell whether your ${label} key was replaced. If it was, the key you have no longer works. Check your connection, then replace the key again.`
        : `We couldn't tell whether a ${label} key was created. Check your connection, then try again.`,
      notice: "",
      toastVariant: "error",
      toastTitle: `Couldn't confirm your ${label} key`,
      toastWords: "Check your connection and look at this card again.",
      replaceAgain: false,
    };
  }
  if ((after || null) !== (before || null)) {
    return {
      kind: "unseen",
      problem: "",
      notice: before
        ? `Your ${label} key was replaced, but the new key couldn't be shown. The old key no longer works. Replace it again to get a key you can copy.`
        : `A ${label} key was created, but it couldn't be shown. Replace it to get a key you can copy.`,
      toastVariant: "warning",
      toastTitle: before ? `Your old ${label} key no longer works` : `Your ${label} key couldn't be shown`,
      toastWords: "A new key was made but couldn't be shown. Replace it again to get one you can copy.",
      replaceAgain: true,
    };
  }
  return {
    kind: "unchanged",
    problem: `No key was created${before ? ", and the key you have still works" : ""}. ${words}`.trim(),
    notice: "",
    toastVariant: "error",
    toastTitle: `Couldn't create your ${label} key`,
    toastWords: words,
    replaceAgain: false,
  };
}

/**
 * Whether the key on screen may stay there, given the keys the server now
 * lists. `shown` is { keyId, listed }: `listed` is true once the server has
 * listed that key as active.
 *   "keep"    listed as active before and still is
 *   "listed"  active, and this is the first read that says so
 *   "wait"    not listed yet (the read after a create has not landed)
 *   "hide"    turned off, or gone after having been listed: it no longer
 *             works, so it must not stay on screen as if it did
 */
export function shownKeyVerdict(keys, shown) {
  if (!shown || !shown.keyId) return "keep";
  const row = (Array.isArray(keys) ? keys : []).find((k) => k && k.key_id === shown.keyId);
  if (row && !row.revoked_at) return shown.listed ? "keep" : "listed";
  if (!row && !shown.listed) return "wait";
  return "hide";
}

export const REPLACED_ELSEWHERE_WORDS =
  "This key was replaced or disconnected somewhere else, so it no longer works and is hidden here.";

// ── What it can do ──────────────────────────────────────────────────────────

/**
 * What a connected agent can do today, in the words of the page. One entry
 * per tool the connector offers (a test compares this list with the
 * connector's own list, so the page cannot promise a tool that is not there).
 */
export const AGENT_ABILITIES = [
  { tool: "get_started", group: "Your day", title: "Learns the pipelines", detail: "Stages, ICPs, regions, the team and the house rules, so nobody has to explain them." },
  { tool: "my_day", group: "Your day", title: "Reads your day", detail: "What is due today or overdue, stage counts, targets and new beta leads." },
  { tool: "find_records", group: "Find and check", title: "Finds hosts and creators", detail: "By name, email, phone or handle, stage, ICP, region, owner or due date, with the last touch and the last reply. Counts by stage, ICP, region or owner." },
  { tool: "get_record", group: "Find and check", title: "Opens a card", detail: "One host or creator with its links and its log." },
  { tool: "check_names", group: "Find and check", title: "Checks names", detail: "Whether up to 50 names are already in a pipeline, exactly or nearly." },
  { tool: "find_mingla_link", group: "Find and check", title: "Finds a Mingla brand or place", detail: "To see whether a host already has an account or a listing." },
  { tool: "check_contactable", group: "Find and check", title: "Checks who is contactable", detail: "Whether up to 50 people are new, already in a pipeline, or marked Do not contact or Warm intro only." },
  { tool: "list_beta_leads", group: "Beta leads", title: "Reads beta leads", detail: "Who asked to join, and which are already hosts. A contact name and email, never a phone number." },
  { tool: "team_summary", group: "Team", title: "Reads the team's numbers", detail: "This week by person, everything due and targets.", adminOnly: true },
  { tool: "add_records", group: "Add and change", title: "Adds hosts and creators", detail: "Up to 50 at once. A name, an email, a phone or a handle that is already there is skipped, never doubled." },
  { tool: "upsert_record", group: "Add and change", title: "Adds or finds one, with its first touch", detail: "One host or creator and the message that went with it. A record that is already there is found, never changed." },
  { tool: "update_records", group: "Add and change", title: "Updates cards", detail: "Fields, contact details and the next action, on up to 50 cards." },
  { tool: "move_stage", group: "Add and change", title: "Moves cards", detail: "Always from the stage it saw; Live sets itself." },
  { tool: "set_owners", group: "Add and change", title: "Sets owners", detail: "Who on the team owns each card." },
  { tool: "log_activity", group: "Log", title: "Logs notes and touches", detail: "A note, a reply, or the first message to someone never contacted." },
  { tool: "record_reply", group: "Log", title: "Records replies", detail: "Word for word, and moves the card to Replied." },
  { tool: "save_drafts", group: "Drafts", title: "Writes drafts for you", detail: "Messages for your review. It never sends." },
  { tool: "update_draft", group: "Drafts", title: "Updates its waiting drafts", detail: "Until you edit one yourself." },
  { tool: "list_drafts", group: "Drafts", title: "Reads your drafts", detail: "Only your own waiting, sent or discarded drafts." },
  { tool: "withdraw_drafts", group: "Drafts", title: "Withdraws its waiting drafts", detail: "Until you edit one yourself." },
  { tool: "list_content", group: "Content", title: "Reads the content calendar", detail: "Searches cards by stage, owner, date or words." },
  { tool: "add_content", group: "Content", title: "Adds content ideas", detail: "Up to 50 title-only cards at once, assigned to you in Idea." },
  { tool: "update_content", group: "Content", title: "Updates content cards", detail: "Copy, timing, channels, links and planning details, using the revision it read." },
  { tool: "assign_content", group: "Content", title: "Sets content owners", detail: "Active team members only, using the revision it read." },
  { tool: "comment_content", group: "Content", title: "Comments on content", detail: "Adds a visible comment under your name and its agent name." },
  { tool: "move_content", group: "Content", title: "Moves content stages", detail: "Uses the same approvals and publishing rules as the screen. It cannot delete." },
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
  "Undo a move, add beta leads to Hosts, and set targets: do these in Mingla Admin for now.",
  "Claude in the browser or on your phone signs in a different way. That is coming; for now use Claude Code or Codex.",
];

// Issue #3980 — the Work board, agent log and calendar tools, offered beside
// the abilities above when the connector says the person can use the Work
// board. Held to the connector's own list (TEAM_AGENT_WORK_TOOLS) by a test.
export const AGENT_WORK_ABILITIES = [
  { tool: "read_log", group: "Work", title: "Reads the agent log", detail: "What every agent did and which records are claimed, before it starts." },
  { tool: "claim", group: "Work", title: "Claims the records it works on", detail: "So no other agent, or another chat on your key, changes or messages them while it works. A claim ends after 30 minutes without an update. Cards are not claimed." },
  { tool: "release", group: "Work", title: "Releases its claims", detail: "When it stops working on a card, and ends its working mark on that card." },
  { tool: "plan_work", group: "Work", title: "Plans a launch", detail: "Proposes the launch kit cards for an event, counted back from its start, with owners." },
  { tool: "add_work", group: "Work", title: "Adds work cards", detail: "Up to 50 at a time, straight to the Work board after the server checks each one, with GitHub links like #3980. Owners and watchers are told." },
  { tool: "start_work", group: "Work", title: "Starts a card", detail: "Moves a card you own to Doing and marks it as working on it until it closes, pushes it back or releases it. Another chat cannot take it while it posts updates." },
  { tool: "update_work", group: "Work", title: "Updates a card", detail: "Changes it, marks plan steps it read back, links GitHub issues or pull requests, adds notes, or hands it to you as Needs a person." },
  { tool: "close_work", group: "Work", title: "Closes a card with proof", detail: "With at least one line of proof. A saved draft or a changed record is checked by Mingla; anything else shows on the card as the agent's word. Anyone it took off the card in the last day is told it closed." },
  { tool: "push_back", group: "Work", title: "Pushes a card back", detail: "As not needed or already done, with a reason everyone on the card sees." },
  { tool: "list_work", group: "Work", title: "Lists the Work board", detail: "By status, owner, event, host or creator, or sprint week." },
  { tool: "my_work", group: "Work", title: "Reads your cards", detail: "Your open cards, the ones you watch, its open claims and the cards it is working on." },
  { tool: "list_calendar", group: "Calendar", title: "Reads the Calendar", detail: "Events on Mingla with their runway, promised events, go-live deadlines, promotions and content." },
  { tool: "runway_report", group: "Calendar", title: "Reports runway", detail: "Which upcoming events are ready to promote, need promoting now, are too late for promo, or are not live yet." },
  { tool: "set_expected_event", group: "Calendar", title: "Records a promised event", detail: "The next event a host has promised, so it shows on the Calendar with its go-live deadline. It can repeat every week or month, or be a venue's promo moment." },
];

export const AGENT_WORK_GUARDRAILS = [
  "It reads the agent log and claims before it acts.",
  "It closes a card only with at least one line of proof. Proof Mingla cannot check shows as the agent's word.",
  "If it takes someone off a card, they are told who did it and which agent.",
  "It never marks a message sent, approves spend or publishes: those wait in To review.",
];

export const AGENT_GUARDRAILS = [
  "It never sends an email, DM or WhatsApp for you.",
  "It sees only what your role sees.",
  "It cannot delete, manage keys or manage the team.",
  "It may log only a cold first message. It writes every follow-up or answer as a draft for you.",
  "It cannot message a record marked Do not contact or Warm intro only, and it cannot lift that mark.",
  "Every change it makes is recorded under your name, with the agent it came through.",
  "If it is refused, it is told why in plain words, so it can tell you.",
];

export const NOT_WORKING_CHECKS = [
  "Did your agent run the command? It should have printed 'Mingla added'.",
  "Restart the agent after it says so.",
  "A message works once. If you pasted it twice or waited more than 10 minutes, copy a new one.",
  "It printed 'Setup did not start'? Nothing was changed and the code was not used: fix what it names, then paste the same message again.",
  "It printed 'Mingla made your key but could not save it'? Copy a new setup message and try again.",
  "Agent refused to run it? Paste the command from the message into the Terminal app yourself.",
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
  too_many_codes: "You have copied 10 setup messages in the last hour. Paste the last one into your agent, or try again in a few minutes.",
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
  "You're offline. You can read this page, but a setup message can't be copied and a key can't be created, replaced or disconnected until you're back.";

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

// ── One-message setup ───────────────────────────────────────────────────────

/** A one-time setup code as the server makes it, for that agent. */
export function isSetupCode(value, agentId) {
  const def = agentDef(agentId);
  return !!def && typeof value === "string" && new RegExp(`^mgls_${def.letter}_[A-Za-z0-9_-]{43}$`).test(value);
}

/** Where each agent keeps the connector, in the words of the page. */
export const AGENT_SETTINGS_FILE = {
  claude: { mac: "~/.claude.json", windows: "~/.claude.json" },
  codex: { mac: "~/.codex/config.toml", windows: "%USERPROFILE%\\.codex\\config.toml" },
};

/**
 * The ONE command a setup message asks an agent to run, on one line. It
 * holds the one-time code and never a key: the key is fetched by the command
 * and goes straight into the agent's own settings.
 * Returns "" unless the address and the code are exactly what they must be,
 * so nothing that could break out of the quotes is ever put in a command.
 */
export function setupCommand({ agent, os, endpoint, code }) {
  const def = agentDef(agent);
  if (!def || !endpoint || agentEndpoint(endpoint.replace(/\/functions\/v1\/team-agent$/, "")) !== endpoint) return "";
  if (!isSetupCode(code, agent)) return "";
  const windows = os === "windows";
  const url = `${endpoint}/setup`;
  // Every form does the same things in the same order: it asks for the key
  // first; what comes back is used only when the whole of it is a key for
  // this agent (one line, the right letter, 43 characters of the key
  // alphabet); only then is the earlier "mingla" entry replaced; and it
  // always ends by printing exactly one line. Text from the server is shown
  // only as printable characters, at most 200 of them.
  if (def.id === "claude") {
    if (windows) {
      // Windows PowerShell 5.1 and PowerShell before 7.3 drop the quotes of a
      // JSON argument unless each is escaped; 7.3 and later pass it as it is.
      return [
        `if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { "Setup did not start: the claude command was not found in this shell. Nothing was changed and the setup code was not used." } else {`,
        `$k = (curl.exe -sS -X POST -H "Authorization: Bearer ${code}" "${url}") -join "\`n";`,
        `if ($k -cmatch '\\Amgla_c_[A-Za-z0-9_-]{43}\\z') { claude mcp remove mingla -s user *> $null;`,
        `$j = @{ type = "http"; url = "${endpoint}"; headers = @{ Authorization = "Bearer $k" } } | ConvertTo-Json -Compress;`,
        `if ($PSVersionTable.PSVersion -lt [version]'7.3' -or $PSNativeCommandArgumentPassing -eq 'Legacy') { $j = $j -replace '"', '\\"' };`,
        `$LASTEXITCODE = 1; claude mcp add-json -s user mingla $j *> $null;`,
        `if ($LASTEXITCODE -eq 0) { "Mingla added to Claude Code." } else { "Mingla made your key but could not save it on this computer. Copy a new setup message from My agent and try again." } }`,
        `else { $s = ([string]$k) -replace '[^\\x20-\\x7E]', ''; if ($s.Length -gt 200) { $s = $s.Substring(0, 200) }; "Setup did not work: $s" } };`,
        `Remove-Variable k, j, s -ErrorAction SilentlyContinue`,
      ].join(" ");
    }
    return [
      `if ! command -v claude >/dev/null 2>&1; then printf '%s\\n' "Setup did not start: the claude command was not found in this shell. Nothing was changed and the setup code was not used.";`,
      `else K="$(curl -sS -X POST -H 'Authorization: Bearer ${code}' '${url}')";`,
      `if printf '%s' "$K" | LC_ALL=C grep -Eqx 'mgla_c_[A-Za-z0-9_-]{43}' && [ "\${#K}" -eq 50 ]; then claude mcp remove mingla -s user >/dev/null 2>&1;`,
      `if claude mcp add-json -s user mingla "{\\"type\\":\\"http\\",\\"url\\":\\"${endpoint}\\",\\"headers\\":{\\"Authorization\\":\\"Bearer $K\\"}}" >/dev/null 2>&1; then printf '%s\\n' "Mingla added to Claude Code.";`,
      `else printf '%s\\n' "Mingla made your key but could not save it on this computer. Copy a new setup message from My agent and try again."; fi;`,
      `else printf '%s\\n' "Setup did not work: $(printf '%s' "$K" | LC_ALL=C tr -cd '\\40-\\176' | cut -c1-200)"; fi; fi; unset K`,
    ].join(" ");
  }
  if (windows) {
    return [
      `$f = Join-Path $HOME ".codex\\config.toml"; $bad = $false; $skip = $false; $tab = ''; $out = @();`,
      `try { New-Item -ItemType Directory -Force (Split-Path $f) -ErrorAction Stop *> $null; if (-not (Test-Path $f)) { New-Item -ItemType File $f -ErrorAction Stop *> $null };`,
      `$out = @(foreach ($l in @(Get-Content $f -ErrorAction Stop)) { $n = ($l -replace '#.*$', '') -replace '[\\s"'']', '';`,
      `if ($l -match '^\\s*\\[') { $tab = $n -replace '[\\[\\]]', ''; $skip = $tab -match '^mcp_servers\\.mingla(\\.|$)' }`,
      `elseif ((-not $skip) -and ($n -match '=')) { $key = $n -replace '=.*$', ''; $full = if ($tab) { "$tab.$key" } else { $key }; if (($full -match '^mcp_servers\\.mingla(\\.|$)') -or (($full -eq 'mcp_servers') -and ($n -match 'mingla'))) { $bad = $true } };`,
      `if (-not $skip) { $l } }) } catch { $bad = $null };`,
      `if ($null -eq $bad) { "Setup did not start: this command could not read or write the Codex config file. Nothing was changed and the setup code was not used." }`,
      `elseif ($bad) { "Setup did not start: the Codex config file already has a mingla entry this command cannot safely replace. Nothing was changed and the setup code was not used. Remove that entry by hand, then paste this message again." }`,
      `else { $k = (curl.exe -sS -X POST -H "Authorization: Bearer ${code}" "${url}") -join "\`n";`,
      `if ($k -cmatch '\\Amgla_x_[A-Za-z0-9_-]{43}\\z') { try { $out = @($out) + '' + '[mcp_servers.mingla]' + 'url = "${endpoint}"' + ('http_headers = { "Authorization" = "Bearer ' + $k + '" }');`,
      `[IO.File]::WriteAllLines($f, $out); "Mingla added to Codex." } catch { "Mingla made your key but could not save it on this computer. Copy a new setup message from My agent and try again." } }`,
      `else { $s = ([string]$k) -replace '[^\\x20-\\x7E]', ''; if ($s.Length -gt 200) { $s = $s.Substring(0, 200) }; "Setup did not work: $s" } };`,
      `Remove-Variable k, f, out, skip, tab, bad, l, n, key, full, s -ErrorAction SilentlyContinue`,
    ].join(" ");
  }
  // The file is read and its new contents prepared before the code is used,
  // so a file this command cannot rewrite with certainty costs nothing. The
  // key is written straight into the file, through its own name (a link to
  // it stays a link); no working copy ever holds it.
  return [
    `F="$HOME/.codex/config.toml"; N=""; R=0;`,
    `if [ -e "$F" ]; then if [ -w "$F" ]; then N="$(awk 'function n(s){gsub(/[ \\t\\r"\\047]/,"",s);return s}function d(s){return gsub(/[[{]/,"&",s)-gsub(/[]}]/,"&",s)}{l=$0;if(m){if(gsub(/"""|\\047\\047\\047/,"&",l)%2)m=0;if(!k)print;next}if(a>0){a+=d(l);if(a<0)a=0;if(!k)print;next}s=l;sub(/^[ \\t]+/,"",s);if(s~/^\\[\\[?[A-Za-z0-9_."\\047 \\t-]+\\]\\]?[ \\t]*(#.*)?\\r?$/){r=s;sub(/#.*$/,"",r);gsub(/[ \\t\\r]/,"",r);t=n(r);gsub(/[][]/,"",t);k=(t~/^mcp_servers\\.mingla(\\.|$)/);if(k&&r!~/^\\[\\[?("mcp_servers"|\\047mcp_servers\\047|mcp_servers)\\.("mingla"|\\047mingla\\047|mingla)(\\.[^]]*)?\\]\\]?$/)b=1}else if(s~/^\\[/){if(k)b=1;k=0;t="?"}else if(!k&&s!~/^#/&&s~/=/){q=s;sub(/=.*$/,"",q);v=s;sub(/^[^=]*=/,"",v);f=(t==""?n(q):t"."n(q));if(f~/^mcp_servers\\.mingla(\\.|$)/){if(q~/["\\047]/||d(v)!=0||v~/"""|\\047\\047\\047/)b=1;else next}else{if(f=="mcp_servers"&&v~/mingla/)b=1;x=d(v);if(x>0)a=x;if(gsub(/"""|\\047\\047\\047/,"&",l)%2)m=1}}if(!k)print}END{if(b)exit 3}' "$F" 2>/dev/null)"; R=$?; [ "$R" -eq 0 ] && { printf '%s\\n' "$N" | awk '{s=$0;gsub(/[ \\t\\r"\\047]/,"",s)}s~/^\\[\\[?mcp_servers\\.mingla[].]/||s~/^mcp_servers\\.mingla[.=]/{f=1}END{exit f?3:0}'; R=$?; }; else R=1; fi;`,
    `elif [ -d "$HOME/.codex" ]; then [ -w "$HOME/.codex" ] || R=1; else [ -w "$HOME" ] || R=1; fi;`,
    `if [ "$R" -eq 3 ]; then printf '%s\\n' "Setup did not start: ~/.codex/config.toml already has a mingla entry this command cannot safely replace. Nothing was changed and the setup code was not used. Remove that entry by hand, then paste this message again.";`,
    `elif [ "$R" -ne 0 ]; then printf '%s\\n' "Setup did not start: this command could not read or write ~/.codex/config.toml. Nothing was changed and the setup code was not used.";`,
    `else K="$(curl -sS -X POST -H 'Authorization: Bearer ${code}' '${url}')";`,
    `if printf '%s' "$K" | LC_ALL=C grep -Eqx 'mgla_x_[A-Za-z0-9_-]{43}' && [ "\${#K}" -eq 50 ]; then`,
    `if ( umask 077; mkdir -p "$HOME/.codex" && { [ -z "$N" ] || printf '%s\\n' "$N"; printf '\\n[mcp_servers.mingla]\\nurl = "%s"\\nhttp_headers = { "Authorization" = "Bearer %s" }\\n' '${endpoint}' "$K"; } >| "$F" && { chmod 600 "$F"; [ "$(grep -c '^\\[mcp_servers\\.mingla\\]$' "$F")" = 1 ]; } ) 2>/dev/null; then printf '%s\\n' "Mingla added to Codex.";`,
    `else printf '%s\\n' "Mingla made your key but could not save it on this computer. Copy a new setup message from My agent and try again."; fi;`,
    `else printf '%s\\n' "Setup did not work: $(printf '%s' "$K" | LC_ALL=C tr -cd '\\40-\\176' | cut -c1-200)"; fi; fi; unset K F N R`,
  ].join(" ");
}

/**
 * The message a person pastes into their agent, for one agent on one kind
 * of computer, or null when it cannot be built. It carries the one-time code
 * once, inside the one command, and never a key.
 */
export function setupMessage({ agent, os, endpoint, code }) {
  const command = setupCommand({ agent, os, endpoint, code });
  if (!command) return null;
  const windows = os === "windows";
  if (agent === "claude") {
    return [
      "Please connect yourself to Mingla Admin, my team's pipeline tool. I am asking you to do this on my own computer.",
      "",
      "Only do this if you are Claude Code running on my computer (the terminal, an editor extension, or the Code tab of the desktop app). If you are Cowork, Claude in a browser or on a phone, or you run in a cloud or sandboxed session, run nothing and tell me to paste this into Claude Code instead.",
      "",
      windows
        ? "Run this one command in PowerShell exactly as written, and do not print, read back or summarise anything it handles:"
        : "Run this one command exactly as written, and do not print, read back or summarise anything it handles:",
      "",
      command,
      "",
      "What it does, so you can check it before you run it:",
      ...(windows
        ? ["If your shell is Git Bash (Claude Code's default on Windows), use the macOS or Linux message instead: it works there."]
        : []),
      "1. Checks that the claude command is here. If it is not, it stops before the code is used.",
      "2. Sends the one-time setup code in this message to Mingla's own server and receives my personal key. The code works once and expires 10 minutes after I copied it. It is not a password and is useless afterwards.",
      "3. Checks that what came back is a key and nothing else. Anything else is never run or saved: it prints one line saying setup did not work, with the server's words as plain text.",
      '4. Only then removes any earlier "mingla" entry from Claude Code\'s settings and saves the key in Claude Code\'s own settings file on this computer (~/.claude.json) as a connector named "mingla". The key goes straight into the file: it is not shown on screen and is not written to shell history.',
      '5. Prints exactly one line: "Mingla added to Claude Code.", or what happened instead.',
      "",
      "Afterwards:",
      '- If it printed "Mingla added to Claude Code.", tell me: "Mingla is added. Quit and reopen Claude Code (or run /exit and then claude --resume), then ask me: What is on my plate in Mingla?" A session that is already open does not see a new connector.',
      '- If it printed "Setup did not work", tell me exactly that line and that I need to copy a new setup message from My agent in Mingla Admin. Do not retry: the code is spent.',
      '- If it printed "Mingla made your key but could not save it", tell me exactly that line: my earlier key has stopped, and I need to copy a new setup message. Do not retry.',
      '- If it printed "Setup did not start", tell me exactly that line: nothing was changed and the code was not used.',
      '- Do not run "claude mcp get mingla" and do not open ~/.claude.json to check: both show the key. "claude mcp list" is safe.',
      "- If you would rather not run it, say so, and I will paste the command into the Terminal app myself.",
    ].join("\n");
  }
  const file = windows ? "%USERPROFILE%\\.codex\\config.toml" : "~/.codex/config.toml";
  return [
    "Please connect yourself to Mingla Admin, my team's pipeline tool. I am asking you to do this on my own computer.",
    "",
    "Only do this if you are Codex running on my computer (the command line, the editor extension, or the desktop app working on local files). If you run in the cloud or cannot reach my home folder, run nothing and tell me to paste the command into the Terminal app myself.",
    "",
    `Run this one command ${windows ? "in PowerShell " : ""}exactly as written, and do not print, read back or summarise anything it handles. It needs network access and writes one file outside this project (${file}), so ask me to approve it if your sandbox requires that:`,
    "",
    command,
    "",
    "What it does, so you can check it before you run it:",
    `1. Reads ${file} and works out its new contents without any earlier "mingla" connector. Nothing is changed yet. If the file holds a mingla entry it cannot remove with certainty, it stops there, before the code is used, and says so.`,
    "2. Sends the one-time setup code in this message to Mingla's own server and receives my personal key. The code works once and expires 10 minutes after I copied it.",
    "3. Checks that what came back is a key and nothing else. Anything else is never run or saved: it prints one line saying setup did not work, with the server's words as plain text.",
    `4. Writes ${file} with a new "mingla" connector that holds the key. Every other setting in that file is kept, and a link to the file stays a link. The key goes straight into the file: it is not shown on screen and is not written to shell history.`,
    windows
      ? '5. Prints exactly one line: "Mingla added to Codex.", or what happened instead.'
      : '5. Makes that file readable by me only, and prints exactly one line: "Mingla added to Codex.", or what happened instead.',
    "",
    "Afterwards:",
    '- If it printed "Mingla added to Codex.", tell me: "Mingla is added. Quit and reopen Codex (in the desktop app or the editor extension, use Restart), then ask me: What is on my plate in Mingla?"',
    '- If it printed "Setup did not work", tell me exactly that line and that I need to copy a new setup message from My agent in Mingla Admin. Do not retry: the code is spent.',
    '- If it printed "Mingla made your key but could not save it", tell me exactly that line: my earlier key has stopped, and I need to copy a new setup message. Do not retry.',
    '- If it printed "Setup did not start", tell me exactly that line: nothing was changed and the code was not used, so I can paste this message again once that is fixed.',
    `- Do not open or print ${file} to check: it holds the key.`,
    "- If you would rather not run it, say so, and I will paste the command into the Terminal app myself.",
  ].join("\n");
}

/**
 * The lines for adding the key by hand. It takes NO key: no line it returns
 * can contain one. Line 1 asks for the key and hides what is pasted; line 2
 * names the variable only.
 * Returns { steps, notes, untested } or null when there is no address.
 */
export function advancedLines({ agent, os, endpoint }) {
  const def = agentDef(agent);
  if (!def || !endpoint || agentEndpoint(endpoint.replace(/\/functions\/v1\/team-agent$/, "")) !== endpoint) return null;
  const windows = os === "windows";
  const keep = windows
    ? {
      id: "keep",
      label: "1. In PowerShell: save the key as a variable for your Windows account. It asks for the key: paste it and press Enter (nothing shows)",
      text: `$k = Read-Host 'Paste your key, then press Enter' -AsSecureString; [Environment]::SetEnvironmentVariable('${def.envVar}', [Net.NetworkCredential]::new('', $k).Password, 'User'); Remove-Variable k`,
      where: `The key is saved in your Windows account's environment variables, readable by any program you run. Nothing you pasted is kept in your shell's history. To remove it: reg delete HKCU\\Environment /v ${def.envVar} /f`,
    }
    : {
      id: "keep",
      label: "1. Save the key in your shell profile. It asks for the key: paste it and press Enter (nothing shows)",
      text: `printf 'Paste your key, then press Enter (it stays hidden): '; stty -echo; IFS= read -r MINGLA_K; stty echo; echo; printf 'export ${def.envVar}="%s"\\n' "$MINGLA_K" >> ~/.zshrc; unset MINGLA_K; source ~/.zshrc`,
      where: "The key ends up as one line in ~/.zshrc, readable by any program you run. Nothing you pasted is kept in your shell's history. To remove it, delete that line. On Linux with bash, write ~/.bashrc in place of ~/.zshrc.",
    };
  const desktop = "Using a desktop app? An app opened from the Dock or the Start menu may not see the variable. Use the setup message instead.";
  if (def.id === "claude") {
    const json = JSON.stringify({ type: "http", url: endpoint, headers: { Authorization: `Bearer \${${def.envVar}}` } });
    return {
      untested: windows,
      steps: [
        keep,
        {
          id: "add",
          label: windows
            ? "2. In a NEW Command Prompt window (cmd, not PowerShell), add Mingla to Claude Code"
            : "2. Add Mingla to Claude Code, for every project",
          text: windows
            ? `claude mcp remove mingla --scope user & claude mcp add-json --scope user mingla "${json.replace(/"/g, '\\"')}"`
            : `claude mcp remove mingla --scope user; claude mcp add-json --scope user mingla '${json}'`,
          where: "This line names the variable and holds no key. It removes any earlier Mingla entry first. To remove Mingla from Claude Code: claude mcp remove mingla --scope user",
        },
      ],
      notes: [
        desktop,
        "Then check it: run claude mcp list. Mingla should say Connected. Do not run claude mcp get mingla where others can see your screen: it prints the key.",
      ],
    };
  }
  const file = windows ? "%USERPROFILE%\\.codex\\config.toml" : "~/.codex/config.toml";
  return {
    untested: windows,
    steps: [
      keep,
      {
        id: "add",
        label: `2. Add these lines to ${file}`,
        text: `[mcp_servers.mingla]\nurl = "${endpoint}"\nbearer_token_env_var = "${def.envVar}"`,
        where: "These lines name the variable and hold no key. To remove Mingla from Codex, delete them.",
      },
    ],
    notes: [
      "The Codex command line, its editor extension and the desktop app all read that one file. Start Codex again afterwards.",
      desktop,
    ],
  };
}

export const KEY_HIDDEN_AFTER_WORDS = "Hidden after 10 minutes. Lost it? Replace the key.";
/** A key stays on screen at most this long. */
export const SHOWN_KEY_MAX_MS = 10 * 60_000;
/** After a setup message ends, the page looks once more for this long. */
export const SETUP_GRACE_MS = 15_000;
/** A key made by a setup message that stays unused this long is said so. */
export const SETUP_UNUSED_WARN_MS = 2 * 60_000;
/** After a setup message is used, the page keeps looking for the key's first use this long. */
export const SETUP_FIRST_USE_WATCH_MS = 10 * 60_000;
/** The browser gets this long to say whether it copied; after that it counts as not copied. */
export const COPY_WAIT_MS = 2_000;

/**
 * The agents whose key has been on screen for its ten minutes. Each key is
 * counted from when THAT key was shown, never from when another one was.
 *   shown  { [agentId]: { keyId, shownAt } | null }
 */
export function keysToHide(shown, now = Date.now()) {
  return Object.keys(shown || {}).filter((id) => {
    const at = shown[id]?.shownAt;
    return !!shown[id] && Number.isFinite(at) && now - at >= SHOWN_KEY_MAX_MS;
  });
}

/** "10:12" on this person's clock. */
export function clockWords(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "in 9 min", "in under a minute", or "" once it has passed. */
export function minutesLeftWords(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= now) return "";
  const m = Math.floor((t - now) / 60_000);
  return m < 1 ? "in under a minute" : `in ${m} min`;
}

/** The setup message still waiting for an agent, as the server lists it, or null. */
export function pendingSetup(setup, agentId, now = Date.now()) {
  const rows = (Array.isArray(setup) ? setup : []).filter(
    (s) =>
      s &&
      s.agent === agentId &&
      (s.state === undefined || s.state === "waiting") &&
      Number.isFinite(Date.parse(s.expires_at)) &&
      Date.parse(s.expires_at) > now
  );
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return rows[0] || null;
}

/**
 * What one agent's setup card shows: every state of the card, as data.
 *   local    what this tab holds for the agent, or null:
 *            { phase: "confirm" | "asking" | "ready" | "blocked" | "used" |
 *                     "superseded" | "ended" | "expired" | "failed" | "lost",
 *              expiresAt, words, tries, keyId, usedAt }
 *            "used" means the server says THIS message's code made a key
 *            (keyId, at usedAt); the card says "Connected" only once that
 *            key has itself been used.
 *   pending  the waiting message the server lists (after a reload), or null
 * Returns { state, tone, lines, showMessage, buttons }. `buttons` is never
 * empty unless the card is busy or offline says why: no state is a dead end.
 */
export function setupCardView({ agentId, activeKey: key = null, stoppedKey = null, local: held = null, pending = null, offline = false, idleDays = 90, now = Date.now(), os = "" }) {
  // A message this tab says was used, whose key is no longer the working one
  // (replaced or disconnected since), has nothing left to say.
  const local = held?.phase === "used" && (!key || key.key_id !== held.keyId) ? null : held;
  const def = agentDef(agentId) || AGENTS[0];
  const product = def.product;
  const status = agentStatus(key, agentId, now);
  const copy = { id: "copy", label: "Copy setup message", variant: "primary" };
  const copyNew = { id: "copy", label: "Copy a new setup message", variant: key ? "secondary" : "primary" };
  const disconnect = { id: "disconnect", label: "Disconnect", variant: "ghost" };
  const done = { id: "done", label: "Done", variant: "secondary" };
  const finish = (view) => ({
    ...view,
    status,
    buttons: view.buttons.map((b) => ({ ...b, disabled: offline && b.id !== "done" && b.id !== "keep" })),
    offlineWords: offline ? "You're offline. This works again once you're back." : "",
  });
  const phase = local?.phase || "";
  if (phase === "asking") {
    return finish({ state: "asking", tone: "info", lines: ["Making your setup message…"], showMessage: false, buttons: [{ ...copy, busy: true }] });
  }
  if (phase === "confirm") {
    return finish({
      state: "confirm",
      tone: "warning",
      lines: ["Your agent's current key keeps working until the new message is used. When it is, the old key stops at once."],
      showMessage: false,
      buttons: [copy, { id: "keep", label: "Keep", variant: "secondary" }],
    });
  }
  if (phase === "ready" || phase === "blocked") {
    const left = minutesLeftWords(local.expiresAt, now);
    const ends = `Works once. Stops working at ${clockWords(local.expiresAt)}${left ? ` (${left})` : ""}.`;
    // What was copied was for another computer than the one chosen now: the
    // card never says "Copied" over text the clipboard does not hold.
    if (phase === "ready" && os && local.copiedOs && local.copiedOs !== os) {
      const label = OS_OPTIONS.find((o) => o.value === os)?.label || "other";
      return finish({
        state: "changed",
        tone: "warning",
        lines: [`Your computer choice changed. Press Copy message to copy the ${label} version.`, ends, "Waiting for your agent…"],
        showMessage: true,
        buttons: [{ id: "again", label: "Copy message", variant: "primary" }, done],
      });
    }
    return finish({
      state: phase,
      tone: phase === "ready" ? "success" : "warning",
      lines:
        phase === "ready"
          ? [`Copied. Paste it into ${product} now.`, ends, "Waiting for your agent…"]
          : [
            local.tries > 0
              ? `Your browser still didn't copy it (tried ${local.tries + 1} times). The message below is selected: press Ctrl or Cmd + C now.`
              : "Your browser didn't copy it. Press Copy message, or Ctrl or Cmd + C.",
            ends,
            "Waiting for your agent…",
          ],
      showMessage: true,
      selectMessage: phase === "blocked",
      buttons: phase === "ready" ? [{ id: "again", label: "Copy again", variant: "secondary" }, done] : [{ id: "again", label: "Copy message", variant: "primary" }, done],
    });
  }
  if (phase === "used") {
    // The message was used: a key was made for this agent. Whether the agent
    // has it is known only once the key itself is used.
    if (status.state === "connected") {
      return finish({
        state: "used_connected",
        tone: "success",
        lines: [`Connected: ${product} is using its key. Ask it: What is on my plate in Mingla?`],
        showMessage: false,
        focus: "copy",
        buttons: [done],
      });
    }
    const usedAt = Date.parse(local.usedAt);
    if (Number.isFinite(usedAt) && now - usedAt >= SETUP_UNUSED_WARN_MS) {
      return finish({
        state: "used_unused",
        tone: "warning",
        lines: ["Your agent has not used the key yet. If it printed an error, copy a new setup message."],
        showMessage: false,
        buttons: [{ ...copyNew, variant: "primary" }, done],
      });
    }
    return finish({
      state: "used",
      tone: "info",
      lines: [
        `Your message was used: a key was made for ${product}. Your agent should have printed "Mingla added to ${product}."`,
        `Restart ${product}, then ask: What is on my plate in Mingla?`,
      ],
      showMessage: false,
      buttons: [done],
    });
  }
  if (phase === "superseded" || phase === "ended") {
    return finish({
      state: phase,
      tone: "warning",
      lines: [
        phase === "superseded"
          ? "A newer setup message was copied elsewhere; this one no longer works."
          : "This setup message no longer works: it was ended before it was used. Your agent is unchanged by it.",
      ],
      showMessage: false,
      focus: "copy",
      buttons: [{ ...copyNew, variant: "primary" }, done],
    });
  }
  if (phase === "expired") {
    return finish({
      state: "expired",
      tone: "warning",
      lines: ["That message has expired and can no longer be used. Your agent is unchanged."],
      showMessage: false,
      focus: "copy",
      buttons: [{ ...copyNew, variant: "primary" }],
    });
  }
  if (phase === "failed") {
    return finish({
      state: "failed",
      tone: "error",
      lines: [`No setup message was made, and nothing changed. ${local.words || ""}`.trim()],
      showMessage: false,
      buttons: [{ id: "copy", label: "Try again", variant: "primary" }],
    });
  }
  if (phase === "lost") {
    return finish({
      state: "lost",
      tone: "error",
      lines: ["We couldn't tell whether a setup message was made. Nothing has changed for your agent: a message only matters once it is used. Try again."],
      showMessage: false,
      buttons: [{ id: "copy", label: "Try again", variant: "primary" }],
    });
  }
  if (pending) {
    return finish({
      state: "pending",
      tone: "info",
      lines: [
        `A setup message was copied at ${clockWords(pending.created_at)} and has not been used. It stops working at ${clockWords(pending.expires_at)}. The message itself is not kept here.`,
      ],
      showMessage: false,
      buttons: key ? [copyNew, disconnect] : [{ ...copyNew, variant: "primary" }],
    });
  }
  if (key) {
    return finish({
      state: status.state === "connected" ? "connected" : "unused",
      tone: "default",
      lines:
        status.state === "connected"
          ? []
          : [`The key is in place but ${product} has not used it yet. Restart ${product}, then ask: What is on my plate in Mingla?`],
      showMessage: false,
      buttons: [copyNew, disconnect],
    });
  }
  return finish({
    state: stoppedKey ? "stopped" : "none",
    tone: "default",
    lines: stoppedKey ? [stoppedWords(stoppedKey, idleDays, now)] : [],
    showMessage: false,
    buttons: [copy],
  });
}

/**
 * What became of ONE setup message, by its own id, once the server's list of
 * setup messages is read. The answer is about that message and nothing else:
 * a key made any other way (by hand, in another tab) never counts as it
 * having been used.
 *   { verdict: "used", keyId, usedAt }  its code made a key
 *   { verdict: "superseded" }           ended, and a newer one exists for that agent
 *   { verdict: "ended" }                ended some other way (disconnected, refused)
 *   { verdict: "expired" }              its time ran out unused
 *   { verdict: "wait" }                 none of those yet
 * `setup` is the list from the server; `id` is the message's own id.
 */
export function setupVerdict({ setup, id, agentId, expiresAt, now = Date.now() }) {
  const rows = Array.isArray(setup) ? setup.filter((r) => r && typeof r === "object") : [];
  const mine = id ? rows.find((r) => r.id === id) : null;
  if (mine?.state === "used" && mine.key_id) return { verdict: "used", keyId: mine.key_id, usedAt: mine.used_at || null };
  const newer = rows.some(
    (r) => r.agent === agentId && r.id !== id && mine && String(r.created_at).localeCompare(String(mine.created_at)) > 0
  );
  if (mine?.state === "ended" || mine?.state === "used") return { verdict: newer ? "superseded" : "ended" };
  // A newer message for the same agent always ends this one, even if this
  // tab's own entry has not caught up.
  if (mine?.state === "waiting" && newer) return { verdict: "superseded" };
  const t = Date.parse(expiresAt);
  if (mine?.state === "expired" || !Number.isFinite(t) || now >= t) return { verdict: "expired" };
  return { verdict: "wait" };
}

/**
 * The timing behind every check the page repeats while something is on
 * screen. It ticks every `everyMs`, only while the page is visible and
 * online, for at most `forMs` (or until the clock reads `until`, which does
 * not move when the page draws again); then it calls `onEnd` once and stops. Going to
 * the background stops the timer; `visible()` (called when the page is shown
 * again) runs one check at once, unless told another read is already on its
 * way, and starts it again.
 * Everything it needs is passed in, so it runs under a fake clock.
 */
export function createWatch({ onTick, onEnd, everyMs = 5_000, forMs, until, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, isVisible = () => true, isOnline = () => true }) {
  const startedAt = now();
  if (Number.isFinite(until)) forMs = Math.max(0, until - startedAt);
  let timer = null;
  let stopped = false;
  const over = () => Number.isFinite(forMs) && now() - startedAt >= forMs;
  const end = () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    onEnd?.();
  };
  const arm = () => {
    if (stopped || timer !== null) return;
    if (!isVisible()) return;
    const left = Number.isFinite(forMs) ? Math.max(0, forMs - (now() - startedAt)) : everyMs;
    timer = setTimer(() => {
      timer = null;
      if (stopped) return;
      if (over()) return end();
      if (isVisible() && isOnline()) onTick();
      arm();
    }, Math.min(everyMs, left));
  };
  arm();
  return {
    /** The page was hidden: nothing runs until it is shown again. */
    hidden() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    /**
     * The page is shown again: one check at once, then the timer. Pass false
     * when something else already reads at that moment, so it is one read
     * and not two.
     */
    visible(readNow = true) {
      if (stopped) return;
      if (over()) return end();
      if (readNow && isOnline()) onTick();
      arm();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    get running() {
      return !stopped;
    },
  };
}
