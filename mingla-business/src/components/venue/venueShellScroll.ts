/**
 * META-ORCH-1148 sub-ORCH 2.0 — Venue Suite shell scroll/nav-clearance contract.
 *
 * Pure helpers extracted from VenueSuiteShell so the mobile scroll + bottom-nav
 * clearance fix is unit-testable without a full RN render (Seth device-found:
 * "all pages need to scroll and clear the nav menu on the business app").
 *
 *  - `moduleSelfScrolls(module)` — Overview mounts <VenueListingContent>, which
 *    OWNS its own ScrollView (with its own clearance), so the shell must NOT wrap
 *    it in a second outer ScrollView (nested same-axis scroll = the broken
 *    "doesn't scroll" symptom). Settings + the booking ComingSoon render plain
 *    Views, so the shell supplies the scroll container for them.
 *  - `venueScrollBottomPad(insetsBottom)` — the floating BottomNav clearance:
 *    `insets.bottom + 120`, the shared nav-lock companion-pin pattern used by
 *    every Hub tab (app/(tabs)/hub/events.tsx) and by VenueListingContent in tab
 *    mode, so the last content row clears the nav on native + web-phone.
 */

import type { VenueModule } from "../../types/venueReservation";

/** The floating-BottomNav clearance constant, shared with the Hub tabs. */
export const VENUE_SCROLL_NAV_CLEARANCE = 120;

/**
 * True iff the module brings its own ScrollView (Overview = VenueListingContent)
 * and therefore the shell must NOT add an outer ScrollView around it.
 */
export function moduleSelfScrolls(module: VenueModule): boolean {
  return module === "overview";
}

/**
 * Bottom padding for the shell-owned ScrollView (Settings / ComingSoon) so the
 * last row clears the floating bottom nav + the device safe-area inset.
 */
export function venueScrollBottomPad(insetsBottom: number): number {
  return insetsBottom + VENUE_SCROLL_NAV_CLEARANCE;
}
