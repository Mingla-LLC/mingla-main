// Issue #4420 (step 5) — the Support chat inbox, as pure rules.
//
// Pure module: no React, no Supabase. The inbox page, its list and a plain
// node test read it. Every label a conversation shows is WORKED OUT here from
// the row (and the tickets linked to it); nothing is stored client-side.
//
// Invariant I-4420-INBOX-LABELS-DERIVED (declared in src/__tests__/issue4420_support_inbox.implementor.test.js): every label on a Support conversation is derived in this module from the row and the tickets linked to it (Host or Explorer, topic, Needs reply, Waiting on customer, Reported, Website request, Ticket T-n, Resolved); none is stored in the browser.
// Invariant I-4420-NOTES-NEVER-IN-PREVIEW (declared in src/__tests__/issue4420_support_inbox.implementor.test.js): an internal note never reaches a list preview, a suggested customer line or a ticket pre-fill; only customer-visible messages do.
//
// Words: a customer thread is a "conversation"; "ticket" means only the Work card.
import { lastSpeaker, isOverdueTicket, ticketSearchText, ticketNumberLabel } from "./supportTicketMetrics.js";
import { TOPIC_LABEL } from "../components/support/supportOptions.js";
import { ticketNumber } from "./ticketModel.js";

/** The quick chips over the list (a conversation can match several). */
export const INBOX_CHIPS = Object.freeze([
  Object.freeze({ id: "needs", label: "Needs reply" }),
  Object.freeze({ id: "waiting", label: "Waiting on customer" }),
  Object.freeze({ id: "reported", label: "Reported" }),
  Object.freeze({ id: "website", label: "Website" }),
  Object.freeze({ id: "mine", label: "Mine" }),
  Object.freeze({ id: "unassigned", label: "Unassigned" }),
  Object.freeze({ id: "overdue", label: "Overdue" }),
]);
const CHIP_IDS = INBOX_CHIPS.map((c) => c.id);

const OPEN_STATUSES = new Set(["new", "open", "pending"]);
const DONE_STATUSES = new Set(["resolved", "closed"]);

/** A reported enquiry (admin_list_reported_enquiries row) as an inbox row. */
export function reportedRow(enquiry) {
  return {
    kind: "reported",
    key: `reported:${enquiry?.id}`,
    id: enquiry?.id,
    enquiry,
    at: enquiry?.reported_at || null,
  };
}

/** A support conversation (support_tickets row) as an inbox row. */
export function conversationRow(ticket) {
  return { kind: "conversation", key: ticket.id, id: ticket.id, ticket, at: ticket.last_message_at || ticket.created_at || null };
}

/** Open = new, open or pending, plus every reported enquiry. Resolved = resolved or closed. */
export function isOpenRow(row) {
  if (!row) return false;
  if (row.kind === "reported") return true;
  return OPEN_STATUSES.has(row.ticket?.status);
}
export function isResolvedRow(row) {
  return !!row && row.kind === "conversation" && DONE_STATUSES.has(row.ticket?.status);
}

/** Needs reply: new or open, and the customer spoke last (a resolved one never does). */
export function needsReply(ticket) {
  return !!ticket && (ticket.status === "new" || ticket.status === "open") && lastSpeaker(ticket) === "customer";
}

function ticketChipText(linked) {
  const base = `Ticket ${ticketNumber(linked.number)}`;
  return linked.status === "done" ? `${base} closed` : base;
}

/**
 * The labels of one row, in display order: [{ id, text, tone }].
 * `linked` is the list of Work tickets linked to the conversation
 * (issue_4420_conversation_tickets: { number, status, ... }).
 */
