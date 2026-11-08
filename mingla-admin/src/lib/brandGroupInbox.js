// Issue #4270 (Wave 7) — the staff Brand group inbox, as words and shapes.
// Pure module: no React, no Supabase, so the list, the thread, the composer and
// their tests share one definition of every word on the screen.
//
//   * Waiting: how long a brand has waited for Mingla Support (from the
//     server's waiting_since), capped at "14d+" (Seth, Q2).
//   * Filters: Needs reply (oldest wait first), Mine, Plan this week, All.
//   * The thread: day dividers, and quiet plan lines folded into one card whose
//     lines open the plan item they name (matched by title on the client).
//   * Composer helpers: quick replies, "Seen by", "is typing…", reactions and
//     the Add to plan prefill from selected messages.
import { PLAN_KIND_WORDS, isPlanLine, planDay } from "./brandPlan.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "12m", "2h 14m", "3d 4h", "14d+"; "" when nobody waits. */
export function waitingWords(sinceIso, nowMs = Date.now()) {
  if (!sinceIso) return "";
  const since = new Date(sinceIso).getTime();
  if (!Number.isFinite(since)) return "";
  const diff = Math.max(0, Number(nowMs) - since);
  if (diff >= 14 * DAY) return "14d+";
  if (diff < HOUR) return `${Math.max(1, Math.floor(diff / MINUTE))}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ${Math.floor((diff % HOUR) / MINUTE)}m`;
  return `${Math.floor(diff / DAY)}d ${Math.floor((diff % DAY) / HOUR)}h`;
}

export const INBOX_FILTERS = Object.freeze(["needs_reply", "mine", "plan_week", "all"]);
export const INBOX_FILTER_WORDS = Object.freeze({
  needs_reply: "Needs reply",
  mine: "Mine",
  plan_week: "Plan this week",
  all: "All",
});

/**
 * The group list with the inbox facts merged in. A light refresh (plan not
 * read: `host.plan` null) keeps the plan the last full refresh read, from
 * `previousPlanByConversation` ({ [conversation_id]: plan }).
 */
export function mergeInbox(groups, inboxRows, previousPlanByConversation = {}) {
  const facts = new Map((Array.isArray(inboxRows) ? inboxRows : []).map((row) => [row.conversation_id, row]));
  return (Array.isArray(groups) ? groups : []).map((group) => {
    const row = facts.get(group.conversation_id);
    let host = row?.host ?? null;
    if (host && host.plan == null) {
      const kept = previousPlanByConversation?.[group.conversation_id];
      if (kept) host = { ...host, plan: kept };
    }
    return {
      ...group,
      waiting_since: row?.waiting_since ?? null,
      last_staff_reply_at: row?.last_staff_reply_at ?? null,
      host,
      // #4270 W7 rework (D-6): whether the inbox read covered this group at all.
      inbox_known: !!row,
    };
  });
}

function sinceMs(row) {
  const t = new Date(row?.waiting_since || "").getTime();
  return Number.isFinite(t) ? t : Infinity;
}

/** The rows a filter and a search keep, in the order they show. */
export function applyInboxFilter(rows, filter, query = "") {
  const list = Array.isArray(rows) ? rows : [];
  let out;
  switch (filter) {
    case "needs_reply":
      out = list.filter((row) => !!row.waiting_since).slice().sort((a, b) => sinceMs(a) - sinceMs(b));
      break;
    case "mine":
      out = list.filter((row) => row.host?.mine === true);
      break;
    case "plan_week":
      out = list.filter((row) => Number(row.host?.plan?.this_week) > 0);
      break;
    default:
      out = list.slice();
  }
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return out;
  return out.filter((row) => [row.brand_name, row.host?.name, row.last_message_preview]
    .some((text) => String(text || "").toLowerCase().includes(needle)));
}

/** Needs reply when anyone waits, else All (Seth, Q1). */
export function defaultInboxFilter(rows) {
  return (Array.isArray(rows) ? rows : []).some((row) => !!row.waiting_since) ? "needs_reply" : "all";
}

/** { waiting, oldest } for "3 groups waiting on Mingla · oldest 2h 14m". */
export function inboxSummary(rows, nowMs = Date.now()) {
  const waiting = (Array.isArray(rows) ? rows : []).filter((row) => !!row.waiting_since);
  if (!waiting.length) return { waiting: 0, oldest: "" };
  const oldest = waiting.reduce((a, b) => (sinceMs(a) <= sinceMs(b) ? a : b));
  return { waiting: waiting.length, oldest: waitingWords(oldest.waiting_since, nowMs) };
}

