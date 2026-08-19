// ticketPdfPath — WHERE AN ORDER'S TICKET PDF LIVES, AND HOW OLD IT IS.
//
// ── WHY A VERSION LIVES IN THE FILENAME (issue #2347) ──────────────────────
// `orders.ticket_pdf_path` is a CACHE POINTER, and until #2347 the object it
// pointed at could have been rendered by either of two writers:
//
//   * `ticket-confirmation-dispatch` — day-correct since #2162.
//   * `ticket-pdf-fetch`'s lazy backfill — read `is_master` and rendered the
//     WRONG DAY for every multi-day guest, then wrote the pointer back, which
//     is what made the defect permanent rather than transient.
//
// Both wrote `tickets/{orderId}.pdf`, so nothing about a cached object tells
// you which renderer produced it. A version token in the NAME does, and it
// makes the repair a property of the deploy instead of a manual UPDATE that
// has to be timed after it — run the UPDATE a minute early and `ticket-pdf-fetch`
// simply re-caches the wrong day.
//
// The old path is never deleted. A signed URL for it may still be in flight,
// and an orphaned object in a private bucket is cheap; a 404 mid-download is
// not.

/** The version token every day-aware render carries. Bump on the NEXT defect
 * that invalidates cached PDFs; never reuse one. */
export const TICKET_PDF_RENDER_VERSION = "d2347";

/** Where a freshly rendered PDF for this order is written. */
export function ticketPdfStoragePath(orderId: string): string {
  return `tickets/${orderId}.${TICKET_PDF_RENDER_VERSION}.pdf`;
}

/**
 * Was this cached object rendered by a day-aware renderer?
 *
 * `false` for every pre-#2347 path (`tickets/{orderId}.pdf`), which is the
 * only signal available that the object MIGHT name the wrong day. The caller
 * decides what to do with a `false` — see `ticket-pdf-fetch`, which re-renders
 * only when the order is actually day-scoped, so single-date and legacy orders
 * keep their existing object and never re-render.
 */
export function isDayAwareTicketPdfPath(path: string | null): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  return path.endsWith(`.${TICKET_PDF_RENDER_VERSION}.pdf`);
}

/**
 * issue #2347 — MUST THIS CACHED PDF BE THROWN AWAY AND RE-RENDERED?
 *
 * Pure, so the decision that touches every buyer's cached artifact is provable
 * without a storage bucket. The truth table IS the guarantee:
 *
 *   cachedPath        isDayScoped | re-render?
 *   ─────────────────────────────────────────────────────────────────────────
 *   null / ""         either      | NO  — nothing cached; the ordinary lazy
 *                                 |      backfill owns that case, unchanged.
 *   pre-#2347 path    true        | YES — this is exactly the population that
 *                                 |      may name the wrong day.
 *   pre-#2347 path    false       | NO  — single-date / legacy / trip /
 *                                 |      experience. ZERO `ticket_event_dates`
 *                                 |      rows means the renderer had only one
 *                                 |      day to choose from and chose it. Its
 *                                 |      object and pointer are never touched
 *                                 |      and it never re-renders. THIS ROW IS
 *                                 |      the "single-day behaviour unchanged"
 *                                 |      guarantee.
 *   day-aware path    either      | NO  — already rendered day-aware.
 */
export function shouldRerenderCachedTicketPdf(input: {
  cachedPath: string | null;
  isDayScoped: boolean;
}): boolean {
  if (typeof input.cachedPath !== "string" || input.cachedPath.length === 0) {
    return false;
  }
  if (isDayAwareTicketPdfPath(input.cachedPath)) return false;
  return input.isDayScoped === true;
}
