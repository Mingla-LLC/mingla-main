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

// #4255: one "Show" filter (Needs attention became one of its options, D9)
// and one "Linked to" filter. With the owner and the search they filter every
// tab the same way (workFilter below).
export const WORK_SHOW = Object.freeze([
  Object.freeze({ value: "", label: "All cards" }),
  Object.freeze({ value: "watch", label: "Cards I watch" }),
  Object.freeze({ value: "attention", label: "Needs attention" }),
  Object.freeze({ value: "overdue", label: "Overdue" }),
  Object.freeze({ value: "blocked", label: "Blocked" }),
]);
export const WORK_LINKED = Object.freeze([
  Object.freeze({ value: "", label: "Anything" }),
  Object.freeze({ value: "host", label: "Hosts" }),
  Object.freeze({ value: "creator", label: "Creators" }),
  Object.freeze({ value: "calendar", label: "Calendar" }),
]);
const SHOW_VALUES = WORK_SHOW.map((o) => o.value).filter(Boolean);
const LINKED_VALUES = WORK_LINKED.map((o) => o.value).filter(Boolean);

/**
 * The view, filters, search and draft drawers in the Work address.
 * `owner` is a teammate's address; `show` and `linked` are the two filter
 * dropdowns. Old addresses still open: `tab=attention` is Show: Needs
 * attention, `tab=activity` is Today (Agent activity sits at its foot),
 * `who=watching` is Show: Cards I watch. `draft`, `record` and `drafts=all`
 * open the message-draft panels.
 */
export function parseWorkView(search) {
  const p = new URLSearchParams(typeof search === "string" ? search : "");
  const owner = String(p.get("owner") || "").trim().toLowerCase();
  const draft = p.get("draft");
  const record = p.get("record");
  const tab = p.get("tab");
  let view = VIEW_VALUES.includes(p.get("view")) ? p.get("view") : "board";
  if (tab === "activity") view = "today";
  let show = SHOW_VALUES.includes(p.get("show")) ? p.get("show") : "";
  if (!show && tab === "attention") show = "attention";
  if (!show && p.get("who") === "watching") show = "watch";
  return {
    view,
    owner: owner && owner.includes("@") && owner.length <= 320 ? owner : null,
    q: String(p.get("q") || "").slice(0, 160),
    show,
    linked: LINKED_VALUES.includes(p.get("linked")) ? p.get("linked") : "",
    draft: draft && UUID_RE.test(draft) ? draft : null,
    record: record && UUID_RE.test(record) ? record : null,
    allDrafts: p.get("drafts") === "all",
  };
}

function linkKinds(card) {
  const kinds = new Set((Array.isArray(card?.links) ? card.links : []).map((l) => l?.kind));
  if (card?.anchor?.kind === "event" || card?.anchor?.kind === "expected") kinds.add(card.anchor.kind);
  return kinds;
}

function isOverdue(card, today) {
  if (!card || card.status === "done" || !card.due_on) return false;
  if (typeof card.overdue === "boolean") return card.overdue;
  return typeof today === "string" && String(card.due_on).slice(0, 10) < today;
}

/**
 * Needs attention, on a card: blocked, waiting on a person, overdue, with no
 * owner, or doing with no update for a week (the card's red reasons).
 */
export function needsAttention(card, today, reasons = []) {
  if (!card || card.status === "done") return false;
  return !!card.blocked || card.status === "person" || isOverdue(card, today) || (Array.isArray(reasons) && reasons.length > 0);
}

/**
 * The one filter every Work tab runs first. `me` is the viewer's address
 * (Show: Cards I watch), `reasonsOf(card)` the card's red reasons (Needs
 * attention), `today` the viewer's YYYY-MM-DD.
 */
