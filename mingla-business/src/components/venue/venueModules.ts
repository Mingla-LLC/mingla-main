/**
 * META-ORCH-1148 sub-ORCH 2.0 — venue-suite module registry + nav derivation.
 *
 * Pure, dependency-free. The single source of truth for which modules the suite
 * shows and in what order. The booking band (Tables / Availability /
 * Reservations / Waitlist) is gated SOLELY on `reservationsEnabled` — this is
 * the fails-on-revert anchor I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE.
 *
 * DO NOT show booking modules unconditionally and DO NOT hide them when the
 * toggle is ON — either flips the invariant test (venueModules.test.ts T-1/T-2)
 * to FAIL.
 */

import type { VenueModule } from "../../types/venueReservation";

export interface VenueModuleMeta {
  readonly id: VenueModule;
  readonly label: string;
  /** Master-rail band header (Design §2.1). Band A = Command, Band B = Booking. */
  readonly band: "command" | "booking";
  /** One-line job description (reused by the ComingSoon interstitial). */
  readonly summary: string;
}

/** Canonical metadata, declaration-ordered. */
export const VENUE_MODULES: Readonly<Record<VenueModule, VenueModuleMeta>> = {
  overview: {
    id: "overview",
    label: "Overview",
    band: "command",
    summary: "Your venue listing, AI scores, gallery, and guest feedback.",
  },
  tables: {
    id: "tables",
    label: "Tables",
    band: "booking",
    summary: "Set up your tables, zones, and party-size limits.",
  },
  availability: {
    id: "availability",
    label: "Availability",
    band: "booking",
    summary: "Set reservation hours, turn times, and blackout dates.",
  },
  reservations: {
    id: "reservations",
    label: "Reservations",
    band: "booking",
    summary: "See and manage today's and upcoming bookings.",
  },
  waitlist: {
    id: "waitlist",
    label: "Waitlist",
    band: "booking",
    summary: "Quote waits and seat walk-ins from a live queue.",
  },
  // ORCH-1186-C — DISPLAY-ONLY menu builder. COMMAND band (always visible,
  // independent of the reservations toggle). NOT a booking module.
  menu: {
    id: "menu",
    label: "Menu",
    band: "command",
    summary: "Build your menu — categories, items, and prices guests see online.",
  },
  settings: {
    id: "settings",
    label: "Settings",
    band: "command",
    summary: "Reservations toggle, fee, policies, and your venue profile.",
  },
};

/** The Band B booking modules in display order (between Overview and Settings). */
export const VENUE_BOOKING_MODULES: readonly VenueModule[] = [
  "tables",
  "availability",
  "reservations",
  "waitlist",
];

/**
 * Visible module list, gated on the single Reservations toggle.
 *  - OFF → `['overview', 'menu', 'settings']` (no booking band).
 *  - ON  → Overview, the four booking modules, Menu, then Settings (Settings
 *    stays last; booking modules between).
 *
 * ORCH-1186-C — `menu` is a COMMAND-band capability present in BOTH branches
 * (it is NOT gated on the reservations toggle). It sits after the booking band
 * and before Settings (a command capability after booking, before settings).
 * Settings STAYS LAST. The booking-band gating is unchanged — the menu addition
 * does not affect I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE.
 *
 * Pure; unit-tested (mirrors `deriveHubVisibleTabs`).
 */
export function deriveVenueModules(
  reservationsEnabled: boolean,
): readonly VenueModule[] {
  if (!reservationsEnabled) {
    return ["overview", "menu", "settings"];
  }
  return ["overview", ...VENUE_BOOKING_MODULES, "menu", "settings"];
}

/** True for the Band-B booking modules (which render ComingSoon in 2.0). */
export function isBookingModule(module: VenueModule): boolean {
  return (VENUE_BOOKING_MODULES as readonly VenueModule[]).includes(module);
}
