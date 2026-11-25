/**
 * #3655 / #1484 — pure venue desktop-rail derivation (no RN / expo imports).
 *
 * Kept out of VenueSuiteShell so node Jest suites can assert rail shape without
 * loading the shell's native dependency graph.
 *
 * #4490 — groups come from the module registry (`venueModuleGroupLabel`):
 * Venue · Offers · Bookings · Operations. A classic-layout venue (no spaces)
 * keeps exactly the pre-#4490 rail: Venue, Bookings (Tables, Availability,
 * Reservations, Waitlist), Operations.
 */

import type { SuiteDesktopModule } from "../suite/SuiteDesktopShell";
import type { VenueModule } from "../../types/venueReservation";
import { venueModuleGroupLabel, venueModuleLabel } from "./venueModules";

const GROUP_ORDER = ["Venue", "Offers", "Bookings", "Operations"] as const;

export function deriveVenueRailModules(
  modules: readonly VenueModule[],
  dirtyModules: ReadonlySet<VenueModule> = new Set(),
): SuiteDesktopModule[] {
  const rows = modules.map((m) => ({
    key: m,
    label: venueModuleLabel(m, modules),
    group: venueModuleGroupLabel(m, modules),
    dirty: dirtyModules.has(m),
  }));
  // Stable within a group; groups in the fixed order.
  return GROUP_ORDER.flatMap((group) => rows.filter((row) => row.group === group));
}