/** "3 groups waiting on Mingla · oldest 2h 14m"; "" when nobody waits. */
export function inboxSummaryWords(summary) {
  if (!summary?.waiting) return "";
  return `${summary.waiting} ${summary.waiting === 1 ? "group" : "groups"} waiting on Mingla · oldest ${summary.oldest}`;
}

export function teammatesWords(count) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? "teammate" : "teammates"}`;
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

/**
 * #4270 W7 rework (D-4): the one way the Brand group shows a person's name.
 * Some accounts carry their email address as their display name; the screen
 * never shows an address. Each candidate is tried in order (the name, then
 * whatever first-name fallbacks the caller has, such as the People row for the
 * same person); the first that is not an address wins, else "A teammate".
 */
export const NO_NAME_WORDS = "A teammate";
export function personName(name, ...fallbacks) {
  for (const candidate of [name, ...fallbacks]) {
    if (typeof candidate !== "string") continue;
    const clean = candidate.replace(/\s+/g, " ").trim();
    if (clean && !clean.includes("@")) return clean;
  }
  return NO_NAME_WORDS;
}

/**
 * A Mingla staff name. Staff accounts can carry their work address as their
 * display name; for staff only (never a brand teammate) the screen uses the
 * name the Work board already gives that address (crm_display_name's rule):
 * the address's first part before . _ + or -, capitalised, so
 * "seth@usemingla.com" reads "Seth". Anything that still looks like an
 * address, or nothing usable, reads "A teammate".
 */
export function staffName(name) {
  const clean = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  if (!clean) return NO_NAME_WORDS;
  if (!clean.includes("@")) return clean;
  const head = (clean.split("@")[0].match(/^[^._+-]+/) || [""])[0];
  if (!head || /[^\p{L}\p{N}]/u.test(head)) return NO_NAME_WORDS;
  return head.charAt(0).toUpperCase() + head.slice(1);
}

/** The first name of `personName(...)`: "Ada" for "Ada Obi"; "A teammate" stays whole. */
export function personFirstName(name, ...fallbacks) {
  const full = personName(name, ...fallbacks);
  return full === NO_NAME_WORDS ? full : firstName(full);
}

const TYPE_WORDS = { image: "Photo", video: "Video", file: "File", audio: "File" };

/** The row's last line: "You: …", "Ada: …", "Photo"; the team size when empty. */
export function previewWords(group, myUserId) {
  if (!group) return "";
  const type = String(group.last_message_type || "");
  const body = TYPE_WORDS[type] || String(group.last_message_preview || "").replace(/\s+/g, " ").trim();
  if (!body) return teammatesWords(group.member_count);
  const sender = group.last_message_sender_id;
  if (!sender) return body;
  if (myUserId && sender === myUserId) return `You: ${body}`;
  if (!String(group.last_message_sender_name || "").trim()) return body;
  return `${personFirstName(group.last_message_sender_name)}: ${body}`;
}

function weekdayShort(iso) {
  const d = new Date(`${String(iso || "").slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAYS[d.getUTCDay()];
}

