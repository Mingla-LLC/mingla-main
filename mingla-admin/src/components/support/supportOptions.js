// #4382 — fixed option lists the Support desk and Product board share.

/** Product areas offered by the New ticket and Send to Product forms. Free text is allowed too. */
export const PRODUCT_AREAS = Object.freeze([
  "Host app · Payouts",
  "Host app · Tickets and check-in",
  "Host app · Events",
  "Host app · Venue",
  "Host app · Account",
  "Host web · Checkout",
  "Explorer app · Discover",
  "Explorer app · Bookings and payments",
  "Explorer app · Account",
  "Admin",
  "Other",
]);

export const PRIORITY_OPTIONS = Object.freeze([
  Object.freeze({ value: "low", label: "Low" }),
  Object.freeze({ value: "normal", label: "Normal" }),
  Object.freeze({ value: "high", label: "High" }),
  Object.freeze({ value: "urgent", label: "Urgent" }),
]);

/** The topics each app offers (the database checks the same lists). */
export const TOPIC_LABEL = Object.freeze({
  payouts: "Payouts",
  tickets_checkin: "Tickets and check-in",
  events: "Events",
  venue: "Venue",
  account: "Account",
  other: "Other",
  broken: "Something is broken",
  bookings_payments: "Bookings and payments",
  idea: "An idea",
  confusing: "Something is confusing",
});

export const STATUS_LABEL = Object.freeze({
  new: "New",
  open: "Open",
  pending: "Waiting",
  resolved: "Resolved",
  closed: "Closed",
});

export const STATUS_BADGE = Object.freeze({
  new: "info",
  open: "brand",
  pending: "warning",
  resolved: "success",
  closed: "default",
});

/** "Host app 4.12 · Android 14 · Pixel 7" from client_meta, or "". */
export function deviceLine(ticket) {
  const meta = ticket?.client_meta || {};
  const app = ticket?.requester_segment === "explorer" ? "Explorer app" : "Host app";
  const parts = [
    meta.app_version ? `${app} ${meta.app_version}` : "",
    [meta.os, meta.os_version].filter(Boolean).join(" "),
    meta.device_model || "",
  ].filter(Boolean);
  return parts.join(" · ");
}
