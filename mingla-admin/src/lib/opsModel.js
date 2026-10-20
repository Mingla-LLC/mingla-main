// Issue #3980 — pure words and shapes for the Work board, the Agent log and
// To review. No React and no Supabase here, so every rule is testable alone.

export const WORK_STATUSES = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "Doing" },
  { value: "person", label: "Needs a person" },
  { value: "done", label: "Done" },
];

export const PERSON_REASONS = {
  send: "Sends a message",
  spend: "Spends money",
  publish: "Publishes an event",
  other: "Needs a person",
};

/**
 * #3980 W2 rework: why a card needs a person, in words. Bridge D's approval
 * card (a drafted "Recently shipped" roadmap card) is about what hosts are
 * told, not about publishing an event.
 */
export function personReasonLabel(card) {
  if (card?.auto_kind === "roadmap_shipped") return "Approve what hosts are told";
  return PERSON_REASONS[card?.person_reason] || "Needs a person";
}

export const PERSON_ACTIONS = {
  send: { action: "mark_sent", label: "Mark sent" },
  spend: { action: "approve_spend", label: "Approve spend" },
  publish: { action: "mark_published", label: "Mark published" },
};

/**
 * #3980 W2 rework 2: Bridge D's approval card asks a person to publish (or
 * archive) a drafted "Recently shipped" roadmap card. It is not an event, so
 * "Mark published" (which checks that an event is public) can never work
 * on it.
 */
export function isRoadmapApproval(card) {
  return card?.auto_kind === "roadmap_shipped";
}

/**
 * #3980 W3 rework 2: the cards Needs you › Spend or publish lists. For the
 * owner and admins (who have What hosts are told) a "Recently shipped"
 * wording card is listed only on that tab; anyone else on such a card still
 * reaches it here.
 */
export function spendQueueCards(cards, hideHostsTold = false) {
  return (Array.isArray(cards) ? cards : []).filter((c) => c && !(hideHostsTold && isRoadmapApproval(c)));
}

/**
 * The one-tap action a card waiting for a person offers, or null when it
 * offers Close with proof instead. A roadmap approval card closes itself
 * once its draft is published or archived in Community, Roadmap, and a
 * person can close it with proof.
 */
export function personActionFor(card) {
  if (isRoadmapApproval(card)) return null;
  return PERSON_ACTIONS[card?.person_reason] || null;
}

/** Community, Roadmap with the drafted card open, or null when the card links none. */
export function roadmapDraftHref(card) {
  const link = (card?.links || []).find((l) => l?.kind === "roadmap_card" && typeof l.id === "string" && l.id);
  return link ? `#/community-support?tab=roadmap&card=${encodeURIComponent(link.id)}` : null;
}

/** True only for a Community & Support address on its Roadmap tab. */
export function isRoadmapHash(hash) {
  const [path, query = ""] = String(hash || "").split("?");
  return path === "#/community-support" && new URLSearchParams(query).get("tab") === "roadmap";
}

/**
 * The roadmap card a Community, Roadmap address asks to open, or null. Only
 * #/community-support with tab=roadmap counts: the Work board and To review
 * also carry ?card= (a work card), and leaving Roadmap for them must not
 * look like a missing roadmap card.
 */