export function rowLabels(row, linked = []) {
  if (!row) return [];
  if (row.kind === "reported") {
    const out = [{ id: "reported", text: "Reported", tone: "warn" }];
    if (row.enquiry?.topic_label) out.push({ id: "topic", text: row.enquiry.topic_label, tone: "plain" });
    return out;
  }
  const t = row.ticket;
  const out = [];
  if (t.origin === "staff") out.push({ id: "staff", text: "Staff", tone: "staff" });
  else if (t.requester_segment === "business") out.push({ id: "segment", text: "Host", tone: "plain" });
  else if (t.requester_segment === "explorer") out.push({ id: "segment", text: "Explorer", tone: "plain" });
  if (t.topic && TOPIC_LABEL[t.topic]) out.push({ id: "topic", text: TOPIC_LABEL[t.topic], tone: "plain" });
  if (needsReply(t)) out.push({ id: "needs", text: "Needs reply", tone: "alert" });
  if (t.status === "pending") out.push({ id: "waiting", text: "Waiting on customer", tone: "wait" });
  if (t.topic === "website_change") out.push({ id: "website", text: "Website request", tone: "plain" });
  for (const l of Array.isArray(linked) ? linked : []) out.push({ id: `ticket:${l.card_id || l.number}`, text: ticketChipText(l), tone: "ticket", linked: l });
  if (DONE_STATUSES.has(t.status)) out.push({ id: "resolved", text: "Resolved", tone: "done" });
  return out;
}

/** The customer-visible message used for previews: never internal, never a system line. */
export function isCustomerVisible(message) {
  return !!message && !message.is_internal && message.message_type !== "system";
}

function oneLine(text, max) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The last-message snippet of a row. `lastMessage` is the newest message the
 * caller read; an internal note or system line given here is IGNORED, and the
 * row falls back to its subject (a note's words never reach the list).
 */
export function rowPreview(row, lastMessage = null, max = 90) {
  if (!row) return "";
  if (row.kind === "reported") return oneLine(row.enquiry?.report_reason ? `Reported: ${row.enquiry.report_reason}` : "Reported enquiry", max);
  const m = isCustomerVisible(lastMessage) ? lastMessage : null;
  if (m) {
    const text = oneLine(m.content, max);
    if (text) return text;
    return "Attachment";
  }
  return oneLine(row.ticket?.subject, max);
}

/** "Name · brand", or "Name · Explorer" / "Name · Host" with no brand. */
export function rowTitle(row, { profilesById = {}, brandsById = {} } = {}) {
  if (!row) return "";
  if (row.kind === "reported") {
    const e = row.enquiry || {};
    return [e.guest_name || "Unknown sender", e.brand_name].filter(Boolean).join(" · ");
  }
  const t = row.ticket;
  const person = (t.requester_user_id && profilesById[t.requester_user_id]) || null;
  const name = person?.display_name || person?.username || person?.email || "";
  const brand = t.brand_id ? brandsById[t.brand_id]?.name : "";
  if (t.origin === "staff") {
    const creator = (t.created_by && profilesById[t.created_by]) || null;
    const by = creator?.display_name || creator?.email || "Staff";
    const about = brand || name;
    return about ? `${by} → ${about}` : by;
  }
  const fallback = t.requester_segment === "explorer" ? "Explorer" : "Host";
  const second = brand || (name ? (t.requester_segment === "explorer" ? "Explorer" : "") : "");
  return [name || fallback, second].filter(Boolean).join(" · ");
}

function normal(v) {
  return String(v ?? "").trim().toLowerCase();
}

function reportedSearchText(e) {
  return [e?.guest_name, e?.guest_email, e?.brand_name, e?.report_reason, e?.topic_label].map(normal).filter(Boolean).join(" ");
}

export function rowSearchText(row, lookups = {}) {
  if (row.kind === "reported") return reportedSearchText(row.enquiry);
  return ticketSearchText(row.ticket, lookups);
}

function chipMatches(row, chip, { me = null, nowMs = Date.now() } = {}) {
  if (!chip) return true;
  if (chip === "reported") return row.kind === "reported";
  if (row.kind === "reported") return false;
  const t = row.ticket;
  switch (chip) {
    case "needs": return needsReply(t);
    case "waiting": return t.status === "pending";
    case "website": return t.topic === "website_change" && OPEN_STATUSES.has(t.status);
    case "mine": return !!me && t.assigned_staff_id === me && OPEN_STATUSES.has(t.status);
    case "unassigned": return !t.assigned_staff_id && OPEN_STATUSES.has(t.status);
    case "overdue": return isOverdueTicket(t, nowMs);
    default: return true;
  }
}

function time(row) {
  const at = Date.parse(row?.at || "");
  return Number.isFinite(at) ? at : 0;
}

function websiteDueMs(ticket) {
  const at = Date.parse(ticket?.website_request?.due_at || ticket?.next_update_at || "");
  return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
}

// #4453: website change requests list by their 24-hour clock: the ones still to
// do first (soonest due on top), then the ones already marked ready.
function compareWebsiteRequests(left, right) {
  const leftReady = left?.ticket?.website_request?.ready_at ? 1 : 0;
  const rightReady = right?.ticket?.website_request?.ready_at ? 1 : 0;
  if (leftReady !== rightReady) return leftReady - rightReady;
  return websiteDueMs(left.ticket) - websiteDueMs(right.ticket) || time(right) - time(left);
}

/**
 * The inbox: { open, resolved } from every row, after the chip and the search.
 * Open lists Needs reply first, then the newest activity first; Resolved
 * lists the newest first. Reported rows sort among Open by their report time.
 */
export function splitInbox(rows, { chip = "", search = "", lookups = {}, me = null, nowMs = Date.now() } = {}) {
  const query = normal(search);
  const kept = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!chipMatches(row, chip, { me, nowMs })) return false;
    if (query && !rowSearchText(row, lookups).includes(query)) return false;
    return true;
  });
  const open = kept.filter(isOpenRow).sort(chip === "website" ? compareWebsiteRequests : (a, b) => {
    const an = a.kind === "conversation" && needsReply(a.ticket) ? 1 : 0;
    const bn = b.kind === "conversation" && needsReply(b.ticket) ? 1 : 0;
    return bn - an || time(b) - time(a);
  });
  const resolved = kept.filter(isResolvedRow).sort((a, b) => time(b) - time(a));
  return { open, resolved };
}

