/**
 * #4490 [venue features] — the public venue page is decided by FEATURES.
 *
 * Proves `venueFeaturePage.ts` (pure): the worked table (Gogi, Gameland, a stay,
 * a bar, a coworking space, an event space, a club, a venue with only a menu),
 * the lead precedence, dependencies failing closed, the null payload being
 * today's page, the P1 "built tabs" filter, hours windows and special days,
 * event times in the venue's own zone, and the reducer's new bar action.
 * (That these files hold no colour, never read the venue type and never call
 * auth is enforced by the additive gate issue-1550-venue-page-single-owner R-5.)
 */
import { describe, expect, test } from "@jest/globals";

import {
  publicVenueReservationUiReducer,
  type PublicVenueReservationUiContext,
} from "@mingla/brand-rendering/publicVenueReservationUiState";
import {
  ALL_VENUE_TABS,
  BUILT_VENUE_TABS,
  deriveVenuePage,
  formatVenueMoney,
  groupVenueHours,
  parsePublicVenueFeatures,
  venueDateLabel,
  venueEventWhen,
  venueHoursText,
  venueOpenStateRows,
  venueSpecialDayRows,
  venueTabFromParam,
  type PublicVenueFeaturesView,
  type VenuePageContext,
} from "@mingla/brand-rendering/venueFeaturePage";
import { resolveVenueOpenState } from "@mingla/brand-rendering/venueOpenState";
import { VENUE_CATEGORY_PROFILES } from "@mingla/brand-rendering/venueCategoryProfile";

// ---- fixtures: the wire payload, parsed by the real parser -----------------

const SPACE = { id: "sp1", name: "The Lounge Side", setting: "covered", capacityStanding: 150 };

interface WireOptions {
  offers?: Record<string, unknown>[];
  tables?: Record<string, unknown> | null;
  memberships?: Record<string, unknown> | unknown[];
  events?: Record<string, unknown>[];
  spaces?: Record<string, unknown>[];
}

const view = (features: string[], opts: WireOptions = {}): PublicVenueFeaturesView => {
  const parsed = parsePublicVenueFeatures({
    version: 1,
    currencyCode: "NGN",
    minorUnitExponent: 2,
    features,
    spaces: opts.spaces ?? [SPACE],
    offers: opts.offers ?? [],
    tables: opts.tables ?? null,
    memberships: opts.memberships ?? [],
    events: { upcoming: opts.events ?? [] },
    hours: { weekly: [], specialDays: [] },
  });
  if (parsed === null) throw new Error("fixture did not parse");
  return parsed;
};

const naira = (n: number): number => n * 100;
const offer = (o: Record<string, unknown>): Record<string, unknown> => ({
  id: `o-${String(o.name)}`,
  summary: null,
  unit: "guest",
  guestMin: null,
  guestMax: null,
  confirmationMode: "instant",
  spaceIds: null,
  sortOrder: 0,
  entryStyle: null,
  ...o,
});

const ctx = (over: Partial<VenuePageContext> = {}): VenuePageContext => ({
  menuTabVisible: true,
  tablesGate: "ready",
  built: ALL_VENUE_TABS,
  ...over,
});

const tabsOf = (v: PublicVenueFeaturesView, c: Partial<VenuePageContext> = {}): string =>
  deriveVenuePage(v, ctx(c)).tabs.join(" · ");

// ---- the worked table (every row of the spec's §2.3) -----------------------

