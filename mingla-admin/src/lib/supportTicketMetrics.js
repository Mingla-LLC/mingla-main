// #4382 Wave 2 / #4420 (step 5) — facts about a support conversation row that
// more than one file reads: active or done, overdue, who spoke last, the
// S-number, search text, waiting time and how much of the list is loaded.
// The inbox's labels, Open vs Resolved and its order are in
// lib/supportInboxModel.js. (The eight views rail, the Opened-by switch and
// the filter bar were retired by #4420 with the chat inbox.)
//
// Invariant I-4382-INBOX-ACTIVE-NEVER-PAGED-OUT is declared below.

const ACTIVE_SUPPORT_STATUSES = new Set(["new", "open", "pending"]);
const DONE_SUPPORT_STATUSES = new Set(["resolved", "closed"]);

export function isActiveTicket(ticket) {
  return Boolean(ticket && ACTIVE_SUPPORT_STATUSES.has(ticket.status));
}

/** Still active, and the update we promised is now late. */
export function isOverdueTicket(ticket, nowMs = Date.now()) {
  if (!isActiveTicket(ticket) || !ticket.next_update_at) return false;
  const due = Date.parse(ticket.next_update_at);
  return Number.isFinite(due) && due <= nowMs;
}

/**
 * Who spoke last: "customer" or "staff". Tickets written before #4382 have no
 * last_sender_kind; for them a customer ticket nobody has answered yet counts
 * as the customer speaking last, and a staff ticket as staff.
 */
export function lastSpeaker(ticket) {
  if (ticket?.last_sender_kind === "customer" || ticket?.last_sender_kind === "staff") {
    return ticket.last_sender_kind;
  }
  if (ticket?.origin === "staff") return "staff";
  return ticket?.first_response_at ? "staff" : "customer";
}

/** "S-1048" from a ticket (or "S-…" while the number is unknown). */
export function ticketNumberLabel(ticket) {
  const n = Number(ticket?.ticket_number);
  return Number.isFinite(n) && n > 0 ? `S-${n}` : "S-…";
}

function normal(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * The words a row can be found by: subject, S-number (with or without the
 * "S-"), the person's name and email, and the brand name.
 */
export function ticketSearchText(ticket, { profilesById = {}, brandsById = {} } = {}) {
  const person = ticket?.requester_user_id ? profilesById[ticket.requester_user_id] : null;
  const brand = ticket?.brand_id ? brandsById[ticket.brand_id] : null;
  const number = Number(ticket?.ticket_number);
  return [
    ticket?.subject,
    Number.isFinite(number) ? `s-${number} s${number} ${number}` : "",
    person?.display_name,
    person?.username,
    person?.email,
    brand?.name,
  ].map(normal).filter(Boolean).join(" ");
}

function waitingSince(ticket) {
  const at = Date.parse(ticket?.last_message_at || ticket?.created_at || "");
  return Number.isFinite(at) ? at : 0;
}

/** "0:24" from milliseconds. */
export function formatVoiceLength(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** How long the row has waited, as the design writes it: 3h, 2d, 5mo. */
export function waitLabel(ticket, nowMs = Date.now()) {
  const since = waitingSince(ticket);
  if (!since) return "";
  const hours = Math.max(0, Math.round((nowMs - since) / 3_600_000));
  if (hours < 24) return `${hours}h`;
  if (hours < 24 * 60) return `${Math.round(hours / 24)}d`;
  return `${Math.round(hours / 24 / 30)}mo`;
}

// ── How much of each view is loaded ─────────────────────────────────────────
// The inbox loads EVERY active ticket (new, open, pending) up to
// ACTIVE_TICKET_CAP, so an old open ticket never drops out of the work views,
// and loads resolved/closed tickets newest first in pages of CLOSED_PAGE_SIZE
// ("Load older"). Counts are always the loaded rows; when a view holds more
// than is loaded the rail and the list say so.
//
// Invariant I-4382-INBOX-ACTIVE-NEVER-PAGED-OUT (declared in src/__tests__/issue4382_support_desk.implementor.test.js): Every active support ticket is loaded into the Admin inbox (up to 2000, with a visible "showing N of M" note beyond that); only resolved and closed tickets are paged, and a partial view says it is partial.
export const ACTIVE_TICKET_STATUSES = Object.freeze([...ACTIVE_SUPPORT_STATUSES]);
export const DONE_TICKET_STATUSES = Object.freeze([...DONE_SUPPORT_STATUSES]);
export const ACTIVE_TICKET_CAP = 2000;
export const CLOSED_PAGE_SIZE = 300;

const WORK_VIEWS = new Set(["needs", "mine", "unassigned", "overdue", "waiting", "website"]); // open conversations: all of them load

/**
 * { partial, loaded, total, canLoadOlder } for a view, from the load's
 * totals { activeLoaded, activeTotal, closedLoaded, closedTotal }.
 */
export function inboxViewCoverage(coverage, viewId) {
  const activeLoaded = Number(coverage?.activeLoaded || 0);
  const activeTotal = Math.max(activeLoaded, Number(coverage?.activeTotal || 0));
  const closedLoaded = Number(coverage?.closedLoaded || 0);
  const closedTotal = Math.max(closedLoaded, Number(coverage?.closedTotal || 0));
  const activeShort = activeTotal > activeLoaded;
  const closedShort = closedTotal > closedLoaded;
  if (WORK_VIEWS.has(viewId)) {
    return { partial: activeShort, loaded: activeLoaded, total: activeTotal, canLoadOlder: false };
  }
  if (viewId === "resolved") {
    return { partial: closedShort, loaded: closedLoaded, total: closedTotal, canLoadOlder: closedShort };
  }
  return {
    partial: activeShort || closedShort,
    loaded: activeLoaded + closedLoaded,
    total: activeTotal + closedTotal,
    canLoadOlder: closedShort,
  };
}

/** The note above a partial list, or null. */
export function coverageNote(viewCoverage) {
  if (!viewCoverage?.partial) return null;
  return `Showing the newest ${viewCoverage.loaded} of ${viewCoverage.total} conversations. Counts cover the loaded tickets only.`;
}
