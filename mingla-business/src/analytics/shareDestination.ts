/**
 * #3187 P2-1 — report a share recipient's destination action from the booted
 * Host web app.
 *
 * WHY. A shared link opens the canonical public page with `?ms=<code>.<version>`.
 * The server document records `share_public_page_viewed` and binds
 * `share_destination_action` to its own CTA — but that CTA lives inside `#root`,
 * and the app replaces it (listener and all) the moment it boots. From then on
 * the only controls a recipient can tap are the app's, so the app reports the
 * action here.
 *
 * HOW. The page's analytics script (`server/publicSharePageAnalytics.js`)
 * exposes ONE recorder on `window` when, and only when, the page was reached
 * with a valid `ms`. This module calls it. Everything else — the consent gate,
 * the payload `{event, code, version, kind, action}`, the relay
 * (`/api/content-share-analytics`), the allowed actions, the page scope and the
 * one-intent-one-event ledger shared with the server CTA — is owned by that one
 * script. So this file knows nothing about codes, versions or consent, and a
 * page not reached from a share (no recorder) makes every call a no-op; so does
 * native, where there is no such global.
 *
 * No imports on purpose: public pages import this, and it must add nothing to
 * their bundle.
 */

/** The destination actions a public page's controls perform (subset of the relay's ACTIONS). */
export type ShareDestinationAction =
  | "buy_tickets"
  | "rsvp"
  | "book_trip"
  | "book_experience"
  | "view_brand"
  | "view_venue"
  | "view_offering"
  | "directions"
  | "website"
  | "call";

/** Must equal SHARE_DESTINATION_GLOBAL in server/publicSharePageAnalytics.js (pinned by the #3187 suite). */
export const SHARE_DESTINATION_GLOBAL = "__minglaShareDestination";

type ShareDestinationRecorder = (action: string) => boolean;

/**
 * Records one destination action for the share this page was opened from.
 * Returns whether an event was sent (false: no share, no consent, already
 * recorded for this share in this tab, or a different page). Never throws —
 * analytics never owns the tap that triggered it.
 */
export function recordShareDestination(action: ShareDestinationAction): boolean {
  const recorder = (globalThis as Record<string, unknown>)[SHARE_DESTINATION_GLOBAL];
  if (typeof recorder !== "function") return false;
  try {
    return (recorder as ShareDestinationRecorder)(action) === true;
  } catch {
    // The page's recorder catches internally; this only guards a foreign value
    // under the same name. The navigation the tap asked for must still happen.
    return false;
  }
}
