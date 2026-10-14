// Issue #3802 (Wave 1) — the rules the Hosts and Creators boards share.
//
// Pure module: no React, no Supabase import. Everything here is a fast local
// answer for the screen; the server (the crm_* functions) is the authority on
// every one of these rules and is asked again on every write.

// Characters the server drops before it compares two names (crm_name_key):
// every kind of space, and every character nobody can see. Like the server,
// this is decided by Unicode general category, not by a hand-picked list:
// control (Cc), format (Cf), private use (Co), unassigned (Cn) and lone
// surrogate (Cs) characters, the variation selectors, and a short list of
// assigned characters that have no shape of their own (fillers and blanks).
// The short list is written as code points on purpose: nobody could see or
// review those characters if they were typed into this file.
/* eslint-disable no-misleading-character-class */
const NAME_KEY_DROPPED =
  /[\s\p{Z}\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u2800\u3164\uFFA0\u{1D159}\u{16FE4}\u{1DA9B}-\u{1DA9F}\u{1DAA1}-\u{1DAAF}]+/gu;
// Combining marks of every script (Mn, Mc, Me). A name made only of these
// (and of dropped characters) has nothing visible in it. They are removed for
// that test only, never from the key of a name that has other characters, so
// a mark attached to a letter stays part of the name.
const NAME_KEY_MARKS = /\p{M}+/gu;
/* eslint-enable no-misleading-character-class */

/**
 * One name, one key: case, spacing, punctuation, a leading @, full-width or
 * plain letters, ligatures and composed or decomposed accents do not make a
 * new record. "" means the name has nothing visible in it. Same rule as the
 * server's crm_name_key(): fold to the compatibility form (NFKC), lower-case,
 * fold again, drop what nobody can see, then keep letters and digits (or, for
 * a name with none, what is left).
 */
