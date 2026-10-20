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

export const PERSON_ACTIONS = {
  send: { action: "mark_sent", label: "Mark sent" },
  spend: { action: "approve_spend", label: "Approve spend" },
  publish: { action: "mark_published", label: "Mark published" },
};

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

/** The nine rules every agent follows, as people read them. */
export const AGENT_RULES = [
  "Reads the agent log for the records it will touch, and checks the open claims, before any work.",
  "Claims the card and every record it will change or message. A claim ends after 30 minutes without an update.",
  "Writes the plan on the card: each step names the connector tool that does it, or a person.",
  "After each step, reads the record back and marks the step done only if the change is really there.",
  "Never reports a step done that it could not do; it leaves it to a person with exact instructions.",
  "Closes a card only with proof of what it read back, or pushes it back as not needed or already done, with a reason.",
  "Never sends, spends money or publishes: it sets the card to Needs a person and stops.",
  "Cannot write to someone Mingla messaged in the last 3 days, unless a person allows one more.",
  "Closing or pushing back releases its claims; it releases any other claim when it stops.",
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

/** "Seth's Claude" for an agent, "Seth" for a person. */
export function agentName(name, via) {
  const who = typeof name === "string" && name.trim() ? name.trim() : "A teammate";
  if (via === "claude") return `${who}'s Claude`;
  if (via === "codex") return `${who}'s Codex`;
  if (via === "system") return "Mingla";
  return who;
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
  return { tab: p.get("tab") === "spend" ? "spend" : "messages", card: card && UUID_RE.test(card) ? card : null };
}

/** Runway words: how many days an event was public before it starts. */
export function runwayLabel(runway) {
  const band = runway?.band;
  const lead = Number(runway?.lead_days);
  if (band === "full") return `Full launch · live ${lead} days ahead`;
  if (band === "tight") return `Tight · live ${lead} days ahead`;
  if (band === "organic") return `Organic only · live ${lead} days ahead`;
  if (band === "not_live") return `Not live yet · go live by ${dayLabel(runway?.go_live_by)}`;
  if (band === "missed") return "Missed go-live: organic only";
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

/** The short band label on chips and buttons. */
export function bandShort(runway) {
  const band = runway?.band;
  if (band === "full") return "Full launch";
  if (band === "tight") return "Tight";
  if (band === "organic") return "Organic only";
  if (band === "not_live") return `Go live by ${dayLabel(runway?.go_live_by)}`;
  if (band === "missed") return "Missed";
  return "No date yet";
}

/** `event=event:<id>` or `event=expected:<id>` → { kind, id }, else null. */
export function parseEventParam(value) {
  const m = typeof value === "string" ? value.match(/^(event|expected):([0-9a-f-]{36})$/i) : null;
  return m && UUID_RE.test(m[2]) ? { kind: m[1].toLowerCase(), id: m[2].toLowerCase() } : null;
}

export const EVENT_TYPE_LABELS = { event: "Event", experience: "Experience", trip: "Trip", rsvp: "RSVP" };
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
