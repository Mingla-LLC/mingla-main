// #4453 — website change requests on the Support desk: the rules behind the
// "Website changes" view, the 24-hour clock and the "Ready for review" button.
// Pure: no React, no Supabase.
//
// A website change request is a support ticket with topic website_change. The
// inbox load attaches its detail row (support_website_requests) as
// ticket.website_request. The 24-hour clock is the request's due time, which
// is also the ticket's promised next update, so the desk's own Overdue rule
// (isOverdueTicket) decides when it is late.
//
// Invariant I-4453-WEBSITE-CLOCK-ONE-RULE (declared in src/__tests__/issue4453_website_requests.implementor.test.js): A website change request reads as overdue on the desk exactly when it is still active, not yet marked ready and its due time has passed; a ready or finished request never shows a running clock.

import { isActiveTicket, isOverdueTicket } from "./supportTicketMetrics.js";

export const WEBSITE_TOPIC = "website_change";
export const READY_NOTE_MAX = 1000;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export function isWebsiteRequestTicket(ticket) {
  return ticket?.topic === WEBSITE_TOPIC;
}

/** The time the request is due: its own clock, else the ticket's promise. */
export function websiteRequestDueAt(ticket) {
  return ticket?.website_request?.due_at || ticket?.next_update_at || null;
}

/** "3h", "40 min", "2d 4h" for a length of time. */
export function formatSpan(ms) {
  const span = Math.max(0, Number(ms) || 0);
  if (span < HOUR_MS) return `${Math.max(1, Math.round(span / MINUTE_MS))} min`;
  const hours = Math.floor(span / HOUR_MS);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours - days * 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/**
 * The clock a website change request shows:
 *   { state: "due" | "overdue" | "ready" | "done" | "none", label, tone }
 * tone is a Badge variant. `none` means "not a website request".
 */
export function websiteRequestClock(ticket, nowMs = Date.now()) {
  if (!isWebsiteRequestTicket(ticket)) return { state: "none", label: "", tone: "default" };
  if (!isActiveTicket(ticket)) return { state: "done", label: "Finished", tone: "default" };
  if (ticket.website_request?.ready_at) return { state: "ready", label: "Ready for review", tone: "success" };
  const dueAt = websiteRequestDueAt(ticket);
  const due = dueAt ? Date.parse(dueAt) : Number.NaN;
  if (!Number.isFinite(due)) return { state: "due", label: "No due time", tone: "default" };
  // The desk's own overdue rule, read against the request's clock.
  if (isOverdueTicket({ ...ticket, next_update_at: dueAt }, nowMs)) {
    return { state: "overdue", label: `Overdue by ${formatSpan(nowMs - due)}`, tone: "error" };
  }
  const left = due - nowMs;
  return { state: "due", label: `Due in ${formatSpan(left)}`, tone: left <= 4 * HOUR_MS ? "warning" : "info" };
}

/** "Home page · Top of the page" from the request's page and section. */
export function websiteRequestWhere(request) {
  if (!request) return "";
  const page = request.page_path === "/" ? "Home page" : request.page_path || "";
  return [page, request.section_label].filter(Boolean).join(" · ") || "The whole website";
}

/**
 * What Ari could not do, in plain words: a bare code (`custom_change`) is
 * never shown to the team.
 */
export function websiteRequestCouldNot(request) {
  const value = typeof request?.missing_capability === "string" ? request.missing_capability.trim() : "";
  if (!value) return "";
  return /^[a-z0-9]+(_[a-z0-9]+)+$/.test(value) ? "A custom change the website editor has no control for yet" : value;
}

/** The Admin page for this brand's website (Brands > Websites). */
export function adminSiteHref(request) {
  return request?.site_id ? `#/brand-sites?siteId=${encodeURIComponent(request.site_id)}` : null;
}

/**
 * Whether "Ready for review" can be pressed, and the words when it cannot:
 * { ok, reason }. The database checks the same things again.
 */
export function readyButtonState(ticket, { sending = false, note = "" } = {}) {
  if (!isWebsiteRequestTicket(ticket)) return { ok: false, reason: "This is not a website change request." };
  if (!ticket.website_request) return { ok: false, reason: "This ticket has no request details, so reply in the thread instead." };
  if (sending) return { ok: false, reason: "Telling the owner…" };
  if (!isActiveTicket(ticket)) return { ok: false, reason: "This request is finished. Set it back to Open to mark it ready again." };
  if (ticket.website_request.ready_at && ticket.status === "pending") {
    return { ok: false, reason: "The owner has been told. It can be marked ready again after they reply." };
  }
  if (String(note || "").trim().length > READY_NOTE_MAX) {
    return { ok: false, reason: `Keep the note under ${READY_NOTE_MAX} characters.` };
  }
  return { ok: true, reason: "" };
}

const READY_ERRORS = {
  forbidden: "Only Support staff can mark a request ready.",
  illegal_transition: "This request is finished. Set it back to Open first.",
  ticket_closed: "This ticket is closed. Set it back to Open first.",
  request_not_found: "This ticket has no website request details.",
  note_too_long: `Keep the note under ${READY_NOTE_MAX} characters.`,
};

/** Plain words for a refusal from issue_4453_website_request_ready. */
export function readyErrorMessage(raw) {
  const text = String(raw || "");
  const key = Object.keys(READY_ERRORS).find((code) => text.includes(code));
  if (key) return READY_ERRORS[key];
  if (/issue_4453_website_request_ready|schema cache|PGRST202/i.test(text)) {
    return "Website requests aren't live in the database yet, so this can't be saved.";
  }
  return text || "Couldn't mark this ready";
}