/** The Open count for the page's badge: Needs reply (what the badge always showed). */
export function needsReplyCount(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r.kind === "conversation" && needsReply(r.ticket)).length;
}

/**
 * What an address asks for. Accepts today's and every older spelling:
 *   conversation=<id> | ticket=<id>   open that conversation
 *   reported=<id>                      open that reported enquiry
 *   filter=<chip> | view=<chip>        a chip (needs, waiting, reported, ...)
 *   view=resolved                      the Resolved section open
 * Anything unknown falls away to the default Open list: never a blank page.
 */
export function inboxParamsFromHash(hash) {
  const text = typeof hash === "string" ? hash : "";
  const at = text.indexOf("?");
  let params;
  try { params = new URLSearchParams(at < 0 ? "" : text.slice(at + 1)); } catch { params = new URLSearchParams(); }
  const conversationId = params.get("conversation") || params.get("ticket") || null;
  const reportedId = params.get("reported") || null;
  const asked = [params.get("filter"), params.get("view")].map((v) => String(v || "").toLowerCase());
  const chip = asked.find((v) => CHIP_IDS.includes(v)) || "";
  const showResolved = asked.includes("resolved");
  return { conversationId, reportedId, chip, showResolved };
}

/** The address of the selected conversation / reported row (the id replaces the other). */
export function hashForSelection(hash, { conversationId = null, reportedId = null } = {}) {
  const text = typeof hash === "string" ? hash : "";
  const at = text.indexOf("?");
  const path = at < 0 ? text : text.slice(0, at);
  let params;
  try { params = new URLSearchParams(at < 0 ? "" : text.slice(at + 1)); } catch { params = new URLSearchParams(); }
  params.delete("ticket");
  params.delete("conversation");
  params.delete("reported");
  if (conversationId) params.set("conversation", conversationId);
  else if (reportedId) params.set("reported", reportedId);
  const q = params.toString();
  return `${path || "#/support"}${q ? `?${q}` : ""}`;
}

const PREFILL_MAX = 600;
const TOPIC_TO_TYPE = Object.freeze({ broken: "bug", idea: "idea", confusing: "question" });

/**
 * What "Create ticket" starts from, taken from the conversation. Only
 * customer-visible messages are read: an internal note never lands here.
 *   { type, title, whatIsWrong, productArea, source: { id, label } }
 * The owner is NOT part of it: the person making the ticket chooses it.
 */
