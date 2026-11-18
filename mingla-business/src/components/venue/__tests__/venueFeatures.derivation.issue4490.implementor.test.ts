/**
 * #4490 P1-6 — feature-driven venue navigation.
 * MINGLA-INVARIANT: I-4490-VENUE-FEATURES-GATE-SUITE (declared in venueModules.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BUILT_FEATURES,
  SWITCHABLE_FEATURES,
  VENUE_FEATURE_KEYS,
  VENUE_TYPES,
  backfilledFeatureSet,
  builtPreset,
  featureCascade,
  featureSetFrom,
  joinFeatureLabels,
  type VenueFeatureKey,
} from "../../../types/venueFeatures";
import { filterVenueModulesForCapabilities } from "../venueCapabilityGate";
import {
  deriveVenueModules,
  deriveVenueNav,
  parseVenueItemParam,
  shouldLeaveHiddenModule,
  venueModuleLabel,
} from "../venueModules";
import { deriveVenueRailModules } from "../venueRail";

const ALL_ON = featureSetFrom(
  Object.fromEntries(VENUE_FEATURE_KEYS.map((k) => [k, true])) as Record<VenueFeatureKey, boolean>,
);

describe("classic layout — existing venues keep today's workspace", () => {
  for (const reservationsEnabled of [false, true]) {
    for (const orderingEnabled of [false, true]) {
      it(`backfill reservations=${reservationsEnabled} ordering=${orderingEnabled} yields exactly the pre-#4490 list`, () => {
        const features = backfilledFeatureSet({ reservationsEnabled, orderingEnabled });
        expect(deriveVenueNav({ features, activeSpaceCount: 0 })).toEqual(
          deriveVenueModules(reservationsEnabled),
        );
      });
    }
  }
  it("keeps the old rail groups and the old Availability label", () => {
    const modules = deriveVenueNav({
      features: backfilledFeatureSet({ reservationsEnabled: true }),
      activeSpaceCount: 0,
    });
    const rail = deriveVenueRailModules(modules);
    expect(rail.map((r) => [r.key, r.group, r.label])).toEqual([
      ["overview", "Venue", "Overview"],
      ["tables", "Bookings", "Tables"],
      ["availability", "Bookings", "Availability"],
      ["reservations", "Bookings", "Reservations"],
      ["waitlist", "Bookings", "Waitlist"],
      ["menu", "Operations", "Menu"],
      ["insights", "Operations", "Insights"],
      ["orders", "Operations", "Orders"],
      ["settings", "Operations", "Settings"],
    ]);
  });
});

describe("feature layout — a venue with spaces", () => {
  it("adds Spaces and Availability & pricing under Offers; nothing unbuilt shows", () => {
    const modules = deriveVenueNav({
      features: backfilledFeatureSet({ reservationsEnabled: false }),
      activeSpaceCount: 2,
    });
    expect(modules).toEqual(["overview", "spaces", "availability", "menu", "insights", "orders", "settings"]);
    expect(venueModuleLabel("availability", modules)).toBe("Availability & pricing");
    const rail = deriveVenueRailModules(modules);
    expect(rail.find((r) => r.key === "spaces")?.group).toBe("Offers");
    expect(rail.find((r) => r.key === "availability")?.group).toBe("Offers");
  });
  it("Events here alone moves a venue to the feature layout", () => {
    const features = featureSetFrom({ menu: true, events_here: true });
    expect(deriveVenueNav({ features, activeSpaceCount: 0 })).toContain("spaces");
  });
  it("keeps Tables, Reservations and Waitlist where they are when table reservations are on", () => {
    const modules = deriveVenueNav({
      features: backfilledFeatureSet({ reservationsEnabled: true }),
      activeSpaceCount: 1,
    });
    expect(modules).toEqual([
      "overview",
      "spaces",
      "availability",
      "tables",
      "reservations",
      "waitlist",
      "menu",
      "insights",
      "orders",
      "settings",
    ]);
  });
  it("never shows modules whose phase has not shipped, even with every feature on", () => {
    const modules = deriveVenueNav({ features: ALL_ON, activeSpaceCount: 3, hasRequestOffers: true });
    for (const unbuilt of ["offers", "today", "calendar", "requests", "members", "checkin"]) {
      expect(modules).not.toContain(unbuilt);
    }
    expect(modules[0]).toBe("overview");
    expect(modules[modules.length - 1]).toBe("settings");
    expect(modules).toContain("orders");
    expect(modules).toContain("insights");
  });
  it("Menu follows its feature; Orders and Insights are always present", () => {
    const off = deriveVenueNav({ features: featureSetFrom({}), activeSpaceCount: 1 });
    expect(off).not.toContain("menu");
    expect(off).toEqual(expect.arrayContaining(["orders", "insights", "settings"]));
  });
  it("a spaces request reaches Spaces before the first space exists", () => {
    const modules = deriveVenueNav({ features: featureSetFrom({ menu: true }), activeSpaceCount: 0, spacesRequested: true });
    expect(modules).toContain("spaces");
  });
});

describe("venue type has no effect on navigation", () => {
  it("venueModules.ts never reads venue_category", () => {
    const src = readFileSync(join(__dirname, "..", "venueModules.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/venue_?[cC]ategory/);
  });
});

describe("dependencies (mirror of the server cascade)", () => {
  it("turning on Table ordering lists Menu when Menu is off", () => {
    expect(featureCascade(featureSetFrom({}), "table_ordering", true)).toEqual(["menu"]);
    expect(featureCascade(featureSetFrom({ menu: true }), "table_ordering", true)).toEqual([]);
  });
  it("turning on Pick a table lists Table reservations then Floor plan", () => {
    expect(featureCascade(featureSetFrom({}), "pick_a_table", true)).toEqual(["table_reservations", "floor_plan"]);
  });
  it("turning off a parent lists only its enabled dependents", () => {
    const features = featureSetFrom({ menu: true, table_ordering: true });
    expect(featureCascade(features, "menu", false)).toEqual(["table_ordering"]);
    expect(featureCascade(featureSetFrom({ table_reservations: true, floor_plan: true, pick_a_table: true }), "table_reservations", false)).toEqual([
      "floor_plan",
      "pick_a_table",
    ]);
  });
  it("names features in plain words", () => {
    expect(joinFeatureLabels(["table_reservations", "floor_plan"])).toBe("Table reservations and Floor plan");
  });
  it("only built features are switchable here; stays never", () => {
    expect(SWITCHABLE_FEATURES).toEqual(["table_reservations", "menu", "table_ordering", "events_here", "waitlist"]);
    expect(BUILT_FEATURES.has("stays")).toBe(true);
    expect(SWITCHABLE_FEATURES).not.toContain("stays");
  });
  it("nine venue types; each preset offers only built switches", () => {
    expect(VENUE_TYPES.map((t) => t.key).sort()).toEqual(
      ["bar_lounge", "cafe", "club", "coworking", "creative_and_arts", "event_space", "play", "restaurant", "stay"],
    );
    expect(builtPreset("play")).toEqual(["menu", "events_here"]);
    expect(builtPreset("club")).toEqual(["table_reservations", "events_here"]);
    expect(builtPreset("stay")).toEqual([]);
  });
});

describe("capabilities (#4188 scoped staff + venue.*)", () => {
  const featureNav = deriveVenueNav({
    features: backfilledFeatureSet({ reservationsEnabled: true }),
    activeSpaceCount: 1,
  });
  it("venue.manage_offers sees Spaces and Availability & pricing only", () => {
    expect(filterVenueModulesForCapabilities(featureNav, true, ["venue.manage_offers"])).toEqual(["spaces", "availability"]);
  });
  it("scoped staff with nothing granted see nothing", () => {
    expect(filterVenueModulesForCapabilities(featureNav, true, [])).toEqual([]);
  });
  it("the check-in-only role sees no unbuilt module and no money surface", () => {
    expect(filterVenueModulesForCapabilities(featureNav, true, ["venue.check_in"])).toEqual([]);
  });
  it("restaurant reservations staff keep exactly what they had", () => {
    expect(filterVenueModulesForCapabilities(featureNav, true, ["restaurant.manage_reservations"])).toEqual([
      "availability",
      "tables",
      "reservations",
      "waitlist",
    ]);
  });
  it("unscoped roles are untouched", () => {
    expect(filterVenueModulesForCapabilities(featureNav, false, [])).toEqual(featureNav);
  });
});

describe("leaving a hidden module and deep links", () => {
  it("never bounces before features resolve", () => {
    expect(shouldLeaveHiddenModule({ activeModule: "spaces", visible: ["overview"], featuresResolved: false })).toBe(false);
  });
  it("bounces a module that is not visible once resolved", () => {
    expect(shouldLeaveHiddenModule({ activeModule: "spaces", visible: ["overview"], featuresResolved: true })).toBe(true);
    expect(shouldLeaveHiddenModule({ activeModule: "spaces", visible: ["overview", "spaces"], featuresResolved: true })).toBe(false);
  });
  it("parses &item= as a uuid only", () => {
    expect(parseVenueItemParam("3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(parseVenueItemParam(["3f2504e0-4f89-11d3-9a0c-0305e82c3301", "x"])).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(parseVenueItemParam("tables")).toBeUndefined();
    expect(parseVenueItemParam(undefined)).toBeUndefined();
  });
});
