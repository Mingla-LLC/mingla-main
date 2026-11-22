/**
 * #4490 R4J-N22 — the Team screen's venue access on a Stay.
 *
 * Spec 07 §J: "Grants: stay venues accept the same venue capabilities as
 * other venues", and §13 shows a Stay's feature destinations (Table
 * reservations, Waitlist, Check-in, Offers…) to staff by those capabilities.
 * The editor offered a Stay only its four `stay.*` capabilities and only the
 * Front desk profile, so no staff member could ever be given a Stay feature.
 * The server's grant validator accepts `stay.*`, `restaurant.*` and `venue.*`
 * on a Stay with any of the four profiles.
 *
 * FAILS-ON-REVERT: restore the Stay exclusion (venue capabilities offered
 * only to non-Stay types, or the Stay profile list back to Front desk) and
 * the Stay cases below fail.
 */
import {
  capabilityOptionsFor,
  isVenueAccessAssignable,
  profileOptionsFor,
} from "../venueAccessOptions";
import type { VenueListing } from "../../../services/venueListingsService";

const STAY_CAPS = [
  "stay.view_reservations",
  "stay.create_reservations",
  "stay.manage_reservations",
  "stay.view_availability",
];

describe("#4490 R4J-N22 venue access options", () => {
  it("a Stay is offered its four Stay capabilities first, then every venue capability an ordinary venue gets", () => {
    const stay = capabilityOptionsFor("stay").map((o) => o.capability);
    const ordinary = capabilityOptionsFor("restaurant").map((o) => o.capability);
    expect(stay.slice(0, 4)).toEqual(STAY_CAPS);
    expect(stay.slice(4)).toEqual(ordinary);
    for (const cap of [
      "venue.check_in",
      "venue.view_bookings",
      "venue.manage_bookings",
      "venue.manage_offers",
      "venue.manage_members",
      "venue.manage_money",
      "restaurant.manage_reservations",
      "restaurant.manage_menu",
      "restaurant.view_orders",
    ]) {
      expect(stay).toContain(cap);
    }
  });

  it("ordinary venues are unchanged: no Stay capabilities, the same venue list for every type", () => {
    const restaurant = capabilityOptionsFor("restaurant").map((o) => o.capability);
    expect(restaurant.some((c) => c.startsWith("stay."))).toBe(false);
    // TEST-MOD-APPROVED #4490 (08-O1): + "Sell and send orders" (venue.sell).
    expect(restaurant).toHaveLength(12);
    expect(restaurant).toContain("venue.sell");
    for (const type of ["play", "club", "cafe", "coworking", "bar_lounge", "event_space", "creative_and_arts"]) {
      expect(capabilityOptionsFor(type).map((o) => o.capability)).toEqual(restaurant);
    }
  });

  it("labels are the existing ones (no new copy)", () => {
    const labels = capabilityOptionsFor("stay").map((o) => o.label);
    expect(labels).toContain("Check guests in at the door");
    expect(labels).toContain("Manage restaurant reservations");
    expect(labels).toContain("View Stay reservations");
  });

  // TEST-MOD-APPROVED #4490 (08-O1): every venue also gets the "Till device" profile.
  it("profiles: a Stay keeps Front desk and also gets the venue profiles; others keep theirs", () => {
    expect(profileOptionsFor("stay").map((o) => o.id)).toEqual([
      "front_desk",
      "restaurant_manager",
      "kitchen_bar",
      "till_device",
      "custom",
    ]);
    expect(profileOptionsFor("restaurant").map((o) => o.id)).toEqual([
      "restaurant_manager",
      "kitchen_bar",
      "till_device",
      "custom",
    ]);
  });

  it("every venue type, Stay included, can have scoped staff", () => {
    const venue = (venueCategory: string): VenueListing =>
      ({ venueCategory }) as unknown as VenueListing;
    expect(isVenueAccessAssignable(venue("stay"))).toBe(true);
    expect(isVenueAccessAssignable(venue("club"))).toBe(true);
    expect(isVenueAccessAssignable(venue("unknown_type"))).toBe(false);
  });
});