export function ticketPrefill(ticket, messages = []) {
  const first = (Array.isArray(messages) ? messages : []).find((m) =>
    isCustomerVisible(m)
    && m.sender_role_snapshot !== "Mingla Support"
    && !!m.sender_id
    && (!ticket?.requester_user_id || m.sender_id === ticket.requester_user_id)
    && String(m.content || "").trim().length > 0);
  const text = oneLine(first?.content, PREFILL_MAX);
  const subject = oneLine(ticket?.subject, 160);
  return {
    type: TOPIC_TO_TYPE[ticket?.topic] || "bug",
    title: subject,
    whatIsWrong: text || subject,
    productArea: String(ticket?.product_area || ""),
    source: { id: ticket?.id, label: `Conversation ${ticket?.ticket_number ?? ""}`.trim() },
  };
}

/**
 * #4420 (step 6) — "Create ticket" from a Brand group (it replaced Send to
 * Product): the ticket links the brand (created_from brand_group, which the
 * server requires to name the brand) and quotes the chosen messages in What
 * is wrong. `lines` are "Name: message" strings, the first one the message
 * the person picked. Returns null when there is no brand to link.
 */
export function brandGroupTicketPrefill({ brandId, brandName, lines } = {}) {
  if (typeof brandId !== "string" || !brandId) return null;
  const quoted = (Array.isArray(lines) ? lines : []).map((l) => String(l || "").trim()).filter(Boolean);
  const name = oneLine(brandName, 80) || "Brand group";
  const firstMessage = String(quoted[0] || "").replace(/^[^:]{1,80}:\s*/, "");
  const header = `From the ${name} Brand group:`;
  return {
    brandId,
    title: oneLine(`${name}: ${firstMessage}`, 160),
    whatIsWrong: `${header}\n${quoted.map((l) => `> ${l.replace(/\s+/g, " ")}`).join("\n")}`.slice(0, 4000),
    label: `${name} Brand group`,
  };
}

/** The line a person might send the customer once a ticket exists. Never carries a note. */
export function customerLineFor(number) {
  return `Thanks for flagging this. We have logged it as ticket ${ticketNumber(number)} and the team is on it. We will update you here.`;
}

/** The header's ticket button: "Create ticket", or the number of the first linked ticket. */
export function createTicketButton(linked = []) {
  const first = Array.isArray(linked) && linked.length ? linked[0] : null;
  return first
    ? { text: `Ticket ${ticketNumber(first.number)}`, linked: true }
    : { text: "Create ticket", linked: false };
}

export { ticketNumberLabel };

/**
 * #4420 (rework 2): what happens to the side panel when another conversation
 * is opened (a row click, the address, Back or Forward, a new conversation).
 *   "keep"  the same conversation: nothing changes;
 *   "close" a ticket summary, or a Create ticket form nobody has typed in:
 *           the panel closes (it is never re-filled for the new conversation);
 *   "ask"   a Create ticket form with edits: ask before discarding them.
 */
export function sidePanelOnSwitch({ sideKind = null, dirty = false, same = false } = {}) {
  if (same || !sideKind) return "keep";
  if (sideKind === "create" && dirty) return "ask";
  return "close";
}

export const DISCARD_TICKET_WORDS = "Discard the ticket you started? What you typed in Create ticket will be lost.";

/** The least height the third-column side panel is given, so its form stays usable. */
export const SIDE_PANEL_MIN_HEIGHT = 320;
/** The gap kept under the side panel, above the bottom of the window. */
export const SIDE_PANEL_BOTTOM_GAP = 12;

/**
 * #4420 (rework 2, P3-3): the third-column side panel's height from where its
 * top is and how tall the window is, so its header and its Create / Cancel
 * row are in view (the form scrolls inside). Never below the minimum.
 */
export function sidePanelFitHeight(top, viewportHeight) {
  const t = Number.isFinite(top) ? Math.max(0, top) : 0;
  const vh = Number.isFinite(viewportHeight) ? viewportHeight : 0;
  return Math.max(SIDE_PANEL_MIN_HEIGHT, Math.floor(vh - t - SIDE_PANEL_BOTTOM_GAP));
}

