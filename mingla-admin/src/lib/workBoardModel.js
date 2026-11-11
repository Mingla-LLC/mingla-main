// Issue #4255 (Work board v2, waves W2 and W3) — the rules the new board, the
// sprint bar and the card panel share. Pure module: no React, no Supabase, so
// a plain node test reads it.
//
//   * Columns are statuses (ops_work_statuses). Every column belongs to one of
//     three groups: todo (Not started), doing (Active), done (Closed).
//   * A card is dragged to change its column only; the order inside a column
//     stays automatic (late first, then by due date; Closed latest first).
//   * Dropping into a Closed column asks for proof first; a stale revision
//     (PT409, token stale_write) snaps the card back with one sentence.
//   * Up to five sprint goals; subtasks go two levels deep (card, subtask,
//     sub-subtask); files are pictures, documents or links, 25 MB each.
import { sortColumn, todayIso } from "./opsModel.js";

export const GROUP_LABELS = Object.freeze({ todo: "Not started", doing: "Active", done: "Closed" });
export const GROUPS = Object.freeze(["todo", "doing", "done"]);

/** Colours offered for a new or recoloured column (stored as data on the column). */
export const COLUMN_COLORS = Object.freeze(["#8a847b", "#2f6fd6", "#f97316", "#7a4fd1", "#c2367a", "#c27a12", "#1f8a5b", "#c42b1c"]);

export const GOAL_LIMIT = 5;
export const MAX_DEPTH = 2;
export const FILE_MAX_BYTES = 26214400;
export const FILES_PER_CARD = 50;
export const FILES_PER_MESSAGE = 10;
export const COLUMN_LIMIT = 20;

/** The board's live columns, in order. Anything malformed is dropped. */
export function liveColumns(statuses) {
  return (Array.isArray(statuses) ? statuses : [])
    .filter((s) => s && typeof s.id === "string" && GROUPS.includes(s.grp) && !s.archived)
    .slice()
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
}

/** The column a card sits in: its status_id, else the first column of its group. */
export function cardColumnId(card, columns) {
  const cols = liveColumns(columns);
  if (card?.status_id && cols.some((c) => c.id === card.status_id)) return card.status_id;
  const grp = card?.status === "person" ? "todo" : card?.status;
  return cols.find((c) => c.grp === grp)?.id || null;
}

/**
 * Each column with its cards in order. `info` is ops_work_list's
 * status_columns ({ [status_id]: { total, shown, truncated } }); without it the
 * count is what is listed (Show or Linked to filter here, in the browser).
 */
export function boardColumns(columns, cards, info = null) {
  const cols = liveColumns(columns);
  const buckets = new Map(cols.map((c) => [c.id, []]));
  for (const card of Array.isArray(cards) ? cards : []) {
    const id = cardColumnId(card, cols);
    if (id && buckets.has(id)) buckets.get(id).push(card);
  }
  return cols.map((col) => {
    const list = sortColumn(buckets.get(col.id), col.grp === "done" ? "done" : "todo");
    const i = info?.[col.id];
    const total = i && Number.isFinite(Number(i.total)) ? Number(i.total) : list.length;
    return { ...col, cards: list, count: total, cut: !!i?.truncated, shown: Number(i?.shown) || list.length };
  });
}

/**
 * What a drop means. `same` changes nothing; `close` opens the proof sheet
 * first (nothing is saved until it is sent); `move` saves at once.
 */
export function planMove(card, toColumn) {
  if (!card || !toColumn) return { kind: "none" };
  if (card.status_id === toColumn.id) return { kind: "same" };
  if (toColumn.grp === "done" && card.status !== "done") return { kind: "close" };
  return { kind: "move" };
}

/** The board's cards with one card shown in another column (the optimistic move). */
export function moveLocally(cards, cardId, toColumn) {
  return (Array.isArray(cards) ? cards : []).map((c) => (c.id === cardId
    ? { ...c, status_id: toColumn.id, status: toColumn.grp, column: { id: toColumn.id, name: toColumn.name, color: toColumn.color, grp: toColumn.grp } }
    : c));
}

