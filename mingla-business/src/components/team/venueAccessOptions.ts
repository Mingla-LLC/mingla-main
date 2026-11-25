/**
 * Which venue-access profiles and capabilities the Team screen offers for a
 * venue (pure; unit-tested).
 *
 * #4490 R4J-N22 — a Stay takes the same venue capabilities as every other
 * venue type (spec 07 §J "Grants"; the server's grant validator accepts
 * `stay.*`, `restaurant.*` and `venue.*` on a Stay, with any profile), plus
 * its own four Stay capabilities. Its feature destinations (Table
 * reservations, Waitlist, Check-in, Offers…) are shown to staff by these
 * capabilities (§13), so the editor must be able to grant them.
 */
import type {
  VenueAccessProfile,
  VenueCapability,
} from "../../services/brandInvitationsService";
import type { VenueListing } from "../../services/venueListingsService";

export type CapabilityOption = {
  capability: VenueCapability;
  label: string;
  categories: readonly string[];
};

export const VENUE_ACCESS_PROFILES: Record<
  Exclude<VenueAccessProfile, "custom">,
  readonly VenueCapability[]
> = {
  front_desk: [
    "stay.view_reservations",
    "stay.create_reservations",
    "stay.manage_reservations",
    "stay.view_availability",
    // #4490 spec 08 O1: the front desk sells and checks guests in.
    "venue.sell",
    "venue.check_in",
  ],
  restaurant_manager: [
    "restaurant.view_orders",
    "restaurant.manage_orders",
    "restaurant.manage_menu",
    "restaurant.manage_qr",
    "restaurant.manage_reservations",
    // #4490 spec 08 O1.
    "venue.sell",
    "venue.kitchen",
    "venue.manage_money",
  ],
  kitchen_bar: ["restaurant.view_orders", "restaurant.manage_orders", "venue.kitchen"],
  // #4490 spec 08 O1: a shared phone or tablet that stays signed in.
  till_device: ["venue.till_device", "venue.sell", "venue.kitchen", "venue.check_in"],
};

export const PROFILE_OPTIONS: readonly {
  id: VenueAccessProfile;
  label: string;
}[] = [
  { id: "front_desk", label: "Front desk" },
  { id: "restaurant_manager", label: "Venue manager" },
  { id: "kitchen_bar", label: "Kitchen / bar" },
  { id: "till_device", label: "Till device" },
  { id: "custom", label: "Custom" },
];

/** #4490 spec 08 O5 (§2 screen 14): the Till device profile's explainer. */
export const TILL_DEVICE_EXPLAINER =
  "This login stays signed in on a shared phone or tablet. Staff switch with their PIN.";

/** Every venue type other than Stay. */
const NON_STAY_CATEGORIES: readonly string[] = [
  "restaurant",
  "play",
  "creative_and_arts",
  "bar_lounge",
  "club",
  "cafe",
  "event_space",
  "coworking",
];

/** Every venue type: the venue capabilities apply to all of them (§J). */
const ALL_VENUE_CATEGORIES: readonly string[] = [...NON_STAY_CATEGORIES, "stay"];

export const CAPABILITY_OPTIONS: readonly CapabilityOption[] = [
  { capability: "stay.view_reservations", label: "View Stay reservations", categories: ["stay"] },
  { capability: "stay.create_reservations", label: "Create Stay reservations", categories: ["stay"] },
  { capability: "stay.manage_reservations", label: "Update or cancel Stay reservations", categories: ["stay"] },
  { capability: "stay.view_availability", label: "View Stay availability", categories: ["stay"] },
  { capability: "restaurant.view_orders", label: "View restaurant orders", categories: ALL_VENUE_CATEGORIES },
  { capability: "restaurant.manage_orders", label: "Manage restaurant orders", categories: ALL_VENUE_CATEGORIES },
  { capability: "restaurant.manage_menu", label: "Manage restaurant menu", categories: ALL_VENUE_CATEGORIES },
  { capability: "restaurant.manage_qr", label: "Manage QR ordering spots", categories: ALL_VENUE_CATEGORIES },
  { capability: "restaurant.manage_reservations", label: "Manage restaurant reservations", categories: ALL_VENUE_CATEGORIES },
  // #4490 — the venue capabilities (every phase has shipped its surfaces).
  { capability: "venue.manage_offers", label: "Manage offers, spaces and opening hours", categories: ALL_VENUE_CATEGORIES },
  { capability: "venue.view_bookings", label: "See bookings, Today and the calendar", categories: ALL_VENUE_CATEGORIES },
  { capability: "venue.manage_bookings", label: "Answer requests and change bookings", categories: ALL_VENUE_CATEGORIES },
  { capability: "venue.check_in", label: "Check guests in at the door", categories: ALL_VENUE_CATEGORIES },
  { capability: "venue.manage_money", label: "Take payments and give refunds", categories: ALL_VENUE_CATEGORIES },
  { capability: "venue.manage_members", label: "Manage members and plans", categories: ALL_VENUE_CATEGORIES },
  // #4490 spec 08 O1 — the Till.
  { capability: "venue.sell", label: "Sell and send orders", categories: ALL_VENUE_CATEGORIES },
];

/** The capabilities offered for a venue of this type, in display order. */
export function capabilityOptionsFor(category: string): readonly CapabilityOption[] {
  return CAPABILITY_OPTIONS.filter((option) => option.categories.includes(category));
}

/**
 * The profiles offered for a venue of this type. A Stay keeps "Front desk"
 * and also gets the venue profiles; other venues keep the venue profiles.
 */
export function profileOptionsFor(category: string): typeof PROFILE_OPTIONS {
  return PROFILE_OPTIONS.filter(
    (option) =>
      option.id === "custom" ||
      option.id !== "front_desk" ||
      category === "stay",
  );
}

export function isVenueAccessAssignable(venue: VenueListing): boolean {
  // #4490 — every venue type can have scoped staff (was Stay and restaurant only).
  return ALL_VENUE_CATEGORIES.includes(venue.venueCategory);
}
