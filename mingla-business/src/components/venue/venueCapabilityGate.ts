import type { VenueCapability } from "../../services/brandInvitationsService";
import type { VenueModule } from "../../types/venueReservation";

/** Selected-venue staff see only the operational surfaces explicitly granted. */
export function filterVenueModulesForCapabilities(
  modules: readonly VenueModule[],
  scoped: boolean,
  capabilities: readonly VenueCapability[],
): readonly VenueModule[] {
  if (!scoped) return modules;
  const allowed = new Set<VenueModule>();
  if (
    capabilities.includes("restaurant.view_orders") ||
    capabilities.includes("restaurant.manage_orders")
  ) {
    allowed.add("orders");
  }
  if (
    capabilities.includes("restaurant.manage_menu") ||
    capabilities.includes("restaurant.manage_qr")
  ) {
    allowed.add("menu");
  }
  if (capabilities.includes("restaurant.manage_reservations")) {
    allowed.add("tables");
    allowed.add("availability");
    allowed.add("reservations");
    allowed.add("waitlist");
  }
  return modules.filter((module) => allowed.has(module));
}