export const MOVE_CONFLICT_WORDS = "Someone changed this card. It is back where it was.";

/** Words for a failed move. A conflict (PT409) puts the card back and says so. */
export function moveErrorWords(error, fallback) {
  if (error?.token === "stale_write") return MOVE_CONFLICT_WORDS;
  return fallback(error);
}

/** Whether this viewer can change the columns (full admins in person; the server checks again). */
export function canChangeColumns(statusRead, config) {
  if (typeof statusRead?.can_change === "boolean") return statusRead.can_change;
  return !!config?.me?.can_columns;
}

/** A column name is 1 to 30 characters on one line, and not already on the board. */
export function columnNameProblem(name, columns, selfId = null) {
  const v = String(name || "").replace(/\s+/g, " ").trim();
  if (!v || v.length > 30) return "Name the column in 1 to 30 characters.";
  if (liveColumns(columns).some((c) => c.id !== selfId && c.name.toLowerCase() === v.toLowerCase())) return `A column called “${v}” is already on the board.`;
  return "";
}

/** The columns a column's cards can move to when it is archived (same group, not itself). */
export function archiveTargets(column, columns) {
  return liveColumns(columns).filter((c) => c.id !== column?.id && c.grp === column?.grp);
}

/** "To do" is the only Not started column: it cannot be archived until another exists. */
export function lastOfGroup(column, columns) {
  return archiveTargets(column, columns).length === 0;
}

// ---------------------------------------------------------------------------
// The one-line header.
// ---------------------------------------------------------------------------

/**
 * How the one-line header fits its width: `full` shows the three filter chips,
 * `folded` puts them behind one Filters button (under 1,150px), `compact` also
 * shows only the active tab (under 640px). The row never wraps.
 */
export function headerFit(width) {
  const w = Number(width) || 0;
  if (w >= 1150) return "full";
  if (w >= 640) return "folded";
  return "compact";
}

