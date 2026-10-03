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
  const orderedCommandTop = command.filter((m) => m === "overview");
  const orderedCommandBottom = command.filter((m) => m !== "overview");
  return [...orderedCommandTop, ...booking, ...orderedCommandBottom].map(
    (m) => ({
      key: m,
      label: VENUE_MODULES[m].label,
      group:
        m === "overview" ? "Venue" : isBookingModule(m) ? "Bookings" : "Operations",
      dirty: dirtyModules.has(m),
    }),
  );
}