function cut(text, max) {
  const s = String(text || "");
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** "Sun · Doors open tonight" (at most 40 characters); "" with no next item. */
export function nextPlanWords(plan) {
  const next = plan?.next;
  if (!next?.title || !next?.on) return "";
  const day = weekdayShort(next.on);
  if (!day) return "";
  return cut(`${day} · ${String(next.title).replace(/\s+/g, " ").trim()}`, 40);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localDayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today", "Yesterday", "Wed 21 Oct", "Wed 21 Oct 2025" (this browser's time zone). */
export function dayDividerLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (localDayKey(d) === localDayKey(today)) return "Today";
  if (localDayKey(d) === localDayKey(yesterday)) return "Yesterday";
  const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "14:18" (this browser's time zone). */
export function clockTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The thread as entries: { type: "day", key, label }, { type: "message",
 * message } and { type: "plan", key, lines }. Quiet plan lines that follow
 * each other on one day, with nothing between them, fold into one plan card.
 */
export function foldThread(messages, now = new Date()) {
  const out = [];
  let lastDay = "";
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message) continue;
    const at = new Date(message.created_at);
    const dayKey = Number.isNaN(at.getTime()) ? "" : localDayKey(at);
    if (dayKey && dayKey !== lastDay) {
      out.push({ type: "day", key: `day-${dayKey}`, label: dayDividerLabel(message.created_at, now) });
      lastDay = dayKey;
    }
    if (isPlanLine(message)) {
      const prev = out[out.length - 1];
      if (prev?.type === "plan") prev.lines.push(message);
      else out.push({ type: "plan", key: `plan-${message.id}`, lines: [message] });
      continue;
    }
    out.push({ type: "message", key: message.id || message.localId, message });
  }
  return out;
}

/** The title a plan line names: the text in its LAST “…” (a rename names the new title). */
export function planLineTitle(content) {
  const found = [...String(content || "").matchAll(/“([^”]*)”/g)];
  return found.length ? found[found.length - 1][1] : "";
}

function norm(text) {
  return String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// How closely an item's title matches a plan line's words: 0 the exact title,
// 1 the title without " · <brand>", 2 without a " (2)" count as well.
// Infinity when it does not match at all.
function titleRank(title, brandName, want) {
  const base = norm(title);
  if (!base) return Infinity;
  if (base === want) return 0;
  const brand = norm(brandName);
  const tail = brand ? ` · ${brand}` : "";
  const noBrand = tail && base.endsWith(tail) ? base.slice(0, -tail.length) : base;
  if (noBrand === want) return 1;
  const noCount = base.replace(/\s\(\d+\)$/, "");
  const noCountBrand = tail && noCount.endsWith(tail) ? noCount.slice(0, -tail.length) : noCount;
  const noBrandCount = noBrand.replace(/\s\(\d+\)$/, "");
  return [noCount, noCountBrand, noBrandCount].includes(want) ? 2 : Infinity;
}

/**
 * The post or task a plan line names, or null (an item removed since, or a
 * name that no longer matches). #4270 W7 rework (D-3): the exact title wins
 * over a loose form, so “Lineup reveal” never opens “Lineup reveal (2)” when
 * both are on the plan; among equals the first listed wins.
 */
export function matchPlanLine(content, items, brandName = "") {
  const want = norm(planLineTitle(content));
  if (!want) return null;
  let best = null;
  let bestRank = Infinity;
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || (item.kind !== "post" && item.kind !== "task")) continue;
    const rank = titleRank(item.title, brandName, want);
    if (rank < bestRank) { best = item; bestRank = rank; }
    if (bestRank === 0) break;
  }
  return best;
}

/** "Seth added 5 items to the plan", or "3 plan updates". */
export function planActivityWords(lines) {
  const list = (Array.isArray(lines) ? lines : []).map((line) => (typeof line === "string" ? line : line?.content || ""));
  const n = list.length;
  const names = list.map((text) => /^(.+?) added “/.exec(text)?.[1] || null);
  if (n > 0 && names.every((name) => name && name === names[0])) {
    return `${names[0]} added ${n} ${n === 1 ? "item" : "items"} to the plan`;
  }
  return `${n} ${n === 1 ? "plan update" : "plan updates"}`;
}

/** The composer's chips. They fill the composer; they never send. */
export function quickReplies({ weekItems = [], nextEvent = null, brandName = "" } = {}) {
  const chips = [];
  const items = Array.isArray(weekItems) ? weekItems.filter(Boolean) : [];
  if (items.length) {
    const lines = items.map((item) => `• ${planDay(item.on)} · ${PLAN_KIND_WORDS[item.kind] || "Event"} · ${item.title}`);
    chips.push({ key: "week", label: "Share this week's plan", text: `This week's plan for ${brandName}:\n${lines.join("\n")}` });
  }
  chips.push({
    key: "photos",
    label: "Ask for event photos",
    text: "Could you send us 3 to 5 photos or short clips from your last event? We'll use them for your next posts.",
  });
  if (nextEvent?.title) {
    chips.push({
      key: "promote",
      label: `Promote ${nextEvent.title}`,
      text: `Let's promote ${nextEvent.title} on ${planDay(nextEvent.on)}. What would you like us to highlight?`,
    });
  }
  return chips;
}

function namesSummary(names, max) {
  const clean = names.filter(Boolean);
  if (!clean.length) return "";
  const shown = clean.slice(0, max).join(", ");
  return clean.length > max ? `${shown} +${clean.length - max}` : shown;
}