describe("the worked table", () => {
  test("Gogi: table_reservations, menu, table_ordering", () => {
    const page = deriveVenuePage(view(["table_reservations", "menu", "table_ordering"], {
      tables: { partyMax: 12 },
    }), ctx());
    expect(page.tabs).toEqual(["overview", "menu", "reservations"]);
    expect(page.labels).toEqual({});
    expect(page.lead?.ctaLabel).toBe("Reserve a table");
    expect(page.lead?.row).toEqual({
      value: "Tables through Mingla",
      detail: null,
      actionLabel: "Reserve",
      icon: "calendar",
    });
    expect(page.lead?.keepPriceRow).toBe(true);
    expect(page.showWays).toBe(false);
  });

  test("Gameland: entry, groups, hire, menu, ordering, events", () => {
    const v = view(["entry", "group_packages", "private_hire", "menu", "table_ordering", "events_here"], {
      offers: [
        offer({ kind: "entry", name: "Walk-in", fromMinor: naira(4000), entryStyle: "walk_in" }),
        offer({ kind: "group_package", name: "Squad", fromMinor: naira(10000), guestMin: 10, guestMax: 60 }),
        offer({ kind: "private_hire", name: "Lounge", fromMinor: naira(4000000), unit: "booking", guestMax: 150, confirmationMode: "request" }),
      ],
      events: [
        { id: "e1", kind: "event", title: "Karaoke", startsAt: "2026-11-21T17:00:00Z", spaceName: "The Lounge Side", fromMinor: 500000, href: "/e/gl/karaoke" },
      ],
    });
    const page = deriveVenuePage(v, ctx());
    expect(page.tabs.join(" · ")).toBe("overview · entry · groups · hire · whats_on · menu");
    expect(page.lead?.ctaLabel).toBe("Buy entry");
    expect(page.lead?.row?.value).toBe("Entry from ₦4,000");
    expect(page.lead?.row?.detail).toBe("Groups from ₦10,000 a guest · private hire from ₦4,000,000");
    expect(page.lead?.row?.actionLabel).toBe("Buy entry");
    expect(page.lead?.keepPriceRow).toBe(false);
    expect(page.showWays).toBe(true);
    expect(page.ways.map((w) => w.title)).toEqual(["Entry", "Groups & parties", "Private hire", "Menu"]);
  });

  test("a stay keeps Overview and Reservations and its own button", () => {
    const page = deriveVenuePage(view(["stays"], { spaces: [] }), ctx({ menuTabVisible: false }));
    expect(page.tabs).toEqual(["overview", "reservations"]);
    expect(page.labels).toEqual({});
    expect(page.lead).toMatchObject({ kind: "stays", tab: "reservations", ctaLabel: "Reserve this Stay", row: null });
    expect(page.showWays).toBe(false);
  });

  test("a Stay keeps Rooms first and appends enabled feature tabs", () => {
    const page = deriveVenuePage(
      view(["stays", "entry", "menu"], {
        offers: [
          offer({
            kind: "entry",
            name: "Pool day",
            fromMinor: naira(15000),
            entryStyle: "day_pass",
          }),
        ],
      }),
      ctx(),
    );
    expect(page.tabs).toEqual(["overview", "rooms", "entry", "menu"]);
    expect(page.lead).toMatchObject({
      kind: "stays",
      tab: "rooms",
      ctaLabel: "Reserve this Stay",
    });
    expect(page.labels).toEqual({});
    expect(page.showWays).toBe(false);
  });

  test("Bar: tables with a minimum spend, groups, hire, menu", () => {
    const v = view(
      ["table_reservations", "floor_plan", "pick_a_table", "min_spend_tables", "group_packages", "private_hire", "menu"],
      {
        tables: { partyMax: 20, holdFromMinor: naira(20000), minSpendFromMinor: naira(80000) },
        offers: [
          offer({ kind: "group_package", name: "Bottle crew", fromMinor: naira(30000) }),
          offer({ kind: "private_hire", name: "Whole lounge", fromMinor: naira(2500000), guestMax: 120 }),
        ],
      },
    );
    const page = deriveVenuePage(v, ctx());
    // TEST-MOD-APPROVED #4490 (N117): when tables lead, Tables comes right after Overview.
    expect(page.tabs.join(" · ")).toBe("overview · reservations · groups · hire · menu");
    expect(page.labels.reservations).toBe("Tables");
    expect(page.lead?.ctaLabel).toBe("Book a table");
    expect(page.lead?.row).toMatchObject({
      value: "Tables from ₦20,000",
      detail: "Spend at least ₦80,000",
      actionLabel: "Book a table",
    });
  });

  test("Coworking: a day pass, by the hour, plans", () => {
    const v = view(["entry", "by_the_hour", "memberships"], {
      offers: [
        offer({ kind: "entry", name: "Day pass", fromMinor: naira(6000), entryStyle: "day_pass" }),
        offer({ kind: "by_the_hour", name: "Boardroom", fromMinor: naira(5500), unit: "hour" }),
      ],
      memberships: { fromMinor: naira(60000), interval: "month" },
    });
    const page = deriveVenuePage(v, ctx({ menuTabVisible: false }));
    expect(page.tabs.join(" · ")).toBe("overview · entry · by_the_hour · plans");
    expect(page.lead?.ctaLabel).toBe("Buy a day pass");
    expect(page.lead?.row?.value).toBe("Entry from ₦6,000");
    expect(page.lead?.row?.detail).toBe("From ₦5,500 an hour · plans from ₦60,000 a month");
  });

  test("Event space: a request-only hire", () => {
    const v = view(["private_hire"], {
      offers: [offer({ kind: "private_hire", name: "Main hall", fromMinor: naira(1800000), guestMax: 850, confirmationMode: "request" })],
    });
    const page = deriveVenuePage(v, ctx({ menuTabVisible: false }));
    expect(page.tabs).toEqual(["overview", "hire"]);
    expect(page.lead?.ctaLabel).toBe("Ask about a date");
    expect(page.lead?.row).toMatchObject({ value: "Hire from ₦1,800,000", detail: "Up to 850 guests", actionLabel: "Ask" });
  });

  test("Club (no guest list in the first build): entry, menu, tables", () => {
    const v = view(["entry", "table_reservations", "min_spend_tables", "menu"], {
      tables: { partyMax: 10, holdFromMinor: naira(500000), minSpendFromMinor: naira(500000) },
      offers: [offer({ kind: "entry", name: "Door", fromMinor: naira(10000) })],
    });
    const page = deriveVenuePage(v, ctx());
    expect(page.tabs.join(" · ")).toBe("overview · entry · menu · reservations");
    expect(page.labels.reservations).toBe("Tables");
    expect(page.lead?.ctaLabel).toBe("Buy entry");
  });

  test("nothing enabled, menu only: Overview and Menu, no bar, no row", () => {
    const page = deriveVenuePage(view(["menu"], { spaces: [] }), ctx());
    expect(page.tabs).toEqual(["overview", "menu"]);
    expect(page.lead).toBeNull();
    expect(page.showWays).toBe(false);
  });
});

