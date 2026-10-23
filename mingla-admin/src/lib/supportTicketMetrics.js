const ACTIVE_SUPPORT_STATUSES = new Set(["new", "open", "pending"]);

export function isActiveUnassignedTicket(ticket) {
  return Boolean(ticket && !ticket.assigned_staff_id && ACTIVE_SUPPORT_STATUSES.has(ticket.status));
}