export function workFilter(cards, { owner = null, show = "", linked = "", q = "", me = "", today = "", reasonsOf = null } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  const mine = String(me || "").toLowerCase();
  const who = String(owner || "").toLowerCase();
  return (Array.isArray(cards) ? cards : []).filter((c) => {
    if (!c || c.archived) return false;
    if (who && !(c.owners || []).some((o) => String(o.email || "").toLowerCase() === who)) return false;
    if (needle) {
      const hay = `${c.title || ""} ${c.instructions || ""}`.toLowerCase();
      const num = String(c.number ?? "");
      if (!hay.includes(needle) && needle !== num && needle !== `card ${num}`) return false;
    }
    if (linked) {
      const kinds = linkKinds(c);
      if (linked === "calendar" ? !(kinds.has("event") || kinds.has("expected") || kinds.has("content")) : !kinds.has(linked)) return false;
    }
    switch (show) {
      case "watch":
        return (c.watchers || []).some((o) => String(o.email || "").toLowerCase() === mine);
      case "attention":
        return needsAttention(c, today, reasonsOf ? reasonsOf(c) : []);
      case "overdue":
        return isOverdue(c, today);
      case "blocked":
        return c.status !== "done" && !!c.blocked;
      default:
        return true;
    }
  });
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

// ── #4255: Today, This week and This month share one layout ─────────────

function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const PERIOD_VIEWS = Object.freeze(["today", "week", "month"]);

/**
 * The window of a period tab, in the viewer's own time:
 *   from, to  Done means closed at or after `from` and before `to`
 *   dueBy     open cards count when due on or before this day, overdue or
 *             undated
 * Today counts done since yesterday 09:00 (the standup), This week since
 * Monday 00:00, This month since the 1st.
 */
export function periodWindow(view, now = new Date()) {
  const d = at(now);
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (view === "week") {
    const from = weekStart(d);
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
    const last = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 1);
    return { view, from, to, dueBy: localIso(last), note: `${shortDay(localIso(from))} to ${shortDay(localIso(last))} · done this week · open cards due by ${shortDay(localIso(last))}, overdue or undated` };
  }
  if (view === "month") {
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const last = new Date(to.getFullYear(), to.getMonth(), 0);
    return { view, from, to, dueBy: localIso(last), note: `${monthName(d)} · done this month · open cards due by ${shortDay(localIso(last))}, overdue or undated` };
  }
  return { view: "today", from: standupSince(d), to: tomorrow, dueBy: localIso(d), note: "Done since yesterday 09:00 · open cards due today, overdue or undated" };
}

export const PERIOD_BUCKETS = Object.freeze([
  Object.freeze({ key: "done", label: "Done" }),
  Object.freeze({ key: "doing", label: "Doing" }),
  Object.freeze({ key: "blocked", label: "Blocked" }),
  Object.freeze({ key: "waiting", label: "Waiting on a person" }),
]);

/** Which list of a period a card is in, or null (a To do card, or out of the window). */
export function periodBucket(card, win) {
  if (!card || card.archived || !win) return null;
  if (card.status === "done") {
    const closed = card.closed_at ? new Date(card.closed_at).getTime() : NaN;
    return Number.isFinite(closed) && closed >= at(win.from).getTime() && closed < at(win.to).getTime() ? "done" : null;
  }
  const due = card.due_on ? String(card.due_on).slice(0, 10) : null;
  if (due && win.dueBy && due > win.dueBy) return null;
  if (card.blocked) return "blocked";
  if (card.status === "doing") return "doing";
  if (card.status === "person") return "waiting";
  return null;
}

const NO_OWNER = "";

/**
 * Per person, the four lists of a period: Done, Doing, Blocked, Waiting on a
 * person. A card with two owners is listed under both; one with none under
 * "No owner". `people` (the team, in its order) names the rows; owners not
 * on the team come after them. `totals` count each card once.
 */
export function periodRows(cards, win, people = []) {
  const totals = { done: 0, doing: 0, blocked: 0, waiting: 0 };
  const byEmail = new Map();
  const names = new Map();
  const row = (email, name) => {
    if (!byEmail.has(email)) byEmail.set(email, { email, name, done: [], doing: [], blocked: [], waiting: [] });
    return byEmail.get(email);
  };
  for (const p of Array.isArray(people) ? people : []) if (p?.email && !p.invited) names.set(String(p.email).toLowerCase(), p.name || p.email);
  for (const card of Array.isArray(cards) ? cards : []) {
    const bucket = periodBucket(card, win);
    if (!bucket) continue;
    totals[bucket] += 1;
    const owners = Array.isArray(card.owners) && card.owners.length ? card.owners : [{ email: NO_OWNER, name: "No owner" }];
    for (const o of owners) {
      const email = String(o.email || "").toLowerCase();
      row(email, email ? names.get(email) || o.name || email : "No owner")[bucket].push(card);
    }
  }
  const byDue = (a, b) => String(a.due_on || "9999").localeCompare(String(b.due_on || "9999")) || (Number(a.number) || 0) - (Number(b.number) || 0);
  const byClosed = (a, b) => String(b.closed_at || "").localeCompare(String(a.closed_at || ""));
  for (const r of byEmail.values()) {
    r.done.sort(byClosed);
    r.doing.sort(byDue);
    r.blocked.sort(byDue);
    r.waiting.sort(byDue);
  }
  const order = [...names.keys()];
  const rows = [...byEmail.values()].sort((a, b) => {
    if (a.email === NO_OWNER) return 1;
    if (b.email === NO_OWNER) return -1;
    const ia = order.indexOf(a.email);
    const ib = order.indexOf(b.email);
    if (ia !== ib) return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
    return a.name.localeCompare(b.name);
  });
  return { totals, rows };
}

/** A list shows its first three; "+N more" shows the rest. */
export const PERIOD_LIST_LIMIT = 3;

export function periodShown(list, expanded, limit = PERIOD_LIST_LIMIT) {
  const all = Array.isArray(list) ? list : [];
  return expanded ? { shown: all, more: 0 } : { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
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
