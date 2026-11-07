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
  const name = firstName(group.last_message_sender_name);
  return name ? `${name}: ${body}` : body;
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

function titleForms(title, brandName) {
  const forms = new Set();
  const base = norm(title);
  if (!base) return forms;
  forms.add(base);
  const noCount = base.replace(/\s\(\d+\)$/, "");
  forms.add(noCount);
  const brand = norm(brandName);
  if (brand) {
    for (const t of [base, noCount]) {
      const tail = ` · ${brand}`;
      if (t.endsWith(tail)) forms.add(t.slice(0, -tail.length));
    }
  }
  return forms;
}

/** The post or task a plan line names, or null (an item removed since, or a name that no longer matches). */
export function matchPlanLine(content, items, brandName = "") {
  const want = norm(planLineTitle(content));
  if (!want) return null;
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || (item.kind !== "post" && item.kind !== "task")) continue;
    if (titleForms(item.title, brandName).has(want)) return item;
  }
  return null;
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
  const clean = names.map(firstName).filter(Boolean);
  if (!clean.length) return "";
  const shown = clean.slice(0, max).join(", ");
  return clean.length > max ? `${shown} +${clean.length - max}` : shown;
}

/** "Seen by Ada", "Seen by Ada, Kim", "Seen by Ada, Kim +1"; "" when nobody has. */
export function seenByWords(reads, message) {
  const sent = new Date(message?.created_at || "").getTime();
  if (!Number.isFinite(sent)) return "";
  const readers = (Array.isArray(reads) ? reads : [])
    .filter((read) => new Date(read?.last_read_at || "").getTime() >= sent)
    .map((read) => read.display_name);
  const summary = namesSummary(readers, 2);
  return summary ? `Seen by ${summary}` : "";
}

/** "info is typing…", "info and Kim are typing…", "3 people are typing…"; null when nobody. */
export function typingWords(names) {
  const clean = (Array.isArray(names) ? names : []).map((n) => firstName(typeof n === "string" ? n : "")).filter(Boolean);
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
  const lines = list.map((m) => `${m.sender_display_name || "Someone"}: ${oneLine(m.content)}`);
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
 * Try again: did a send that looked lost reach the server after all? True when
 * a message from me with the same words exists from five seconds before the
 * first try onwards.
 */
export function sendLanded(messages, { content, at }, myUserId) {
  const from = Number(at) - 5_000;
  const want = String(content || "").trim();
  return (Array.isArray(messages) ? messages : []).some((m) => m && m.sender_id === myUserId
    && String(m.content || "").trim() === want
    && new Date(m.created_at).getTime() >= from);
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