describe("lead precedence and the other rows", () => {
  const all = view(
    ["entry", "table_reservations", "by_the_hour", "memberships", "group_packages", "private_hire"],
    {
      tables: { partyMax: 8 },
      memberships: { fromMinor: naira(30000), interval: "month" },
      offers: [
        offer({ kind: "entry", name: "Entry", fromMinor: naira(1000), entryStyle: "timed_session" }),
        offer({ kind: "by_the_hour", name: "Room", fromMinor: naira(2000), unit: "hour" }),
        offer({ kind: "group_package", name: "Pack", fromMinor: naira(5000), unit: "booking", guestMin: 4, guestMax: 20 }),
        offer({ kind: "private_hire", name: "Hire", fromMinor: naira(9000), guestMax: 90 }),
      ],
    },
  );

  // [TEST-MOD-APPROVED #4490] spec 06 decision 13.2 (Seth, 19 Nov): Plans lead
  // By the hour. The subset that holds both now leads with plans.
  test("entry, then tables, then plans, by the hour, groups, hire", () => {
    const kinds: string[] = [];
    const features = ["entry", "table_reservations", "by_the_hour", "memberships", "group_packages", "private_hire"];
    for (let i = 0; i < features.length; i += 1) {
      const subset = new Set(features.slice(i));
      const v: PublicVenueFeaturesView = { ...all, features: all.features.filter((f) => subset.has(f)) };
      kinds.push(deriveVenuePage(v, ctx({ menuTabVisible: false })).lead?.kind ?? "none");
    }
    expect(kinds).toEqual(["entry", "tables", "memberships", "memberships", "group_packages", "private_hire"]);
    // By the hour still leads when there are no plans.
    const hourOnly: PublicVenueFeaturesView = { ...all, features: all.features.filter((f) => f === "by_the_hour" || f === "group_packages") };
    expect(deriveVenuePage(hourOnly, ctx({ menuTabVisible: false })).lead?.kind).toBe("by_the_hour");
  });

  test("timed sessions read Book a visit; mixed entry reads Buy entry", () => {
    expect(deriveVenuePage(all, ctx()).lead?.ctaLabel).toBe("Book a visit");
    const mixed = view(["entry"], {
      offers: [
        offer({ kind: "entry", name: "A", fromMinor: 100, entryStyle: "day_pass" }),
        offer({ kind: "entry", name: "B", fromMinor: 200, entryStyle: "walk_in" }),
      ],
    });
    expect(deriveVenuePage(mixed, ctx()).lead?.ctaLabel).toBe("Buy entry");
  });

  test("a group package priced per booking reads from {min}, with its range", () => {
    const v = view(["group_packages"], {
      offers: [offer({ kind: "group_package", name: "Pack", fromMinor: naira(5000), unit: "booking", guestMin: 4, guestMax: 20 })],
    });
    const lead = deriveVenuePage(v, ctx({ menuTabVisible: false })).lead;
    expect(lead?.row).toMatchObject({ value: "Groups from ₦5,000", detail: "4 to 20 guests", actionLabel: "Book" });
    expect(lead?.ctaLabel).toBe("Book for a group");
  });

  test("by the hour and plans lead rows", () => {
    const hour = view(["by_the_hour"], {
      offers: [offer({ kind: "by_the_hour", name: "Room", fromMinor: naira(2000), unit: "hour" })],
    });
    // [TEST-MOD-APPROVED #4490] W3 fix 3 (W3-N27): a pool table or a desk is
    // not "a room": the by-the-hour verb is the pane's own "Book".
    expect(deriveVenuePage(hour, ctx({ menuTabVisible: false })).lead).toMatchObject({
      ctaLabel: "Book",
      row: { value: "From ₦2,000 an hour", actionLabel: "Book" },
    });
    const plans = view(["memberships"], { memberships: { fromMinor: naira(30000), interval: "month" } });
    expect(deriveVenuePage(plans, ctx({ menuTabVisible: false })).lead).toMatchObject({
      ctaLabel: "Join",
      row: { value: "Plans from ₦30,000 a month", actionLabel: "Join" },
    });
  });

  test("a tab with nothing to show is not rendered", () => {
    // Entry switched on with no offer: no tab, no lead, no "Ways to come".
    const empty = view(["entry", "group_packages", "by_the_hour"], { offers: [] });
    const page = deriveVenuePage(empty, ctx({ menuTabVisible: false }));
    expect(page.tabs).toEqual(["overview"]);
    expect(page.lead).toBeNull();
    expect(page.showWays).toBe(false);
    // Plans on with no plan; What's on on with no event.
    const bare = view(["memberships", "events_here"]);
    expect(deriveVenuePage(bare, ctx({ menuTabVisible: false })).tabs).toEqual(["overview"]);
  });

  test("Menu shows only with real items", () => {
    expect(tabsOf(view(["menu"]), { menuTabVisible: false })).toBe("overview");
  });
});

