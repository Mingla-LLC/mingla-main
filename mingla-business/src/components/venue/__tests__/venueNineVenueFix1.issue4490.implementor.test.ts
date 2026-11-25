/**
 * #4490 fix round 1 (nine-venue click test) — pure rules behind the screen
 * fixes: setup needs after add-venue (N20/N61), the feature-led checklist
 * (N17), the nav for a venue with no stored features (N61/N62), Orders only
 * with Menu or Table ordering (N57), offer cards by features (N57), money
 * grouping as you type (N4), opening-hours defaults (N59/N66), ordered day
 * windows (N16), day-named hours errors (N7), next table name (N24), hire
 * rows naming their days (N45/N68) and the typed guest stepper (N32).
 */
import {
  featureSetupNeeds,
  sellStepMeta,
  spacesRequired,
  spacesStepMeta,
} from "../features/featureSetupModel";
import { openingHoursDefault } from "../features/hoursModel";
import { nextTableNameAfter } from "../features/floor/tableDraft";
import { NEW_OFFER_CARDS, splitOfferCards, priceColumn } from "../features/offers/offersModel";
import { hirePriceLine, hireRowWords, type HireDraft, type HireRowDraft } from "../features/offers/hireModel";
import { deriveVenueNav, hasNoStoredFeatures, navFeatures } from "../venueModules";
import { groupMoneyTyping } from "../../ui/fieldModels";
import { dayWindows, hoursWeekIssue, withOrderedWindows } from "../../../utils/venueBrandHours";
import { featureSetFrom, type VenueFeatureKey, type VenueFeatureSet } from "../../../types/venueFeatures";
import { clampTypedStepperValue } from "../../../../../packages/offering-rendering/OfferingDecideParts";
import type { VenueOffer } from "../../../types/venueOffers";

const on = (...keys: VenueFeatureKey[]): VenueFeatureSet =>
  featureSetFrom(Object.fromEntries(keys.map((k) => [k, true])) as Partial<Record<VenueFeatureKey, boolean>>);

describe("N20/N61 — chosen features that still need setting up", () => {
  test("a refused Private hire asks for a space with a button to Spaces", () => {
    const needs = featureSetupNeeds({
      features: on("table_reservations", "menu"),
      activeSpaceCount: 0,
      refused: [{ key: "private_hire", code: "feature_requires", detail: "space" }],
    });
    expect(needs).toEqual([
      {
        key: "private_hire",
        text: "Private hire needs a space first: add one, then switch it on.",
        buttonLabel: "Add a space",
        target: "spaces",
      },
    ]);
  });

  test("Pick a table refused for Floor plan, which waits for a space, still points at Spaces", () => {
    const needs = featureSetupNeeds({
      features: on("table_reservations"),
      activeSpaceCount: 0,
      refused: [
        { key: "floor_plan", code: "feature_requires", detail: "space" },
        { key: "pick_a_table", code: "feature_requires", detail: "floor_plan" },
      ],
    });
    expect(needs.map((n) => [n.key, n.target])).toEqual([
      ["floor_plan", "spaces"],
      ["pick_a_table", "spaces"],
    ]);
    expect(needs[1].text).toBe("Pick a table needs Floor plan, and that needs a space: add one, then switch them on.");
  });

  test("a feature stored on but blocked by a space (the backend's not-ready read) is listed", () => {
    const features = on("private_hire");
    const blocked = { ...features, private_hire: { ...features.private_hire, blockedBy: ["space"] } };
    const needs = featureSetupNeeds({ features: blocked, activeSpaceCount: 0, refused: null });
    expect(needs).toEqual([
      expect.objectContaining({ key: "private_hire", text: "Private hire needs a space before guests can book it.", target: "spaces" }),
    ]);
  });

  test("the backend's `needs` read: a space opens Spaces, a table opens Tables", () => {
    const features = on("private_hire", "pick_a_table");
    const read = {
      ...features,
      private_hire: { ...features.private_hire, needs: ["space"] },
      pick_a_table: { ...features.pick_a_table, needs: ["table"] },
    };
    expect(featureSetupNeeds({ features: read, activeSpaceCount: 0 }).map((n) => [n.key, n.buttonLabel, n.target])).toEqual([
      ["private_hire", "Add a space", "spaces"],
      ["pick_a_table", "Add tables", "tables"],
    ]);
  });

  test("Table ordering waiting for Mingla has no button", () => {
    expect(
      featureSetupNeeds({
        features: on("menu"),
        activeSpaceCount: 0,
        refused: [{ key: "table_ordering", code: "venue_not_orderable", detail: null }],
      }),
    ).toEqual([{ key: "table_ordering", text: "Table ordering starts after Mingla checks your venue.", buttonLabel: null, target: null }]);
  });

  test("a refusal switched on since is no longer listed", () => {
    expect(
      featureSetupNeeds({
        features: on("private_hire"),
        activeSpaceCount: 1,
        refused: [{ key: "private_hire", code: "feature_requires", detail: "space" }],
      }),
    ).toEqual([]);
  });
});

