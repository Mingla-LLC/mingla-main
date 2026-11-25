/**
 * #4490 spec 08 O1 — the Till in the venue workspace menus.
 *
 * The Till shows only when it is released (VENUE_TILL), the venue's `till`
 * feature is on, and this person may sell (the server's `issue_4490_can_sell`
 * mirror). It sits first under Operations (floor design rail), right before
 * Check-in in the feature layout and before Menu in the classic layout. A
 * login whose only right is selling sees the Till alone.
 */
import { featureSetFrom } from "../../../types/venueFeatures";
import { filterVenueModulesForCapabilities, venueAccessCanSell, withTillAccess } from "../venueCapabilityGate";
import { deriveVenueNav, parseVenueModuleParam, VENUE_MODULES } from "../venueModules";
import { deriveVenueRailModules } from "../venueRail";
import { tillHref, TILL_LAUNCHER_COPY } from "../till/tillRoute";


const featureLayout = featureSetFrom({ entry: true, menu: true, till: true });
const classic = featureSetFrom({ menu: true, till: true });

// TEST-MOD-APPROVED #4490 (08-O5 part B): Close the day (same release switch and feature as the Till)
// sits right after the Till; the Till still leads Operations and only the Till's own release modules
// (Kitchen and bar, Close the day) sit between it and Check-in / Menu.
const TILL_RELEASE = new Set(["stations", "close"]);
const withoutRelease = (nav: readonly string[]): string[] => nav.filter((m) => !TILL_RELEASE.has(m));

describe("08-O1 the Till in the venue rail", () => {
  it("TN-1 released + feature on: Till leads Operations, right before Check-in (feature layout)", () => {
    const nav = deriveVenueNav({ features: featureLayout, activeSpaceCount: 1, tillReleased: true });
    expect(withoutRelease(nav).indexOf("till")).toBe(withoutRelease(nav).indexOf("checkin") - 1);
    const operations = deriveVenueRailModules(nav).filter((row) => row.group === "Operations");
    expect(operations[0]).toEqual(expect.objectContaining({ key: "till", label: "Till" }));
  });

  it("TN-2 classic layout (no spaces): Till sits before Menu, still first under Operations", () => {
    const nav = deriveVenueNav({ features: classic, activeSpaceCount: 0, tillReleased: true });
    expect(withoutRelease(nav).indexOf("till")).toBe(withoutRelease(nav).indexOf("menu") - 1);
    const operations = deriveVenueRailModules(nav).filter((row) => row.group === "Operations");
    expect(operations[0]?.key).toBe("till");
  });

  it("TN-3 not released or feature off: no Till, and every other module is unchanged", () => {
    const released = deriveVenueNav({ features: featureLayout, activeSpaceCount: 1, tillReleased: true });
    const notReleased = deriveVenueNav({ features: featureLayout, activeSpaceCount: 1 });
    const off = deriveVenueNav({
      features: featureSetFrom({ entry: true, menu: true }),
      activeSpaceCount: 1,
      tillReleased: true,
    });
    expect(notReleased).not.toContain("till");
    expect(off).not.toContain("till");
    expect(released.filter((m) => m !== "till" && m !== "close")).toEqual(notReleased);
  });

  it("TN-4 venue staff: venue.sell (also a Till device) keeps the Till; check-in or kitchen alone does not", () => {
    const nav = deriveVenueNav({ features: featureLayout, activeSpaceCount: 1, tillReleased: true });
    expect(filterVenueModulesForCapabilities(nav, true, ["venue.sell"])).toEqual(["till"]);
    expect(
      filterVenueModulesForCapabilities(nav, true, ["venue.till_device", "venue.sell", "venue.kitchen", "venue.check_in"]),
    ).toEqual(expect.arrayContaining(["till", "today", "checkin"]));
    expect(filterVenueModulesForCapabilities(nav, true, ["venue.check_in"])).not.toContain("till");
    expect(filterVenueModulesForCapabilities(nav, true, ["venue.kitchen"])).not.toContain("till");
  });

  it("TN-5 who may sell mirrors the server: event manager and above, or venue.sell", () => {
    for (const role of ["event_manager", "brand_admin", "brand_owner"]) {
      expect(venueAccessCanSell({ scoped: false, capabilities: [], role })).toBe(true);
    }
    for (const role of ["finance_manager", "marketing_manager", "scanner", null]) {
      expect(venueAccessCanSell({ scoped: false, capabilities: [], role })).toBe(false);
    }
    expect(venueAccessCanSell({ scoped: true, capabilities: ["venue.sell"], role: null })).toBe(true);
    expect(venueAccessCanSell({ scoped: true, capabilities: ["venue.check_in"], role: "brand_admin" })).toBe(false);
    const nav = deriveVenueNav({ features: featureLayout, activeSpaceCount: 1, tillReleased: true });
    expect(withTillAccess(nav, false)).not.toContain("till");
    expect(withTillAccess(nav, true)).toEqual(nav);
  });

  it("TN-6 the address key and the route", () => {
    expect(parseVenueModuleParam("till")).toBe("till");
    expect(VENUE_MODULES.till.group).toBe("operations");
    expect(tillHref("44900000-0000-4000-8000-0000000000d1")).toBe("/venue/44900000-0000-4000-8000-0000000000d1/till");
    expect(TILL_LAUNCHER_COPY.open).toBe("Open the Till");
  });
});
