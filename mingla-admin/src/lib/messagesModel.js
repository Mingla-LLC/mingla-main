// Issue #4255 (W4, D11) — Messages: the Admin top-bar inbox. Pure: no React,
// no Supabase. Builds on lib/notificationsInbox.js (team_inbox rows).
//
// Notifications tab: For you / Watching / All chips. Rows are grouped by card
// in this order: decisions first, then mentions and replies, then support
// alerts (#3988, kept as their own group), then changes on cards you watch.
// A card with several notices is one row with "+N more on this card".
//
// The badge on the Messages button: unread team chats (team_badge.chats) plus
// unread notifications For you. One poll feeds both (hooks/useMessages.js).
import { alertIsNew, inAppRoute } from "./notificationsInbox.js";

export const MESSAGES_TABS = Object.freeze([
  { id: "notifications", label: "Notifications" },
  { id: "chats", label: "Team chats" },
  { id: "settings", label: "Settings" },
]);

export const NOTIFICATION_FILTERS = Object.freeze([
  { id: "you", label: "For you" },
  { id: "watch", label: "Watching" },
  { id: "all", label: "All" },
]);

export const NOTIFICATION_GROUPS = Object.freeze([
  { id: "decide", label: "Needs a decision from you", tone: "brand", filters: ["you", "all"] },
  { id: "mention", label: "Mentions and replies", tone: "info", filters: ["you", "all"] },
  { id: "late", label: "Due and late", tone: "error", filters: ["you", "all"] },
  { id: "support", label: "Support alerts", tone: "warning", filters: ["you", "all"] },
  { id: "status", label: "Changes on cards you watch", tone: "success", filters: ["watch", "all"] },
]);

/** Which group a team_inbox mention belongs to. */
export function mentionGroup(m) {
  if (!m) return "status";
  // #4255 rework: the 09:00 "due and late" notice (ops_due_digest).
  if (m.source_kind === "work_due") return "late";
  // #4255 Retest 2 (P3b): a decision is the server's per-person flag
  // (team_mentions.decision, set by ops_notify_people on the tag-change
  // event, owners only), never the excerpt's words. The Host app's
  // Mentions read the same flag.
  if (m.decision === true) return "decide";
  if (m.kind === "mention") return "mention";
  return "status";
}

