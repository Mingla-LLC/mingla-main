/**
 * #3655 / #1484 — pure venue desktop-rail derivation (no RN / expo imports).
 *
 * Kept out of VenueSuiteShell so node Jest suites can assert rail shape without
 * loading the shell's native dependency graph.
 */

import type { SuiteDesktopModule } from "../suite/SuiteDesktopShell";
import type { VenueModule } from "../../types/venueReservation";
import { VENUE_MODULES, isBookingModule } from "./venueModules";

export function deriveVenueRailModules(
  modules: readonly VenueModule[],
  dirtyModules: ReadonlySet<VenueModule> = new Set(),
): SuiteDesktopModule[] {
  const command = modules.filter((m) => VENUE_MODULES[m].band === "command");
  const booking = modules.filter((m) => VENUE_MODULES[m].band === "booking");
  // #4420 — Reviews sits with Overview at the top (the "Venue" group).
  const isVenueTop = (m: VenueModule): boolean => m === "overview" || m === "reviews";
  const orderedCommandTop = command.filter(isVenueTop);
  const orderedCommandBottom = command.filter((m) => !isVenueTop(m));
  return [...orderedCommandTop, ...booking, ...orderedCommandBottom].map(
    (m) => ({
      key: m,
      label: VENUE_MODULES[m].label,
      group:
        isVenueTop(m) ? "Venue" : isBookingModule(m) ? "Bookings" : "Operations",
      dirty: dirtyModules.has(m),
    }),
  );
}
