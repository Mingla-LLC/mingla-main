// #4382 Wave 2 — the Support inbox's views, the "Opened by" switch, the
// filters and search, and their counts.
//
// Every count is worked out from the very rows the inbox would list for that
// view, after the same Opened-by switch, filters and search, so a count can
// never disagree with the list under it (#4130 Wave 6 rule, kept).
//
// MINGLA-INVARIANT: I-4382-INBOX-COUNTS-EQUAL-ROWS | issue #4382 | Every inbox view count equals the number of rows that view lists under the same Opened-by switch, filters and search
//
// The view rules follow the approved design ("Try the inbox"):
//   Needs reply  open (or new) and the customer spoke last
//   Mine         mine and still active
//   Unassigned   nobody owns it and still active
//   Overdue      still active and the promised next update has passed
//   Waiting      Waiting on customer (status pending)
//   Resolved     resolved or closed
//   All          everything

const ACTIVE_SUPPORT_STATUSES = new Set(["new", "open", "pending"]);
const DONE_SUPPORT_STATUSES = new Set(["resolved", "closed"]);

/** The inbox views, in rail order. The first is the default. */
export const SUPPORT_INBOX_VIEWS = Object.freeze([
  Object.freeze({ id: "needs", label: "Needs reply", group: "Work" }),
  Object.freeze({ id: "mine", label: "Mine", group: "Work" }),
  Object.freeze({ id: "unassigned", label: "Unassigned", group: "Work" }),
  Object.freeze({ id: "overdue", label: "Overdue", group: "Work" }),
  Object.freeze({ id: "waiting", label: "Waiting on customer", group: "Work" }),
  Object.freeze({ id: "resolved", label: "Resolved", group: "Done" }),
  Object.freeze({ id: "all", label: "All tickets", group: "Done" }),
]);

/** The Opened-by switch. */
export const OPENED_BY_OPTIONS = Object.freeze([
  Object.freeze({ value: "all", label: "Everyone" }),
  Object.freeze({ value: "customer", label: "Customers" }),
  Object.freeze({ value: "staff", label: "Staff" }),
]);

export const VISIBILITY_LABEL = Object.freeze({
  internal: "Internal",
  person: "Person",
  brand: "Brand team",
});

export function isActiveTicket(ticket) {
  return Boolean(ticket && ACTIVE_SUPPORT_STATUSES.has(ticket.status));
}

export function isActiveUnassignedTicket(ticket) {
  return Boolean(ticket && !ticket.assigned_staff_id && ACTIVE_SUPPORT_STATUSES.has(ticket.status));
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

export function ticketMatchesView(ticket, view, { me = null, nowMs = Date.now() } = {}) {
  if (!ticket) return false;
  switch (view) {
    case "needs":
      return (ticket.status === "open" || ticket.status === "new") && lastSpeaker(ticket) === "customer";
    case "mine":
      return Boolean(me) && ticket.assigned_staff_id === me && isActiveTicket(ticket);
    case "unassigned":
      return isActiveUnassignedTicket(ticket);
    case "overdue":
      return isOverdueTicket(ticket, nowMs);
    case "waiting":
      return ticket.status === "pending";
    case "resolved":
      return DONE_SUPPORT_STATUSES.has(ticket.status);
    case "all":
      return true;
    default:
      return false;
  }
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

/**
 * The rows every view starts from: the Opened-by switch, the dropdown filters
 * and the search box. `filters` = { productArea, priority, owner, brand } where
 * "" means any; owner "none" means nobody.
 */
export function supportInboxBase(rows, {
  openedBy = "all",
  filters = {},
  search = "",
  profilesById = {},
  brandsById = {},
} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const query = normal(search);
  return list.filter((ticket) => {
    if (openedBy !== "all" && (ticket.origin || "customer") !== openedBy) return false;
    if (filters.productArea && ticket.product_area !== filters.productArea) return false;
    if (filters.priority && ticket.priority !== filters.priority) return false;
    if (filters.owner === "none" && ticket.assigned_staff_id) return false;
    if (filters.owner && filters.owner !== "none" && ticket.assigned_staff_id !== filters.owner) return false;
    if (filters.brand && ticket.brand_id !== filters.brand) return false;
    if (query && !ticketSearchText(ticket, { profilesById, brandsById }).includes(query)) return false;
    return true;
  });
}

function waitingSince(ticket) {
  const at = Date.parse(ticket?.last_message_at || ticket?.created_at || "");
  return Number.isFinite(at) ? at : 0;
}

const OLDEST_FIRST = new Set(["needs", "mine", "unassigned", "overdue", "waiting"]);

/**
 * The rows a view shows. Work still waiting lists the longest-waiting first;
 * Resolved and All list newest activity first.
 */
export function supportInboxRows(rows, view, ctx = {}) {
  const nowMs = ctx.nowMs ?? Date.now();
  const list = supportInboxBase(rows, ctx).filter((row) => ticketMatchesView(row, view, { me: ctx.me, nowMs }));
  const oldestFirst = OLDEST_FIRST.has(view);
  return list.sort((left, right) => (oldestFirst
    ? waitingSince(left) - waitingSince(right)
    : waitingSince(right) - waitingSince(left)));
}

/**
 * { needs, mine, unassigned, overdue, waiting, resolved, all, open } over the
 * inbox's own rows. `open` is the Needs reply count: the Support page's Inbox
 * badge reads it, so the badge matches the default view.
 */
export function supportInboxCounts(rows, ctx = {}) {
  const nowMs = ctx.nowMs ?? Date.now();
  const base = supportInboxBase(rows, ctx);
  const counts = Object.fromEntries(
    SUPPORT_INBOX_VIEWS.map(({ id }) => [id, base.filter((row) => ticketMatchesView(row, id, { me: ctx.me, nowMs })).length]),
  );
  counts.open = counts.needs;
  return counts;
}

/** The chip a row shows for who opened it and who can see it. */
export function originChip(ticket) {
  if (ticket?.origin === "staff") {
    return { kind: "staff", label: `Staff · ${VISIBILITY_LABEL[ticket.visibility] || "Internal"}` };
  }
  return { kind: "customer", label: ticket?.requester_segment === "explorer" ? "Explorer" : "Host" };
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
// MINGLA-INVARIANT: I-4382-INBOX-ACTIVE-NEVER-PAGED-OUT | issue #4382 | Every active support ticket is loaded into the Admin inbox (up to 2000, with a visible "showing N of M" note beyond that); only resolved and closed tickets are paged, and a partial view says it is partial.
export const ACTIVE_TICKET_STATUSES = Object.freeze([...ACTIVE_SUPPORT_STATUSES]);
export const DONE_TICKET_STATUSES = Object.freeze([...DONE_SUPPORT_STATUSES]);
export const ACTIVE_TICKET_CAP = 2000;
export const CLOSED_PAGE_SIZE = 300;

const WORK_VIEWS = new Set(["needs", "mine", "unassigned", "overdue", "waiting"]);

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

/** The rail count: the loaded rows, with "+" when the view holds more. */
export function railCountLabel(count, partial) {
  return partial ? `${count}+` : String(count);
}

/** The note above a partial list, or null. */
export function coverageNote(viewCoverage) {
  if (!viewCoverage?.partial) return null;
  return `Showing the newest ${viewCoverage.loaded} of ${viewCoverage.total} tickets. Counts cover the loaded tickets only.`;
}