describe("tables and the reserve gate", () => {
  const tables = view(["table_reservations", "menu"], { tables: { partyMax: 12 } });

  test("a gate still checking keeps the tab (it has retry states) but sells nothing yet", () => {
    const page = deriveVenuePage(tables, ctx({ tablesGate: "pending" }));
    expect(page.tabs).toEqual(["overview", "menu", "reservations"]);
    expect(page.lead).toBeNull();
  });

  test("a gate that says not reservable drops the tab and the button", () => {
    const page = deriveVenuePage(tables, ctx({ tablesGate: "blocked" }));
    expect(page.tabs).toEqual(["overview", "menu"]);
    expect(page.lead).toBeNull();
  });

  test("a venue without table_reservations can never show a table button, row or tab", () => {
    for (const gate of ["ready", "pending", "blocked"] as const) {
      const page = deriveVenuePage(view(["events_here", "menu"]), ctx({ tablesGate: gate }));
      expect(page.tabs).not.toContain("reservations");
      expect(page.lead).toBeNull();
      expect(JSON.stringify(page)).not.toMatch(/Tables through Mingla|Reserve|Find a table/);
    }
  });

  test("a preview shows every tab the venue will have, ready or not", () => {
    const page = deriveVenuePage(tables, ctx({ tablesGate: "blocked", preview: true }));
    expect(page.tabs).toEqual(["overview", "menu", "reservations"]);
    expect(page.lead?.ctaLabel).toBe("Reserve a table");
  });
});

