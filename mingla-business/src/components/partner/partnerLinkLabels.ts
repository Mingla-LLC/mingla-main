/**
 * partnerLinkLabels — ORCH-1384 pure label/copy helpers for the partner
 * brand-link surface. CANONICAL, unit-tested source for the three
 * status/reason/error string maps.
 *
 * WHY ITS OWN MODULE + WHY IT IS IMPORTED ONLY BY THE LAZY SHEET (ORCH-1384 web
 * eager-bundle budget fix):
 *   `PartnerLinkDetailSheet.tsx` is NATIVE-FIRST and heavy (reanimated sheet,
 *   the React-Query verb mutations, Input/Sheet primitives) and is lazily
 *   loaded off the web boot path (brands.tsx `React.lazy`). This module holds
 *   the pure copy maps it needs. Metro places any module shared by ≥2 output
 *   chunks into the eager web boot `__common` chunk guarded by the ORCH-1083
 *   initial-bundle budget (`scripts/ci/orch-1083-initial-bundle-budget.mjs`,
 *   __common cap 2,250,000 B). To keep this module (and thus nothing partner-
 *   sheet-related) out of `__common`, it is imported ONLY by the lazy sheet —
 *   so it rides the sheet's async chunk. The two tiny eager list surfaces that
 *   also need a label carry a VERBATIM inline copy instead of importing here:
 *     - app/partner/brands.tsx        → reasonLabelFor + terminalEventNameFor
 *     - components/team/MemberDetailSheet.tsx → errorCopyFor
 *   That is a pure-formatting duplication (spec-frozen copy, no state — NOT a
 *   Const #2 data-ownership split). __tests__/partnerLinkLabels.driftguard.
 *   orch1384.source.test.ts executes all copies and asserts they never drift
 *   from these canonical definitions. Re-sharing this module with an eager
 *   surface re-bloats `__common` and the ORCH-1083 guard goes red — that guard
 *   IS the regression test for this fix.
 *
 * These are pure `string`/`string | null → string` maps: NO React, NO
 * reanimated, NO service/mutation imports. Keep it that way.
 */

/** §9.1 — cancelled_reason → row/sheet status label. NULL (legacy) → "Cancelled". */
export function reasonLabelFor(reason: string | null): string {
  switch (reason) {
    case "owner_declined":
      return "Declined by owner";
    case "invitation_revoked":
      return "Invite revoked";
    case "partner_disconnected":
      return "Disconnected";
    case "owner_removed":
      return "Disconnected by owner";
    case "partner_cancelled":
    default:
      return "Cancelled";
  }
}

/** §2.2 Group C — terminal timeline event name per reason. */
export function terminalEventNameFor(reason: string | null): string {
  switch (reason) {
    case "owner_declined":
      return "Declined";
    case "invitation_revoked":
      return "Revoked";
    case "partner_disconnected":
    case "owner_removed":
      return "Disconnected";
    case "partner_cancelled":
    default:
      return "Cancelled";
  }
}

/** §5.6 — typed service error code → user copy (shared by both sheets). */
export function errorCopyFor(code: string): string {
  switch (code) {
    case "link_not_pending":
      return "This invite already changed state. Close this and check the list.";
    case "link_not_active":
      return "This connection isn't active anymore. Close this and check the list.";
    case "link_not_found":
      return "This link no longer exists. Close this and refresh.";
    case "forbidden":
      return "You don't have permission to manage this link.";
    case "email_send_failed":
      return "We couldn't send the email. Tap Resend invite to try again.";
    default:
      return "Something broke on our side. Try again.";
  }
}
