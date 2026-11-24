/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4490 Explorer W6a — Venues in Discover (app side; #2774 lane).
 *
 *   K-*  the kind: appended last, empty filters, the pill shows only with
 *        supply and a server without `venues` never throws;
 *   M-*  the venue card model: type label, lead line (₦, server price), event
 *        chip in the venue's clock, lead tab, unreadable facts;
 *   R-*  routing: /b/<brand>/v/<venue>?tab=<lead>;
 *   C-*  the mounted venue card: label, area, offer line, On tonight, a11y;
 *   F-*  Type of place chips say the taxonomy words; selected labels too;
 *   G-*  wiring: visibleKinds optional chaining, venue_tapped_to_book source
 *        discover, analytics properties, coach copy unchanged by Venues, the
 *        §6 empty / filtered / error copy.
 *
 * FAILS-ON-REVERT: `kinds[kind].total` without `?.` -> G-1; open without the
 * lead tab -> R-1; the venue variant removed from DiscoverCard -> C-1; the coach
 * check back on DISCOVER_KIND_ORDER.length -> G-4.
 *
 * Fix round 1 (W6-N4 / W6-N7): C-3 fails if the card prints "On tonight" /
 * "On today" in English instead of the W3 deck's translated keys; M-5 fails if
 * Discover stops using the shared table verb rule; G-6 fails if the filtered-empty
 * state goes back to an empty body line.
 * TEST-MOD-APPROVED #4490 (06-W6 fix 1): this file now mocks react-i18next with a
 * small lookup over the real en / fr cards and discover strings (the lane's shared
 * double only knows followers.json and would print raw keys).
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";

const { act, create } = require("react-test-renderer") as typeof import("react-test-renderer");

jest.mock("@mingla/offering-rendering", () => ({ EventCoverMedia: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
const mockI18n = { lang: "en" as "en" | "fr" };
// The app's i18n bootstrap (src/i18n/index.ts) imports i18next, which the
// #2774 render lane (mingla-business modules only) does not install; the card
// reads only the current language from it (localeUtils). Same stand-in as the
// #1605 resolver hooks use.
jest.mock("../../../i18n", () => ({
  __esModule: true,
  default: { language: "en", t: (key: string) => key, changeLanguage: () => undefined },
}));
jest.mock("react-i18next", () => {
  const nodePath = require("node:path");
  const load = (lang: string, ns: string) => require(nodePath.resolve(__dirname, `../../../i18n/locales/${lang}/${ns}.json`));
  const t = (key: string, options?: { defaultValue?: string } & Record<string, unknown>) => {
    const [ns, leaf] = key.includes(":") ? key.split(":") : ["discover", key];
    const value = load(mockI18n.lang, ns)[leaf] ?? options?.defaultValue ?? key;
    return String(value).replace(/{{\s*(\w+)\s*}}/g, (_m: string, k: string) => String(options?.[k] ?? `{{${k}}}`));
  };
  return { initReactI18next: { type: "3rdParty", init: () => undefined }, useTranslation: () => ({ t, i18n: { language: mockI18n.lang } }) };
});

const { DISCOVER_KIND_ORDER, emptyDiscoverFilters } = require("../../../types/discoverFeed") as typeof import("../../../types/discoverFeed");
const { discoverVenueCardModel, discoverVenueAnalytics, discoverVenueLeadTab, withVenueLeadTab } =
  require("../discoverVenueCard") as typeof import("../discoverVenueCard");
const { canonicalDiscoverCardPath } = require("../discoverCardRoute") as typeof import("../discoverCardRoute");
const { selectedDiscoverFilterLabels } = require("../discoverFilterState") as typeof import("../discoverFilterState");
const { venueTypeLabel, VENUE_TYPE_CHIP_KEYS } = require("@mingla/brand-rendering/venueTypeLabels") as typeof import("@mingla/brand-rendering/venueTypeLabels");
const { DiscoverCard } = require("../DiscoverCard") as typeof import("../DiscoverCard");

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf8");

// Lagos 18:00 on Sat 28 Nov 2026 = 17:00 UTC.
const NOW = new Date("2026-11-28T17:00:00.000Z");

function facts(over: Record<string, unknown> = {}) {
  return {
    venueId: "11111111-1111-4111-8111-111111111111",
    venueName: "Gameland Lagos",
    venueSlug: "gamelandlagos",
    brandId: "22222222-2222-4222-8222-222222222222",
    brandSlug: "gameland",
    brandName: "Gameland",
    venueType: "play",
    timezone: "Africa/Lagos",
    features: ["entry", "events_here"],
    isBookable: true,
    tablesReservable: false,
    plansLive: false,
    priceFrom: { entry: 400000, group_packages: null, private_hire: null, by_the_hour: null, memberships: null },
    membershipsPeriod: null,
    currencyCode: "NGN",
    minorUnitExponent: 2,
    onTodayStartsAt: "2026-11-28T19:00:00.000Z",
    onTodayEndsAt: "2026-11-28T23:00:00.000Z",
    onTodayLive: false,
    onTodayLiveUntil: null,
    ...over,
  };
}

function venueCard(over: Record<string, unknown> = {}, cardOver: Record<string, unknown> = {}) {
  return {
    source: "mingla" as const,
    kind: "venue" as const,
    id: "11111111-1111-4111-8111-111111111111",
    brand: { id: "22222222-2222-4222-8222-222222222222", slug: "gameland", name: "Gameland", photoUrl: null },
    title: "Gameland Lagos",
    coverUrl: null,
    coverType: "image" as const,
    coverHue: 140,
    startsAtUtc: null,
    endsAtUtc: null,
    timezone: "Africa/Lagos",
    meta: { venueOrPlace: "Lekki Phase 1" },
    price: null,
    route: { pathname: "/venue/[slug]", params: { slug: "gamelandlagos", venueSlug: "gamelandlagos" } },
    venue: facts(over),
    ...cardOver,
  };
}

const textOf = (node: unknown): string[] => {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === "string") { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.children) walk(n.children);
  };
  walk(node);
  return out;
};

describe("#4490 W6a Discover Venues", () => {
  it("K-1 Venues is the fifth kind, appended last; empty filters are {}", () => {
    expect([...DISCOVER_KIND_ORDER]).toEqual(["events", "experiences", "trips", "stays", "venues"]);
    expect(emptyDiscoverFilters("venues")).toEqual({ kind: "venues", f: {} });
    expect(emptyDiscoverFilters("stays")).toEqual({ kind: "stays", f: { guests: 2 } });
  });

  it("M-1 a venue card says its type, lead line, event chip and tab", () => {
    const model = discoverVenueCardModel(venueCard(), NOW)!;
    expect(model.typeLabel).toBe("Play and games");
    expect(model.offerLine).toBe("Entry from ₦4,000");
    expect(model.eventChip).toBe("On tonight");
    expect(model.leadTab).toBe("entry");
  });
  it("M-2 no price for the lead: the verb, never an invented amount; tables say the shared table verb", () => {
    const noPrice = discoverVenueCardModel(venueCard({ priceFrom: { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null } }), NOW)!;
    expect(noPrice.offerLine ?? "").not.toMatch(/₦|NGN|\d/);
    const tables = discoverVenueCardModel(venueCard({ venueType: "restaurant", features: ["table_reservations"], tablesReservable: true,
      priceFrom: { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null }, onTodayStartsAt: null, onTodayEndsAt: null }), NOW)!;
    // The shared table verb (W3 fix rounds; one Tables wording is pending Seth).
    expect(tables.offerLine).toBe("Reserve a table");
    expect(tables.typeLabel).toBe("Restaurant");
    expect(tables.eventChip).toBeNull();
  });
  it("M-3 an event later today before 17:00 is On today; other cards and junk give no model", () => {
    const day = discoverVenueCardModel(venueCard({ onTodayStartsAt: "2026-11-29T10:00:00.000Z", onTodayEndsAt: "2026-11-29T12:00:00.000Z" }), new Date("2026-11-29T07:00:00.000Z"))!;
    expect(day.eventChip).toBe("On today");
    expect(discoverVenueCardModel({ ...venueCard(), kind: "stay" } as never, NOW)).toBeNull();
    expect(discoverVenueCardModel(venueCard({}, { venue: { nope: true } }) as never, NOW)).toBeNull();
    expect(discoverVenueAnalytics({ ...venueCard(), kind: "event" } as never, NOW)).toEqual({});
  });
  it("M-4 analytics: venue_type, lead_tab, on_tonight", () => {
    expect(discoverVenueAnalytics(venueCard(), NOW)).toEqual({ venue_type: "play", lead_tab: "entry", on_tonight: true });
  });

  it("R-1 a venue opens its page on the lead tab; a stay is unchanged", () => {
    expect(canonicalDiscoverCardPath(venueCard() as never)).toBe("/b/gameland/v/gamelandlagos");
    expect(withVenueLeadTab(venueCard() as never, "/b/gameland/v/gamelandlagos")).toBe("/b/gameland/v/gamelandlagos?tab=entry");
    expect(read("../../DiscoverScreen.tsx")).toContain("const path = plainPath === null ? null : withVenueLeadTab(card, plainPath);");
    expect(discoverVenueLeadTab(venueCard() as never)).toBe("entry");
    expect(canonicalDiscoverCardPath({ ...venueCard(), kind: "stay" } as never)).toBe("/b/gameland/v/gamelandlagos");
    const noLead = venueCard({ features: [], priceFrom: { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null } });
    expect(withVenueLeadTab(noLead as never, "/b/gameland/v/gamelandlagos")).toBe("/b/gameland/v/gamelandlagos");
    expect(withVenueLeadTab({ ...venueCard(), kind: "stay" } as never, "/b/x/v/y")).toBe("/b/x/v/y");
  });

  it("C-1 the mounted venue card shows type, name, area, lead line and On tonight", () => {
    let tree: ReturnType<typeof create> | null = null;
    act(() => {
      tree = create(<DiscoverCard card={venueCard() as never} saved={false} onPress={() => undefined} onSave={() => undefined} now={NOW} />);
    });
    const text = textOf(tree!.toJSON());
    expect(text).toEqual(expect.arrayContaining(["Play and games", "On tonight", "Gameland Lagos", "Lekki Phase 1", "Entry from ₦4,000"]));
    const root = tree!.root.findAll((n) => n.props?.accessibilityRole === "button")[0];
    expect(root.props.accessibilityLabel).toBe("Gameland Lagos, Play and games, Entry from ₦4,000, On tonight");
  });
  it("C-3 the event chip uses the W3 deck's translated words (French: Ce soir / Aujourd’hui)", () => {
    mockI18n.lang = "fr";
    try {
      let tree: ReturnType<typeof create> | null = null;
      act(() => {
        tree = create(<DiscoverCard card={venueCard() as never} saved={false} onPress={() => undefined} onSave={() => undefined} now={NOW} />);
      });
      const text = textOf(tree!.toJSON());
      expect(text).toContain("Ce soir");
      expect(text).not.toContain("On tonight");
      act(() => {
        tree = create(<DiscoverCard card={venueCard({ onTodayStartsAt: "2026-11-29T10:00:00.000Z", onTodayEndsAt: "2026-11-29T12:00:00.000Z" }) as never}
          saved={false} onPress={() => undefined} onSave={() => undefined} now={new Date("2026-11-29T07:00:00.000Z")} />);
      });
      expect(textOf(tree!.toJSON())).toContain("Aujourd’hui");
      const deck = read("../../SwipeableCards.tsx");
      expect(deck).toContain("t('cards:deck.on_tonight', { defaultValue: 'On tonight' })");
      expect(read("../DiscoverCard.tsx")).toContain('t("cards:deck.on_tonight", { defaultValue: "On tonight" })');
    } finally {
      mockI18n.lang = "en";
    }
  });
  it("M-5 tables follow the shared rule: Book a table with minimum-spend tables, otherwise Reserve a table", () => {
    const none = { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null };
    const plain = discoverVenueCardModel(venueCard({ venueType: "restaurant", features: ["table_reservations"], tablesReservable: true, priceFrom: none, onTodayStartsAt: null, onTodayEndsAt: null }), NOW)!;
    const minSpend = discoverVenueCardModel(venueCard({ venueType: "club", features: ["table_reservations", "min_spend_tables"], tablesReservable: true, priceFrom: none, onTodayStartsAt: null, onTodayEndsAt: null }), NOW)!;
    expect(plain.offerLine).toBe("Reserve a table");
    expect(minSpend.offerLine).toBe("Book a table");
    // One owner: Discover's line is the deck's chip (deckVenueChips -> deriveVenuePage).
    expect(read("../discoverVenueCard.ts")).toContain("const chips = deckVenueChips(facts, now, venueMoneyText);");
  });
  it("C-2 an event card still renders the classic body (no venue line)", () => {
    let tree: ReturnType<typeof create> | null = null;
    const event = { ...venueCard(), kind: "event", venue: undefined, price: { currency: "NGN", listMinor: 500000, saleMinor: null, saleEndsAt: null, isFree: false, unit: "each" } };
    act(() => {
      tree = create(<DiscoverCard card={event as never} saved={false} onPress={() => undefined} onSave={() => undefined} now={NOW} />);
    });
    expect(textOf(tree!.toJSON())).not.toContain("Entry from ₦4,000");
    expect(textOf(tree!.toJSON())).toContain("Gameland");
  });

  it("F-1 Type of place chips say the taxonomy words; selected labels too", () => {
    expect(VENUE_TYPE_CHIP_KEYS.map(venueTypeLabel)).toEqual([
      "Restaurant", "Bar and lounge", "Club", "Cafe", "Play and games", "Coworking", "Event space", "Creative and arts",
    ]);
    const groups = [{ id: "venueType" as const, multi: true, options: [{ id: "club", count: 2 }, { id: "bar_lounge", count: 1 }] }];
    expect(selectedDiscoverFilterLabels({ kind: "venues", f: { venueTypes: ["bar_lounge"] } }, groups,
      (g, id) => (g === "venueType" ? venueTypeLabel(id) : null))).toEqual(["Bar and lounge"]);
    const dropdown = read("../FilterDropdown.tsx");
    expect(dropdown).toContain('venueType: "venue_type"');
    expect(dropdown).toContain('if (group.id === "venueType") return venueTypeLabel(id);');
    expect(dropdown).toContain('venueType: "venueTypes"');
  });

  it("G-1..G-5 DiscoverScreen wiring", () => {
    const screen = read("../../DiscoverScreen.tsx");
    // TEST-MOD-APPROVED #4490 (06-W6 fix 2, W6-D2): the pills now read the kept
    // kinds (`pillKinds`, the facets' kinds or the city's last ones); the pin is
    // the same optional chaining on a kind the server may not send.
    expect(screen).toContain("(pillKinds?.[kind]?.total ?? 0) > 0");
    expect(screen).toContain('venues: t("pill.venues", "Venues")');
    expect(screen).toContain('source: "discover",');
    expect(screen).toContain('if (card.kind === "stay" || card.kind === "venue") return "venue" as const;');
    // Coach copy decision is made over the four original kinds only.
    expect(screen).toContain('const coachKinds = visibleKinds.filter((kind) => kind !== "venues");');
    expect(screen).not.toContain("visibleKinds.length === DISCOVER_KIND_ORDER.length");
    // §6 copy keys.
    for (const key of ["venues.empty_title", "venues.empty_body", "venues.filtered_title", "venues.error_title", "venues.error_retry"]) {
      expect(screen).toContain(`t("${key}"`);
    }
    const en = JSON.parse(read("../../../i18n/locales/en/discover.json")) as Record<string, string>;
    expect(en["pill.venues"]).toBe("Venues");
    expect(en["group.venue_type"]).toBe("Type of place");
    expect(en["venues.empty_title"]).toBe("No venues to book here yet.");
    expect(en["venues.empty_body"]).toBe("Venues you can book on Mingla will show up here.");
    expect(en["venues.filtered_title"]).toBe("No venues match those filters.");
    expect(en["venues.error_title"]).toBe("We could not load venues.");
    expect(en["venues.error_retry"]).toBe("Try again");
    expect(en["empty.clear_filters"]).toBe("Clear filters");
  });
  it("G-6 the filtered-empty Venues state uses the existing Discover filtered-empty body; an empty body draws no line", () => {
    const screen = read("../../DiscoverScreen.tsx");
    expect(screen).toContain('title={t("venues.filtered_title", "No venues match those filters.")} body={t("empty.no_match_subtitle", "Adjust filters or reset to see more.")}');
    expect(screen).not.toContain('body=""');
    expect(read("../DiscoverEmptyState.tsx")).toContain("{props.body ? <Text style={styles.body}>{props.body}</Text> : null}");
  });
});
