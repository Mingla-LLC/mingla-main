// Issue #3802 (Wave 1) — the rules the Hosts and Creators boards share.
//
// Pure module: no React, no Supabase import. Everything here is a fast local
// answer for the screen; the server (the crm_* functions) is the authority on
// every one of these rules and is asked again on every write.

// Characters the server drops before it compares two names (crm_name_key):
// every kind of blank space and every invisible or control character.
// Written as code points on purpose: several of these characters are
// invisible, and two of them end a line in JavaScript source.
// (The control and combining characters in the class are the point of it.)
/* eslint-disable no-control-regex, no-misleading-character-class */
const NAME_KEY_DROPPED =
  /[\s\u0001-\u001F\u007F-\u00A0\u00AD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180F\u2000-\u200F\u2028-\u202F\u205F-\u206F\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB]+/g;
/* eslint-enable no-control-regex, no-misleading-character-class */

/**
 * One name, one key: case, spacing, punctuation and a leading @ do not make a
 * new record. Same rule as the server's crm_name_key().
 */
export function nameKey(name) {
  if (typeof name !== "string") return "";
  const seen = name.replace(NAME_KEY_DROPPED, "").toLowerCase();
  const key = seen.replace(/[^\p{L}\p{N}]+/gu, "");
  return key === "" ? seen : key;
}