describe("dependencies fail closed", () => {
  test("table ordering without a menu, pick a table without a floor plan, hire without a space", () => {
    const parsed = parsePublicVenueFeatures({
      features: ["table_ordering", "pick_a_table", "private_hire", "floor_plan", "table_reservations"],
      spaces: [],
    });
    expect(parsed?.features).toEqual(["table_reservations"]);
    const withSpace = parsePublicVenueFeatures({
      features: ["private_hire", "floor_plan", "pick_a_table", "table_reservations", "table_ordering", "menu"],
      spaces: [SPACE],
    });
    expect(withSpace?.features).toEqual([
      "private_hire",
      "table_reservations",
      "floor_plan",
      "pick_a_table",
      "menu",
      "table_ordering",
    ]);
  });

  test("a payload that is not the documented shape parses to null", () => {
    expect(parsePublicVenueFeatures(null)).toBeNull();
    expect(parsePublicVenueFeatures({})).toBeNull();
    expect(parsePublicVenueFeatures({ features: "events_here" })).toBeNull();
    expect(parsePublicVenueFeatures([])).toBeNull();
  });

  test("unknown feature keys and malformed rows are dropped, not trusted", () => {
    const parsed = parsePublicVenueFeatures({
      features: ["menu", "teleporting"],
      spaces: [],
      offers: [{ id: "x", kind: "entry", name: "Door", fromMinor: -5 }, "nope"],
      events: { upcoming: [{ id: "e", title: "T", startsAt: "2026-11-21T17:00:00Z", href: "https://evil.example/e/a/b" }] },
    });
    expect(parsed?.features).toEqual(["menu"]);
    expect(parsed?.offers).toEqual([]);
    expect(parsed?.events).toEqual([]);
  });
});

describe("the null payload is today's page", () => {
  test("Overview, Menu (with items), Reservations; no lead of its own", () => {
    expect(deriveVenuePage(null, ctx({ menuTabVisible: true }))).toMatchObject({
      legacy: true,
      tabs: ["overview", "menu", "reservations"],
      lead: null,
      showWays: false,
    });
    expect(deriveVenuePage(null, ctx({ menuTabVisible: false })).tabs).toEqual(["overview", "reservations"]);
  });
});

describe("this release builds only some tabs", () => {
  // TEST-MOD-APPROVED #4490: P2-6 builds Entry, so the unbuilt example is now
  // Groups only; Entry is a built tab with its lead.
  // TEST-MOD-APPROVED #4490 P3-3: Groups is built from P3, so its tab shows (hire stays unbuilt).
  test("a feature whose flow is not built shows no tab and no lead; Entry is built from P2, Groups from P3", () => {
    const v = view(["entry", "group_packages", "events_here", "menu"], {
      offers: [
        offer({ kind: "entry", name: "Walk-in", fromMinor: naira(4000) }),
        offer({ kind: "group_package", name: "Squad", fromMinor: naira(10000) }),
      ],
      events: [{ id: "e1", kind: "event", title: "Karaoke", startsAt: "2026-11-21T17:00:00Z", href: "/e/a/b" }],
    });
    const page = deriveVenuePage(v, { menuTabVisible: true, tablesGate: "ready" });
    expect(BUILT_VENUE_TABS.has("entry")).toBe(true);
    expect(BUILT_VENUE_TABS.has("groups")).toBe(true);
    // TEST-MOD-APPROVED #4490 P4-3: private hire is built now.
    // TEST-MOD-APPROVED #4490 P5-3: by the hour is built now; plans stay unbuilt.
    expect(BUILT_VENUE_TABS.has("hire")).toBe(true);
    expect(BUILT_VENUE_TABS.has("by_the_hour")).toBe(true);
    // TEST-MOD-APPROVED #4490 P6-3: plans are built now.
    expect(BUILT_VENUE_TABS.has("plans")).toBe(true);
    expect(page.tabs).toEqual(["overview", "entry", "groups", "whats_on", "menu"]);
    expect(page.lead?.kind).toBe("entry");
    expect(page.lead?.ctaLabel).toBe("Buy entry");
  });
});

