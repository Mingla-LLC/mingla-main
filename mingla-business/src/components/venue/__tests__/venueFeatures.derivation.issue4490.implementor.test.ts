// MINGLA-INVARIANT: I-4490-VENUE-FEATURES-GATE-SUITE | issue #4490 | the venue workspace modules derive only from venue_features (plus whether the venue has spaces); venue_category never decides tabs, and the classic list is reproduced exactly for every backfilled venue.
/**
 * #4490 P1-6 — feature-driven venue navigation.
 * Invariant I-4490-VENUE-FEATURES-GATE-SUITE is declared at the top of this file.
 */
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
    // TEST-MOD-APPROVED #4490 — P2 ships Offers (always in the feature layout).
    expect(modules).toEqual(["overview", "offers", "spaces", "availability", "menu", "insights", "orders", "settings"]);
    expect(venueModuleLabel("availability", modules)).toBe("Availability & pricing");
    const rail = deriveVenueRailModules(modules);
    expect(rail.find((r) => r.key === "spaces")?.group).toBe("Offers");
    expect(rail.find((r) => r.key === "availability")?.group).toBe("Offers");
  });
  it("Events here alone moves a venue to the feature layout", () => {
    const features = featureSetFrom({ menu: true, events_here: true });
    expect(deriveVenueNav({ features, activeSpaceCount: 0 })).toContain("spaces");
  });
  it("keeps Reservations and Waitlist where they are; Tables live under Spaces (P5)", () => {
    const modules = deriveVenueNav({
      features: backfilledFeatureSet({ reservationsEnabled: true }),
      activeSpaceCount: 1,
    });
    // TEST-MOD-APPROVED #4490 — P2 ships Offers.
    // TEST-MOD-APPROVED #4490 P5-2 — reconciliation 35: the Tables module moves under Spaces.
    expect(modules).toEqual([
      "overview",
      "offers",
      "spaces",
      "availability",
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
    // TEST-MOD-APPROVED #4490 — P2 ships Offers, Today and Check-in.
    // TEST-MOD-APPROVED #4490 P4 — Calendar and Requests ship with private hire.
    // TEST-MOD-APPROVED #4490 P6-2 — Members ships with memberships, so every module is built now.
    for (const built of ["offers", "today", "checkin", "calendar", "requests", "guestlist", "members"]) {
      expect(modules).toContain(built);
    }
    expect(modules[0]).toBe("overview");
    expect(modules[modules.length - 1]).toBe("settings");
    expect(modules).toContain("orders");
    expect(modules).toContain("insights");
  });
  it("Menu follows its feature; Orders and Insights are always present", () => {
    const off = deriveVenueNav({ features: featureSetFrom({}), activeSpaceCount: 1 });
    expect(off).not.toContain("menu");
    // TEST-MOD-APPROVED #4490 N57: Orders shows only with Menu or Table ordering.
    expect(off).toEqual(expect.arrayContaining(["insights", "settings"]));
    expect(off).not.toContain("orders");
  });
  it("a spaces request reaches Spaces before the first space exists", () => {
    const modules = deriveVenueNav({ features: featureSetFrom({ menu: true }), activeSpaceCount: 0, spacesRequested: true });
    expect(modules).toContain("spaces");
  });
});