describe("N17 — the Overview checklist follows the venue's features", () => {
  test("a restaurant with no Entry is never told to add Entry", () => {
    expect(sellStepMeta(on("table_reservations", "menu"))).toBe("Switch on what you sell in Settings, then add it here");
    expect(spacesStepMeta(on("table_reservations"), 0)).toBe("The rooms and areas guests use");
  });

  test("Entry keeps its line; several sellers read as a list", () => {
    expect(sellStepMeta(on("entry"))).toBe("Entry, with a price for each kind of guest");
    expect(sellStepMeta(on("entry", "group_packages", "private_hire"))).toBe(
      "Entry, a group package or private hire for a space",
    );
  });

  test("spaces are required (not optional) when Private hire or By the hour is on", () => {
    expect(spacesRequired(on("private_hire"))).toBe(true);
    expect(spacesRequired(on("by_the_hour"))).toBe(true);
    expect(spacesRequired(on("entry"))).toBe(false);
    expect(spacesStepMeta(on("private_hire"), 0)).toBe("Needed for Private hire. The rooms and areas guests use");
    expect(spacesStepMeta(on("entry"), 0)).toBe("Optional for Entry. The areas guests use");
    expect(spacesStepMeta(on("entry"), 2)).toBe("2 spaces");
  });
});

describe("N61/N62/N57 — the nav", () => {
  test("an event space with no stored feature rows gets Offers and Spaces, not the legacy list", () => {
    const backfill = on("menu"); // the server's legacy read: Menu on, nothing else
    expect(hasNoStoredFeatures(backfill)).toBe(true);
    const nav = deriveVenueNav({
      features: backfill,
      activeSpaceCount: 0,
      venueCategory: "event_space",
      noStoredFeatures: true,
    });
    expect(nav).toEqual(expect.arrayContaining(["overview", "offers", "spaces", "settings"]));
    expect(nav).not.toContain("menu");
    expect(nav).not.toContain("orders");
    expect(navFeatures({ features: backfill, activeSpaceCount: 0, venueCategory: "event_space", noStoredFeatures: true }).menu.enabled).toBe(false);
  });

  test("stored rows always win over the type", () => {
    const stored = on("menu");
    const withVersion = { ...stored, menu: { ...stored.menu, version: 3 } };
    expect(hasNoStoredFeatures(withVersion)).toBe(false);
    expect(navFeatures({ features: withVersion, activeSpaceCount: 0, venueCategory: "event_space", noStoredFeatures: false })).toBe(withVersion);
  });

  test("Orders shows only with Menu or Table ordering", () => {
    expect(deriveVenueNav({ features: on("entry"), activeSpaceCount: 0 })).not.toContain("orders");
    expect(deriveVenueNav({ features: on("entry", "menu"), activeSpaceCount: 0 })).toContain("orders");
    expect(deriveVenueNav({ features: on("table_reservations", "menu"), activeSpaceCount: 0 })).toContain("orders");
  });
});

describe("N57 — New offer cards follow features and type", () => {
  test("a coworking venue leads with its own ways to sell; the rest wait behind More", () => {
    const { main, more } = splitOfferCards(NEW_OFFER_CARDS, () => false, "coworking");
    expect(main.map((c) => c.key)).toEqual(["entry", "private_hire", "by_the_hour", "membership"]);
    expect(more.map((c) => c.key)).toEqual(["group_package", "table_reservations"]);
  });

  test("a switched-on feature is always a main card; no type and nothing on shows them all", () => {
    expect(splitOfferCards(NEW_OFFER_CARDS, (k) => k === "group_packages", "coworking").main.map((c) => c.key)).toContain("group_package");
    expect(splitOfferCards(NEW_OFFER_CARDS, () => false, null).more).toEqual([]);
  });
});

describe("N4 — money groups thousands as you type", () => {
  test.each([
    ["10000", "10,000"],
    ["1234567", "1,234,567"],
    ["1234567.5", "1,234,567.5"],
    ["12,3456", "123,456"],
    ["0050", "50"],
    ["", ""],
    ["5000.", "5,000."],
    ["abc", "abc"],
  ])("%s → %s", (typed, shown) => {
    expect(groupMoneyTyping(typed)).toBe(shown);
  });
});