// ---- hours, special days, events ------------------------------------------

describe("hours with several windows a day and special days", () => {
  test("windows group by weekday in order, past midnight kept", () => {
    const days = groupVenueHours([
      { weekday: 2, windowOrdinal: 1, openTime: "18:00", closeTime: "23:30", isClosed: false },
      { weekday: 2, windowOrdinal: 0, openTime: "12:00", closeTime: "15:00", isClosed: false },
      { weekday: 5, windowOrdinal: 0, openTime: "22:00", closeTime: "03:00", isClosed: false },
      { weekday: 6, windowOrdinal: 0, openTime: null, closeTime: null, isClosed: true },
    ]);
    expect(days.map((d) => venueHoursText(d))).toEqual(["12:00–15:00, 18:00–23:30", "22:00–03:00", "Closed"]);
  });

  test("date labels are calendar dates (no timezone drift)", () => {
    expect(venueDateLabel("2026-12-25")).toBe("Fri 25 Dec");
    expect(venueDateLabel("2026-02-29")).toBe("2026-02-29"); // not a date: shown as given
  });

  test("special days: upcoming only, closed or their own windows", () => {
    const rows = venueSpecialDayRows(
      [
        { date: "2026-12-31", label: null, isClosed: false, windows: [{ open: "18:00", close: "03:00" }] },
        { date: "2026-12-25", label: "Christmas Day", isClosed: true, windows: [] },
        { date: "2026-08-01", label: "Gone", isClosed: true, windows: [] },
      ],
      "2026-11-18",
    );
    expect(rows.map((r) => `${r.dateLabel}|${r.label}|${r.text}`)).toEqual([
      "Fri 25 Dec|Christmas Day|Closed",
      "Thu 31 Dec|null|18:00–03:00",
    ]);
  });

  test("a closed special day today is not Open now; its own windows replace the weekly ones", () => {
    const weekly = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday, windowOrdinal: 0, openTime: "09:00", closeTime: "17:00", isClosed: false,
    }));
    const noon = new Date("2026-08-05T12:00:00Z"); // Wed in London
    const normal = resolveVenueOpenState({
      hours: venueOpenStateRows(weekly, [], noon, "Europe/London"),
      timeZone: "Europe/London",
      now: noon,
    });
    expect(normal.status).toBe("open");
    const closedToday = resolveVenueOpenState({
      hours: venueOpenStateRows(weekly, [{ date: "2026-08-05", label: null, isClosed: true, windows: [] }], noon, "Europe/London"),
      timeZone: "Europe/London",
      now: noon,
    });
    expect(closedToday.status).toBe("opensLater");
    const lateOnly = resolveVenueOpenState({
      hours: venueOpenStateRows(
        weekly,
        [{ date: "2026-08-05", label: null, isClosed: false, windows: [{ open: "18:00", close: "23:00" }] }],
        noon,
        "Europe/London",
      ),
      timeZone: "Europe/London",
      now: noon,
    });
    expect(lateOnly.status).toBe("opensLater");
    expect(lateOnly.opensAt).toBe("18:00");
  });

  test("event times are the venue's own clock, or nothing at all", () => {
    expect(venueEventWhen("2026-11-21T17:00:00Z", "Africa/Lagos")).toBe("Sat 21 Nov · 18:00");
    expect(venueEventWhen("2026-11-21T23:30:00Z", "Africa/Lagos")).toBe("Sun 22 Nov · 00:30");
    expect(venueEventWhen("2026-11-21T17:00:00Z", null)).toBeNull();
    expect(venueEventWhen("2026-11-21T17:00:00Z", "-05:00")).toBeNull();
    expect(venueEventWhen("not a date", "Africa/Lagos")).toBeNull();
  });

  test("money: whole amounts without decimals, in the venue's currency", () => {
    expect(formatVenueMoney(naira(4000), "NGN", 2)).toBe("₦4,000");
    expect(formatVenueMoney(450050, "NGN", 2)).toBe("₦4,500.50");
    expect(formatVenueMoney(-1, "NGN", 2)).toBe("—");
  });

  test("?tab= accepts the new tab keys and nothing else", () => {
    expect(venueTabFromParam("whats_on")).toBe("whats_on");
    expect(venueTabFromParam("menu")).toBe("menu");
    expect(venueTabFromParam("admin")).toBeNull();
    expect(venueTabFromParam(undefined)).toBeNull();
  });
});

