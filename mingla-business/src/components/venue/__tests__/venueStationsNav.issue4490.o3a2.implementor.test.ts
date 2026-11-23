/**
 * #4490 spec 08 O3 part A2 — "Kitchen and bar" in the venue rail (both shells):
 * right after the Till under Operations; shown only when released (VENUE_TILL),
 * the venue's Kitchen and bar screens feature is on, and the person may work
 * the kitchen (issue_4490_can_kitchen). Selecting it opens the station route.
 *
 * fails-on-revert: the nav candidate, the capability rule and both shells'
 * routing are pinned here.
 */
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

import { featureSetFrom } from "../../../types/venueFeatures";
import { deriveVenueNav, venueModuleGroupLabel, VENUE_MODULES } from "../venueModules";
import {
  filterVenueModulesForCapabilities,
  venueAccessCanKitchen,
  withStationsAccess,
  withTillAccess,
} from "../venueCapabilityGate";

const features = (on: Record<string, boolean>) => featureSetFrom(on as never);
const nav = (on: Record<string, boolean>, released = true) =>
  deriveVenueNav({ features: features(on), activeSpaceCount: 1, tillReleased: released });

describe("08-O3 A2 Kitchen and bar in the rail", () => {
  test("right after the Till, under Operations, labelled as the design rail", () => {
    const modules = nav({ menu: true, till: true, kitchen_screens: true, entry: true });
    const i = modules.indexOf("till");
    expect(modules[i + 1]).toBe("stations");
    expect(VENUE_MODULES.stations.label).toBe("Kitchen and bar");
    expect(venueModuleGroupLabel("stations", modules)).toBe("Operations");
  });
  test("classic layout: after the Till too", () => {
    const modules = deriveVenueNav({ features: features({ menu: true, till: true, kitchen_screens: true }), activeSpaceCount: 0, tillReleased: true });
    expect(modules.indexOf("stations")).toBe(modules.indexOf("till") + 1);
  });
  test("hidden when not released or the feature is off; shown without the Till feature", () => {
    expect(nav({ menu: true, kitchen_screens: true }, false)).not.toContain("stations");
    expect(nav({ menu: true, till: true })).not.toContain("stations");
    expect(nav({ menu: true, kitchen_screens: true })).toContain("stations");
  });
  test("scoped staff: Kitchen / bar and Till-device grants see it; selling or check-in alone do not", () => {
    const all = nav({ menu: true, till: true, kitchen_screens: true, entry: true });
    expect(filterVenueModulesForCapabilities(all, true, ["venue.kitchen"])).toContain("stations");
    expect(filterVenueModulesForCapabilities(all, true, ["restaurant.manage_orders"])).toContain("stations");
    expect(filterVenueModulesForCapabilities(all, true, ["venue.sell"])).not.toContain("stations");
    expect(filterVenueModulesForCapabilities(all, true, ["venue.check_in"])).not.toContain("stations");
    expect(venueAccessCanKitchen({ scoped: true, capabilities: ["venue.till_device", "venue.kitchen"], role: null })).toBe(true);
  });
  test("brand roles: event manager and above (the server rule); a finance manager never meets it", () => {
    const all = nav({ menu: true, till: true, kitchen_screens: true });
    for (const role of ["event_manager", "brand_admin", "brand_owner"]) {
      expect(venueAccessCanKitchen({ scoped: false, capabilities: [], role })).toBe(true);
    }
    expect(venueAccessCanKitchen({ scoped: false, capabilities: [], role: "finance_manager" })).toBe(false);
    expect(withStationsAccess(withTillAccess(all, false), false)).not.toContain("stations");
    expect(withStationsAccess(all, true)).toContain("stations");
  });
  test("both shells open the station route from the rail and from ?module=stations, with a static launcher", () => {
    const venue = fs.readFileSync(path.join(__dirname, "../VenueSuiteShell.tsx"), "utf8");
    const stay = fs.readFileSync(path.join(__dirname, "../../stay/StaySuiteShell.tsx"), "utf8");
    expect(venue).toContain('import { stationHref, StationsLauncher } from "./station/StationsLauncher";');
    expect(stay).toContain('import { stationHref, StationsLauncher } from "../venue/station/StationsLauncher";');
    for (const shell of [venue, stay]) {
      expect(shell).toMatch(/=== "stations"[\s\S]{0,80}push\(stationHref\(venueId\)/);
      expect(shell).toContain("stationsDeepLinkRef");
      expect(shell).toContain("venueAccess.canKitchen === true");
      expect(shell).not.toMatch(/StationScreen/);
    }
  });
});
