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
  // #4490 spec 08 O1 — selling (a Till device login holds venue.sell too).
  if (capabilities.includes("venue.sell")) {
    allowed.add("till");
  }
  // #4490 spec 08 O3 — kitchen and bar (a Till device holds venue.kitchen too).
  if (capabilities.includes("venue.kitchen") || capabilities.includes("restaurant.manage_orders")) {
    allowed.add("stations");
  }
  // #4490 spec 08 O5 part B — Close the day is money (venue.manage_money).
  if (capabilities.includes("venue.manage_money")) {
    allowed.add("close");
  }
  return modules.filter((module) => allowed.has(module));
}

/**
 * #4490 spec 08 O1 — the Till shows only to someone the server lets sell at
 * this venue (`issue_4490_can_sell`: event manager and above, or venue.sell),
 * so a finance or marketing manager never meets a Till that refuses them.
 */
export function withTillAccess(
  modules: readonly VenueModule[],
  canSell: boolean,
): readonly VenueModule[] {
  return canSell ? modules : modules.filter((module) => module !== "till");
}

/**
 * #4490 spec 08 O3 — Kitchen and bar shows only to someone the server lets work
 * a station here (`issue_4490_can_kitchen`), never to a role it would refuse.
 */
export function withStationsAccess(
  modules: readonly VenueModule[],
  canKitchen: boolean,
): readonly VenueModule[] {
  return canKitchen ? modules : modules.filter((module) => module !== "stations");
}

/**
 * #4490 spec 08 O5 part B — Close the day shows only to someone the server lets
 * handle money here (`issue_4490_can_manage_money`), never to a role it refuses.
 */
export function withCloseAccess(
  modules: readonly VenueModule[],
  canManageMoney: boolean,
): readonly VenueModule[] {
  return canManageMoney ? modules : modules.filter((module) => module !== "close");
}

/** #4490 spec 08 O5 part B — brand roles with money rights without a venue grant (finance manager and up). */
const MONEY_ROLES: ReadonlySet<string> = new Set(["finance_manager", "event_manager", "brand_admin", "brand_owner"]);

/**
 * #4490 spec 08 O5 part B — the client mirror of `issue_4490_can_manage_money`:
 * venue staff with venue.manage_money at this venue, or a brand role of
 * finance manager and above. An unknown role is no.
 */
export function venueAccessCanManageMoney(input: {
  scoped: boolean;
  capabilities: readonly VenueCapability[];
  role: string | null;
}): boolean {
  return input.scoped
    ? input.capabilities.includes("venue.manage_money")
    : input.role !== null && MONEY_ROLES.has(input.role);
}

/** #4490 — scoped staff who may open the venue's offer/space/hours editors. */
export function scopedStaffManagesOffers(
  scoped: boolean,
  capabilities: readonly VenueCapability[],
): boolean {
  return scoped && capabilities.includes("venue.manage_offers");
}

/** #4490 spec 08 O1 — brand roles that may sell without a venue grant. */
const SELLING_ROLES: ReadonlySet<string> = new Set(["event_manager", "brand_admin", "brand_owner"]);

/**
 * #4490 spec 08 O1 — the client mirror of `issue_4490_can_sell`: venue staff
 * with venue.sell at this venue, or a brand role of event manager and above.
 * An unknown role (no member row read) is no.
 */
/**
 * #4490 spec 08 O3 — the client mirror of `issue_4490_can_kitchen`: venue staff
 * with venue.kitchen or restaurant.manage_orders at this venue, or a brand role
 * of event manager and above (the same roles that may sell).
 */
export function venueAccessCanKitchen(input: {
  scoped: boolean;
  capabilities: readonly VenueCapability[];
  role: string | null;
}): boolean {
  return input.scoped
    ? input.capabilities.includes("venue.kitchen") || input.capabilities.includes("restaurant.manage_orders")
    : input.role !== null && SELLING_ROLES.has(input.role);
}

export function venueAccessCanSell(input: {
  scoped: boolean;
  capabilities: readonly VenueCapability[];
  role: string | null;
}): boolean {
  return input.scoped
    ? input.capabilities.includes("venue.sell")
    : input.role !== null && SELLING_ROLES.has(input.role);
}
