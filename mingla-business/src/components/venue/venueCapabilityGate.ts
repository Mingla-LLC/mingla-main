import type { VenueCapability } from "../../services/brandInvitationsService";
import type { VenueModule } from "../../types/venueReservation";

/**
 * Selected-venue staff see only the operational surfaces explicitly granted.
 *
 * #4490 — the venue.* capabilities (spec 02 §2.5):
 *  - venue.manage_offers  → Offers, Spaces, Availability & pricing
 *  - venue.view_bookings  → Today, Calendar, Requests, Check-in (read)
 *  - venue.manage_bookings→ Today, Calendar, Requests, Check-in
 *  - venue.check_in       → Today, Check-in (the check-in-only role)
 *  - venue.manage_money   → no module of its own (money buttons inside them)
 * Modules that are not visible for the venue (feature off, phase not shipped)
 * stay hidden whatever is granted: this only ever narrows `modules`.
 */
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
    // #4490 P5 — tables live under Spaces › Tables (tables only for this capability).
    allowed.add("spaces");
    allowed.add("availability");
    allowed.add("reservations");
    allowed.add("waitlist");
  }
  if (capabilities.includes("venue.manage_offers")) {
    allowed.add("offers");
    allowed.add("spaces");
    allowed.add("availability");
  }
  if (
    capabilities.includes("venue.view_bookings") ||
    capabilities.includes("venue.manage_bookings")
  ) {
    allowed.add("today");
    allowed.add("calendar");
    allowed.add("requests");
    allowed.add("checkin");
  }
  // 07-I: the full list editor (terms, names and promoter links) is a
  // manage-bookings surface. Door-only staff see the same names in Check-in.
  if (capabilities.includes("venue.manage_bookings")) {
    allowed.add("guestlist");
  }
  // #4490 P6 — memberships: plans, members, pause/end.
  if (capabilities.includes("venue.manage_members")) {
    allowed.add("members");
  }
  if (capabilities.includes("venue.check_in")) {
    allowed.add("today");
    allowed.add("checkin");
  }
  return modules.filter((module) => allowed.has(module));
}

/** #4490 — scoped staff who may open the venue's offer/space/hours editors. */
export function scopedStaffManagesOffers(
  scoped: boolean,
  capabilities: readonly VenueCapability[],
): boolean {
  return scoped && capabilities.includes("venue.manage_offers");
}
