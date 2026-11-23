/**
 * #4490 (08-O3 fix 2) — a venue-only member (kitchen and bar, Till device,
 * sell, check-in, bookings, money) sees every venue they hold a grant at on
 * Home, whatever its type. Before, Home kept only Stay and restaurant venues,
 * so a login at a Play and games or Cafe venue read "No venue access yet".
 *
 * TEST-MOD-APPROVED #4490 (08-O3 fix 3): the suite's one source-text read (Home
 * reads the list through the model and lands on /venue/<id>) moved, word for
 * word, into .github/scripts/strict-grep/issue-4490-host-wiring.mjs as pin
 * `venue-staff-home-any-type` (I-PROPOSED-1047-NO-SOLE-SOURCE-PIN), as O3 fix 1
 * did for the Till and station suites; every behavioural test stays here.
 */
import type { VenueListing } from "../../../services/venueListingsService";
import {
  listVenueStaffVenues,
  venueStaffCardIcon,
  venueStaffCardType,
} from "../venueStaffHomeModel";

function venue(id: string, venueCategory: string): VenueListing {
  return { id, name: `V ${id}`, venueCategory, city: null } as unknown as VenueListing;
}

describe("venue-only Home list (#4490 O3 fix 2)", () => {
  it("lists a kitchen-only member's venue at a Play and games venue, with a path", () => {
    const out = listVenueStaffVenues([venue("d1", "play")]);
    expect(out.map((v) => v.id)).toEqual(["d1"]);
    expect(venueStaffCardType(out[0])).toBe("Play and games");
  });

  it("lists every venue type the member was granted (cafe, club, bar, event space)", () => {
    const types = ["cafe", "club", "bar_lounge", "event_space", "coworking", "creative_and_arts"];
    const out = listVenueStaffVenues(types.map((t, i) => venue(`v${i}`, t)));
    expect(out).toHaveLength(types.length);
  });

  it("keeps Stay and restaurant venues and their words unchanged", () => {
    const out = listVenueStaffVenues([venue("s", "stay"), venue("r", "restaurant")]);
    expect(out.map((v) => v.id)).toEqual(["s", "r"]);
    expect(venueStaffCardType(out[0])).toBe("Stay");
    expect(venueStaffCardType(out[1])).toBe("Restaurant");
    expect(venueStaffCardIcon(out[0])).toBe("home");
    expect(venueStaffCardIcon(out[1])).toBe("notebook");
  });

  it("no grants: the list is empty so Home keeps 'No venue access yet'", () => {
    expect(listVenueStaffVenues([])).toEqual([]);
    expect(listVenueStaffVenues(undefined)).toEqual([]);
    expect(listVenueStaffVenues(null)).toEqual([]);
  });
});
