/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4490 W6 fix 2 — the device pass's Discover P3s (#2774 lane).
 *
 *   D1-*  W6-D1: the venue card's lead line may wrap to a second line, so
 *         "Hire from ₦1,800,000" is never cut mid-number at 375;
 *   D2-*  W6-D2: one body state at a time (a failed read shows the error alone,
 *         never "No venues match those filters." under it), and the kind pills
 *         keep the city's last kinds when the facets read fails;
 *   D3-*  W6-D3: while new filters load, the stale count is not claimed and the
 *         skeleton shows; a Venues read gives up after the 10 s venue budget
 *         and is not retried after it.
 *
 * FAILS-ON-REVERT: numberOfLines back to 1 -> D1-1; `!failed` taken out of the
 * load state -> D2-1, D2-2; the pills read only `facets.data` -> D2-3, D2-4;
 * `facetsStale` ignored -> D3-1, D3-2; the venue read not raced -> D3-3;
 * the venue retry rule removed -> D3-4, D3-5.
 */
// app-mobile's tsc has no jest or react-test-renderer types: declare what this
// suite uses so it adds no type errors (the W5 handler suite does the same).
declare const jest: {
  mock(path: string, factory: () => unknown): void;
  fn(): { (...args: unknown[]): unknown; mockImplementation(impl: (...args: unknown[]) => unknown): void; mockReset(): void };
  useFakeTimers(): void;
  useRealTimers(): void;
  advanceTimersByTime(ms: number): void;
};
declare const describe: (name: string, body: () => void) => void;
declare const it: (name: string, body: () => void | Promise<void>) => void;
declare const expect: (value: unknown) => {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toContain(v: unknown): void;
  toMatch(v: RegExp): void;
  toBeUndefined(): void;
  toBeInstanceOf(v: unknown): void;
};
type TestNode = { type: unknown; props: Record<string, any> };
type TestTree = { root: { findAll(match: (n: TestNode) => boolean): TestNode[] } };

import React from "react";
import fs from "node:fs";
import path from "node:path";

const { act, create } = require("react-test-renderer") as {
  act(work: () => void | Promise<void>): Promise<void> | void;
  create(element: React.ReactElement): TestTree;
};