export function nameKey(name) {
  if (typeof name !== "string") return "";
  const seen = name.normalize("NFKC").toLowerCase().normalize("NFKC").replace(NAME_KEY_DROPPED, "");
  if (seen.replace(NAME_KEY_MARKS, "") === "") return "";
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
  const ident = identNeedles(needle, String(q || "").trim());
  return (Array.isArray(records) ? records : []).filter((r) => {
    if (icp && r.icp !== icp) return false;
    if (regionId === NO_REGION ? !!r.region_id : regionId && r.region_id !== regionId) return false;
    if (mine && !(Array.isArray(r.owners) && r.owners.includes(me))) return false;
    if (!needle) return true;
    const name = String(r.name || "").toLowerCase();
    return (
      name.includes(needle) ||
      (needleKey.length >= 2 && nameKey(name).includes(needleKey)) ||
      identifierMatches(r.identifiers, ident)
    );
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
  "stage_changed",
  "lead_name_unusable",
  "do_not_contact",
  "warm_intro_only",
  "needs_a_person",
  "contact_rule_locked",
  "duplicate_identifier",
  "invalid_identifier",
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
  invalid_target: "A monthly target is a whole number from 1 to 1000.",
  invalid_identifiers: STALE,
  invalid_candidates: STALE,
  field_not_for_agents: STALE,
  invalid_contact_rule: "Pick None, Warm intro only or Do not contact, and say why in one line.",
  invalid_contact_rule_reason: "Keep the reason to 300 characters or fewer.",
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
  stage_changed:
    "Someone moved this card while you were looking at it, so nothing was moved. The board is up to date now: move it again if you still want to.",
  lead_name_unusable:
    "This lead's business name can't be used as a host name. Add the host by hand from Hosts.",
  do_not_contact: "This record is marked Do not contact, so nothing was logged.",
  warm_intro_only: "This record is marked Warm intro only, so nothing was logged.",
  needs_a_person: "This record has already been contacted, so a follow-up is a person's to log.",
  contact_rule_locked: "Only a person can lift or loosen a contact rule.",
  duplicate_identifier: "That email, phone or handle already belongs to another record. Open that record instead.",
  invalid_identifier: "That isn't a usable email, phone number or handle. Check it and try again.",
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

/**
 * One sentence from its parts, joined with single spaces. A part that is
 * empty (a log line with no time, say) leaves no gap before the full stop.
 */
function sentence(...parts) {
  return `${parts.filter((p) => typeof p === "string" && p !== "").join(" ")}.`;
}

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
  const when = entry && entry.occurred_at ? relativeTime(entry.occurred_at, now) : "";
  const here = stageLabel(def, fresh.stage);
  const name = fresh.name || shown.name;
  if (fresh.stage === toStageId) {
    return {
      kind: "already",
      title: `${name} is already in ${here}`,
      description: who
        ? `${sentence(who, "moved it there", when)} Nothing else was changed.`
        : entry
          ? `${sentence("It moved there by itself", when)} Nothing else was changed.`
          : "Someone else moved it there first. Nothing else was changed.",
    };
  }
  const from = stageLabel(def, shown.stage);
  const how = who
    ? sentence(`${who} moved it from ${from} to ${here}`, when)
    : entry
      ? sentence(`It moved from ${from} to ${here} by itself`, when)
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

// ── Homes, targets and Beta leads (issue #3802, Wave 1) ────────────────────
//
// Pure helpers for the role homes, the Team dashboard and the Beta leads
// page. Every number they are given was counted by the server; nothing here
// invents one.

function count(v) {
  return Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0;
}

/** { overdue, today, total } for one pipeline's due block (missing = zeros). */
export function dueTotals(due) {
  const overdue = count(due?.overdue);
  const today = count(due?.today);
  return { overdue, today, total: overdue + today };
}

/** The colour of a "done / target" pill: reached, started, or not started. */
export function targetPill(done, target) {
  const d = count(done);
  const t = count(target);
  if (t > 0 && d >= t) return "success";
  if (d > 0) return "warning";
  return "default";
}

/**
 * One row per stage for the "by stage" bars: [{ id, label, count, width }].
 * `width` is a percentage of the largest count; a stage with nobody in it is
 * a zero-width bar, never a made-up minimum.
 */
export function funnelRows(stages) {
  const rows = (Array.isArray(stages) ? stages : []).map((s) => ({
    id: String(s?.id ?? ""),
    label: String(s?.label ?? s?.id ?? ""),
    count: count(s?.count),
  }));
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return rows.map((r) => ({ ...r, width: max > 0 ? Math.round((r.count / max) * 1000) / 10 : 0 }));
}

/** The control a beta lead's row shows: "open" once a host exists, else "add". */
export function betaLeadButton(lead) {
  return lead?.host && typeof lead.host.id === "string" && lead.host.id !== "" ? "open" : "add";
}

const BETA_TYPE_LABELS = {
  restaurant: "Restaurant",
  cafe_bar: "Caf\u00E9 / Bar",
  club_nightlife: "Club / Nightlife",
  event_organiser: "Event organiser",
  experience_tour: "Experience / Tour",
  venue_space: "Venue / Space",
  other: "Other",
};

/** A beta lead type as the lead saw it on the form. */
export function betaTypeLabel(type) {
  return Object.hasOwn(BETA_TYPE_LABELS, type) ? BETA_TYPE_LABELS[type] : String(type ?? "");
}

/** The small line under "Add to Hosts": what will be carried over. */
export function betaSuggestionLine(lead) {
  const s = lead?.suggested || {};
  const icp = s.icp_note === "set" && s.icp_label ? `As ${s.icp_label}` : "ICP to pick on the card";
  const region = s.region_note === "set" && s.region_name ? s.region_name : "Region to pick on the card";
  return `${icp} ${String.fromCharCode(183)} ${region}`;
}

export const BETA_CONVERT_STATUSES = ["created", "exists", "linked", "duplicate"];

/**
 * The toast for the server's answer to "Add to Hosts":
 * { variant, title, description }. `fallbackName` is the lead's business name,
 * used only if the answer carries no record name.
 */
export function betaConvertMessage(result, fallbackName = "") {
  const name = result?.record?.name || fallbackName || "This lead";
  const status = result?.status;
  if (status === "exists") {
    return { variant: "info", title: `${name} is already in Hosts`, description: "Someone added it first." };
  }
  if (status === "linked") {
    return { variant: "info", title: `${name} was already in Hosts`, description: "This lead is now linked to it." };
  }
  if (status === "duplicate") {
    return {
      variant: "info",
      title: `${name} is already in Hosts`,
      description: "A host with this name exists. Open it instead.",
    };
  }
  if (status !== "created") {
    return { variant: "error", title: "That didn't go through. Try again.", description: "" };
  }
  const city = typeof result.city === "string" ? result.city : "";
  const notes = [];
  if (result.icp_note === "several") notes.push("They chose several types, so pick the ICP on the card.");
  else if (result.icp_note !== "set") notes.push("Their type has no matching ICP, so pick one on the card.");
  if (result.region_note === "ambiguous") {
    notes.push(`More than one Launch City is called '${city}'. Pick the region on the card.`);
  } else if (result.region_note !== "set") {
    notes.push(`'${city}' isn't a Launch City, so the region is empty. Pick one on the card.`);
  }
  return {
    variant: "success",
    title: `${name} added to Hosts`,
    description: notes.length === 0 ? "ICP and region carried over. You are the owner." : notes.join(" "),
  };
}

/**
 * "This week by person" rows, in the order the server sent them:
 * [{ email, name, role, former, touches, stageMoves, added, overdue, dueToday }].
 * Two people whose addresses give the same first name are told apart by their
 * full address.
 */
export function weekRows(byPerson) {
  const list = (Array.isArray(byPerson) ? byPerson : []).filter((p) => p && typeof p.email === "string" && p.email !== "");
  const team = list.map((p) => ({ email: p.email, display_name: p.display_name }));
  return list.map((p) => ({
    email: p.email,
    name: ownerLabel(p.email, team),
    role: typeof p.role === "string" ? p.role : "",
    former: p.status === "former",
    invited: p.status === "invited",
    touches: count(p.touches),
    stageMoves: count(p.stage_moves),
    added: count(p.added),
    overdue: count(p.overdue),
    dueToday: count(p.due_today),
  }));
}

/** True when nobody logged anything this week. */
export function weekIsEmpty(rows) {
  return (Array.isArray(rows) ? rows : []).every((r) => r.touches + r.stageMoves + r.added === 0);
}

/** "Monday 12 October" for the viewer's own day (YYYY-MM-DD). */
export function longDate(today) {
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return "";
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** A whole number from 1 to 1000, or null when what was typed is not one. */
export function parseTarget(typed) {
  const text = String(typed ?? "").trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 1000 ? n : null;
}

// ── Emails, phone numbers and handles ───────────────────────────────────────

export const IDENT_KINDS = [
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "handle", label: "Handle" },
];
export const IDENT_PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "x", label: "X" },
  { id: "facebook", label: "Facebook" },
  { id: "youtube", label: "YouTube" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "other", label: "Other" },
];
export const MAX_IDENTIFIERS = 20;

const asciiLower = (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());
// Characters nobody can see, and every kind of space: the same two lists the
// server's crm_ident_key() uses, written as code points on purpose.
/* eslint-disable no-misleading-character-class, no-control-regex */
const IDENT_HIDDEN = /[\u0000-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\u{E0000}-\u{E0FFF}]/gu;
const IDENT_SPACE = /[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/gu;
/* eslint-enable no-misleading-character-class, no-control-regex */
const IDENT_NAME = /^[a-z0-9._-]{2,60}$/;
// A YouTube video id, as typed: its letter case is part of it.
const IDENT_VIDEO = "[A-Za-z0-9_-]{6,20}";
// Country codes of two digits; 1 and 7 are one digit; every other is three.
const PHONE_CC2 = ["20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46", "47",
  "48", "49", "51", "52", "53", "54", "55", "56", "57", "58", "60", "61", "62", "63", "64", "65",
  "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98"];
const IDENT_SITES = ["instagram.com", "tiktok.com", "x.com", "twitter.com", "facebook.com",
  "youtube.com", "linkedin.com"];
// Link-in-bio and short-link sites: the path is the person, as typed.
const IDENT_LINKS = ["linktr.ee", "bit.ly", "beacons.ai", "t.me", "lnk.bio", "linkin.bio",
  "taplink.cc", "tinyurl.com", "stan.store", "solo.to", "carrd.co", "bio.link",
  "hoo.be", "allmylinks.com", "msha.ke", "flow.page", "linkpop.com",
  "campsite.bio", "koji.to", "snipfeed.co", "tr.ee", "vm.tiktok.com",
  "youtu.be", "fb.me", "m.me", "threads.net", "goo.gl", "ow.ly", "rebrand.ly"];
// Never a handle: WhatsApp (a phone number), and pages that forward to others.
const IDENT_NEVER = ["wa.me", "api.whatsapp.com", "whatsapp.com", "l.facebook.com",
  "lm.facebook.com", "l.instagram.com", "t.co"];
// The ends of a site name, so a plain "name.com" is read as a site.
const IDENT_ENDS = ["com", "net", "org", "io", "co", "ai", "me", "ly", "ee", "to", "cc", "bio",
  "link", "page", "store", "app", "site", "uk", "us", "ng", "de", "fr", "info",
  "biz", "xyz", "online", "shop"];
// Path words of the known sites that introduce the name or id after them.
const IDENT_LEAD = ["channel", "c", "user", "in", "company", "school", "pub", "showcase",
  "groups", "people", "pages", "stories"];
// Path words of the known sites that are never a person's name.
const IDENT_WORDS = new Set([
  "profile.php", "channel", "c", "user", "pages", "people", "groups", "reel", "reels", "stories", "p",
  "share", "sharer", "sharer.php", "in", "company", "school", "pub", "showcase", "explore", "tv", "watch",
  "shorts", "playlist", "hashtag", "tag", "tags", "intent", "i", "home", "search", "video", "videos",
  "events", "photo", "photos", "posts", "status", "embed", "live", "feed", "results", "story.php",
  "permalink.php", "login", "signup", "accounts", "about", "help", "settings", "discover", "foryou",
  "following", "music", "t", "gaming", "marketplace", "profile", "dialog", "l.php", "direct", "messages",
]);
/** A link that shares or forwards a page: never a profile. */
export const SHARE_LINK =
  /(facebook[.]com\/(sharer|share|dialog)|sharer[.]php|(twitter|x)[.]com\/intent|linkedin[.]com\/(share|sharing)|(^|[/.])(l|lm)[.]facebook[.]com|l[.]instagram[.]com|(^|\/\/)t[.]co\/|google[.][a-z.]+\/url)/i;
const WHATSAPP_LINK = /((^|[/.])wa[.]me\/[+]?[0-9]{7,15}([/?#]|$)|whatsapp[.]com\/send\/?[?]([^#]*&)?phone=[+]?[0-9]{7,15}([&#]|$))/i;

/** The text every kind is read from: composed, nothing hidden, plain single spaces; case kept. */
function identText(value) {
  return value.normalize("NFC").replace(IDENT_HIDDEN, "").replace(IDENT_SPACE, " ").replace(/^ +| +$/g, "");
}

/** A site as it is compared: without www., m. or mobile., and LinkedIn without its country. */
function identSite(site) {
  return site.replace(/^(www|m|mobile)[.](?=.*[.])/, "").replace(/^[a-z]{2}[.]linkedin[.]com$/, "linkedin.com");
}

/** The digits of a country code at the start of these digits: 1, 2 or 3 of them. */
function countryLength(digits) {
  if (digits[0] === "1" || digits[0] === "7") return 1;
  return PHONE_CC2.includes(digits.slice(0, 2)) ? 2 : 3;
}

/**
 * The normal form of an email, a phone number or a handle, or null when the
 * value is not usable as that kind. A twin of the server's own function: the
 * two are held together by shared tables of examples that both suites assert.
 * First, for every kind, the text is composed (NFC), characters nobody can
 * see are removed, every kind of space becomes one plain space and the ends
 * are trimmed; more than 200 characters is not usable.
 *   email:  A to Z lower-cased; a name, an @ and a domain
 *   phone:  an extension at the end is dropped; written with its country
 *           code (a leading + or 00, or a WhatsApp link): "+", the code and
 *           the national number without a "(0)" or a trunk 0 after the code,
 *           and without the mobile 9 after +54 or the mobile 1 after +52 when
 *           ten digits follow it; otherwise its digits; 7 to 15 digits
 *   handle: written plainly (alice, @alice): 2 to 60 of a-z 0-9 . _ -, A to
 *           Z lower-cased; a link site, or "name.com" with no @, is not one.
 *           Written as a link: on a known profile site, the name in the
 *           address (or the name after a word that introduces one); any other
 *           page of those sites names no one; a YouTube video, written
 *           youtube.com/watch?v=<id> or youtu.be/<id>, is
 *           youtube.com/watch?v=<id> with the id as typed; a link-in-bio or short-link site is
 *           site/path with the path as typed; any other site is site/path,
 *           lower-cased. A site with no path, and a WhatsApp link, are not
 *           handles.
 */
export function identKey(kind, value) {
  if (typeof kind !== "string" || typeof value !== "string") return null;
  let o = identText(value);
  let t = asciiLower(o);
  if ([...t].length > 200) return null;
  if (kind === "email") return /^[^@ ]+@[^@ ]+[.][^@ ]+$/u.test(t) ? t : null;
  if (kind === "phone") {
    const wa =
      /(?:^|[/.])wa[.]me\/[+]?([0-9]{7,15})(?:[/?#]|$)/.exec(t) ||
      /whatsapp[.]com\/send\/?[?](?:[^#]*&)?phone=[+]?([0-9]{7,15})(?:[&#]|$)/.exec(t);
    if (wa) {
      t = `+${wa[1]}`;
    } else {
      t = t.replace(/ *(?:ext|extension|x|#)[.]? *[0-9]{1,6} *$/, "").replace(/[(] *0 *[)]/g, "").replace(/[^0-9+]/g, "");
      if (/^00/.test(t)) t = `+${t.slice(2)}`;
      t = (t.startsWith("+") ? "+" : "") + t.replace(/[^0-9]/g, "");
    }
    if (t.startsWith("+")) {
      const cc = countryLength(t.slice(1));
      t = t.slice(0, 1 + cc) + t.slice(1 + cc).replace(/^0/, "");
      // The mobile digit: Argentina's 9 after +54, Mexico's 1 after +52,
      // when the ten digits of a national number follow it.
      if (/^[+]549[0-9]{10}$/.test(t) || /^[+]521[0-9]{10}$/.test(t)) t = t.slice(0, 3) + t.slice(4);
    }
    const n = t.replace(/[^0-9]/g, "").length;
    return n >= 7 && n <= 15 ? t : null;
  }
  if (kind !== "handle") return null;

  // Written plainly.
  if (!/^https?:\/\//.test(t) && !/^www[.]/.test(t) && !/[/?#]/.test(t)) {
    const name = t.replace(/^@/, "");
    if (IDENT_SITES.includes(name) || IDENT_LINKS.includes(name) || IDENT_NEVER.includes(name)) return null;
    if (!t.startsWith("@") && name.includes(".") && IDENT_ENDS.includes(name.split(".").pop())) return null;
    return IDENT_NAME.test(name) ? name : null;
  }

  // Written as a link.
  o = o.replace(/^[Hh][Tt][Tt][Pp][Ss]?:\/\//, "");
  t = t.replace(/^https?:\/\//, "");
  let site = /^[^/?#]*/.exec(t)[0];
  const rest = t.slice(site.length);
  const orig = o.slice(site.length);
  if (!site.includes(".")) {
    const name = site.replace(/^@/, "");
    return IDENT_NAME.test(name) ? name : null;
  }
  site = identSite(site);
  if (!/^[a-z0-9-]+([.][a-z0-9-]+)+$/.test(site) || IDENT_NEVER.includes(site)) return null;
  const pathOf = (text) => /^[^?#]*/.exec(text)[0].replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  let path = pathOf(rest);
  const queryOf = (text = rest) => {
    const q = /^[^?#]*[?]([^#]*)/.exec(text);
    return `&${q ? q[1] : ""}`;
  };
  const idMatch = /&id=([a-z0-9._-]{2,60})(?:&|$)/.exec(queryOf());
  const id = idMatch ? idMatch[1] : null;

  if (IDENT_SITES.includes(site)) {
    if (path === "") return null;
    const segs = path.split("/");
    const one = segs[0].replace(/^@/, "");
    if (site === "youtube.com" && one === "watch" && segs.length === 1) {
      const v = new RegExp(`&[Vv]=(${IDENT_VIDEO})(?:&|$)`).exec(queryOf(orig));
      return v ? `youtube.com/watch?v=${v[1]}` : null;
    }
    if (!IDENT_WORDS.has(one)) return IDENT_NAME.test(one) ? one : null;
    if (one === "profile.php") return segs.length === 1 ? id : null;
    if (!IDENT_LEAD.includes(one)) return null;
    if (site === "facebook.com" && (one === "pages" || one === "people") && segs.length === 3 && /^[0-9]{2,60}$/.test(segs[2])) {
      return segs[2];
    }
    const two = (segs[1] || "").replace(/^@/, "");
    return IDENT_NAME.test(two) && !IDENT_WORDS.has(two) ? two : null;
  }
  if (path === "" && !id) return null;
  if (IDENT_LINKS.includes(site)) {
    path = pathOf(orig);
    // A YouTube short link names the same video as its long form.
    if (site === "youtu.be" && new RegExp(`^${IDENT_VIDEO}$`).test(path)) return `youtube.com/watch?v=${path}`;
  }
  const key = `${site}${path !== "" ? `/${path}` : ""}${id ? `?id=${id}` : ""}`;
  return key.includes(" ") ? null : key;
}

/** The national part of a phone number in its normal form. */
function phoneNational(key) {
  if (key.startsWith("+")) return key.slice(1 + countryLength(key.slice(1)));
  return key.replace(/^0+/, "");
}

/**
 * How two phone numbers match, the way the server matches them: "exact"
 * when their normal forms are equal; "national_number" when neither carries
 * a country code and, without leading zeros, the shorter (at least seven
 * digits) ends the longer, or when one carries one and the other's digits
 * without leading zeros (at least seven) end its national part or are its
 * own digits written without the +; "" otherwise. Two numbers that both carry a
 * country code match only when they are equal.
 */
export function phoneMatch(a, b) {
  const ka = identKey("phone", String(a ?? ""));
  const kb = identKey("phone", String(b ?? ""));
  if (!ka || !kb) return "";
  if (ka === kb) return "exact";
  const ia = ka.startsWith("+");
  const ib = kb.startsWith("+");
  const na = phoneNational(ka);
  const nb = phoneNational(kb);
  if (ia && ib) return "";
  if (!ia && !ib) {
    const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
    return short.length >= 7 && long.endsWith(short) ? "national_number" : "";
  }
  const [intlKey, intl, national] = ia ? [ka, na, nb] : [kb, nb, na];
  if (national.length >= 7 && intl.endsWith(national)) return "national_number";
  return identKey("phone", `+${national}`) === intlKey ? "national_number" : "";
}

/**
 * Which kind a typed value looks like: an @ with a dot after it is an email;
 * 7 or more digits with only + ( ) - . and spaces is a phone number; anything
 * else is a handle. "" for nothing typed.
 */
export function detectIdentKind(text) {
  const v = String(text || "").trim();
  if (!v) return "";
  if (/^[^@\s/]+@[^@\s/]+[.][^@\s/]+$/.test(v)) return "email";
  if (/^[0-9+()\-. ]+$/.test(v) && v.replace(/[^0-9]/g, "").length >= 7) return "phone";
  // A WhatsApp link is a phone number.
  if (WHATSAPP_LINK.test(v) && identKey("phone", v)) return "phone";
  return "handle";
}

/** The platform a handle was written as a profile address of, or "". */
export function detectPlatform(text) {
  const typed = asciiLower(identText(String(text || ""))).replace(/^https?:\/\//, "");
  const host = /^[^/?#]*/.exec(typed)[0];
  const v = identSite(host) + typed.slice(host.length);
  if (v.startsWith("instagram.com/")) return "instagram";
  if (v.startsWith("tiktok.com/")) return "tiktok";
  if (v.startsWith("x.com/") || v.startsWith("twitter.com/")) return "x";
  if (v.startsWith("facebook.com/")) return "facebook";
  if (v.startsWith("youtube.com/")) return "youtube";
  if (v.startsWith("linkedin.com/")) return "linkedin";
  return "";
}

/** A record's identifiers as the server takes them back: kind, value, platform. */
export function identifiersToSend(list) {
  return (Array.isArray(list) ? list : [])
    .filter((i) => i && typeof i.kind === "string" && typeof i.value === "string")
    .map((i) => (i.platform ? { kind: i.kind, value: i.value, platform: i.platform } : { kind: i.kind, value: i.value }));
}

/**
 * Add one typed identifier to a list. Returns { list } or { message } when it
 * is not usable, is already there, or the list is full.
 */
export function addIdentifier(list, { kind, value, platform = "" }) {
  const current = Array.isArray(list) ? list : [];
  const typed = String(value || "").trim().replace(/\s+/g, " ");
  // A WhatsApp link is a phone number, whichever kind was chosen.
  const k = kind === "handle" && WHATSAPP_LINK.test(typed) && identKey("phone", typed) ? "phone" : kind || detectIdentKind(typed);
  const key = identKey(k, typed);
  if (!key) {
    if (k === "handle" && SHARE_LINK.test(typed)) {
      return { message: "That is a link that shares or forwards a page, not a profile. Paste the link to the profile itself instead." };
    }
    return {
      message:
        k === "email"
          ? "An email needs a name, an @ and a domain."
          : k === "phone"
            ? "A phone number needs 7 to 15 digits."
            : "A handle is 2 to 60 letters, digits, dots or underscores, with or without @, or the link to a profile. A site on its own, a post, a search or a share link names no one.",
    };
  }
  if (
    current.some(
      (i) => i.kind === k && ((i.key || identKey(i.kind, i.value)) === key || (k === "phone" && phoneMatch(i.value, typed) !== ""))
    )
  ) {
    return { message: "That one is already on this record." };
  }
  if (current.length >= MAX_IDENTIFIERS) return { message: `A record holds at most ${MAX_IDENTIFIERS} of these.` };
  const item = { kind: k, value: typed, key, platform: k === "handle" ? platform || detectPlatform(typed) || null : null };
  return { list: [...current, item] };
}

/**
 * What a typed search could match among identifiers. The normal forms are
 * read from the text as typed (`typed`), as the server reads them: a YouTube
 * video id or a short link's path keeps its case.
 */
function identNeedles(needle, typed = needle) {
  const part = needle.replace(/^@/, "");
  const digits = needle.replace(/[^0-9]/g, "");
  return {
    part: part.length >= 3 ? part : "",
    digits: digits.length >= 7 ? digits : "",
    keys: needle ? [identKey("email", typed), identKey("phone", typed), identKey("handle", typed)] : [],
  };
}

function identifierMatches(identifiers, n) {
  if (!Array.isArray(identifiers) || identifiers.length === 0) return false;
  return identifiers.some((i) => {
    const key = typeof i?.key === "string" ? i.key : "";
    if (!key) return false;
    if (i.kind === "email" && n.keys[0] === key) return true;
    if (i.kind === "phone" && n.keys[1] === key) return true;
    if (i.kind === "handle" && n.keys[2] === key) return true;
    if (i.kind === "phone") {
      return !!n.digits && (key.includes(n.digits) || (n.digits.length >= 9 && key.endsWith(n.digits.slice(-9))));
    }
    return !!n.part && key.includes(n.part);
  });
}

/** How one identifier reads on a chip: "Email", "Phone", "Instagram", "Handle". */
export function identLabel(item) {
  if (!item) return "";
  if (item.kind === "handle") return IDENT_PLATFORMS.find((p) => p.id === item.platform)?.label || "Handle";
  return IDENT_KINDS.find((k) => k.id === item.kind)?.label || "";
}

// ── The contact rule ────────────────────────────────────────────────────────

export const CONTACT_RULES = [
  { id: "warm_intro_only", label: "Warm intro only", variant: "warning" },
  { id: "do_not_contact", label: "Do not contact", variant: "error" },
];

/**
 * What a record's contact rule shows: null when it has none, otherwise
 * { id, label, variant, reason, banner, aria }.
 *   banner  "Do not contact · <reason> · set by Tunde on 14 Oct"
 *   aria    ", do not contact" (added to the card's accessible name)
 */
export function contactRuleView(record, team = [], now = Date.now()) {
  const rule = CONTACT_RULES.find((r) => r.id === record?.contact_rule);
  if (!rule) return null;
  const reason = typeof record.contact_rule_reason === "string" ? record.contact_rule_reason : "";
  const parts = [rule.label];
  if (reason) parts.push(reason);
  const by = typeof record.contact_rule_by === "string" && record.contact_rule_by ? ownerLabel(record.contact_rule_by, team) : "";
  const at = record.contact_rule_at ? new Date(record.contact_rule_at) : null;
  if (by || (at && !Number.isNaN(at.getTime()))) {
    let when = "";
    if (at && !Number.isNaN(at.getTime())) {
      const sameYear = at.getFullYear() === new Date(now).getFullYear();
      when = ` on ${at.getDate()} ${MONTHS[at.getMonth()]}${sameYear ? "" : ` ${at.getFullYear()}`}`;
    }
    parts.push(`set${by ? ` by ${by}` : ""}${when}`);
  }
  return { id: rule.id, label: rule.label, variant: rule.variant, reason, banner: parts.join(" \u00b7 "), aria: `, ${rule.label.toLowerCase()}` };
}

/** The card's accessible name: "Open Palm Court Kitchen, do not contact". */
export function recordOpenLabel(record, team = []) {
  return `Open ${record?.name || ""}${contactRuleView(record, team)?.aria || ""}`;
}

/** The warning above Save when a person logs an outbound touch on a marked record, or "". */
export function logRuleWarning(record, entry) {
  const rule = contactRuleView(record);
  if (!rule || entry?.kind !== "touch" || entry?.direction !== "outbound") return "";
  return `This record is marked ${rule.label}. Log this only if it really happened.`;
}

/**
 * What the Add form says about one answer of the contactable check, or null
 * when the candidate is new: { id, name, byIdentifier, line, rule, others }.
 * Every record the candidate matches is weighed by the server; the one named
 * here is the one with the strictest contact rule, so a rule on ANY match is
 * the rule shown.
 *   line  "Looks like Palm Court Kitchen (same email)"
 *   rule  "Do not contact: asked us to stop", or "" when no match has one
 */
export function contactHit(result) {
  if (!result || !result.record || !["exists", "do_not_contact", "warm_intro_only"].includes(result.verdict)) return null;
  const matches = Array.isArray(result.matches) ? result.matches.filter((m) => m && m.record) : [];
  // The strictest rule on any match: the first record when the server sent its
  // list in that order, and looked for here in case it did not.
  const ruled =
    matches.find((m) => m.record.contact_rule === "do_not_contact") ||
    matches.find((m) => m.record.contact_rule === "warm_intro_only") ||
    null;
  const own = matches.find((m) => m.record.id === result.record.id) || null;
  const chosen = ruled && !contactRuleView(result.record) ? ruled : own;
  const record = chosen ? chosen.record : result.record;
  const on = chosen ? (Array.isArray(chosen.matched_on) ? chosen.matched_on : []) : Array.isArray(result.matched_on) ? result.matched_on : [];
  const byName = chosen ? !!chosen.name_match && on.length === 0 : result.match === "name";
  const what = [...new Set(on.map((m) => (m.kind === "phone" ? "phone number" : m.kind)))];
  const same = byName ? "same name" : what.length ? `same ${what.join(" and ")}` : "same details";
  const rule = contactRuleView(record);
  return {
    id: record.id,
    name: record.name,
    byIdentifier: !byName,
    line: `Looks like ${record.name} (${same})`,
    rule: rule ? `${rule.label}${rule.reason ? `: ${rule.reason}` : ""}` : "",
    others: Math.max(0, matches.length > 0 ? matches.length - 1 : Number(result.other_matches) || 0),
  };
}

/**
 * The record a refusal names, from the server's own sentence, or "":
 *   '"x" already belongs to "Palm Court Kitchen" in Hosts. Open that record instead.'
 */
export function sharedDetailHolder(message) {
  const m = /already belongs to "(.+)" in (Hosts|Creators)(?:, which is marked |\.)/.exec(String(message || ""));
  return m ? m[1] : "";
}

/**
 * The contact rule of the record a refusal names, from the same sentence, or "":
 *   '... in Hosts, which is marked Do not contact: Asked us to stop. Open that record instead.'
 */
export function sharedDetailRule(message) {
  const m = /in (?:Hosts|Creators), which is marked (Do not contact|Warm intro only)(?:: (.*?))?\. Open that record instead\.$/.exec(String(message || ""));
  return m ? `${m[1]}${m[2] ? `: ${m[2]}` : ""}` : "";
}

/** The two texts of "City missing?", by role. */
export function missingCityWords(canAddRegion) {
  return canAddRegion
    ? {
      text: "Cities come from Launch Cities. Add the city in Place Pool: it opens in a new tab, so what you have typed here stays. The city is added as not live; press Refresh regions here afterwards.",
      primary: "Open Place Pool",
      secondary: "Cancel",
      refresh: "Refresh regions",
      blocked: "Your browser blocked the new tab. Allow pop-ups for this site, or open Place Pool yourself:",
    }
    : {
      text: "Cities come from Launch Cities, which an owner or admin manages. Ask one of them to add it. Until then, leave the region empty and put the city in a note.",
      primary: "OK",
      secondary: "",
      refresh: "",
    };
}