// ---- the reducer ----------------------------------------------------------

describe("the bar's button", () => {
  const context = (over: Partial<PublicVenueReservationUiContext> = {}): PublicVenueReservationUiContext => ({
    hasMenu: true,
    canOpenReservationSheet: true,
    availableTabs: ["overview", "entry", "menu", "reservations"],
    ...over,
  });
  const start = { activeTab: "overview", reservationSheetOpen: false } as const;

  test("on the table tab it is exactly the old Reserve press", () => {
    const old = publicVenueReservationUiReducer(start, { type: "RESERVE_CTA_PRESSED", context: context() });
    const now = publicVenueReservationUiReducer(start, { type: "PRIMARY_CTA_PRESSED", tab: "reservations", context: context() });
    expect(now).toEqual(old);
    expect(now).toEqual({ activeTab: "reservations", reservationSheetOpen: true });
    const closed = context({ canOpenReservationSheet: false });
    expect(publicVenueReservationUiReducer(start, { type: "PRIMARY_CTA_PRESSED", tab: "reservations", context: closed })).toEqual(
      publicVenueReservationUiReducer(start, { type: "RESERVE_CTA_PRESSED", context: closed }),
    );
  });

  test("on any other tab it selects the tab with no sheet", () => {
    expect(publicVenueReservationUiReducer(start, { type: "PRIMARY_CTA_PRESSED", tab: "entry", context: context() })).toEqual({
      activeTab: "entry",
      reservationSheetOpen: false,
    });
  });

  test("a tab the venue does not have can never stay active", () => {
    const next = publicVenueReservationUiReducer(start, { type: "TAB_SELECTED", tab: "hire", context: context() });
    expect(next.activeTab).toBe("overview");
    const gone = publicVenueReservationUiReducer(
      { activeTab: "entry", reservationSheetOpen: false },
      { type: "ENVIRONMENT_CHANGED", context: context({ availableTabs: ["overview", "menu"] }) },
    );
    expect(gone.activeTab).toBe("overview");
  });

  test("with no availableTabs the rule is today's (only Menu can be hidden)", () => {
    const legacy = context({ availableTabs: undefined, hasMenu: false });
    expect(publicVenueReservationUiReducer(start, { type: "TAB_SELECTED", tab: "menu", context: legacy }).activeTab).toBe("overview");
    expect(publicVenueReservationUiReducer(start, { type: "TAB_SELECTED", tab: "reservations", context: legacy }).activeTab).toBe("reservations");
  });
});

// ---- the venue types are labels ------------------------------------------

describe("the nine venue types are labels and starting presets", () => {
  test("each has its own noun", () => {
    const nouns = Object.fromEntries(
      Object.entries(VENUE_CATEGORY_PROFILES).map(([k, p]) => [k, p.noun]),
    );
    expect(nouns).toMatchObject({
      restaurant: "restaurant",
      play: "venue",
      creative_and_arts: "venue",
      stay: "hotel",
      bar_lounge: "bar and lounge",
      club: "club",
      cafe: "cafe",
      event_space: "event space",
      coworking: "coworking space",
    });
  });
});
