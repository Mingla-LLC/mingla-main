// Issue #4130 (Wave 1) — the Work page's four views (Board, Today, This week,
// This month), the person filter, and the waiting drafts that sit in the
// Waiting on a person column now that Needs you is gone.
//
// Pure module: no React, no Supabase. The page, the views and a plain node
// test read it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const WORK_VIEWS = Object.freeze([
  Object.freeze({ value: "board", label: "Board" }),
  Object.freeze({ value: "today", label: "Today" }),
  Object.freeze({ value: "week", label: "This week" }),
  Object.freeze({ value: "month", label: "This month" }),
]);
const VIEW_VALUES = WORK_VIEWS.map((v) => v.value);

/**
 * The view, person filter, search and draft drawers in the Work address.
 * `owner` is a teammate's address (the person chips); `who=watching` keeps
 * the old "cards I watch" filter. `draft`, `record` and `drafts=all` open the
 * message-draft drawers that replace the old Needs you page.
 */
export function parseWorkView(search) {
  const p = new URLSearchParams(typeof search === "string" ? search : "");
  const owner = String(p.get("owner") || "").trim().toLowerCase();
  const draft = p.get("draft");
  const record = p.get("record");
  return {
    view: VIEW_VALUES.includes(p.get("view")) ? p.get("view") : "board",
    owner: owner && owner.includes("@") && owner.length <= 320 ? owner : null,
    q: String(p.get("q") || "").slice(0, 160),
    draft: draft && UUID_RE.test(draft) ? draft : null,
    record: record && UUID_RE.test(record) ? record : null,
    allDrafts: p.get("drafts") === "all",
  };
}

// ── Periods, in the viewer's own time ────────────────────────────────────

function at(now) {
  return now instanceof Date ? new Date(now.getTime()) : new Date(now ?? Date.now());
}

/** Yesterday at 09:00, local time: where the standup starts counting. */
export function standupSince(now = new Date()) {
  const d = at(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 9, 0, 0, 0);
}

/** The last 24 hours: what the "What changed" feed covers. */
export function lastDaySince(now = new Date()) {
  return new Date(at(now).getTime() - 86_400_000);
}

/** Monday 00:00 local of the week `now` is in. */
export function weekStart(now = new Date()) {
  const d = at(now);
  const dow = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow, 0, 0, 0, 0);
}

/** This week so far: Monday 00:00 local until now. */
export function weekRange(now = new Date()) {
  return { from: weekStart(now), to: at(now) };
}

/** The last `weeks` weeks (this one included), Monday to now: the closed-per-week chart. */
export function recentWeeksRange(now = new Date(), weeks = 8) {
  const start = weekStart(now);
  return { from: new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7 * (weeks - 1)), to: at(now) };
}

/** This month so far: the 1st at 00:00 local until now. */
export function monthRange(now = new Date()) {
  const d = at(now);
  return { from: new Date(d.getFullYear(), d.getMonth(), 1), to: d };
}

/**
 * The same days of last month, for "vs September": from its 1st for as long
 * as this month has run (never past its own end).
 */
export function previousMonthRange(now = new Date()) {
  const d = at(now);
  const from = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const end = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(Math.min(end.getTime(), from.getTime() + (d.getTime() - end.getTime())));
  return { from, to: to > from ? to : new Date(from.getTime() + 60_000) };
}

export function monthName(now = new Date(), offset = 0) {
  const d = at(now);
  return MONTHS_LONG[new Date(d.getFullYear(), d.getMonth() + offset, 1).getMonth()];
}