describe("N59/N66 — defaults from the venue's opening hours", () => {
  test("open days and the most common window", () => {
    const hours = [0, 1, 2, 3, 4].map((weekday) => ({ weekday, openTime: "08:00:00", closeTime: "20:00:00", isClosed: false }));
    hours.push({ weekday: 5, openTime: "10:00", closeTime: "14:00", isClosed: false });
    hours.push({ weekday: 6, openTime: null as unknown as string, closeTime: null as unknown as string, isClosed: true });
    expect(openingHoursDefault(hours)).toEqual({ weekdays: [0, 1, 2, 3, 4, 5], open: "08:00", close: "20:00" });
  });

  test("no open day keeps the editor's own default", () => {
    expect(openingHoursDefault([])).toBeNull();
    expect(openingHoursDefault(undefined)).toBeNull();
  });
});

describe("N16/N7 — opening hours", () => {
  const sat = { weekday: 5, openTime: "17:00", closeTime: "00:00", isClosed: false, extraWindows: [{ openTime: "11:00", closeTime: "15:00" }] };

  test("a day's windows read earliest first, and are saved that way", () => {
    expect(dayWindows(sat).map((w) => `${w.openTime}–${w.closeTime}`)).toEqual(["11:00–15:00", "17:00–00:00"]);
    expect(withOrderedWindows(sat)).toEqual({ ...sat, openTime: "11:00", closeTime: "15:00", extraWindows: [{ openTime: "17:00", closeTime: "00:00" }] });
  });

  test("an hours problem names the day", () => {
    expect(
      hoursWeekIssue([{ weekday: 4, openTime: "12:00", closeTime: "00:00", isClosed: false, extraWindows: [{ openTime: "18:00", closeTime: "02:00" }] }]),
    ).toBe("Friday: two windows overlap. Change one so they don't.");
    expect(hoursWeekIssue([{ weekday: 0, openTime: "09:00", closeTime: null, isClosed: false }])).toBe(
      "Monday: open and close times are required for open days.",
    );
  });
});

describe("N24 — the next table keeps the last one's letters", () => {
  test("B1 → B2, Booth 3 → Booth 4, T1 when there is none", () => {
    expect(nextTableNameAfter(["B1"], "B1")).toBe("B2");
    expect(nextTableNameAfter(["Booth 1", "Booth 2", "Booth 3"], "Booth 3")).toBe("Booth 4");
    expect(nextTableNameAfter([], null)).toBe("T1");
    expect(nextTableNameAfter(["B1", "B2"], "B1")).toBe("B3");
  });
});

describe("N45/N68 — hire prices say what they are and which days", () => {
  const row = (over: Partial<HireRowDraft>): HireRowDraft => ({
    key: "r",
    optionId: null,
    place: "s:hall",
    guestMin: 50,
    guestMax: 600,
    priceMinor: 350_000_000,
    weekdays: [],
    perHour: false,
    ...over,
  });

  test("a weekend row names its days; a weekday row reads plain", () => {
    expect(hireRowWords(row({ weekdays: [4, 5, 6], priceMinor: 420_000_000 }), "The Main Hall", "hire_fee", "NGN")).toMatch(
      /^The Main Hall · 50–600 guests · Fri to Sun: ₦4,200,000$/,
    );
    expect(hireRowWords(row({}), "The Main Hall", "hire_fee", "NGN")).toBe("The Main Hall · 50–600 guests: ₦3,500,000");
  });

  test("a minimum spend is never summarised as a price", () => {
    const draft = { rows: [row({ priceMinor: 60_000_000 })], charge: "min_spend" } as unknown as HireDraft;
    expect(hirePriceLine(draft, "NGN")).toBe("Minimum spend from ₦600,000");
  });

  test("the offer list names a day price", () => {
    const offer = {
      kind: "private_hire",
      options: [
        { priceMinor: 350_000_000, guestMax: 600, unit: "booking", weekdays: [0, 1, 2, 3] },
        { priceMinor: 420_000_000, guestMax: 600, unit: "booking", weekdays: [4, 5, 6] },
      ],
    } as unknown as VenueOffer;
    const line = priceColumn(offer, "NGN");
    expect(line).toContain("from ₦3,500,000");
    expect(line).toContain("₦4,200,000");
    expect(line).toContain("up to 600 guests");
  });
});

describe("N32 — the guest stepper takes a typed number", () => {
  test("digits only, clamped into range, empty is nothing", () => {
    expect(clampTypedStepperValue("250", 10, 500)).toEqual({ typed: 250, value: 250 });
    expect(clampTypedStepperValue("900", 10, 500)).toEqual({ typed: 900, value: 500 });
    expect(clampTypedStepperValue("3", 10, 500)).toEqual({ typed: 3, value: 10 });
    expect(clampTypedStepperValue("1,2a0", 1, 500)).toEqual({ typed: 120, value: 120 });
    expect(clampTypedStepperValue("", 1, 500)).toEqual({ typed: null, value: null });
  });
});
