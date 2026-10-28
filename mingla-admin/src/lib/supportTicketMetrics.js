const ACTIVE_SUPPORT_STATUSES = new Set(["new", "open", "pending"]);
const DONE_SUPPORT_STATUSES = new Set(["resolved", "closed"]);

export function isActiveUnassignedTicket(ticket) {
  return Boolean(ticket && !ticket.assigned_staff_id && ACTIVE_SUPPORT_STATUSES.has(ticket.status));
}

// Issue #4130 (Wave 6) — the Support inbox's filters and their counts. Every
// count is worked out from the very rows the inbox lists (live chats AND
// staff-created threads), so a count can never disagree with the list under
// it. The old Overview counted live chats only and showed "Unanswered
// tickets 0" while the inbox held a new staff-created ticket.

/** The inbox filters, in order. The first is the default. */
export const SUPPORT_INBOX_FILTERS = Object.freeze([
  Object.freeze({ id: "open", label: "Open" }),
  Object.freeze({ id: "unassigned", label: "Unassigned" }),
  Object.freeze({ id: "overdue", label: "Overdue" }),
  Object.freeze({ id: "resolved", label: "Resolved" }),
  Object.freeze({ id: "all", label: "All" }),
]);

export function isActiveTicket(ticket) {
  return Boolean(ticket && ACTIVE_SUPPORT_STATUSES.has(ticket.status));
}

/** Still open, and the update we promised the customer is now late. */
export function isOverdueTicket(ticket, nowMs = Date.now()) {
  if (!isActiveTicket(ticket) || !ticket.next_update_at) return false;
  const due = Date.parse(ticket.next_update_at);
  return Number.isFinite(due) && due <= nowMs;
}

export function supportInboxMatches(ticket, filter, nowMs = Date.now()) {
  switch (filter) {
    case "open": return isActiveTicket(ticket);
    case "unassigned": return isActiveUnassignedTicket(ticket);
    case "overdue": return isOverdueTicket(ticket, nowMs);
    case "resolved": return Boolean(ticket && DONE_SUPPORT_STATUSES.has(ticket.status));
    case "all": return Boolean(ticket);
    default: return false;
  }
}

/** { open, unassigned, overdue, resolved, all } over the inbox's own rows. */
export function supportInboxCounts(rows, nowMs = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  return Object.fromEntries(
    SUPPORT_INBOX_FILTERS.map(({ id }) => [id, list.filter((row) => supportInboxMatches(row, id, nowMs)).length]),
  );
}

function waitingSince(ticket) {
  const at = Date.parse(ticket?.last_message_at || ticket?.created_at || "");
  return Number.isFinite(at) ? at : 0;
}

/**
 * The rows a filter shows. Work still waiting (Open, Unassigned, Overdue)
 * lists the longest-waiting first; Resolved and All list newest activity first.
 */
export function supportInboxRows(rows, filter, nowMs = Date.now()) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => supportInboxMatches(row, filter, nowMs));
  const oldestFirst = filter === "open" || filter === "unassigned" || filter === "overdue";
  return list.sort((left, right) => (oldestFirst
    ? waitingSince(left) - waitingSince(right)
    : waitingSince(right) - waitingSince(left)));
}