describe("venue type has no effect on navigation", () => {
  it("two venues with the same switches get the same navigation whatever their type", () => {
    const features = featureSetFrom({ menu: true, events_here: true });
    const baseline = deriveVenueNav({ features, activeSpaceCount: 1, spacesRequested: false });
    for (const { key: venueType } of VENUE_TYPES) {
      // A stray type on the input must not change anything: navigation reads switches only.
      const withType = { features, activeSpaceCount: 1, spacesRequested: false, venueCategory: venueType };
      expect(deriveVenueNav(withType as Parameters<typeof deriveVenueNav>[0])).toEqual(baseline);
      // And a type's own starting switches decide its nav, nothing else.
      const preset = featureSetFrom(
        Object.fromEntries(builtPreset(venueType).map((k) => [k, true])) as Partial<Record<VenueFeatureKey, boolean>>,
      );
      expect(deriveVenueNav({ ...withType, features: preset } as Parameters<typeof deriveVenueNav>[0])).toEqual(
        deriveVenueNav({ features: preset, activeSpaceCount: 1, spacesRequested: false }),
      );
    }
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
    // TEST-MOD-APPROVED #4490 — P2 ships Entry.
    // TEST-MOD-APPROVED #4490 P4 — group packages (P3) and private hire (P4) are switchable.
    // TEST-MOD-APPROVED #4490 P5-2 — by the hour, floor plan, pick a table and minimum-spend tables ship.
    expect(SWITCHABLE_FEATURES).toEqual([
      "entry",
      "group_packages",
      "private_hire",
      "by_the_hour",
      "table_reservations",
      "floor_plan",
      "pick_a_table",
      "menu",
      "table_ordering",
      "min_spend_tables",
      // TEST-MOD-APPROVED #4490 07-I — private guest lists are built.
      "guest_list",
      // TEST-MOD-APPROVED #4490 P6-2 — memberships are built and switchable.
      "memberships",
      "events_here",
      "waitlist",
    ]);
    expect(BUILT_FEATURES.has("stays")).toBe(true);
    expect(SWITCHABLE_FEATURES).not.toContain("stays");
  });
  it("nine venue types; each preset offers only built switches", () => {
    expect(VENUE_TYPES.map((t) => t.key).sort()).toEqual(
      ["bar_lounge", "cafe", "club", "coworking", "creative_and_arts", "event_space", "play", "restaurant", "stay"],
    );
    // TEST-MOD-APPROVED #4490 — P2 ships Entry.
    // TEST-MOD-APPROVED #4490 P4 — the play preset's packages and hire are built now.
    // TEST-MOD-APPROVED #4490 P6-2 — every feature is built, so each type starts with what it usually sells
    // (spec 04 §4): play and clubs add table ordering (offered, never started before approval), clubs a menu,
    // creative and arts entry and memberships, cafes entry, by the hour and events.
    expect(builtPreset("play")).toEqual(["entry", "group_packages", "private_hire", "menu", "table_ordering", "events_here"]);
    // TEST-MOD-APPROVED #4490 P5-2 — minimum-spend tables are built now.
    expect(builtPreset("club")).toEqual(["entry", "table_reservations", "min_spend_tables", "menu", "table_ordering", "events_here"]);
    expect(builtPreset("coworking")).toEqual(["entry", "by_the_hour", "private_hire", "memberships"]);
    expect(builtPreset("creative_and_arts")).toEqual(["entry", "by_the_hour", "private_hire", "memberships", "events_here"]);
    expect(builtPreset("stay")).toEqual([]);
  });
});

describe("capabilities (#4188 scoped staff + venue.*)", () => {
  const featureNav = deriveVenueNav({
    features: backfilledFeatureSet({ reservationsEnabled: true }),
    activeSpaceCount: 1,
  });
  it("venue.manage_offers sees Spaces and Availability & pricing only", () => {
    // TEST-MOD-APPROVED #4490 — P2 ships Offers.
    expect(filterVenueModulesForCapabilities(featureNav, true, ["venue.manage_offers"])).toEqual(["offers", "spaces", "availability"]);
  });
  it("scoped staff with nothing granted see nothing", () => {
    expect(filterVenueModulesForCapabilities(featureNav, true, [])).toEqual([]);
  });
  it("the check-in-only role sees no unbuilt module and no money surface", () => {
    // TEST-MOD-APPROVED #4490 — a table-only venue has no Today/Check-in (conflict 34).
    expect(filterVenueModulesForCapabilities(featureNav, true, ["venue.check_in"])).toEqual([]);
  });
  it("guest-list management belongs only to manage-bookings staff", () => {
    const nav = deriveVenueNav({ features: featureSetFrom({ guest_list: true }), activeSpaceCount: 0 });
    expect(nav).toEqual(expect.arrayContaining(["guestlist", "today", "checkin"]));
    expect(filterVenueModulesForCapabilities(nav, true, ["venue.manage_bookings"])).toEqual(
      expect.arrayContaining(["guestlist"]),
    );
    expect(filterVenueModulesForCapabilities(nav, true, ["venue.check_in"])).not.toContain("guestlist");
  });
  it("restaurant reservations staff keep exactly what they had", () => {
    // TEST-MOD-APPROVED #4490 P5-2 — their tables now live under Spaces › Tables.
    expect(filterVenueModulesForCapabilities(featureNav, true, ["restaurant.manage_reservations"])).toEqual([
      "spaces",
      "availability",
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

// #4490 P2 — Today and Check-in follow the booking features (conflict 34).
describe("P2: Offers, Today and Check-in", () => {
  it("Entry on moves a venue to the feature layout with Offers, Today and Check-in", () => {
    const modules = deriveVenueNav({ features: featureSetFrom({ entry: true, menu: true }), activeSpaceCount: 0 });
    // TEST-MOD-APPROVED #4490 P4 — Calendar shows for any booking feature (B §2.2) now it is built.
    expect(modules).toEqual(["overview", "offers", "spaces", "availability", "today", "calendar", "checkin", "menu", "insights", "orders", "settings"]);
  });
  it("a restaurant with only table reservations gets no Today or Check-in", () => {
    const modules = deriveVenueNav({ features: backfilledFeatureSet({ reservationsEnabled: true }), activeSpaceCount: 1 });
    expect(modules).not.toContain("today");
    expect(modules).not.toContain("checkin");
  });
  it("the check-in-only role sees Today and Check-in, nothing else", () => {
    const nav = deriveVenueNav({ features: featureSetFrom({ entry: true, menu: true }), activeSpaceCount: 0 });
    expect(filterVenueModulesForCapabilities(nav, true, ["venue.check_in"])).toEqual(["today", "checkin"]);
  });
});