/** "26 Oct" for a date or an ISO date string. */
export function shortDay(value) {
  if (!value) return "";
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** "09:42" today, "Yesterday 18:20", else "24 Oct 18:20" — local time. */
export function feedTime(value, now = new Date()) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const n = at(now);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86_400_000);
  if (diff === 0) return hm;
  if (diff === 1) return `Yesterday ${hm}`;
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${hm}`;
}

/** The viewer's IANA time zone, or null when the browser cannot say. */
export function viewerTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz ? tz : null;
  } catch {
    return null;
  }
}

// ── Words ────────────────────────────────────────────────────────────────

const STATUS_WORDS = { todo: "To do", doing: "In progress", person: "Waiting on a person", done: "Done" };

const ACTION_WORDS = {
  added: "added",
  closed: "closed",
  auto_closed: "saw close by itself",
  gate_closed: "saw close by itself",
  started: "started",
  blocked: "marked blocked",
  unblocked: "unblocked",
  pushed_back: "pushed back",
  reopened: "reopened",
  note: "added a note to",
  people: "changed who is on",
  links: "changed the links on",
  plan: "updated the plan of",
  updated: "updated",
  carried: "carried into this week",
  archived: "removed",
  github: "linked GitHub to",
  sprint_moved: "moved to another sprint",
  took_over: "took over",
  working_cleared: "cleared the working mark on",
  gate_override: "overrode the go-live rule on",
  re_anchored: "changed the event of",
};

/** What a person did to a card, as a short verb phrase. */
export function eventVerb(entry) {
  if (entry?.action === "status") {
    const to = STATUS_WORDS[entry?.to_status];
    return to ? `moved to ${to}` : "changed the status of";
  }
  return ACTION_WORDS[entry?.action] || "changed";
}

/** Whole percent of cards closed on time, or null when nothing closed. */
export function onTimePercent(closed, onTime) {
  const c = Number(closed);
  const o = Number(onTime);
  if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(o)) return null;
  return Math.round((Math.min(o, c) / c) * 100);
}

/** "+3 vs last week", "2 fewer than last week", "same as last week", or "" when unknown. */
export function deltaWords(now, before, what) {
  const a = Number(now);
  const b = Number(before);
  if (!Number.isFinite(a) || !Number.isFinite(b) || before === null || before === undefined) return { text: "", up: undefined };
  if (a === b) return { text: `same as ${what}`, up: undefined };
  return a > b ? { text: `+${a - b} vs ${what}`, up: true } : { text: `${b - a} fewer than ${what}`, up: false };
}

/** "+18% vs September" (or "" when the earlier number is 0 or unknown). */
export function percentDeltaWords(now, before, what) {
  const a = Number(now);
  const b = Number(before);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return { text: "", up: undefined };
  const pct = Math.round(((a - b) / b) * 100);
  if (pct === 0) return { text: `same as ${what}`, up: undefined };
  return { text: `${pct > 0 ? "+" : ""}${pct}% vs ${what}`, up: pct > 0 };
}

// ── The standup ──────────────────────────────────────────────────────────

/**
 * One row per person: cards closed since yesterday 09:00 (from the server's
 * per-person counts), what they have in progress, and what is blocked or
 * waiting on a person. `cards` are the open cards on the board.
 */
export function standupRows(people, cards, closedByPerson) {
  const closed = new Map((Array.isArray(closedByPerson) ? closedByPerson : []).map((p) => [String(p.email || "").toLowerCase(), Number(p.closed) || 0]));
  const open = Array.isArray(cards) ? cards.filter((c) => c && c.status !== "done" && !c.archived) : [];
  return (Array.isArray(people) ? people : []).map((p) => {
    const email = String(p.email || "").toLowerCase();
    const mine = open.filter((c) => (c.owners || []).some((o) => String(o.email || "").toLowerCase() === email));
    return {
      email,
      name: p.name || email,
      done: closed.get(email) || 0,
      doing: mine.filter((c) => c.status === "doing" && !c.blocked),
      blocked: mine.filter((c) => c.status === "person" || c.blocked),
    };
  });
}

/** The people a standup covers: the person picked, or the whole team (not invites). */
export function standupPeople(people, owner) {
  const team = (Array.isArray(people) ? people : []).filter((p) => !p.invited);
  return owner ? team.filter((p) => p.email === owner) : team;
}

/** The standup as plain text for a chat: one line per person. */
export function standupText(rows, now = new Date()) {
  const d = at(now);
  const head = `Standup ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} (since yesterday 09:00)`;
  const lines = (Array.isArray(rows) ? rows : []).map((r) => {
    const today = r.doing.length ? r.doing.map((c) => c.title).join("; ") : "nothing in progress";
    const blocked = r.blocked.length ? r.blocked.map((c) => c.title).join("; ") : "none";
    return `${r.name}: done ${r.done} card${r.done === 1 ? "" : "s"}. Today: ${today}. Blocked or waiting: ${blocked}.`;
  });
  return [head, ...lines].join("\n");
}

// ── Waiting drafts on the board ──────────────────────────────────────────

/** The host and creator records a card is linked to (where its drafts are). */
export function cardRecordIds(card) {
  return (Array.isArray(card?.links) ? card.links : [])
    .filter((l) => l && (l.kind === "host" || l.kind === "creator") && typeof l.id === "string")
    .map((l) => l.id);
}

/** A card that waits for a person to send a message. */
export function isSendCard(card) {
  return !!card && card.status === "person" && card.person_reason === "send" && !card.archived;
}

/**
 * Waiting drafts split between the cards that carry them and the drafts no
 * open send card covers. Covered drafts open from their card; the rest are
 * listed on their own in the Waiting on a person column, so no draft the old
 * Needs you page showed is lost.
 */
export function splitDrafts(drafts, cards) {
  const byCard = new Map();
  const covered = new Set();
  const list = Array.isArray(drafts) ? drafts.filter((d) => d && d.state === "waiting") : [];
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!isSendCard(card)) continue;
    const ids = new Set(cardRecordIds(card));
    const proofIds = new Set((Array.isArray(card.proof) ? card.proof : []).filter((p) => p?.kind === "draft").map((p) => String(p.id)));
    const mine = list.filter((d) => (d.record?.id && ids.has(d.record.id)) || (d.record_id && ids.has(d.record_id)) || proofIds.has(String(d.id)));
    if (mine.length) {
      byCard.set(card.id, mine.length);
      for (const d of mine) covered.add(d.id);
    }
  }
  return { byCard, loose: list.filter((d) => !covered.has(d.id)) };
}

/** The board title of a draft listed on its own. */
export function draftItemTitle(draft) {
  const name = draft?.record?.name;
  return name ? `Send a message to ${name}` : "Send a message (the host or creator card is gone)";
}
