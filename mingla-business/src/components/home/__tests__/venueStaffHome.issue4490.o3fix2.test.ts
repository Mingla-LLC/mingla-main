/**
 * #4490 (08-O3 fix 2) — a venue-only member (kitchen and bar, Till device,
 * sell, check-in, bookings, money) sees every venue they hold a grant at on
 * Home, whatever its type. Before, Home kept only Stay and restaurant venues,
 * so a login at a Play and games or Cafe venue read "No venue access yet".
 */
import fs from "node:fs";
import path from "node:path";

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

  it("Home reads the list through the model and still lands on /venue/<id>", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../VenueStaffHome.tsx"), "utf8");
    expect(src).toContain("listVenueStaffVenues(venuesQuery.data)");
    expect(src).toContain("router.push(`/venue/${venue.id}` as never)");
    expect(src).toContain("No venue access yet");
    expect(src).not.toMatch(/venueCategory === "stay" \|\| venue\.venueCategory === "restaurant"/);
  });
});