jest.mock("@mingla/offering-rendering", () => ({ EventCoverMedia: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
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
  const load = (ns: string) => require(nodePath.resolve(__dirname, `../../../i18n/locales/en/${ns}.json`));
  const t = (key: string, options?: { defaultValue?: string } & Record<string, unknown>) => {
    const [ns, leaf] = key.includes(":") ? key.split(":") : ["discover", key];
    const value = load(ns)[leaf] ?? options?.defaultValue ?? key;
    return String(value).replace(/{{\s*(\w+)\s*}}/g, (_m: string, k: string) => String(options?.[k] ?? `{{${k}}}`));
  };
  return { initReactI18next: { type: "3rdParty", init: () => undefined }, useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
const mockInvoke = jest.fn();
jest.mock("../../../services/supabase", () => ({ supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } } }));

const { DiscoverCard } = require("../DiscoverCard") as typeof import("../DiscoverCard");
const { discoverLoadState, discoverPillKinds } = require("../discoverLoadState") as typeof import("../discoverLoadState");
const { discoverVenueRetry, fetchDiscoverFacets, fetchDiscoverPage } =
  require("../../../services/discoverFeedService") as typeof import("../../../services/discoverFeedService");
const { VenuePurchaseError, VENUE_READ_TIMEOUT_MS } =
  require("../../../services/venuePurchaseService") as typeof import("../../../services/venuePurchaseService");

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf8");
const NOW = new Date("2026-11-28T17:00:00.000Z");

function hallCard() {
  return {
    source: "mingla" as const,
    kind: "venue" as const,
    id: "33333333-3333-4333-8333-333333333333",
    brand: { id: "22222222-2222-4222-8222-222222222222", slug: "foundry", name: "Foundry", photoUrl: null },
    title: "The Foundry Hall",
    coverUrl: null,
    coverType: "image" as const,
    coverHue: 20,
    startsAtUtc: null,
    endsAtUtc: null,
    timezone: "Africa/Lagos",
    meta: { venueOrPlace: "Lagos" },
    price: null,
    route: { pathname: "/venue/[slug]", params: { slug: "foundry-hall", venueSlug: "foundry-hall" } },
    venue: {
      venueId: "33333333-3333-4333-8333-333333333333",
      venueName: "The Foundry Hall",
      venueSlug: "foundry-hall",
      brandId: "22222222-2222-4222-8222-222222222222",
      brandSlug: "foundry",
      brandName: "Foundry",
      venueType: "event_space",
      timezone: "Africa/Lagos",
      features: ["private_hire"],
      isBookable: true,
      tablesReservable: false,
      plansLive: false,
      priceFrom: { entry: null, group_packages: null, private_hire: 180000000, by_the_hour: null, memberships: null },
      membershipsPeriod: null,
      currencyCode: "NGN",
      minorUnitExponent: 2,
      onTodayStartsAt: null,
      onTodayEndsAt: null,
      onTodayLive: false,
      onTodayLiveUntil: null,
    },
  };
}

const base = {
  anchorSet: true,
  facetsLoaded: true,
  facetsFailed: false,
  feedLoaded: true,
  feedFailed: false,
  visibleKindCount: 3,
  itemCount: 0,
};

describe("#4490 W6 fix 2 Discover", () => {
  it("D1-1 the lead line wraps to two lines and keeps the whole price", () => {
    let tree: TestTree | null = null;
    act(() => {
      tree = create(<DiscoverCard card={hallCard() as never} saved={false} onPress={() => undefined} onSave={() => undefined} now={NOW} />);
    });
    const line = tree!.root.findAll(
      (n) => typeof n.type !== "string" && typeof n.props.children === "string" && n.props.children.startsWith("Hire from"),
    )[0];
    expect(line.props.children).toBe("Hire from ₦1,800,000");
    expect(line.props.numberOfLines).toBe(2);
  });

  it("D2-1 a failed facets read shows the error alone: no skeleton, no filtered-empty, no empty city", () => {
    const facetsDown = discoverLoadState({ ...base, facetsLoaded: false, facetsFailed: true, feedLoaded: false });
    expect(facetsDown).toEqual({ countPending: false, showSkeleton: false, cityEmpty: false, filteredEmpty: false });
    const bothDown = discoverLoadState({ ...base, facetsLoaded: false, facetsFailed: true, feedLoaded: false, feedFailed: true, visibleKindCount: 0 });
    expect(bothDown).toEqual({ countPending: false, showSkeleton: false, cityEmpty: false, filteredEmpty: false });
  });

  it("D2-2 a failed feed read over loaded facets is not 'No venues match those filters.'", () => {
    const state = discoverLoadState({ ...base, feedLoaded: false, feedFailed: true });
    expect(state.filteredEmpty).toBe(false);
    expect(state.showSkeleton).toBe(false);
    // The real "nothing matches" still shows when both reads answered.
    expect(discoverLoadState(base).filteredEmpty).toBe(true);
  });

  it("D2-3 the pills keep the city's last kinds when the facets read fails", () => {
    const kinds = { events: { total: 4 }, venues: { total: 11 } };
    const last = { anchorKey: "city:lagos", kinds };
    expect(discoverPillKinds(undefined, last, "city:lagos")).toBe(kinds);
    expect(discoverPillKinds(undefined, last, "city:abuja")).toBeUndefined();
    const fresh = { events: { total: 1 } };
    expect(discoverPillKinds(fresh, last, "city:lagos")).toBe(fresh);
  });

  it("D2-4 the screen builds its pills, count and error from that one state", () => {
    const screen = read("../../DiscoverScreen.tsx");
    expect(screen).toContain("const pillKinds = discoverPillKinds(facets.data?.kinds, lastKindsRef.current, anchorKey);");
    expect(screen).toContain("(pillKinds?.[kind]?.total ?? 0) > 0");
    expect(screen).toContain("if (facets.data && !facets.isPlaceholderData) lastKindsRef.current = { anchorKey, kinds: facets.data.kinds };");
    expect(screen).toContain("facetsStale: facets.isPlaceholderData,");
    // No "0 venues" next to the error.
    expect(screen).toMatch(/const countLabel = loadState\.countPending\s*\?\s*""\s*:\s*facets\.error\s*\?\s*""/);
  });

  it("D3-1 new filters loading over the previous counts: count withheld, skeleton shown", () => {
    const state = discoverLoadState({ ...base, feedLoaded: false, facetsStale: true });
    expect(state.countPending).toBe(true);
    expect(state.showSkeleton).toBe(true);
    expect(state.filteredEmpty).toBe(false);
  });

  it("D3-2 an empty feed waits for the new counts before saying nothing matches", () => {
    const state = discoverLoadState({ ...base, facetsStale: true });
    expect(state.filteredEmpty).toBe(false);
    expect(state.cityEmpty).toBe(false);
  });

  it("D3-3 a Venues read that gets no answer gives up at the 10 s venue budget; other kinds are not raced", async () => {
    jest.useFakeTimers();
    try {
      mockInvoke.mockImplementation(() => new Promise(() => undefined));
      const anchor = { kind: "city", name: "Lagos", lat: 6.5, lng: 3.4 } as never;
      const venues = fetchDiscoverPage(anchor, { kind: "venues", f: {} }, null);
      const venuesFacets = fetchDiscoverFacets(anchor, { kind: "venues", f: {} });
      const events = fetchDiscoverPage(anchor, { kind: "events", f: {} }, null);
      let eventsSettled = false;
      void events.then(() => { eventsSettled = true; }, () => { eventsSettled = true; });
      const venuesResult = venues.then(() => "answered", (e: unknown) => e);
      const facetsResult = venuesFacets.then(() => "answered", (e: unknown) => e);
      expect(VENUE_READ_TIMEOUT_MS).toBe(10_000);
      await act(async () => {
        jest.advanceTimersByTime(VENUE_READ_TIMEOUT_MS);
      });
      expect(await venuesResult).toBeInstanceOf(VenuePurchaseError);
      expect(await facetsResult).toBeInstanceOf(VenuePurchaseError);
      expect(eventsSettled).toBe(false);
    } finally {
      jest.useRealTimers();
      mockInvoke.mockReset();
    }
  });

  it("D3-4 a Venues read is not retried after its budget; other failures once; auth never", () => {
    expect(discoverVenueRetry(0, new VenuePurchaseError("venue_unreachable"))).toBe(false);
    expect(discoverVenueRetry(0, new Error("Discover unavailable: Edge Function returned a non-2xx status code"))).toBe(true);
    expect(discoverVenueRetry(1, new Error("Discover unavailable: boom"))).toBe(false);
    expect(discoverVenueRetry(0, new Error("Discover unavailable: JWT expired"))).toBe(false);
  });

  it("D3-5 the feed and facets queries use that rule for Venues only", () => {
    for (const rel of ["../../../hooks/useDiscoverFeed.ts", "../../../hooks/useDiscoverFacets.ts"]) {
      expect(read(rel)).toContain('...(filters.kind === "venues" ? { retry: discoverVenueRetry } : {}),');
    }
  });
});