/**
 * #4420 rework 3 (G1): the inbox's name and brand lookups from the answers the
 * server gave. A refused or failed people lookup (a Support teammate who is
 * not a full admin is refused it) or brand read is "no enrichment", never a
 * failed inbox: the rows still list, and their titles and labels fall back to
 * what the conversation row carries (requester_segment gives Host or
 * Explorer). `missing` names what did not load, for one plain notice.
 *
 * peoplePages: the answers of each people lookup ({ data, error } or an Error
 * when the call threw); brands: the brand read's answer (same shapes).
 */
export function inboxLookupsFromResults({ peoplePages = [], brands = null } = {}) {
  const failed = (answer) => !answer || answer instanceof Error || Boolean(answer.error);
  const missing = [];
  let profilesById = {};
  if (peoplePages.some(failed)) missing.push("people");
  else profilesById = Object.fromEntries(peoplePages.flatMap((page) => (Array.isArray(page.data) ? page.data : [])).filter((row) => row?.id).map((row) => [row.id, row]));
  let brandsById = {};
  if (brands === null) return { profilesById, brandsById, missing };
  if (failed(brands)) missing.push("brands");
  else brandsById = Object.fromEntries((Array.isArray(brands.data) ? brands.data : []).filter((row) => row?.id).map((row) => [row.id, row]));
  return { profilesById, brandsById, missing };
}

/** The one plain notice for lookups that did not load, or null. */
export function inboxLookupNotice(missing = []) {
  const people = missing.includes("people");
  const brands = missing.includes("brands");
  if (people && brands) return "Names and brands aren't shown for your account, so conversations show Host or Explorer. Replies, notes and tickets work as usual.";
  if (people) return "Names aren't shown for your account, so conversations show Host or Explorer and search covers subjects, numbers and brands. Replies, notes and tickets work as usual.";
  if (brands) return "Brand names didn't load, so conversations show the person instead. Replies, notes and tickets work as usual.";
  return null;
}

/**
 * #4420 rework 3 (G1): the sentence under "Couldn't load the conversations".
 * Always one of these plain sentences: a server code (not_authorized, 42501,
 * PGRST…) is never shown.
 */
export const INBOX_LOAD_ERROR_WORDS = Object.freeze({
  access: "Your account can't open the Support inbox yet. Ask an admin to add you to Support, then try again.",
  session: "Your sign-in has ended. Sign in again, then try again.",
  network: "We couldn't reach Mingla. Check your connection, then try again.",
  other: "Something on our side stopped the conversations loading. Try again in a moment.",
});
export function inboxLoadErrorText(err) {
  const text = String(err?.message ?? err ?? "").toLowerCase();
  const code = String(err?.code ?? "").toLowerCase();
  if (/not_authorized|not authorized|permission denied|42501|forbidden|403/.test(`${text} ${code}`)) return INBOX_LOAD_ERROR_WORDS.access;
  if (/jwt|session|401|sign in/.test(`${text} ${code}`)) return INBOX_LOAD_ERROR_WORDS.session;
  if (/failed to fetch|network|timeout|timed out|load failed/.test(text)) return INBOX_LOAD_ERROR_WORDS.network;
  return INBOX_LOAD_ERROR_WORDS.other;
}

/**
 * #4420 rework 3 (G3): the least widths the Support columns need. Below these
 * the thread's reply box and its Next update / Status row overlap.
 */
export const INBOX_LIST_MIN_WIDTH = 300;
export const INBOX_THREAD_MIN_WIDTH = 480;
export const INBOX_SIDE_MIN_WIDTH = 340;
/** The grid's gap between columns (Tailwind gap-4). */
export const INBOX_COLUMN_GAP = 16;

/**
 * Where the Create ticket / ticket summary panel goes for the width the inbox
 * grid has: "column" (a third column beside the thread) only when the list,
 * the thread and the panel all get their minimum; otherwise "overlay" (it
 * slides over the thread from the right). Derived from the measured width,
 * not from one breakpoint, so a collapsed or expanded side menu is counted.
 */
export function sidePanelPlacement(availableWidth) {
  const w = Number(availableWidth);
  if (!Number.isFinite(w) || w <= 0) return "overlay";
  const need = INBOX_LIST_MIN_WIDTH + INBOX_THREAD_MIN_WIDTH + INBOX_SIDE_MIN_WIDTH + 2 * INBOX_COLUMN_GAP;
  return w >= need ? "column" : "overlay";
}