/**
 * "Seen by Ada", "Seen by Ada, Kim", "Seen by Ada, Kim +1"; "" when nobody has.
 * `nameFor(userId)` (optional) is a fallback name for a reader whose display
 * name is an address (D-4).
 */
export function seenByWords(reads, message, nameFor = null) {
  const sent = new Date(message?.created_at || "").getTime();
  if (!Number.isFinite(sent)) return "";
  const readers = (Array.isArray(reads) ? reads : [])
    .filter((read) => new Date(read?.last_read_at || "").getTime() >= sent)
    .map((read) => personFirstName(read?.display_name, typeof nameFor === "function" ? nameFor(read?.user_id) : null));
  const summary = namesSummary(readers, 2);
  return summary ? `Seen by ${summary}` : "";
}

/** "info is typing…", "info and Kim are typing…", "3 people are typing…"; null when nobody. */
export function typingWords(names) {
  const clean = (Array.isArray(names) ? names : []).filter((n) => typeof n === "string" && n.trim()).map((n) => personFirstName(n));
  if (!clean.length) return null;
  if (clean.length === 1) return `${clean[0]} is typing…`;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]} are typing…`;
  return `${clean.length} people are typing…`;
}

/** The six reactions (the #4304 policy refuses any other). */
export const REACTION_EMOJI = Object.freeze(["❤️", "👍", "😂", "😮", "😢", "🔥"]);

/** Map(messageId -> [{ emoji, count, mine }]) in the offered order. */
export function summariseReactions(rows, viewerId) {
  const byMessage = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.message_id || !row.emoji) continue;
    const pills = byMessage.get(row.message_id) ?? new Map();
    const pill = pills.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false };
    pill.count += 1;
    if (viewerId && row.user_id === viewerId) pill.mine = true;
    pills.set(row.emoji, pill);
    byMessage.set(row.message_id, pills);
  }
  const order = (emoji) => {
    const i = REACTION_EMOJI.indexOf(emoji);
    return i === -1 ? REACTION_EMOJI.length : i;
  };
  const out = new Map();
  for (const [id, pills] of byMessage) out.set(id, [...pills.values()].sort((a, b) => order(a.emoji) - order(b.emoji)));
  return out;
}

/** Pressing an emoji removes the viewer's own row, or adds one. */
export function reactionToggle(rows, messageId, emoji, viewerId) {
  const existing = (Array.isArray(rows) ? rows : []).find((row) =>
    row.message_id === messageId && row.user_id === viewerId && row.emoji === emoji);
  return existing ? { action: "remove", rowId: existing.id } : { action: "add" };
}

function cutAtWord(text, max) {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const space = head.lastIndexOf(" ");
  return (space > max * 0.5 ? head.slice(0, space) : head).trimEnd();
}

/** The Add to plan form, filled from selected messages: { title, note }. */
export function planPrefillFromMessages(messages) {
  const list = (Array.isArray(messages) ? messages : []).filter((m) => m && String(m.content || "").trim());
  if (!list.length) return { title: "", note: "" };
  const oneLine = (text) => String(text || "").replace(/\s+/g, " ").trim();
  const title = cutAtWord(oneLine(list[0].content), 160);
  const lines = list.map((m) => `${String(m.sender_display_name || "").trim() ? personName(m.sender_display_name) : "Someone"}: ${oneLine(m.content)}`);
  const note = cut(`From the Brand group: ${lines.join(" · ")}`, 500);
  return { title, note };
}

/** "Not sent: connection lost" for a network failure; else the reason. */
export function sendFailureWords(error) {
  const message = String(error?.message || "");
  if (!message || /fetch|network|offline|load failed|timeout/i.test(message)) return "Not sent: connection lost";
  return `Not sent: ${message}`;
}

/**
 * Try again: did a send that looked lost reach the server after all?
 *
 * #4270 W7 rework (D-7): when the send carries `knownIds` (the ids of the
 * messages already in the thread when it was sent), a message from me with the
 * same words that is NOT one of them landed; the browser's clock is only a
 * wide guard (10 minutes) against an old twin read before the thread loaded.
 * Without `knownIds` it falls back to the time window: from five seconds
 * before the first try onwards.
 */
export function sendLanded(messages, { content, at, knownIds }, myUserId) {
  const want = String(content || "").trim();
  const mine = (Array.isArray(messages) ? messages : []).filter((m) => m && m.sender_id === myUserId
    && String(m.content || "").trim() === want);
  if (Array.isArray(knownIds)) {
    const known = new Set(knownIds);
    const from = Number(at) - 10 * MINUTE;
    return mine.some((m) => !known.has(m.id) && !(new Date(m.created_at).getTime() < from));
  }
  const from = Number(at) - 5_000;
  return mine.some((m) => new Date(m.created_at).getTime() >= from);
}

/** "17:58" today, "Thu" this week, "4 Nov" before (the list's time column). */
export function inboxTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const today = new Date(now);
  if (localDayKey(d) === localDayKey(today)) return clockTime(iso);
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (startToday - d.getTime() < 6 * DAY) return WEEKDAYS[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Initials for an avatar: "Harmattan Club" -> "HC". */
export function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
}

// ── #4270 W7 rework: the controller's decisions, as plain functions ─────────

/** D-13: a window focus reads the full inbox only when the last full read is a minute old. */
export const FOCUS_REFRESH_MIN_MS = 60_000;
export function focusRefreshDue(lastFullReadAt, nowMs = Date.now()) {
  const last = Number(lastFullReadAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  return Number(nowMs) - last >= FOCUS_REFRESH_MIN_MS;
}

/**
 * D-8: tapping a group. On a phone or tablet the open thread is the address's
 * `group`, not the selection, so the group selected by default (the first
 * row) still opens when tapped. Nothing happens only when that group's thread
 * is already showing with no side panel.
 */
export function openGroupStep(conversationId, { selectedId, viewGroup, sideOpen }) {
  if (!conversationId) return "none";
  return conversationId === selectedId && conversationId === viewGroup && !sideOpen ? "none" : "open";
}

/**
 * D-6: what the Brand group knows about the brand's host card.
 *   status "loading"  the inbox (or the fallback lookup) is still reading
 *          "ready"    a host card; `host.owners` is null when only the
 *                     fallback lookup answered (owners unknown)
 *          "none"     no host card (a reliable answer): Create / Link
 *          "unknown"  nothing could be read: never offer Create / Link
 * `inboxStatus` is "loading" | "ready" | "error"; `fallback` is the pre-W7
 * lookup (ops_brand_host_record) used while the inbox cannot answer for this
 * group: { status: "idle" | "loading" | "ready" | "none" | "error", recordId, name }.
 */
export function hostCardFacts({ inboxStatus, group, fallback }) {
  if (!group) return { status: "none", host: null, needsFallback: false };
  if (inboxStatus === "loading" && !group.inbox_known) return { status: "loading", host: null, needsFallback: false };
  if (inboxStatus === "ready" && group.inbox_known) {
    return group.host ? { status: "ready", host: group.host, needsFallback: false } : { status: "none", host: null, needsFallback: false };
  }
  const fb = fallback || { status: "idle" };
  if (fb.status === "ready" && fb.recordId) {
    return { status: "ready", host: { record_id: fb.recordId, name: fb.name || "Host", owners: null, plan: null, stage: null, region_id: null, icp: null, mine: null }, needsFallback: true };
  }
  if (fb.status === "none") return { status: "none", host: null, needsFallback: true };
  if (fb.status === "error") return { status: "unknown", host: null, needsFallback: true };
  return { status: "loading", host: null, needsFallback: true };
}

/** D-6 / D-14: plain words when the brand team cannot be read (never the database's text). */
export const PEOPLE_ERROR_WORDS = "The brand team can't be shown right now. The chat still works; try again in a moment.";
/** D-6: plain words when who is waiting cannot be read. */
export const INBOX_ERROR_WORDS = "Who is waiting and the host card details can't be shown right now. The groups and their messages still work.";

/**
 * D-5: answers that may land late. `open(key)` names the group on screen;
 * `begin(key)` hands out a ticket for a read of that group; `applies(ticket)`
 * is true only while that group is still the one open and no newer read of the
 * SAME group has started. A read of another group (Try again on a group no
 * longer open) never cancels the open group's read.
 */
export function createAnswerGate() {
  let openKey = null;
  let n = 0;
  const latest = new Map();
  return {
    open(key) { openKey = key ?? null; },
    isOpen(key) { return key != null && key === openKey; },
    begin(key) {
      n += 1;
      latest.set(key, n);
      return { key, n };
    },
    applies(ticket) {
      return !!ticket && ticket.key != null && ticket.key === openKey && latest.get(ticket.key) === ticket.n;
    },
  };
}
