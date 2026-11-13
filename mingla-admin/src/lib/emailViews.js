// Issue #4383 — the Communications Email screen's sections, read from and
// written to the address as `view=` (#/email?view=emails).
//
// Pure module: no React, no Supabase, so a plain node test runs it.
//
//   write         the composer (every teammate, #4255 D5)
//   emails        #4419: one list of every email, scheduled to sent, with
//                 a full page per email at #/email/<id>. Every teammate who
//                 writes email opens it; the server shows non-admins their
//                 scheduled emails only (only admins see sent emails, as
//                 before; Seth, 13 Nov 2026)
//   templates     the composer's template manager
//   unsubscribes  the unsubscribe list (admin-only table)

import { AREA } from "./access.js";

export const EMAIL_VIEWS = Object.freeze([
  Object.freeze({ id: "write", label: "Write" }),
  Object.freeze({ id: "emails", label: "Emails" }),
  Object.freeze({ id: "templates", label: "Templates" }),
  Object.freeze({ id: "unsubscribes", label: "Unsubscribes" }),
]);

export const DEFAULT_EMAIL_VIEW = "write";

// #4255: the unsubscribe list reads an admin-only table, so only admins see it.
export const ADMIN_ONLY_EMAIL_VIEWS = Object.freeze(new Set(["unsubscribes"]));

// The Email page's section ids before #4419 (and #4383), kept so an old
// in-page state, bookmark or the #4383 Overview link (#/email?view=scheduled)
// still opens the same emails.
const OLD_VIEW_IDS = Object.freeze({ send: "write", history: "emails", sent: "emails", scheduled: "emails" });

// #4419: the list filter an old address implies (Scheduled kept its filter).
const OLD_VIEW_FILTERS = Object.freeze({ scheduled: "scheduled", sent: "all", history: "all" });
export const EMAIL_LIST_FILTERS = Object.freeze(["all", "scheduled", "sending", "sent", "attention", "cancelled"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function emailViewsFor(access) {
  const isAdmin = access?.status === "active" && Array.isArray(access?.areas) &&
    access.areas.includes(AREA.ADMIN_CONSOLE);
  return isAdmin ? EMAIL_VIEWS : EMAIL_VIEWS.filter((view) => !ADMIN_ONLY_EMAIL_VIEWS.has(view.id));
}

function hashParams(hash) {
  const text = typeof hash === "string" ? hash : "";
  const at = text.indexOf("?");
  try {
    return new URLSearchParams(at < 0 ? "" : text.slice(at + 1));
  } catch {
    return new URLSearchParams();
  }
}

/** The section an address asks for, if this person has it; else Write. */
export function emailViewFromHash(hash, views = EMAIL_VIEWS) {
  const requested = hashParams(hash).get("view");
  const id = requested && Object.hasOwn(OLD_VIEW_IDS, requested) ? OLD_VIEW_IDS[requested] : requested;
  return views.some((view) => view.id === id) ? id : DEFAULT_EMAIL_VIEW;
}

/** #4419: the Emails list filter an address asks for (filter=, or an old view's). */
export function emailListFilterFromHash(hash) {
  const params = hashParams(hash);
  const filter = params.get("filter");
  if (filter && EMAIL_LIST_FILTERS.includes(filter)) return filter;
  const view = params.get("view");
  return view && Object.hasOwn(OLD_VIEW_FILTERS, view) ? OLD_VIEW_FILTERS[view] : "all";
}

/** The address of one section; Write has the bare address. */
export function emailViewHash(viewId, filter = "all") {
  if (!EMAIL_VIEWS.some((view) => view.id === viewId) || viewId === DEFAULT_EMAIL_VIEW) return "#/email";
  const base = `#/email?view=${encodeURIComponent(viewId)}`;
  return viewId === "emails" && filter !== "all" && EMAIL_LIST_FILTERS.includes(filter)
    ? `${base}&filter=${encodeURIComponent(filter)}`
    : base;
}

/** #4419: the email an address opens (#/email/<uuid>), or null. UUIDs only. */
export function emailDetailIdFromHash(hash) {
  const text = typeof hash === "string" ? hash : "";
  const match = /^#\/email\/([^/?#]+)(?:[?#].*)?$/.exec(text);
  return match && UUID.test(match[1]) ? match[1].toLowerCase() : null;
}

/** #4419: the address of one email's page. */
export function emailDetailHash(id) {
  return typeof id === "string" && UUID.test(id) ? `#/email/${id}` : "#/email?view=emails";
}
