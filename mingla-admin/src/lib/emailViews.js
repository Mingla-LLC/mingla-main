// Issue #4383 — the Communications Email screen's sections, read from and
// written to the address as `view=` (#/email?view=sent).
//
// Pure module: no React, no Supabase, so a plain node test runs it.
//
//   write         the composer (every teammate, #4255 D5)
//   scheduled     every scheduled email, for every teammate who writes email
//   sent          today's send history (admin-only table)
//   templates     the composer's template manager
//   unsubscribes  the unsubscribe list (admin-only table)

import { AREA } from "./access.js";

export const EMAIL_VIEWS = Object.freeze([
  Object.freeze({ id: "write", label: "Write" }),
  Object.freeze({ id: "sent", label: "Sent" }),
  Object.freeze({ id: "templates", label: "Templates" }),
  Object.freeze({ id: "unsubscribes", label: "Unsubscribes" }),
]);

export const DEFAULT_EMAIL_VIEW = "write";

// #4255: Send history and the unsubscribe list read admin-only tables, so
// only admins see those sections. The Scheduled list is every teammate's
// (#4383, served by issue_4383_email_scheduled_list).
export const ADMIN_ONLY_EMAIL_VIEWS = Object.freeze(new Set(["sent", "unsubscribes"]));

// The Email page's sub-tab ids before #4383, kept so an old in-page state
// or bookmark still opens the same section.
const OLD_VIEW_IDS = Object.freeze({ send: "write", history: "sent" });

export function emailViewsFor(access) {
  const isAdmin = access?.status === "active" && Array.isArray(access?.areas) &&
    access.areas.includes(AREA.ADMIN_CONSOLE);
  return isAdmin ? EMAIL_VIEWS : EMAIL_VIEWS.filter((view) => !ADMIN_ONLY_EMAIL_VIEWS.has(view.id));
}

/** The section an address asks for, if this person has it; else Write. */
export function emailViewFromHash(hash, views = EMAIL_VIEWS) {
  const text = typeof hash === "string" ? hash : "";
  const at = text.indexOf("?");
  let requested = null;
  try {
    requested = new URLSearchParams(at < 0 ? "" : text.slice(at + 1)).get("view");
  } catch {
    requested = null;
  }
  const id = requested && Object.hasOwn(OLD_VIEW_IDS, requested) ? OLD_VIEW_IDS[requested] : requested;
  return views.some((view) => view.id === id) ? id : DEFAULT_EMAIL_VIEW;
}

/** The address of one section; Write has the bare address. */
export function emailViewHash(viewId) {
  if (!EMAIL_VIEWS.some((view) => view.id === viewId) || viewId === DEFAULT_EMAIL_VIEW) return "#/email";
  return `#/email?view=${encodeURIComponent(viewId)}`;
}