/** How many of the three filters are on. */
export function activeFilterCount({ owner = null, show = "", linked = "" } = {}) {
  return [owner, show, linked].filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Sprint goals, capacity and the planner.
// ---------------------------------------------------------------------------

export const GOAL_STATES = Object.freeze([
  Object.freeze({ value: "on_track", label: "On track" }),
  Object.freeze({ value: "at_risk", label: "At risk" }),
  Object.freeze({ value: "done", label: "Done" }),
  Object.freeze({ value: "missed", label: "Missed" }),
]);

export function goalStateLabel(state) {
  return GOAL_STATES.find((s) => s.value === state)?.label || "On track";
}

/** A sprint takes up to five live goals. */
export function canAddGoal(goals) {
  return (Array.isArray(goals) ? goals.filter((g) => g && !g.archived) : []).length < GOAL_LIMIT;
}

export function goalTitleProblem(title) {
  const v = String(title || "").replace(/\s+/g, " ").trim();
  return v.length < 3 || v.length > 80 ? "Say the goal in 3 to 80 characters." : "";
}

/** "6 h", "1.5 h", "45 min"; nothing for no estimate. */
export function hoursLabel(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return "";
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.round((m / 60) * 10) / 10;
  return `${h} h`;
}

/** "1.5" hours typed -> 90 minutes; anything else -> null (or a problem). */
export function parseEstimate(text) {
  const v = String(text ?? "").trim().toLowerCase().replace(/\s*(h|hr|hrs|hours?)$/, "");
  if (v === "") return { minutes: null, problem: "" };
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return { minutes: null, problem: "An estimate is hours, from 0.1 to 1,000." };
  return { minutes: Math.max(1, Math.round(n * 60)), problem: "" };
}

/** A teammate's planned minutes against their hours. Over 100% is red. */
export function capacityUse(row) {
  const hours = row?.hours ?? row?.hours_default;
  const planned = Number(row?.planned_minutes) || 0;
  if (hours === null || hours === undefined || hours === "") return { pct: null, over: false, set: false };
  const cap = Number(hours) * 60;
  if (!Number.isFinite(cap) || cap <= 0) return { pct: planned > 0 ? Infinity : 0, over: planned > 0, set: true };
  const pct = Math.round((planned / cap) * 100);
  return { pct, over: pct > 100, set: true };
}

/** The team's planned hours against its hours, for the sprint bar. */
export function teamCapacity(capacity) {
  let plannedMin = 0;
  let capHours = 0;
  let anySet = false;
  for (const row of Array.isArray(capacity) ? capacity : []) {
    plannedMin += Number(row?.planned_minutes) || 0;
    const h = row?.hours ?? row?.hours_default;
    if (h !== null && h !== undefined && h !== "") { capHours += Number(h) || 0; anySet = true; }
  }
  const plannedHours = Math.round((plannedMin / 60) * 10) / 10;
  return { plannedHours, capHours, set: anySet, over: anySet && plannedHours > capHours };
}

/** Day n of 7 of the sprint that starts on `startsOn` (0 before, 8 after). */
export function sprintDay(startsOn, today = todayIso()) {
  if (!startsOn) return 0;
  const d = Math.round((new Date(`${String(today).slice(0, 10)}T00:00:00Z`) - new Date(`${String(startsOn).slice(0, 10)}T00:00:00Z`)) / 86_400_000) + 1;
  if (d < 1) return 0;
  return d > 7 ? 8 : d;
}

/** Cards done of cards planned, from the planner's in-sprint list. */
export function sprintProgress(inSprint) {
  const list = Array.isArray(inSprint) ? inSprint : [];
  const done = list.filter((c) => c?.status === "done").length;
  return { done, planned: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Subtasks.
// ---------------------------------------------------------------------------

/** A card at depth 2 (a sub-subtask) takes no subtasks of its own. */
export function canHaveSubtasks(card) {
  return Number(card?.depth || 0) < MAX_DEPTH;
}

/** "3 of 5 done" and the bar's percentage. */
export function subtaskProgress(counts) {
  const total = Number(counts?.total) || 0;
  const done = Number(counts?.done) || 0;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0, words: total ? `${done} of ${total} done` : "" };
}

/** The ids in a new order after one subtask moved (for ops_subtask_reorder). */
export function reorderIds(ids, fromId, toId) {
  const list = Array.isArray(ids) ? ids.slice() : [];
  const from = list.indexOf(fromId);
  const to = list.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list;
}

/** The proof a ticked subtask closes with: it says plainly where it came from. */
export function tickProof(name) {
  const who = String(name || "").trim();
  return [{ kind: "text", text: who ? `Ticked done in the subtask list by ${who}.` : "Ticked done in the subtask list." }];
}

// ---------------------------------------------------------------------------
// Files and links.
// ---------------------------------------------------------------------------

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];
const DOC_MIMES = {
  "application/pdf": "PDF",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.ms-powerpoint": "PowerPoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  "text/plain": "Text",
  "text/csv": "CSV",
  "application/vnd.apple.keynote": "Keynote",
  "application/vnd.apple.numbers": "Numbers",
  "application/vnd.apple.pages": "Pages",
};
const EXT_MIMES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic",
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", key: "application/vnd.apple.keynote", numbers: "application/vnd.apple.numbers", pages: "application/vnd.apple.pages",
};

/** The type a file is sent as: its own, or one read from its name when the browser gives none. */
export function fileMime(file) {
  const own = String(file?.type || "").toLowerCase();
  if (IMAGE_MIMES.includes(own) || Object.hasOwn(DOC_MIMES, own)) return own;
  const ext = String(file?.name || "").split(".").pop().toLowerCase();
  return EXT_MIMES[ext] || own;
}

/** image, document, or null when a card does not take this type. */
export function fileKind(file) {
  const mime = fileMime(file);
  if (IMAGE_MIMES.includes(mime)) return "image";
  if (Object.hasOwn(DOC_MIMES, mime)) return "document";
  return null;
}

/** Why a file cannot be added, before anything is uploaded; "" when it can. */
export function fileProblem(file) {
  const name = String(file?.name || "This file");
  if (!fileKind(file)) return `${name} is not a type a card takes. Pictures: JPEG, PNG, WebP, GIF or HEIC. Documents: PDF, Word, Excel, PowerPoint, text, CSV, Keynote, Numbers or Pages.`;
  if (Number(file?.size) > FILE_MAX_BYTES) return `${name} is over 25 MB. Share it as a link instead.`;
  if (!(Number(file?.size) > 0)) return `${name} is empty.`;
  return "";
}