export function roadmapCardFromHash(hash) {
  if (!isRoadmapHash(hash)) return null;
  const id = new URLSearchParams(String(hash).split("?")[1] || "").get("card");
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * To review's groups, in order. Roadmap approvals have their own, and so do
 * cards that wait for a person to send a message (#3980 W2 rework 3: rework 2
 * had dropped them into "Other" with no Mark sent).
 */
export const REVIEW_GROUPS = [
  { id: "send", title: "Send a message" },
  { id: "spend", title: "Spend money" },
  { id: "publish", title: "Publish an event" },
  { id: "hosts", title: "What hosts are told" },
  { id: "other", title: "Other" },
];

/** Which To review group a card waiting for a person belongs to. */
export function reviewGroupOf(card) {
  if (isRoadmapApproval(card)) return "hosts";
  return ["send", "spend", "publish"].includes(card?.person_reason) ? card.person_reason : "other";
}

export const KIT_STEPS = [
  { value: -35, label: "T-35 · host materials in" },
  { value: -31, label: "T-31 · listing built and checked" },
  { value: -28, label: "T-28 · go-live gate" },
  { value: -26, label: "T-26 · content brief and creators" },
  { value: -21, label: "T-21 · giveaway and ads start" },
  { value: -14, label: "T-14 · creator posts" },
  { value: -7, label: "T-7 · reminder push" },
  { value: 2, label: "T+2 · recap" },
];

export const LINK_KINDS = [
  { value: "host", label: "Host" },
  { value: "creator", label: "Creator" },
  { value: "brand", label: "Brand" },
  { value: "event", label: "Event" },
  { value: "content", label: "Content" },
  { value: "expected", label: "Expected" },
];

/** The eleven rules every agent follows, as people read them. */
export const AGENT_RULES = [
  "Reads the agent log for the records it will touch, and checks the open claims, before any work.",
  "Claims every record it will change or message. A claim ends after 30 minutes without an update. Cards are not claimed: starting a card marks the agent as working on it for as long as it takes.",
  "Writes the plan on the card: each step names the connector tool that does it, or a person.",
  "After each step, reads the record back and marks the step done only if the change is really there.",
  "Never reports a step done that it could not do; it leaves it to a person with exact instructions.",
  "Closes a card only with proof of what it read back, or pushes it back as not needed or already done, with a reason.",
  "Never sends, spends money or publishes: it sets the card to Needs a person and stops.",
  "Cannot write to someone Mingla messaged in the last 3 days, unless a person allows one more.",
  "Closing or pushing back releases its claims; it releases any other claim when it stops.",
  "Names its chat, so claims and the log show which chat did what. Two chats on one key never write over each other.",
  "Logs its operations work on the Work board: a card at the start, each step as it goes, and proof (with PR and merge links for code) when it closes.",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A date as "22 Oct" (from "2026-10-22" or a date-time). */
export function dayLabel(value) {
  if (typeof value !== "string") return "";
  const m = value.slice(0, 10).match(DATE_RE);
  if (!m) return "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ""}`.trim();
}

/** A date-time as HH:MM in the browser's own zone. */
export function timeLabel(value) {
  const t = Date.parse(value || "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today in the browser's own zone, as YYYY-MM-DD. */
export function todayIso(now = new Date()) {
  return isoDate(now);
}

export function addDays(value, days) {
  const m = typeof value === "string" ? value.match(DATE_RE) : null;
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return isoDate(d);
}

/** The Monday of the week holding this date. */
export function mondayOf(value) {
  const m = typeof value === "string" ? value.match(DATE_RE) : null;
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dow = (d.getDay() + 6) % 7;
  return addDays(value, -dow);
}

/** "Sprint 19 to 25 Oct", or "Sprint 27 Oct to 2 Nov" across months. */
export function sprintLabel(startsOn) {
  const end = addDays(startsOn, 6);
  if (!end) return "Sprint";
  const [, , , sd] = startsOn.match(DATE_RE);
  const sameMonth = startsOn.slice(5, 7) === end.slice(5, 7);
  return sameMonth ? `Sprint ${Number(sd)} to ${dayLabel(end)}` : `Sprint ${dayLabel(startsOn)} to ${dayLabel(end)}`;
}

/**
 * "Seth's Claude" for an agent, "Seth's Claude (Hosts sweep)" when the chat
 * has a name, "Seth" for a person.
 */
export function agentName(name, via, chatLabel) {
  const who = typeof name === "string" && name.trim() ? name.trim() : "A teammate";
  const chat = typeof chatLabel === "string" && chatLabel.trim() ? ` (${chatLabel.trim()})` : "";
  if (via === "claude") return `${who}'s Claude${chat}`;
  if (via === "codex") return `${who}'s Codex${chat}`;
  if (via === "system") return "Mingla";
  return who;
}

/** The words a GitHub link may not break: the same rule as ops_github_parse. */
export const GITHUB_LINK_WORDS =
  "GitHub link must be an issue or pull request of Mingla-LLC/mingla-main, like #3980 or https://github.com/Mingla-LLC/mingla-main/pull/3991.";

/**
 * #3980, 3980, or an issue or pull request address of Mingla-LLC/mingla-main.
 * { kind, number } or { error }. Mirrors ops_github_parse on the server.
 */
export function parseGithubInput(value) {
  const v = String(value ?? "").trim();
  let m = /^#?([0-9]{1,7})$/.exec(v);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 ? { kind: "issue", number: n } : { error: GITHUB_LINK_WORDS };
  }
  m = /^https:\/\/github\.com\/Mingla-LLC\/mingla-main\/(issues|pull)\/([0-9]{1,7})\/?([?#].*)?$/.exec(v);
  if (m) {
    const n = Number(m[2]);
    if (n >= 1) return { kind: m[1] === "pull" ? "pull" : "issue", number: n };
  }
  return { error: GITHUB_LINK_WORDS };
}

/** "#3980 · In Progress": the chip of a linked GitHub issue or pull request. */
export function githubChipWords(status) {
  const n = Number(status?.number);
  const label = typeof status?.label === "string" && status.label ? status.label : "Checking GitHub";
  return Number.isInteger(n) && n > 0 ? `#${n} · ${label}` : label;
}

/**
 * #3980 Wave 2: the tone of a GitHub status chip (D-15 words). Planned and
 * Closed neutral, In Progress and Open info, In Review warning, Shipped and
 * Merged brand, Live success, Not on GitHub error, Checking GitHub a dashed
 * outline.
 */
const GITHUB_CHIP_TONES = {
  Planned: "neutral", "In Progress": "info", "In Review": "warning", Shipped: "brand", Live: "success",
  "Not on GitHub": "error", "Checking GitHub": "checking", Open: "info", Merged: "brand", Closed: "neutral",
};
export function githubChipTone(label) {
  return GITHUB_CHIP_TONES[label] || "checking";
}
const GITHUB_CHIP_CLASSES = {
  neutral: "bg-[var(--gray-100)] text-[var(--gray-700)]",
  info: "bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  warning: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  brand: "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
  success: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
  error: "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
  checking: "border border-dashed border-[var(--gray-400)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)]",
};
/** The chip's colour classes (tokens only, light and dark). */
export function githubChipClass(label) {
  return GITHUB_CHIP_CLASSES[githubChipTone(label)];
}

/** "Next (Horizon Next)": GitHub's lane suggestion for a roadmap card, in words. */
export function roadmapSuggestionWords(suggestion) {
  const lanes = { now: "Now", next: "Next", later: "Later", shipped: "Recently shipped" };
  const lane = lanes[suggestion?.lane];
  if (!lane) return "";
  const reason = typeof suggestion?.reason === "string" ? suggestion.reason.replace(/^GitHub: /, "").trim() : "";
  return reason ? `${lane} (${reason})` : lane;
}

/** "Waiting for #3980 to be Live": the card waits for its GitHub links. */
export function githubWaitWords(links) {
  const numbers = (Array.isArray(links) ? links : []).map((g) => Number(g?.number)).filter((n) => Number.isInteger(n) && n > 0);
  if (numbers.length === 0) return "";
  return `Blocked until ${numbers.map((n) => `#${n}`).join(", ")} ${numbers.length > 1 ? "are" : "is"} Live`;
}

/**
 * #3980 W2 rework: is the "Blocked until #n is Live" switch offered? Always
 * while the card waits (so a person can switch it off); otherwise only when
 * at least one linked issue or pull request is not Live yet: waiting for
 * what is already Live would unblock at once.
 */
export function githubWaitOffered(card) {
  if (card?.blocked && card?.blocked_kind === "github") return true;
  const links = (Array.isArray(card?.github) ? card.github : []).filter((g) => Number.isInteger(Number(g?.number)) && Number(g?.number) > 0);
  return links.some((g) => g?.live !== true && g?.label !== "Live");
}

/** "2 h ago", "3 days ago": how long since an agent last updated a card. */
export function sinceWords(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const minutes = Math.max(0, Math.round((now - t) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** "● Seth's Claude (Hosts sweep) is on it · last update 2 h ago", or quiet. */
export function workingWords(working, now = Date.now()) {
  if (!working || typeof working !== "object") return "";
  const who = typeof working.name === "string" && working.name ? working.name : "An agent";
  if (working.quiet) {
    const quietFor = sinceWords(working.last_update_at, now).replace(/ ago$/, "");
    return `${who} is on it · quiet for ${quietFor}`;
  }
  return `${who} is on it · last update ${sinceWords(working.last_update_at, now)}`;
}

/**
 * The lower-case names more than one teammate has, across every list given
 * (two "Debrah"s, or an email-derived name that matches a chosen one). A
 * picker shows the email next to each of those names so they can be told
 * apart.
 */
export function sharedNames(...lists) {
  const byName = new Map();
  for (const list of lists) {
    for (const p of Array.isArray(list) ? list : []) {
      const name = String(p?.name ?? "").trim().toLowerCase();
      const email = String(p?.email ?? "").trim().toLowerCase();
      if (!name || !email) continue;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(email);
    }
  }
  return new Set([...byName].filter(([, emails]) => emails.size > 1).map(([name]) => name));
}

/** "Debrah", or "Debrah (debrah@x.com)" when another teammate is also Debrah. */
export function personLabel(person, shared) {
  const name = String(person?.name ?? "").trim() || String(person?.email ?? "");
  return shared?.has(name.toLowerCase()) && person?.email ? `${name} (${person.email})` : name;
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const GROUPS = ["status", "person", "event"];
export const WHO = ["all", "mine", "watching"];

/** The Work board's address: card, group, who, week and the add form. */
export function parseWorkSearch(search) {
  const p = new URLSearchParams(typeof search === "string" ? search : "");
  const card = p.get("card");
  const week = p.get("week");
  return {
    card: card && UUID_RE.test(card) ? card : null,
    cardInvalid: card !== null && !UUID_RE.test(card),
    group: GROUPS.includes(p.get("group")) ? p.get("group") : "status",
    who: WHO.includes(p.get("who")) ? p.get("who") : "all",
    week: week && DATE_RE.test(week) ? mondayOf(week) : null,
    add: p.get("add") === "1",
  };
}

export function buildWorkSearch(state) {
  const p = new URLSearchParams();
  if (state.card) p.set("card", state.card);
  if (state.group && state.group !== "status") p.set("group", state.group);
  if (state.who && state.who !== "all") p.set("who", state.who);
  if (state.week) p.set("week", state.week);
  if (state.add) p.set("add", "1");
  return p.toString();
}

export function parseLogSearch(search) {
  const p = new URLSearchParams(typeof search === "string" ? search : "");
  return { who: p.get("who") === "mine" ? "mine" : "all" };
}

export function parseReviewSearch(search) {
  const p = new URLSearchParams(typeof search === "string" ? search : "");
  const card = p.get("card");
  const tab = p.get("tab");
  return { tab: tab === "spend" ? "spend" : tab === "told" ? "told" : "messages", card: card && UUID_RE.test(card) ? card : null };
}

/** Runway words in the four plain states, with how many days an event was public before it starts. */
export function runwayLabel(runway) {
  const band = runway?.band;
  const lead = Number(runway?.lead_days);
  if (band === "full") return `Ready to promote · live ${lead} days ahead`;
  if (band === "tight") return `Promote now · live ${lead} days ahead`;
  if (band === "organic") return `Too late for promo · live ${lead} days ahead`;
  if (band === "not_live") return `Not live yet · go live by ${dayLabel(runway?.go_live_by)}`;
  if (band === "missed") return "Too late for promo · not live by the 3-week line";
  return "No date yet";
}

/** The colour family a band is shown in. */
export function bandTone(band) {
  if (band === "full") return "success";
  if (band === "tight") return "warning";
  if (band === "organic" || band === "missed") return "error";
  if (band === "not_live") return "info";
  return "default";
}

const ERROR_WORDS = {
  network: "You’re offline. Reconnect and try again.",
  stale_write: "This card changed. Showing the latest.",
  not_found: "That card isn’t here any more.",
  forbidden: "Your account can’t do this.",
  signed_out: "You’ve been signed out. Sign in again.",
  not_ready: "This part of Mingla isn’t ready yet. Try again shortly.",
  undo_expired: "That change can no longer be undone.",
  try_again: "That didn’t save. Try again.",
};

/** Words for a refusal. Server words are already written for people. */
export function opsErrorWords(error) {
  const token = typeof error?.token === "string" ? error.token : "";
  if (token === "invalid_card" && Array.isArray(error?.fixes) && error.fixes.length) {
    return error.fixes.map((f) => f.message).join(" ");
  }
  if (Object.hasOwn(ERROR_WORDS, token) && token !== "forbidden") return ERROR_WORDS[token];
  if (typeof error?.message === "string" && /\s/.test(error.message)) return error.message;
  if (token === "forbidden") return ERROR_WORDS.forbidden;
  return "That didn’t work. Try again, and if it keeps happening tell an admin.";
}

export function requestKey(prefix = "web") {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now()}${Math.random()}`.replace(/\D/g, "");
  return `${prefix}_${random}`.slice(0, 70).padEnd(8, "0");
}

export function agentPromptFor(card) {
  const title = typeof card?.title === "string" ? card.title : "";
  return `Do card "${title}" (Card ${card?.number ?? "?"}) in Mingla. Check the agent log first, claim it, follow the instructions, and close it with proof or push back with a reason.`;
}

const LOG_ACTIONS = {
  card_added: "added a card",
  card_refused: "was refused a card",
  claimed: "claimed",
  claim_refused: "could not claim",
  released: "released a claim",
  claim_expired: "let a claim end",
  step: "posted a step",
  started: "started",
  updated: "updated",
  blocked: "marked blocked",
  unblocked: "unblocked",
  needs_person: "asked for a person",
  closed: "closed",
  pushed_back: "pushed back",
  reopened: "reopened",
  gate_closed: "closed a go-live gate",
  gate_override: "overrode a block",
  write_stopped: "was stopped",
  draft_stopped: "was stopped from writing a message",
  person_changed_claimed: "changed a claimed record",
  expected_set: "set an expected event",
  launch_planned: "planned a launch",
  contact_override: "allowed one more message",
  converted: "turned next steps into cards",
  archived: "removed a card",
  took_over: "took over a quiet card",
  working_cleared: "ended a working mark",
  chat_named: "named its chat",
  auto_added: "added a card by itself",
  auto_closed: "closed a card by itself",
  auto_redated: "moved a card's date",
  release_record: "read a release record",
  guide_live: "turned a Feature Guide entry Live",
  guide_incomplete: "left a Feature Guide entry as it was",
  brand_linked: "linked a brand",
  brand_card_added: "added a host card for a brand",
  sprint_moved: "moved a card to this week",
  setting_changed: "changed a setting",
};

export function logActionWords(action) {
  return LOG_ACTIONS[action] || "did something";
}

/** The chip on a log row. */
export function logChip(entry) {
  if (entry?.outcome === "stopped") return { label: "Stopped", tone: "error" };
  if (["closed", "pushed_back", "gate_closed"].includes(entry?.action)) return { label: "Closed", tone: "success" };
  if (["claimed", "started", "step", "updated"].includes(entry?.action)) return { label: "Working", tone: "default" };
  if (entry?.action === "card_added") return { label: "Added", tone: "brand" };
  return { label: "Info", tone: "info" };
}

export function closeKindLabel(kind) {
  if (kind === "already_done") return "Closed: already done";
  if (kind === "declined") return "Declined";
  if (kind === "system") return "Closed by Mingla";
  return "Done";
}

export function proofBadge(item) {
  if (item?.verified) return "Checked by Mingla";
  return item?.by_agent ? "Agent's word" : "Person's note";
}

const STATUS_ORDER = ["todo", "doing", "person", "done"];

/** Cards grouped for the board: by status, by owner or by event. */
export function groupCards(cards, group) {
  const list = Array.isArray(cards) ? cards : [];
  if (group === "person") {
    const by = new Map();
    for (const card of list) {
      const owners = Array.isArray(card.owners) && card.owners.length ? card.owners : [{ email: "", name: "No owner" }];
      for (const o of owners) {
        const key = o.email || "none";
        if (!by.has(key)) by.set(key, { key, title: o.name || o.email || "No owner", cards: [] });
        by.get(key).cards.push(card);
      }
    }
    return [...by.values()].sort((a, b) => a.title.localeCompare(b.title));
  }
  if (group === "event") {
    const by = new Map();
    for (const card of list) {
      const a = card.anchor;
      const key = a?.id ? `${a.kind}:${a.id}` : "none";
      const title = a?.id ? `${a.title}${a.start_on ? ` · ${dayLabel(a.start_on)}` : ""}` : "No event";
      if (!by.has(key)) by.set(key, { key, title, sort: a?.start_on || "9999", cards: [] });
      by.get(key).cards.push(card);
    }
    return [...by.values()].sort((a, b) => (a.key === "none") - (b.key === "none") || a.sort.localeCompare(b.sort));
  }
  return STATUS_ORDER.map((status) => ({
    key: status,
    title: status === "done" ? "Done this week" : WORK_STATUSES.find((s) => s.value === status).label,
    cards: list.filter((card) => card.status === status),
  }));
}

/** Mention candidates for "@" text: active teammates whose name starts with what was typed. */
export function mentionMatches(team, typed) {
  const q = String(typed || "").toLowerCase();
  return (Array.isArray(team) ? team : []).filter((p) => !q || String(p.name || "").toLowerCase().startsWith(q) || String(p.email || "").startsWith(q)).slice(0, 6);
}

/** The text the mention picker puts in a note for one teammate. */
export function mentionToken(person) {
  return `@${String(person?.name || person?.email || "").trim()}`;
}

const lower = (value) => String(value || "").trim().toLowerCase();
const localPart = (email) => String(email || "").trim().split("@")[0];
// "alex.kim@x" -> "Alex Kim"; null when the address holds one word only.
function fullNameFromEmail(email) {
  const words = localPart(email).split(/[._+-]+/).filter(Boolean);
  if (words.length < 2) return null;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * The mention text for one teammate, unique across the team: "@Name" when
 * nobody else has that name, else "@Alex Kim" (the full name from the
 * address), else the address's local part ("@alex.kim"), else the whole
 * address. Two teammates never get the same mention text.
 */
export function mentionTokenFor(person, team) {
  const email = lower(person?.email);
  const others = (Array.isArray(team) ? team : []).filter((p) => lower(p?.email) && lower(p?.email) !== email);
  const name = String(person?.name || "").trim();
  if (name && !others.some((p) => lower(p.name) === lower(name))) return `@${name}`;
  const full = fullNameFromEmail(email);
  if (full && !others.some((p) => lower(p.name) === lower(full) || lower(fullNameFromEmail(p.email)) === lower(full))) return `@${full}`;
  const local = localPart(email);
  if (local && !others.some((p) => lower(localPart(p.email)) === lower(local))) return `@${local}`;
  return `@${email || name}`;
}

const pickToken = (p) => String(p?.token || mentionToken(p));
function tokenCount(token, text) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (String(text || "").match(new RegExp(`(?:^|\\s)${escaped}(?![\\w.@-]*[\\w@])`, "g")) || []).length;
}

/**
 * The picks still in a note after an edit: a pick whose mention text is no
 * longer in the text (as a whole token) is dropped at once, so typing the
 * same name back by hand never tells that person.
 */
export function keepPicksInText(picks, body) {
  return (Array.isArray(picks) ? picks : []).filter((p) => pickToken(p) !== "@" && tokenCount(pickToken(p), body) > 0);
}

/**
 * The emails to tell about a note: only teammates picked from the mention
 * list (each pick carries its email and its mention text), and only while
 * that mention text is still in the note as a whole token. Names typed by
 * hand never match. Mention text is unique per teammate (mentionTokenFor);
 * if two different people still share one text and fewer copies are left
 * than people, nobody behind that text is told, because Mingla cannot know
 * which one was taken out.
 */
export function mentionedEmails(picks, body) {
  const text = String(body || "");
  const byToken = new Map();
  for (const p of Array.isArray(picks) ? picks : []) {
    const email = String(p?.email || "").trim().toLowerCase();
    const token = pickToken(p);
    if (!email || token === "@") continue;
    if (!byToken.has(token)) byToken.set(token, []);
    if (!byToken.get(token).includes(email)) byToken.get(token).push(email);
  }
  const out = [];
  for (const [token, emails] of byToken) {
    const count = tokenCount(token, text);
    if (count === 0 || count < emails.length) continue;
    for (const email of emails) if (!out.includes(email)) out.push(email);
  }
  return out;
}

/** What a plan step may name as the thing that does it. */
export const PLAN_TOOLS = [
  "person", "get_started", "my_day", "find_records", "get_record", "check_names", "find_mingla_link", "check_contactable",
  "list_beta_leads", "team_summary", "add_records", "upsert_record", "update_records", "move_stage", "set_owners",
  "log_activity", "record_reply", "save_drafts", "update_draft", "list_drafts", "withdraw_drafts",
  "list_content", "add_content", "update_content", "assign_content", "comment_content", "move_content",
  "read_log", "claim", "release", "plan_work", "add_work", "start_work", "update_work", "close_work", "push_back",
  "list_work", "my_work", "list_calendar", "runway_report", "set_expected_event",
];

const EVENT_WORDS = {
  added: "added the card",
  updated: "changed the card",
  started: "started",
  status: "changed the status",
  blocked: "marked it blocked",
  unblocked: "unblocked it",
  closed: "closed it",
  pushed_back: "pushed it back",
  reopened: "reopened it",
  note: "wrote a note",
  people: "changed owners or watchers",
  links: "changed links",
  plan: "changed the plan",
  gate_closed: "closed the gate",
  gate_override: "overrode the block",
  carried: "carried it into this sprint",
  re_anchored: "moved it to the real event",
  undone: "undid a change",
  archived: "removed it",
  took_over: "took it over",
  working_cleared: "ended the working mark",
  auto_closed: "closed it by itself",
  redated: "moved its date",
  sprint_moved: "moved it to this week",
  github: "changed GitHub links",
};

export function eventWords(action) {
  return EVENT_WORDS[action] || "changed it";
}

// ---------------------------------------------------------------------------
// Wave 2 — the Calendar layers, runway words and the launch kit rows.
// ---------------------------------------------------------------------------

/** The Calendar's layers, in order, with the swatch each one is drawn in. */
export const CALENDAR_LAYERS = [
  { id: "live", label: "On Mingla", swatch: "bg-[var(--color-success-600)]" },
  { id: "exp", label: "Expected", swatch: "border-[1.5px] border-dashed border-[var(--gray-400)] bg-transparent" },
  { id: "dead", label: "Go-live deadlines", swatch: "bg-[var(--color-info-600)]" },
  { id: "promo", label: "Promotions", swatch: "bg-[var(--color-brand-600)]" },
  { id: "content", label: "Content", swatch: "bg-[var(--gray-500)]" },
];
const LAYER_IDS = CALENDAR_LAYERS.map((l) => l.id);

/** `layers=live,exp` → which layers are on. Absent (or nothing valid) = all on. */
export function parseLayers(value) {
  const on = Object.fromEntries(LAYER_IDS.map((id) => [id, true]));
  if (typeof value !== "string") return on;
  const picked = value.split(",").map((s) => s.trim()).filter((s) => LAYER_IDS.includes(s));
  if (value.trim() === "") return on;
  if (value === "none") return Object.fromEntries(LAYER_IDS.map((id) => [id, false]));
  if (!picked.length) return on;
  return Object.fromEntries(LAYER_IDS.map((id) => [id, picked.includes(id)]));
}

/** The URL value for these layers: null when all are on, "none" when none are. */
export function buildLayers(on) {
  const picked = LAYER_IDS.filter((id) => on?.[id]);
  if (picked.length === LAYER_IDS.length) return null;
  return picked.length ? picked.join(",") : "none";
}

/** The short band label on chips and buttons: one of the four plain states. */
export function bandShort(runway) {
  const band = runway?.band;
  if (band === "full") return "Ready to promote";
  if (band === "tight") return "Promote now";
  if (band === "organic") return "Too late for promo";
  if (band === "not_live") return `Not live yet, live by ${dayLabel(runway?.go_live_by)}`;
  if (band === "missed") return "Too late for promo";
  return "No date yet";
}

/** `event=event:<id>` or `event=expected:<id>` → { kind, id }, else null. */
export function parseEventParam(value) {
  const m = typeof value === "string" ? value.match(/^(event|expected):([0-9a-f-]{36})$/i) : null;
  return m && UUID_RE.test(m[2]) ? { kind: m[1].toLowerCase(), id: m[2].toLowerCase() } : null;
}

export const EVENT_TYPE_LABELS = { event: "Event", experience: "Experience", trip: "Trip", rsvp: "RSVP", promo_moment: "Promo moment" };
export const KIT_WHO = { host_owner: "Host owner", marketing: "Sales and marketing" };

/** The state chip of one launch kit row: its words and colour. */
export function kitStateChip(row) {
  const state = row?.state;
  if (state === "card" || (state === "done" && row?.card)) {
    const card = row.card || {};
    if (card.status === "done") return { label: "Done", tone: "success" };
    if (card.blocked) return { label: "Blocked", tone: "error" };
    const status = WORK_STATUSES.find((s) => s.value === card.status);
    return { label: status ? status.label : "Card", tone: card.status === "person" ? "warning" : "brand" };
  }
  if (state === "done") return { label: "Done", tone: "success" };
  if (state === "not_eligible") return { label: "Not eligible", tone: "error" };
  if (state === "passed") return { label: "Passed", tone: "default" };
  return { label: "No card", tone: "default" };
}

function daysBetween(from, to) {
  const a = typeof from === "string" ? from.match(DATE_RE) : null;
  const b = typeof to === "string" ? to.match(DATE_RE) : null;
  if (!a || !b) return null;
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86_400_000);
}

/**
 * The runway bar: a track from 42 days before the start to 2 days after,
 * ticks for T-28 (live), T-21 (promo), the event and today, and a fill from
 * the day it went public to the start. Positions are percentages, 0 to 100.
 */
export function runwayBarModel(anchor, today) {
  const start = typeof anchor?.start_on === "string" ? anchor.start_on.slice(0, 10) : null;
  if (!start) return null;
  const from = addDays(start, -42);
  const span = 44;
  const pos = (day) => {
    const d = daysBetween(from, day);
    return d === null ? null : Math.max(0, Math.min(100, (d / span) * 100));
  };
  const published = anchor?.is_public && typeof anchor?.published_at === "string" ? anchor.published_at.slice(0, 10) : null;
  const fillFrom = published ? pos(published) : null;
  const end = pos(start);
  return {
    ticks: [
      { key: "live", label: "T-28 live", at: pos(addDays(start, -28)) },
      { key: "promo", label: "T-21 promo", at: pos(addDays(start, -21)) },
      { key: "event", label: "Event", at: end },
      { key: "today", label: "Today", at: pos(today), brand: true },
    ],
    fill: fillFrom === null ? null : { left: fillFrom, width: Math.max(0, end - fillFrom), tone: bandTone(anchor?.runway?.band) },
  };
}

/** Proof lines typed by a person, as proof items (3 characters or more each). */
export function proofFromLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((t) => String(t ?? "").trim())
    .filter((t) => t.length >= 3)
    .map((text) => ({ kind: "text", text }));
}

// ---------------------------------------------------------------------------
// Wave 3 — the launch kit, the giveaway and ads rule, the Team dashboard and
// turning next steps into cards.
// ---------------------------------------------------------------------------

const KIT_SKIP_WORDS = {
  card_exists: "Already has a card",
  already_public: "Done: the event is public",
  date_passed: "Its day has passed",
  no_date: "The event has no date yet",
};

/** Why a launch kit step was not proposed, in words. */
export function kitSkipWords(reason) {
  return KIT_SKIP_WORDS[reason] || "Not proposed";
}

/** What a launch kit preview proposes, for the panel's words and button. */
export function kitPlanSummary(preview) {
  const cards = Array.isArray(preview?.cards) ? preview.cards : [];
  const skipped = Array.isArray(preview?.skipped) ? preview.skipped : [];
  const promoHeld = !!preview?.promo_gate?.blocked && cards.some((c) => c?.kind === "promo");
  return {
    count: cards.length,
    skipped: skipped.length,
    promoHeld,
    addLabel: cards.length === 1 ? "Add 1 card" : `Add ${cards.length} cards`,
  };
}

/** After an add: how many went on the board, and the ones that did not, with their fixes. */
export function addResultSummary(answer) {
  const results = Array.isArray(answer?.results) ? answer.results : [];
  const added = Number(answer?.added || 0);
  const problems = results
    .filter((r) => r?.status === "refused" || r?.status === "duplicate")
    .map((r) => ({
      index: r.index,
      title: typeof r.title === "string" ? r.title : "",
      messages: r.status === "duplicate"
        ? [typeof r.message === "string" ? r.message : "An open card already does this."]
        : (Array.isArray(r.fixes) ? r.fixes : []).map((f) => f?.message).filter((m) => typeof m === "string"),
    }));
  return { added, problems, toast: added === 1 ? "1 card added. Owners were told." : `${added} cards added. Owners were told.` };
}

const CONVERSION_ISSUES = {
  no_owner: { label: "No owner", tone: "warning" },
  already_converted: { label: "Already converted", tone: "default" },
  duplicate_title: { label: "Same title as an open card", tone: "error" },
  duplicate_record: { label: "Same name and next step as another record", tone: "default" },
  too_short: { label: "Next step too short", tone: "error" },
};

/** The chip for a next step that cannot simply be converted. */
export function conversionIssue(issue) {
  return issue ? CONVERSION_ISSUES[issue] || { label: "Cannot convert", tone: "error" } : null;
}

/** The words for the last convert: added, skipped (already a card) and not converted. */
export function conversionResultWords(result) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return `Last convert: ${n(result?.added)} added, ${n(result?.skipped)} skipped because they are already a card, ${n(result?.refused)} not converted.`;
}

/** A row can be picked when it is ready, or has no owner and a fallback owner is chosen. */
export function conversionSelectable(row, fallbackOwner) {
  if (!row) return false;
  if (!row.issue) return true;
  return row.issue === "no_owner" && typeof fallbackOwner === "string" && fallbackOwner.length > 0;
}

export const HOSTS_WITHOUT_OWNER_PROMPT =
  "Give every host card that has no owner an owner by city and ICP: find_records for hosts with no owner, then set_owners. Tell me who you assigned.";

/** "N host cards have no owner…", or nothing when every host card has one. */
export function hostsWithoutOwnerWords(count) {
  const n = Number(count || 0);
  if (n <= 0) return "";
  return `${n} host ${n === 1 ? "card has" : "cards have"} no owner. Work cannot be assigned to ${n === 1 ? "it" : "them"}.`;
}

/** Open cards first by due date, at most `limit`. */
export function dueOrder(cards, limit) {
  const list = (Array.isArray(cards) ? cards : []).filter((c) => c && c.status !== "done");
  list.sort((a, b) => String(a.due_on || "").localeCompare(String(b.due_on || "")) || Number(a.number || 0) - Number(b.number || 0));
  return typeof limit === "number" ? list.slice(0, limit) : list;
}

// ---------------------------------------------------------------------------
// #3980 synced program, Wave 3 — the operations redesign.
// ---------------------------------------------------------------------------

/** The four plain states (and Happened, and No next event), as the server names them. */
export const PLAIN_STATES = {
  ready: "Ready to promote",
  short: "Promote now",
  late: "Too late for promo",
  notlive: "Not live yet",
  done: "Happened",
  none: "No next event",
  nodate: "No date yet",
};
export const STATE_LEGEND = ["ready", "short", "late", "notlive"];

/** The words of a state the server sent ({k, name}), falling back to the plain map. */
export function stateName(state) {
  if (!state || typeof state !== "object") return "";
  return String(state.name || PLAIN_STATES[state.k] || "");
}

/** "Get it live by 1 Nov" style tail for a not-live state. */
export function stateLine(state) {
  const name = stateName(state);
  if (state?.k === "notlive" && state.by) return `${name}, live by ${dayLabel(state.by)}`;
  return name;
}

/** "Tue 20 Oct". */
export function dayLong(value) {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Work tab and Needs attention group in the Work page address. */
export const WORK_TABS = ["board", "attention", "activity"];
export const ATTENTION_GROUPS = [
  { key: "noowner", label: "No owner" },
  { key: "overdue", label: "Overdue" },
  { key: "missing", label: "Missing info" },
  { key: "stuck", label: "Stuck" },
  { key: "nonext", label: "No next event" },
  { key: "engineering", label: "Engineering" },
];

export function parseWorkTab(search) {
  const p = new URLSearchParams(typeof search === "string" ? search : "");
  const tab = p.get("tab");
  const att = p.get("att");
  return {
    tab: WORK_TABS.includes(tab) ? tab : "board",
    att: ATTENTION_GROUPS.some((g) => g.key === att) ? att : null,
  };
}

/** The Work board's four columns. "Done this week" holds cards closed since Monday. */
export const WORK_COLUMNS = [
  { key: "person", label: "Needs you" },
  { key: "todo", label: "To do" },
  { key: "doing", label: "In progress" },
  { key: "done", label: "Done this week" },
];

/** #3980 W3 rework 2: a card's status in words, for Group by Person or Event. */
export function workStatusLabel(status) {
  return { person: "Needs you", todo: "To do", doing: "In progress", done: "Done" }[status] || "";
}

export function columnCards(cards, key, today = todayIso()) {
  const monday = mondayOf(today);
  return (Array.isArray(cards) ? cards : []).filter((c) => {
    if (key === "done") return c.status === "done" && (!c.closed_at || String(c.closed_at).slice(0, 10) >= monday);
    return c.status === key;
  });
}

/** Red reason badges on a work card: No owner, Overdue <n>d, No update for <n>d. */
export function cardReasons(card, now = Date.now()) {
  const out = [];
  if (!card || card.status === "done") return out;
  if (card.status !== "person" && !(card.owners || []).length) out.push("No owner");
  if (card.due_on) {
    const days = Math.round((new Date(`${todayIso(new Date(now))}T00:00:00Z`) - new Date(`${String(card.due_on).slice(0, 10)}T00:00:00Z`)) / 86_400_000);
    if (days > 0) out.push(`Overdue ${days}d`);
  }
  if (card.status === "doing" && card.working?.last_update_at) {
    const quiet = Math.floor((now - new Date(card.working.last_update_at).getTime()) / 86_400_000);
    if (quiet >= 7) out.push(`No update for ${quiet}d`);
  }
  return out;
}

/** Red reason badges on a host card: No owner; Missing type, region, contact. */
export function hostReasons(record, missing = []) {
  const out = [];
  if (record && !(record.owners || []).length && record.stage !== "lost") out.push("No owner");
  if (missing.length) out.push(`Missing ${missing.join(", ")}`);
  return out;
}

/** What a host card is missing, in the words of the screens. */
export function hostMissing(record) {
  if (!record) return [];
  const out = [];
  if (!String(record.icp || "").trim()) out.push("type");
  if (!record.region_id) out.push("region");
  const hasContact = String(record.contact || "").trim() || (Array.isArray(record.identifiers) && record.identifiers.length);
  if (!hasContact) out.push("contact");
  return out;
}

/** The Hosts board's two toggle filters. */
export const HOST_FILTERS = [
  { value: "nonext", label: "No next event" },
  { value: "soon", label: "Go live soon" },
];

/** Does a host pass the filter (from its ops_host_next row)? */
export function hostPassesFilter(row, filter, today = todayIso()) {
  if (!filter) return true;
  if (!row) return false;
  if (filter === "nonext") return !!row.needs_next;
  if (filter === "soon") {
    const st = row.next?.state;
    if (!st || st.k !== "notlive" || !st.by) return false;
    return st.by <= addDays(today, 14);
  }
  return true;
}

export const REPEAT_OPTIONS = [
  { value: "none", label: "Does not repeat" },
  { value: "week", label: "Every week" },
  { value: "month", label: "Every month" },
];

/** The prompt "Ask my agent to fix these" copies for one Needs attention group. */
export function attentionPrompt(groupLabel) {
  return `Fix every item under Needs attention in Mingla Work: ${groupLabel}. Ask me before assigning owners.`;
}

/** Each Needs attention group's count: the length of the list the server sent. */
export function attentionCounts(data) {
  const groups = data?.groups || {};
  return Object.fromEntries(ATTENTION_GROUPS.map((g) => [g.key, Array.isArray(groups[g.key]) ? groups[g.key].length : 0]));
}

/**
 * Issue #3980 W3 rework (D4): the upcoming rows of a host card, soonest
 * first. A repeating series lists every one of its kept dates that is not
 * yet stood for by a public event (those show as the event itself), each as
 * "<title>, 31 Oct" with its own state; a one-off promise is one row.
 */
export function hostUpcomingRows(events, openExpected, today) {
  const rows = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e?.start_on || (today && e.start_on < today)) continue;
    rows.push({ key: `e-${e.id}`, kind: "event", id: e.id, title: e.title, on: e.start_on, state: e.state, repeats: false, moment: false });
  }
  for (const x of Array.isArray(openExpected) ? openExpected : []) {
    if (!x) continue;
    const repeats = !!x.repeats && x.repeats !== "none";
    const occ = repeats && Array.isArray(x.occurrences) ? x.occurrences.filter((o) => o && o.on && !o.live) : null;
    if (occ) {
      occ.forEach((o, i) => rows.push({
        key: `x-${x.id}-${o.on}`, kind: "expected", id: x.id, title: `${x.title}, ${dayLabel(o.on)}`, on: o.on,
        state: o.state || x.state, repeats: true, moment: !!x.promo_moment, row: i === 0 ? x : null,
      }));
      continue;
    }
    rows.push({ key: `x-${x.id}`, kind: "expected", id: x.id, title: x.title, on: x.next_on || x.expected_on, state: x.state,
      repeats, moment: !!x.promo_moment, row: x });
  }
  return rows.sort((a, b) => String(a.on).localeCompare(String(b.on)) || String(a.title).localeCompare(String(b.title)));
}

/**
 * Issue #3980 W3 rework (D7): the words after saving or cancelling a
 * promised event, from what the server says it did. Steps are said to be in
 * Work only when automatic steps were on and ran.
 */
export function expectedSavedWords(result, madeWords = "Saved. It’s on the Calendar and its steps are in Work.") {
  if (result && result.auto_steps === false) return "Saved. Automatic steps are off, so no steps were added.";
  const steps = result?.steps;
  if (steps && steps.stopped) return "Saved. It’s on the Calendar. Its steps couldn’t be made just now; the next run adds them.";
  if (steps && typeof steps === "object") {
    const n = Number(steps.added || 0) + Number(steps.redated || 0);
    // #3980 W3 rework 2: the server says how many of its steps are open; with
    // none (a series whose first date is still far off) the words never
    // claim steps exist.
    if (n === 0 && steps.open !== undefined && Number(steps.open) === 0) {
      // #3980 W3 rework 3: steps a person already finished or declined are
      // not added again, so the words never promise them "nearer the date".
      if (Number(steps.settled || 0) > 0) return "Saved. It’s on the Calendar. Its steps were already finished or declined in Work, so none were added.";
      return "Saved. It’s on the Calendar. No steps are needed yet; Mingla adds them nearer the date.";
    }
    return n > 0 ? madeWords : "Saved. It’s on the Calendar; its steps were already in Work.";
  }
  return "Saved. It’s on the Calendar.";
}

export function expectedCancelledWords(result) {
  if (result && result.auto_steps === false) return "Cancelled. Automatic steps are off, so no steps were changed.";
  const closed = Number(result?.steps?.closed || 0);
  if (result?.steps?.stopped) return "Cancelled. Its steps close on the next run.";
  if (closed === 1) return "Cancelled. Its 1 open step closed.";
  if (closed > 1) return `Cancelled. Its ${closed} open steps closed.`;
  return "Cancelled. It had no open steps.";
}

/**
 * Issue #3980 W3 rework (D8): the Needs you tab to open when the address
 * names none: the first tab that has something waiting (Messages, then Spend
 * or publish, then What hosts are told for the owner and admins), else
 * Messages.
 */
export function needsYouStartTab({ waiting = 0, draftNeeded = 0, needsPerson = 0, wording = 0 } = {}, canTell = false) {
  if (Number(waiting) + Number(draftNeeded) > 0) return "messages";
  if (Number(needsPerson) > 0) return "spend";
  if (canTell && Number(wording) > 0) return "told";
  return "messages";
}

/** Nothing anywhere needs a person (from loaded counts): the page says so. */
export function needsYouCaughtUp(counts) {
  return !!counts?.loaded && Number(counts?.total || 0) === 0;
}