function time(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function mentionRow(m, group) {
  const actor = m.actor_name || "A teammate";
  const chat = m.source_kind === "team_message";
  const label = group === "decide" ? "Needs your OK" : group === "late" ? "Due and late" : group === "status" ? "Changed" : chat ? "Team chat" : "Mentioned you";
  return {
    key: `m-${m.id}`,
    group,
    kind: chat ? "chat" : "card",
    label,
    isNew: !m.read_at,
    at: m.created_at,
    actor,
    title: group === "decide" ? `${actor} needs your decision` : group === "late" ? "Your cards due and late" : group === "status" ? `${actor} changed a card` : `${actor} mentioned you`,
    detail: m.body_excerpt || "",
    cardId: m.card_id || null,
    threadId: m.thread_id || null,
    link: m.deep_link || null,
    source: { type: "mention", id: m.id, read_at: m.read_at },
  };
}

function alertRow(a) {
  return {
    key: `a-${a.id}`,
    group: "support",
    kind: "support",
    label: "Support",
    isNew: alertIsNew(a),
    at: a.created_at,
    actor: "",
    title: a.title || "Support alert",
    detail: a.ticket_resolved ? `${a.body || ""}${a.body ? " · " : ""}Resolved` : a.body || "",
    cardId: null,
    threadId: null,
    link: a.deep_link || null,
    alert: a,
    source: { type: "support", id: a.id, read_at: a.read_at, ticket_resolved: !!a.ticket_resolved },
  };
}

// One row per card (or chat) per group: the newest notice, the rest nested.
function groupByCard(rows) {
  const out = [];
  const at = new Map();
  for (const row of rows) {
    const anchor = row.cardId ? `card:${row.cardId}` : row.threadId ? `thread:${row.threadId}` : null;
    if (anchor && at.has(anchor)) {
      const lead = out[at.get(anchor)];
      lead.more.push(row);
      lead.sources.push(row.source);
      if (row.isNew) lead.isNew = true;
      continue;
    }
    if (anchor) at.set(anchor, out.length);
    out.push({ ...row, more: [], sources: [row.source] });
  }
  return out;
}

/**
 * The Notifications tab for a chip: [{ id, label, tone, rows }] in the
 * contract's order, empty groups left out. Done rows (marked read in this
 * session) are passed in `hidden` (keys) and left out.
 */
export function notificationGroups(inbox, filter = "you", hidden = new Set()) {
  const mentions = Array.isArray(inbox?.mentions) ? inbox.mentions : [];
  const alerts = Array.isArray(inbox?.alerts) ? inbox.alerts : [];
  const rows = [
    ...mentions.map((m) => mentionRow(m, mentionGroup(m))),
    ...alerts.map(alertRow),
  ].filter((r) => !hidden.has(r.key)).sort((a, b) => time(b.at) - time(a.at));
  return NOTIFICATION_GROUPS
    .filter((g) => g.filters.includes(filter))
    .map((g) => ({ id: g.id, label: g.label, tone: g.tone, rows: groupByCard(rows.filter((r) => r.group === g.id)) }))
    .filter((g) => g.rows.length > 0);
}

/** Unread notifications For you: decisions, mentions and replies, support alerts. */
export function forYouUnread(inbox) {
  const mentions = Array.isArray(inbox?.mentions) ? inbox.mentions : [];
  const alerts = Array.isArray(inbox?.alerts) ? inbox.alerts : [];
  const m = mentions.filter((x) => !x.read_at && mentionGroup(x) !== "status").length;
  return m + alerts.filter(alertIsNew).length;
}

/** The number on the Messages button. null while nothing has answered yet. */
export function messagesBadge({ badge, inbox }) {
  if (badge == null && inbox == null) return null;
  const chats = Number(badge?.chats || 0);
  return (Number.isFinite(chats) ? chats : 0) + forYouUnread(inbox);
}

/** "Messages, 7 unread" for the button. */
export function messagesButtonLabel(count) {
  return count ? `Messages, ${count} unread` : "Messages";
}

/** Where a row opens. A card's mention opens its thread; a decision opens the card. */
export function rowTarget(row) {
  if (!row) return null;
  if (row.kind === "chat" && row.threadId) return { tab: "chats", threadId: row.threadId };
  if (row.kind === "card" && row.cardId) {
    return { hash: row.group === "mention" ? `#/work-board?card=${row.cardId}&side=thread:${row.cardId}` : `#/work-board?card=${row.cardId}` };
  }
  const route = inAppRoute(row.link);
  return route ? { hash: route } : null;
}

/** The thread id a #/messages?thread=<id> address names, or null. */
export function threadFromSearch(search) {
  let params;
  try {
    params = new URLSearchParams(typeof search === "string" ? search : "");
  } catch {
    return null;
  }
  const id = params.get("thread") || "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Settings (D14): one table, the same rows the Host app writes.
// ---------------------------------------------------------------------------

// #4255 fix-up: direct messages and group messages are switched apart. A
// group message only ever pushes (team chat lives in Team chats, never a
// notification list), so its row has a push switch alone; `channels` says
// which switches a row has.
// #4255 rework: a direct message never makes an in-app notice either (it is
// read in its chat), so its row has the push switch alone (orchestrator
// decision, 11 Nov). "My cards due and late" is the 09:00 push (design
// contract). A row with `hintOn` says what its push switch does right now.
export const SETTING_ROWS = Object.freeze([
  { key: "business.team_mention", label: "Mentions and tags", hint: "On work cards, in team chats", email: "admin.team_mention", channels: ["inapp", "push"] },
  { key: "business.team_decision", label: "Decisions for me", hint: "Approve, sent back, You send", email: null, channels: ["inapp", "push"] },
  { key: "business.team_message", label: "Direct messages", hint: "Push on by default", email: null, channels: ["push"] },
  { key: "business.team_group_message", label: "Group messages", hint: "Push off: only when you’re mentioned", hintOn: "Push on: every group message", email: null, channels: ["push"] },
  { key: "business.team_due", label: "My cards due and late", hint: "One push at 9:00 your time", email: null, channels: ["inapp", "push"] },
]);

/** The words under a setting, following its push switch (#4255 rework). */
export function settingHint(row, rows) {
  if (!row) return "";
  return row.hintOn && teamPrefOn(rows, row.key, "push") ? row.hintOn : row.hint;
}

/**
 * Whether a switch is on. No row means the default: in-app and push on,
 * except group message pushes, which stay off until switched on (a DM always
 * pushes), exactly as team_chat_enqueue reads them.
 */
export function teamPrefOn(rows, key, channel) {
  const row = (Array.isArray(rows) ? rows : []).find((r) => r.category_key === key && r.channel === channel);
  if (row) return !!row.enabled;
  return key !== "business.team_group_message";
}

// ---------------------------------------------------------------------------
// Team chats.
// ---------------------------------------------------------------------------

/** The people a composer @-lists (everyone but me), as RichComposer reads them. */
export function composerPeople(people) {
  return (Array.isArray(people) ? people : []).filter((p) => p && !p.me && p.email).map((p) => ({ email: p.email, name: p.name || p.email }));
}

/** RichComposer's mentioned emails as team user ids (only people in this chat). */
export function mentionIds(emails, people, members) {
  const inChat = new Set((Array.isArray(members) ? members : []).map((m) => m.user_id));
  const byEmail = new Map((Array.isArray(people) ? people : []).map((p) => [String(p.email || "").toLowerCase(), p.user_id]));
  const out = [];
  for (const e of Array.isArray(emails) ? emails : []) {
    const id = byEmail.get(String(e || "").toLowerCase());
    if (id && (!inChat.size || inChat.has(id)) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * #4255 fix-up: one chat's messages from the pages read so far (older first),
 * oldest first, each message once (a newer copy wins, so an edit or a delete
 * seen on the latest page replaces the copy on an older page).
 */
export function mergeTeamPages(olderRows, newerRows) {
  const byId = new Map();
  for (const m of [...(Array.isArray(olderRows) ? olderRows : []), ...(Array.isArray(newerRows) ? newerRows : [])]) {
    if (m && m.id) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
}

/** The p_before for the next older page: the oldest message shown. */
export function olderCursor(messages) {
  const first = Array.isArray(messages) && messages.length ? messages[0] : null;
  return first?.created_at || null;
}

/** "Photo", "Document" or "Link" for a message with no words (the server's last_message.preview). */
export function threadPreview(thread) {
  const last = thread?.last_message;
  if (!last) return "No messages yet";
  const who = last.author_name ? `${last.author_name}: ` : "";
  return `${who}${last.preview || ""}`.trim();
}

/** The chats a find box keeps (by title), newest first as the server sent them. */
export function filterThreads(threads, query) {
  const q = String(query || "").trim().toLowerCase();
  const list = Array.isArray(threads) ? threads : [];
  return q ? list.filter((t) => String(t.title || "").toLowerCase().includes(q)) : list;
}

/** Teammates matching a find box who have no direct message with me yet. */
export function peopleToStart(people, threads, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const dmWith = new Set((Array.isArray(threads) ? threads : []).filter((t) => t.kind === "dm").map((t) => t.other_user_id));
  return (Array.isArray(people) ? people : [])
    .filter((p) => !p.me && !dmWith.has(p.user_id) && (String(p.name || "").toLowerCase().includes(q) || String(p.email || "").toLowerCase().includes(q)))
    .slice(0, 6);
}

// #4255 rework 2 (P1): the browser's IANA time zone ("Africa/Lagos"), or null.
// Admin saves it on the teammate's profile (team_set_my_timezone) so quiet
// hours (22:00 to 07:00) and the 09:00 due notice follow their own clock.
export function deviceTimeZone(intl = globalThis.Intl) {
  try {
    const zone = intl?.DateTimeFormat?.().resolvedOptions?.().timeZone;
    return typeof zone === "string" && zone.trim() !== "" ? zone.trim() : null;
  } catch {
    return null;
  }
}

/** The zone to send now, or null: nothing known, or already saved by this tab. */
export function timeZoneToSave(lastSaved, zone) {
  return zone && zone !== lastSaved ? zone : null;
}

/**
 * One save per zone per person (in this tab): returns sync(userId, zone),
 * which calls save(zone) only for a new zone and remembers it once saved
 * (a failed save is tried again next time).
 */
export function createTimeZoneSync(save) {
  const saved = new Map();
  return async function sync(userId, zone) {
    if (!userId) return null;
    const next = timeZoneToSave(saved.get(userId) ?? null, zone);
    if (!next) return null;
    const result = await save(next);
    saved.set(userId, next);
    return result;
  };
}

/** The read-only line under the settings. */
export function timeZoneLine(zone) {
  return zone ? `Time zone: ${zone} (from this device)` : null;
}