/** "PDF", "Word"… for a document tile. */
export function docTypeLabel(mime) {
  return DOC_MIMES[String(mime || "").toLowerCase()] || "File";
}

/** "1.2 MB", "840 KB". */
export function sizeLabel(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}

/** Links start with https:// and stay under 2,000 characters. */
export function linkProblem(url) {
  const v = String(url || "").trim();
  if (!/^https:\/\/[^\s]+$/.test(v) || v.length < 9 || v.length > 2000) return "Links start with https:// and stay under 2,000 characters.";
  return "";
}

/** A friendly name for a link: Google Doc, Instagram post, or the site's name. No page is fetched. */
export function linkFriendlyName(url) {
  let u;
  try { u = new URL(String(url || "")); } catch { return ""; }
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname;
  if (host === "docs.google.com") {
    if (path.startsWith("/document")) return "Google Doc";
    if (path.startsWith("/spreadsheets")) return "Google Sheet";
    if (path.startsWith("/presentation")) return "Google Slides";
    if (path.startsWith("/forms")) return "Google Form";
  }
  if (host === "drive.google.com") return path.includes("/folders/") ? "Google Drive folder" : "Google Drive file";
  if (host === "instagram.com") return path.startsWith("/reel") ? "Instagram reel" : path.startsWith("/p/") ? "Instagram post" : "Instagram";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "TikTok";
  if (host === "youtube.com" || host === "youtu.be") return "YouTube video";
  if (host === "github.com") return "GitHub";
  if (host === "figma.com") return "Figma";
  return host;
}

/** The host of a link, for its tile. */
export function linkHost(url) {
  try { return new URL(String(url || "")).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// ---------------------------------------------------------------------------
// The thread.
// ---------------------------------------------------------------------------

/** Messages grouped by day, oldest first; a run of one person's messages shows their name once. */
export function threadDays(messages, now = new Date()) {
  const out = [];
  let lastDay = "";
  let lastAuthor = "";
  let lastAt = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    const at = new Date(m?.created_at || 0);
    const day = Number.isNaN(at.getTime()) ? "" : at.toISOString().slice(0, 10);
    if (day !== lastDay) { out.push({ day, label: dayHeading(at, now), items: [] }); lastDay = day; lastAuthor = ""; }
    const author = `${m?.author_email || ""}|${m?.via || ""}`;
    const t = at.getTime();
    const collapsed = author === lastAuthor && t - lastAt < 10 * 60_000 && !m?.deleted;
    out[out.length - 1].items.push({ message: m, collapsed });
    lastAuthor = author;
    lastAt = t;
  }
  return out;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Yesterday", or "Monday 3 Nov". */
export function dayHeading(at, now = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (key(d) === key(now)) return "Today";
  if (key(d) === key(y)) return "Yesterday";
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "09:12". */
export function clockTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Teammates mentioned in a message who are neither owners nor watchers of the card. */
export function mentionedOutsiders(mentionEmails, card) {
  const on = new Set([...(card?.owners || []), ...(card?.watchers || [])].map((p) => String(p?.email || "").toLowerCase()));
  return Array.from(new Set((Array.isArray(mentionEmails) ? mentionEmails : []).map((e) => String(e || "").toLowerCase()).filter((e) => e && e !== "everyone" && !on.has(e))));
}

export const REACTIONS = Object.freeze(["👍", "🙏", "🎉", "❤️", "👀", "✅"]);

/** Whether "Show changes" is on for this person (remembered in this browser). */
export function readShowChanges(storage) {
  try { return storage?.getItem?.("mingla:work-thread-changes") === "1"; } catch { return false; }
}
export function writeShowChanges(storage, on) {
  try { storage?.setItem?.("mingla:work-thread-changes", on ? "1" : "0"); } catch { /* the switch still works for this visit */ }
}