/** "tunde.a@usemingla.com" -> "Tunde". Same rule as crm_display_name(). */
export function displayName(email) {
  if (typeof email !== "string" || email.trim() === "") return "";
  const local = email.trim().split("@")[0];
  const first = (local.match(/^[^._+-]+/) || [""])[0];
  if (first === "") return email.trim();
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function stageDef(def, stageId) {
  return (def?.stages || []).find((s) => s.id === stageId) || null;
}

export function stageLabel(def, stageId) {
  return stageDef(def, stageId)?.label || stageId || "";
}

export function icpLabel(def, icpId) {
  return (def?.icps || []).find((i) => i.id === icpId)?.label || "";
}

export function terminalStage(def) {
  return (def?.stages || []).find((s) => s.terminal) || null;
}

const STAGE_VARIANTS = {
  live: "success",
  onboarded: "success",
  booked: "success",
  posted: "success",
  replied: "info",
  meeting: "info",
  negotiating: "info",
  lost: "error",
  passed: "error",
};

export function stageBadgeVariant(stageId) {
  return Object.hasOwn(STAGE_VARIANTS, stageId) ? STAGE_VARIANTS[stageId] : "default";
}

/**
 * The stage the arrow on a card moves to, or null when there is no arrow: the
 * record is in its closing stage, or the next stage sets itself (Live) or is
 * the closing stage (Lost, Passed — those ask for a reason first).
 */
export function nextStage(def, record) {
  const stages = def?.stages || [];
  const i = stages.findIndex((s) => s.id === record?.stage);
  if (i < 0) return null;
  if (stages[i].terminal) return null;
  const next = stages[i + 1];
  if (!next || next.terminal || next.auto) return null;
  return next;
}

/** Creators: Booked and every later stage except the closing one. */
export function stageNeedsSignedAgreement(def, stageId) {
  if (def?.id !== "creators") return false;
  const stages = def.stages || [];
  const booked = stages.findIndex((s) => s.id === "booked");
  const at = stages.findIndex((s) => s.id === stageId);
  return booked >= 0 && at >= booked && !stages[at].terminal;
}

// The same words the server uses, so a move the screen stops and a move the
// server refuses read identically.
export const MOVE_BLOCK_COPY = {
  stage_sets_itself:
    "Live sets itself when the linked brand has a public listing. Move the card to Onboarded and link the brand instead.",
  stage_is_live:
    "This host has a public listing, so it stays in Live. Mark it as lost if the relationship ended.",
};

/**
 * Why a move cannot happen, decided before the server is asked.
 * Returns null (go ahead), or { token, message, needsReason }.
 */
export function moveBlocker(def, record, toStageId) {
  const to = stageDef(def, toStageId);
  if (!to || !record || record.stage === toStageId) return { token: "same", message: "" };
  if (to.auto) return { token: "stage_sets_itself", message: MOVE_BLOCK_COPY.stage_sets_itself };
  if (stageDef(def, record.stage)?.auto && !to.terminal) {
    return { token: "stage_is_live", message: MOVE_BLOCK_COPY.stage_is_live };
  }
  if (stageNeedsSignedAgreement(def, toStageId) && record.agreement !== "signed") {
    return {
      token: "agreement_required",
      message: `Mark the agreement as signed before moving to ${to.label}.`,
    };
  }
  return null;
}

/** YYYY-MM-DD for the viewer's own calendar day. */
export function localToday(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** overdue | today | later | none */
export function dueState(dueOn, today) {
  if (typeof dueOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return "none";
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return "later";
  if (dueOn < today) return "overdue";
  if (dueOn === today) return "today";
  return "later";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-31" -> "Oct 31" (the year is added when it is not this year). */
export function shortDate(dueOn, today) {
  if (typeof dueOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return "";
  const [y, m, d] = dueOn.split("-").map(Number);
  const label = `${MONTHS[m - 1] || ""} ${d}`;
  return typeof today === "string" && today.slice(0, 4) === String(y) ? label : `${label}, ${y}`;
}

/** "Lagos" -> "lagos", "New York" -> "new-york", "São Paulo" -> "sao-paulo". */
export function regionSlug(name) {
  if (typeof name !== "string") return "";
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The address value for "records with no region yet". */
export const NO_REGION = "none";

export function regionBySlug(regions, slug) {
  if (typeof slug !== "string" || slug === "") return null;
  return (regions || []).find((r) => regionSlug(r.name) === slug) || null;
}

export function regionName(regions, regionId) {
  return (regions || []).find((r) => r.id === regionId)?.name || "";
}

/**
 * Teammate names for a card: "Tunde, Maya". Two teammates whose addresses give
 * the same first name are told apart by their full address.
 */
export function displayOwners(record, team) {
  const owners = Array.isArray(record?.owners) ? record.owners : [];
  if (owners.length === 0) return "Unassigned";
  return owners.map((email) => ownerLabel(email, team)).join(", ");
}

export function ownerLabel(email, team) {
  const list = Array.isArray(team) ? team : [];
  const mine = list.find((t) => t.email === email);
  const name = mine?.display_name || displayName(email);
  const clash = list.some((t) => t.email !== email && (t.display_name || displayName(t.email)) === name);
  return clash ? email : name;
}

/**
 * Filter a loaded pipeline. `regionId` is a region id, or NO_REGION for
 * records without one. `mine` keeps the records `me` (an email) owns.
 */
export function filterRecords(records, { q = "", icp = "", regionId = "", mine = false, me = "" } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  const needleKey = nameKey(needle);
  return (Array.isArray(records) ? records : []).filter((r) => {
    if (icp && r.icp !== icp) return false;
    if (regionId === NO_REGION ? !!r.region_id : regionId && r.region_id !== regionId) return false;
    if (mine && !(Array.isArray(r.owners) && r.owners.includes(me))) return false;
    if (!needle) return true;
    const name = String(r.name || "").toLowerCase();
    return name.includes(needle) || (needleKey.length >= 2 && nameKey(name).includes(needleKey));
  });
}

export function hasActiveFilters({ q, icp, region, mine } = {}) {
  return !!(String(q || "").trim() || icp || region || mine);
}

/** { stageId: [records] } with every stage of the pipeline present. */
export function groupByStage(def, records) {
  const out = {};
  for (const s of def?.stages || []) out[s.id] = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (Object.hasOwn(out, r.stage)) out[r.stage].push(r);
  }
  return out;
}

/** List order: overdue first, then by date, no date last, then by name. */
export function sortForList(records) {
  return [...(Array.isArray(records) ? records : [])].sort((a, b) => {
    const da = a.due_on || "9999-99-99";
    const db = b.due_on || "9999-99-99";
    if (da !== db) return da < db ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

/**
 * The By-region table: one row per region that has a matching record, in the
 * order the server lists regions, then a "No region" row when any exist.
 */
export function byRegionTable(def, records, regions) {
  const stages = (def?.stages || []).map((s) => s.id);
  const rows = new Map();
  const blank = () => Object.fromEntries(stages.map((id) => [id, 0]));
  for (const r of Array.isArray(records) ? records : []) {
    const key = r.region_id || NO_REGION;
    if (!rows.has(key)) rows.set(key, { counts: blank(), total: 0 });
    const row = rows.get(key);
    if (Object.hasOwn(row.counts, r.stage)) row.counts[r.stage] += 1;
    row.total += 1;
  }
  const out = [];
  for (const region of regions || []) {
    const row = rows.get(region.id);
    if (row) out.push({ regionId: region.id, slug: regionSlug(region.name), name: region.name, ...row });
  }
  // A record whose region is no longer in the list still counts somewhere.
  let none = rows.get(NO_REGION) || null;
  const known = new Set((regions || []).map((r) => r.id));
  for (const [key, row] of rows) {
    if (key === NO_REGION || known.has(key)) continue;
    if (!none) none = { counts: blank(), total: 0 };
    for (const id of stages) none.counts[id] += row.counts[id];
    none.total += row.total;
  }
  if (none) out.push({ regionId: NO_REGION, slug: NO_REGION, name: "No region", ...none });
  return out;
}

/**
 * Records that look like the name being typed. Same rule as the server's
 * crm_duplicate_check: exact = same key; similar = both keys have 3 or more
 * characters and one contains the other (up to 5).
 */
export function findDuplicates(records, name, excludeId = null) {
  const key = nameKey(String(name || "").trim().replace(/\s+/g, " "));
  if (key === "") return { exact: null, similar: [] };
  let exact = null;
  const similar = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (excludeId && r.id === excludeId) continue;
    const other = nameKey(r.name);
    if (other === key) {
      exact = exact || r;
    } else if (key.length >= 3 && other.length >= 3 && (other.includes(key) || key.includes(other))) {
      similar.push(r);
    }
  }
  similar.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { exact, similar: similar.slice(0, 5) };
}

// ── Server answers in plain words ───────────────────────────────────────────

/**
 * Turn whatever the data layer threw into { token, message, detail }.
 * The crm_* functions raise "<token>: <plain words>"; anything else (a network
 * failure, an expired sign-in, a function that is not there yet) gets a token
 * of its own so the screen never shows a raw error.
 */
export function parseServerError(err) {
  const raw = typeof err?.message === "string" ? err.message : "";
  const code = typeof err?.code === "string" ? err.code : "";
  const detail = typeof err?.details === "string" ? err.details : "";
  const m = raw.match(/^([a-z][a-z_]{1,39}):\s*([\s\S]*)$/);
  if (m) return { token: m[1], message: m[2].trim(), detail };
  if (raw === "forbidden" || code === "42501") return { token: "forbidden", message: "", detail };
  if (code === "PGRST202" || code === "42883") return { token: "not_ready", message: "", detail };
  if (code === "PGRST301" || code === "PGRST303" || /jwt/i.test(raw)) return { token: "signed_out", message: "", detail };
  if (
    err instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(raw) ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  ) {
    return { token: "network", message: "", detail };
  }
  return { token: "unknown", message: "", detail };
}

const GENERIC = "That didn't save. Try again, and if it keeps happening tell an admin.";
const STALE = "This page is out of date. Reload it and try again.";

// Tokens whose server message is already written for the person on screen.
const SERVER_WORDS = new Set([
  "stage_sets_itself",
  "stage_is_live",
  "agreement_required",
  "reason_required",
  "duplicate_name",
  "undo_expired",
  "undo_not_live",
  "invalid_name",
  "invalid_body",
  "invalid_followers",
  "invalid_message_ref",
  "too_many_owners",
]);

// Tokens whose server message is written for a caller of the function (it
// names functions and formats), so the screen says it its own way.
const OWN_WORDS = {
  not_found: "That record is no longer here. It may have been deleted.",
  try_again: "Someone else changed this at the same moment, so nothing was saved. Try again.",
  network: "You seem to be offline, so that didn't go through. Check your connection and try again.",
  signed_out: "Your sign-in ran out. Reload the page and sign in again.",
  not_ready: "Hosts and Creators aren't switched on yet. Try again in a few minutes, or tell an admin.",
  unknown: GENERIC,
  invalid_stage: STALE,
  invalid_pipeline: STALE,
  invalid_kind: STALE,
  invalid_fields: STALE,
  invalid_entry: STALE,
  invalid_value: STALE,
  invalid_mode: STALE,
  invalid_items: STALE,
  invalid_occurred_at: STALE,
  unknown_field: STALE,
  field_not_for_pipeline: STALE,
  field_not_for_kind: STALE,
  request_key_required: STALE,
  request_key_reused: STALE,
  too_many: STALE,
  invalid_icp: "That ICP is no longer in the list. Pick another.",
  invalid_region: "That region is no longer in the list. Pick another.",
  invalid_channel: "Pick a channel from the list.",
  invalid_source: "Pick a source from the list.",
  invalid_agreement: "Pick None, Sent or Signed.",
  invalid_direction: "Say whether you reached out or they replied.",
  invalid_reply_class: "A reply classification only applies to a message they sent you.",
  invalid_due_on: "Pick a real date.",
  invalid_brand: "That brand is no longer on Mingla. Search again and pick another.",
  invalid_place: "That place is no longer in Mingla. Search again and pick another.",
  invalid_contact: "Keep the contact to 300 characters or fewer.",
  invalid_next_action: "Keep the next action to 200 characters or fewer.",
  invalid_rate: "Keep the rate to 120 characters or fewer.",
  invalid_owners: STALE,
  unknown_owner: "One of those people is no longer on the team. Reload the page and pick again.",
};

const FORBIDDEN_DEFAULT = "Your account can't use Hosts and Creators. Ask the owner to give you team access.";

// What to say for a token whose own sentence did not arrive with it.
const WORDS_WHEN_SERVER_SENT_NONE = {
  stage_sets_itself: MOVE_BLOCK_COPY.stage_sets_itself,
  stage_is_live: MOVE_BLOCK_COPY.stage_is_live,
  agreement_required: "Mark the agreement as signed first.",
  reason_required: "Add one line saying why, so the next person knows.",
  duplicate_name: "That name is already in the pipeline. Open the existing card instead.",
  undo_expired: "That move can no longer be undone. Move the card back by hand.",
  undo_not_live: "This host can't go back to Live right now. Move the card to Onboarded by hand.",
  invalid_name: "Add a name between 1 and 160 characters.",
  invalid_body: "Write what happened first, in 4000 characters or fewer.",
  invalid_followers: "Followers must be a whole number, 0 or more.",
  invalid_message_ref: "Keep the message link or id to 500 characters or fewer.",
  too_many_owners: "A card can have at most 10 owners.",
};

/** A sentence, not a bare word or a token: at least two words. */
function isSentence(text, token) {
  return text !== "" && text !== token && /\s/.test(text) && !/^[a-z_]+$/.test(text);
}

/**
 * The words to show for a server answer. Never a raw error, never a code and
 * never a token: a token this screen does not know gets the generic line, and
 * a known token that arrived without its sentence gets the prepared one.
 */
export function errorCopy(token, message) {
  const raw = typeof message === "string" ? message.trim() : "";
  const words = isSentence(raw, token) ? raw : "";
  if (token === "forbidden") return words || FORBIDDEN_DEFAULT;
  if (SERVER_WORDS.has(token)) {
    if (words) return words;
    return Object.hasOwn(WORDS_WHEN_SERVER_SENT_NONE, token) ? WORDS_WHEN_SERVER_SENT_NONE[token] : GENERIC;
  }
  if (Object.hasOwn(OWN_WORDS, token)) return OWN_WORDS[token];
  return GENERIC;
}

/** Shorthand for a caught error. */
export function errorWords(err) {
  if (err && typeof err.token === "string") return errorCopy(err.token, err.message);
  const parsed = parseServerError(err);
  return errorCopy(parsed.token, parsed.message);
}

const LOAD_GENERIC = "We couldn't load this. Check your connection and try again.";

/** The same, for something that failed to LOAD (nothing was being saved). */
export function loadErrorWords(err) {
  const token = err && typeof err.token === "string" ? err.token : parseServerError(err).token;
  if (token === "unknown" || token === "try_again" || token === "network") return LOAD_GENERIC;
  return errorWords(err);
}

// ── Edits on an open card that have not reached the server ────────────────
//
// A card saves each field by itself. These helpers answer, from plain data,
// "is anything this person typed still not on the server?" so the card can
// never say Saved while something is unsent, can send ALL of it on Try again,
// and can refuse to close quietly.

const FIELD_ORDER = [
  "name", "icp", "region_id", "owners", "contact", "channel", "source", "next_action", "due_on",
  "brand_id", "place_pool_id", "followers", "agreement", "rate",
];
const FIELD_LABELS = {
  name: "Name",
  icp: "ICP",
  region_id: "Region",
  owners: "Owners",
  contact: "Contact",
  channel: "Channel",
  source: "Source",
  next_action: "Next action",
  due_on: "Due",
  brand_id: "Brand link",
  place_pool_id: "Place link",
  followers: "Followers",
  agreement: "Agreement",
  rate: "Rate",
};
/** Fields that are typed (they save when focus leaves them). */
export const TEXT_FIELDS = ["name", "contact", "next_action", "rate", "followers"];

export function fieldLabel(key, pipeline) {
  if (key === "contact" && pipeline === "creators") return "Handle and reach";
  return Object.hasOwn(FIELD_LABELS, key) ? FIELD_LABELS[key] : "A field";
}

/** What a typed value becomes before it is compared or sent. */
export function normalizeTyped(key, raw) {
  const typed = String(raw ?? "").trim();
  return key === "name" ? typed.replace(/\s+/g, " ") : typed;
}

function savedText(record, key) {
  const v = record ? record[key] : null;
  return v === null || v === undefined ? "" : String(v);
}

/**
 * Typed, not yet sent: text drafts that differ from what is saved and are not
 * already listed as unsent. [{ key, value }]
 */
export function pendingTextEdits(drafts, record, unsent) {
  const out = [];
  for (const key of TEXT_FIELDS) {
    if (!drafts || !Object.hasOwn(drafts, key)) continue;
    if (unsent && Object.hasOwn(unsent, key)) continue;
    const value = normalizeTyped(key, drafts[key]);
    if (value !== savedText(record, key)) out.push({ key, value });
  }
  return out;
}

/** Every field whose last save failed, in the order the card shows them. */
export function unsentEdits(unsent) {
  const map = unsent && typeof unsent === "object" ? unsent : {};
  return FIELD_ORDER.filter((key) => Object.hasOwn(map, key)).map((key) => ({
    key,
    value: map[key].value,
    local: !!map[key].local,
  }));
}

/**
 * Everything that must be sent before the card may say Saved or close: EVERY
 * failed field (not only the latest) plus anything typed and not yet sent.
 */
export function editsToSend(drafts, record, unsent) {
  return [...unsentEdits(unsent), ...pendingTextEdits(drafts, record, unsent)];
}

/**
 * The card's save line.
 *   saving  -> "Saving..."
 *   unsent  -> "Not saved: <fields>" + Try again   (keys = the fields)
 *   pending -> typed, saves when focus leaves the field
 *   saved   -> "Saved · time"   (ONLY when nothing is unsent or pending)
 *   idle    -> "Changes save as you make them"
 */
export function saveLine({ saving = 0, drafts = {}, record = null, unsent = {}, savedAt = "" } = {}) {
  if (saving > 0) return { kind: "saving", keys: [] };
  const failed = unsentEdits(unsent);
  if (failed.length > 0) return { kind: "unsent", keys: failed.map((e) => e.key) };
  const pending = pendingTextEdits(drafts, record, unsent);
  if (pending.length > 0) return { kind: "pending", keys: pending.map((e) => e.key) };
  return { kind: savedAt ? "saved" : "idle", keys: [] };
}

/** True while closing the card would lose something. */
export function hasUnsavedEdits(state) {
  const kind = saveLine(state).kind;
  return kind === "saving" || kind === "unsent" || kind === "pending";
}

/**
 * The page keeps a card on screen while its edits are still unsent, even when
 * the address no longer names it (Close, Escape, the Back button).
 */
export function shouldHoldCard(shownCard, urlCard, dirtyCard) {
  return !!shownCard && shownCard !== urlCard && dirtyCard === shownCard;
}

// ── A card that moved while this person was looking at an old board ───────

/** How often the board refreshes by itself while the page is visible. */
export const BOARD_REFRESH_MS = 30_000;

function lastMoveInto(activity, stageId) {
  return (Array.isArray(activity) ? activity : []).find((a) => a.kind === "stage_move" && a.to_stage === stageId) || null;
}

/**
 * Before a move is sent, compare the card on screen with the server's copy.
 *   go      -> nothing changed, send the move
 *   already -> someone made this same move first: confirm it, send nothing
 *   moved   -> the card is somewhere else now: move nothing, say who and where
 */
export function freshnessVerdict(def, shown, fresh, toStageId, activity, now = Date.now()) {
  if (!shown || !fresh || fresh.stage === shown.stage) return { kind: "go" };
  const entry = lastMoveInto(activity, fresh.stage);
  const who = entry ? (entry.actor_email ? activityActor(entry) : "") : "";
  const when = entry ? relativeTime(entry.occurred_at, now) : "";
  const here = stageLabel(def, fresh.stage);
  const name = fresh.name || shown.name;
  if (fresh.stage === toStageId) {
    return {
      kind: "already",
      title: `${name} is already in ${here}`,
      description: who
        ? `${who} moved it there ${when}. Nothing else was changed.`
        : entry
          ? `It moved there by itself ${when}. Nothing else was changed.`
          : "Someone else moved it there first. Nothing else was changed.",
    };
  }
  const from = stageLabel(def, shown.stage);
  const how = who
    ? `${who} moved it from ${from} to ${here} ${when}.`
    : entry
      ? `It moved from ${from} to ${here} by itself ${when}.`
      : `It is in ${here} now, not ${from}.`;
  return {
    kind: "moved",
    title: `${name} is no longer in ${from}`,
    description: `${how} Your move was not made. The board is up to date now: move the card again if you still want to.`,
  };
}

// ── Activity log lines ─────────────────────────────────────────────────────

export function activityActor(entry) {
  if (!entry?.actor_email) return "System";
  return entry.actor_name || displayName(entry.actor_email);
}

/** The agent badge: shown only when something other than a person or the system acted. */
export function activityVia(entry) {
  return entry?.via && entry.via !== "system" ? entry.via : "";
}

/**
 * { headline, body, badge } for one log entry. Stage moves read "Moved from A
 * to B." with the reason beneath; touches read "<Channel> · reached out".
 */
export function activityLine(entry, def, vocab) {
  const channels = vocab?.channels || [];
  const replies = vocab?.reply_classes || [];
  if (entry?.kind === "stage_move") {
    const moved = `Moved from ${stageLabel(def, entry.from_stage)} to ${stageLabel(def, entry.to_stage)}.`;
    // The system writes its own full sentence; a person's move carries the reason.
    if (!entry.actor_email && entry.body) return { headline: entry.body, body: "", badge: "" };
    return { headline: moved, body: entry.body || "", badge: "" };
  }
  if (entry?.kind === "touch") {
    const channel = channels.find((c) => c.id === entry.channel)?.label || "Message";
    const way = entry.direction === "inbound" ? "they replied" : "reached out";
    return {
      headline: `${channel} · ${way}`,
      body: entry.body || "",
      badge: replies.find((c) => c.id === entry.reply_class)?.label || "",
      ref: entry.message_ref || "",
    };
  }
  return { headline: entry?.body || "", body: "", badge: "" };
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function relativeTime(iso, now = Date.now()) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** "3:42 pm" for the "Saved · time" line. */
export function clockTime(date = new Date()) {
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, "0");
  const half = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m} ${half}`;
}

/** A link is only ever opened when it is plainly a web address. */
export function safeHttpUrl(value) {
  if (typeof value !== "string") return "";
  const v = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(v) ? v : "";
}
