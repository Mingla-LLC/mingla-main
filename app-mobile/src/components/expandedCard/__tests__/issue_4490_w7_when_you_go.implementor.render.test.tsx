// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4490 Explorer W7 — "When you'd go" on every venue surface, rendered.
 *
 *   P-1  place sheet / venue Overview unchanged: chips, crowd tile, bars, note;
 *   P-2  chips are 34 pt to look at and tap with a 5 pt slop above and below (44 pt);
 *   P-3  "Your plan · Sat 17:00" when the plan is not today;
 *   E-1  event page: Now + "Event · Sat 19:00", the Event chip preselected,
 *        crowd OFF (no tile, no bars, no crowd note), Leave by in Good to know;
 *   E-2  Now on the event page: no Leave by; the drive is the same on both chips;
 *   E-3  a past Leave by reads "Leave now"; no drive: no Drive and no Leave by;
 *   E-4  the block is absent when every row is empty;
 *   X-1  EventWhenYoudGo draws only for an event opened from a What's on row,
 *        and only for /e/ rows (experiences, trips and any other way in: nothing);
 *   X-2  an unreadable venue clock draws nothing (never the phone's clock);
 *   O-1  pass "On the day": weather, drive (est.), Leave by; no crowd; a booking
 *        more than 7 days out says "The forecast shows from Thu 26 Nov";
 *   O-2  nothing to say: nothing drawn;
 *   C-1  the checkout line (finished, not mounted: W4);
 *   S-*  wiring pins (screen slot, both What's on doors, pass mount, marker).
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT: `showCrowd` ignored (E-1); the Event chip not preselected
 * (E-1); hitSlop removed (P-2); `hostedEventContextFor` returning a context for
 * a non-row (X-1); the pass mounting without the isLive guard (S-4).
 */
// app-mobile's tsc has no jest or react-test-renderer types, and a local
// `declare const jest` stops the jest.mock hoist: this suite is not type
// checked (the same stance as the existing render suites, which add the same
// errors); the model suite beside it declares its globals instead.
import React from "react";
import fs from "node:fs";
import path from "node:path";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

jest.mock("react-i18next", () => {
  const cards = require("../../../i18n/locales/en/cards.json");
  const interpolate = (value: string, o: Record<string, unknown> = {}) =>
    String(value).replace(/{{\s*(\w+)\s*}}/g, (_m: string, k: string) => (k in o ? String(o[k]) : `{{${k}}}`));
  const t = (key: string, o: Record<string, unknown> = {}) => {
    const leaf = key.includes(":") ? key.split(":")[1] : key;
    return interpolate(cards[leaf] ?? (o.defaultValue as string | undefined) ?? key, o);
  };
  return { useTranslation: () => ({ t, i18n: { language: "en" } }), initReactI18next: {} };
});
jest.mock("react-native-reanimated", () => {
  const R = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: { View: (p: Record<string, unknown>) => R.createElement(View, p) },
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    withTiming: (v: unknown) => v,
    useReducedMotion: () => true,
  };
});

jest.mock("../../../utils/localeUtils", () => ({ getUserLocale: () => "en-US" }));
jest.mock("../../../services/currencyService", () => ({ convertBetween: (a: number) => a, getServableRate: () => null }));
jest.mock("../../../services/countryCurrencyService", () => ({ currencySymbolMap: { USD: "$", NGN: "₦" } }));

let mockForecast: { data: unknown } = { data: null };
let mockViewer: { data: unknown } = { data: null };
jest.mock("../../../hooks/useVenueForecast", () => ({
  useVenueForecast: () => mockForecast,
  venueWeatherKeys: { all: ["venueWeather"], at: () => ["venueWeather"] },
}));
jest.mock("../../../hooks/useUserLocation", () => ({ useUserLocation: () => mockViewer }));
jest.mock("../../../hooks/useLocalePreferences", () => ({ useLocalePreferences: () => ({ currency: "NGN", measurementSystem: "Metric" }) }));
jest.mock("../../../store/appStore", () => ({
  useAppStore: (sel?: (s: { user: { id: string } }) => unknown) => (typeof sel === "function" ? sel({ user: { id: "u1" } }) : { user: { id: "u1" } }),
}));

const { WhenYoudGo, WHEN_CHIP_HIT_SLOP } = require("../WhenYoudGo");
const { EventWhenYoudGo } = require("../EventWhenYoudGo");
const { VenueOnTheDay } = require("../../purchases/VenueOnTheDay");
const { VenueCheckoutWhenLine } = require("../../venueOffers/VenueCheckoutWhenLine");
const { eventWhenChips, initialWhenKey } = require("../whenYoudGoModel");
const { whenChips } = require("../placeSheetModel");
const { WHEN_BLOCK } = require("../spineTokens");
const { rememberHostedEventRow, hostedEventContextFor, clearHostedEventContexts } = require("../hostedEventContext");

type Node = any;
const mounted: any[] = [];
const mount = (el: React.ReactElement) => {
  let root: any = null;
  TestRenderer.act(() => {
    root = TestRenderer.create(el);
  });
  mounted.push(root!);
  return root!;
};
afterEach(() => {
  while (mounted.length > 0) {
    const root = mounted.pop()!;
    TestRenderer.act(() => root.unmount());
  }
  clearHostedEventContexts();
  mockForecast = { data: null };
  mockViewer = { data: null };
});
const isComposite = (n: Node) => typeof n.type !== "string";
const byTestId = (r: { root: Node }, id: string) => r.root.findAll((n: Node) => n.props?.testID === id && isComposite(n));
const texts = (r: { root: Node }) =>
  r.root.findAll((n: Node) => isComposite(n) && typeof n.props?.children === "string").map((n: Node) => n.props.children as string);
const flat = (s: unknown): Record<string, unknown> => (Array.isArray(s) ? Object.assign({}, ...s.map(flat)) : ((s as Record<string, unknown>) ?? {}));

// Tuesday 24 Nov 2026, 11:00 in Lagos.
const NOW = new Date("2026-11-24T10:00:00Z");
const SAT_19 = new Date("2026-11-28T18:00:00Z");
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function hourly7() {
  const out: Record<string, unknown>[] = [];
  for (let d = 0; d < 7; d += 1) {
    const day = new Date(Date.UTC(2026, 10, 24 + d)).toISOString().slice(0, 10);
    for (let h = 0; h < 24; h += 1) {
      out.push({ time: `${day}T${String(h).padStart(2, "0")}:00`, temperature: 80, condition: "Clear", icon: "01d", precipitation: 0, precipitationProbability: 45 });
    }
  }
  return out;
}
const WEATHER = { hourlyForecast: hourly7(), utcOffsetSeconds: 3600 };

describe("#4490 W7 — the sheet block keeps its behaviour (P)", () => {
  const chips = whenChips(NOW, 60, null);
  const base = { chips, onSelect: () => undefined, category: "casual_eats", utcOffsetMinutes: 60, driveTime: "19 min", lat: 6.45, lng: 3.43, clock, weatherUtcOffsetSeconds: 3600, hourly: hourly7(), now: NOW };

  test("P-1 chips, tiles, bars, note and Good to know as before", () => {
    const root = mount(<WhenYoudGo {...base} selected="now" />);
    const t = texts(root);
    expect(t).toEqual(expect.arrayContaining(["When you'd go", "Now", "Tonight 19:00", "Tomorrow 19:00", "Weather", "Crowd", "Drive", "19 min (est.)", "Good to know", "Sunset"]));
    expect(byTestId(root, "sheet-when-crowd")).toHaveLength(1);
    expect(byTestId(root, "sheet-when-bars")).toHaveLength(1);
    expect(texts(root).join(" ")).toMatch(/Crowd is typical for this kind of place, not live\. Drive time is an estimate\./);
    expect(byTestId(root, "sheet-good-leave_by")).toHaveLength(0);
  });

  test("P-2 34 pt chips with a 5 pt slop above and below", () => {
    const root = mount(<WhenYoudGo {...base} selected="now" />);
    const chipNodes = root.root.findAll((n: Node) => isComposite(n) && typeof n.props?.testID === "string" && n.props.testID.startsWith("sheet-when-chip-") && n.props.hitSlop !== undefined);
    expect(chipNodes.length).toBeGreaterThanOrEqual(3);
    for (const c of chipNodes) expect(c.props.hitSlop).toEqual({ top: 5, bottom: 5 });
    expect(WHEN_CHIP_HIT_SLOP).toEqual({ top: 5, bottom: 5 });
    expect(WHEN_BLOCK.chipHeight).toBe(34);
    const styled = root.root.findAll((n: Node) => isComposite(n) && n.props?.testID === "sheet-when-chip-now" && flat(n.props.style).minHeight === 34);
    expect(styled.length).toBeGreaterThan(0);
  });

  test("P-3 a plan on another day reads \"Your plan · Sat 17:00\"; today it keeps the time alone", () => {
    const sat = whenChips(NOW, 60, new Date("2026-11-28T16:00:00Z"));
    expect(texts(mount(<WhenYoudGo {...base} chips={sat} selected="now" />))).toContain("Your plan · Sat 17:00");
    const today = whenChips(NOW, 60, new Date("2026-11-24T16:00:00Z"));
    expect(texts(mount(<WhenYoudGo {...base} chips={today} selected="now" />))).toContain("Your plan · 17:00");
  });
});

describe("#4490 W7 — the event page block (E)", () => {
  const chips = eventWhenChips(NOW, SAT_19);
  const resolveClock = require("../whenYoudGoModel").zoneClock("Africa/Lagos");
  const base = {
    chips,
    onSelect: () => undefined,
    category: null,
    showCrowd: false,
    utcOffsetMinutes: 60,
    resolveClock,
    driveTime: "25 min",
    lat: 6.45,
    lng: 3.43,
    clock,
    weatherUtcOffsetSeconds: 3600,
    hourly: hourly7(),
    now: NOW,
  };

  test("E-1 Now and \"Event · Sat 19:00\", the Event chip selected, no crowd anywhere, Leave by 18:30", () => {
    expect(initialWhenKey(chips)).toBe("event");
    const root = mount(<WhenYoudGo {...base} selected={initialWhenKey(chips)} />);
    const t = texts(root);
    expect(t).toEqual(expect.arrayContaining(["Now", "Event · Sat 19:00", "Weather", "Drive", "25 min (est.)", "Good to know", "Sunset", "Leave by", "18:30"]));
    expect(byTestId(root, "sheet-when-crowd")).toHaveLength(0);
    expect(byTestId(root, "sheet-when-bars")).toHaveLength(0);
    expect(t.join(" ")).not.toMatch(/Crowd|Usually|typical/);
    expect(t.join(" ")).toMatch(/Drive time is an estimate\./);
    const selected = root.root.findAll((n: Node) => isComposite(n) && n.props?.testID === "sheet-when-chip-event" && n.props.accessibilityState?.selected === true);
    expect(selected.length).toBeGreaterThan(0);
  });

  test("E-2 Now carries no Leave by, and the drive is the same on both chips", () => {
    const nowRoot = mount(<WhenYoudGo {...base} selected="now" />);
    expect(byTestId(nowRoot, "sheet-good-leave_by")).toHaveLength(0);
    expect(texts(nowRoot)).toContain("25 min (est.)");
    expect(texts(mount(<WhenYoudGo {...base} selected="event" />))).toContain("25 min (est.)");
  });

  test("E-3 Leave by that has passed reads \"Leave now\"; no drive: no Drive tile and no Leave by", () => {
    const soon = eventWhenChips(NOW, new Date("2026-11-24T10:20:00Z"));
    const leaveNow = mount(<WhenYoudGo {...base} chips={soon} selected="event" />);
    expect(texts(leaveNow)).toContain("Leave now");
    expect(texts(leaveNow)).not.toContain("Leave by");
    const noDrive = mount(<WhenYoudGo {...base} selected="event" driveTime={null} />);
    expect(byTestId(noDrive, "sheet-when-drive")).toHaveLength(0);
    expect(byTestId(noDrive, "sheet-good-leave_by")).toHaveLength(0);
    expect(byTestId(noDrive, "sheet-good-sunset")).toHaveLength(1);
  });

  test("E-4 every row empty: the block is not drawn", () => {
    const empty = mount(<WhenYoudGo {...base} selected="event" hourly={null} driveTime={null} lat={null} lng={null} />);
    expect(empty.toJSON()).toBeNull();
  });

  test("E-5 past the 7 days the Weather tile hides on the Event chip; Drive and Good to know stay", () => {
    const far = eventWhenChips(NOW, new Date("2026-12-05T18:00:00Z"));
    const root = mount(<WhenYoudGo {...base} chips={far} selected="event" />);
    expect(byTestId(root, "sheet-when-weather")).toHaveLength(0);
    expect(byTestId(root, "sheet-when-drive")).toHaveLength(1);
    expect(texts(root)).toContain("Event · Sat 5 Dec 19:00".replace("Sat 5 Dec", "Sat"));
  });
});

describe("#4490 W7 — EventWhenYoudGo only for an event opened from What's on (X)", () => {
  const ROW = { startsAt: SAT_19.toISOString(), href: "/e/gameland/friday-night" };
  const remember = (over: Record<string, unknown> = {}) =>
    rememberHostedEventRow(ROW.href, [ROW], { lat: 6.45, lng: 3.43, timeZone: "Africa/Lagos", driveTime: "25 min", ...over });

  test("X-1 opened from a What's on row: the block draws, Event chip selected, no crowd", () => {
    remember();
    mockForecast = { data: WEATHER };
    const root = mount(<EventWhenYoudGo brandSlug="gameland" eventSlug="friday-night" now={NOW} />);
    expect(byTestId(root, "event-when-you-go")).toHaveLength(1);
    expect(texts(root)).toEqual(expect.arrayContaining(["Now", "Leave by"]));
    expect(texts(root).some((s: string) => /^Event · Sat \d\d:\d\d$/.test(s))).toBe(true);
    expect(byTestId(root, "sheet-when-crowd")).toHaveLength(0);
    expect(byTestId(root, "sheet-when-bars")).toHaveLength(0);
  });

  test("X-1b any other way in draws nothing: no row, another event, an experience or trip row, a row with no start", () => {
    expect(mount(<EventWhenYoudGo brandSlug="gameland" eventSlug="friday-night" now={NOW} />).toJSON()).toBeNull();
    remember();
    expect(mount(<EventWhenYoudGo brandSlug="gameland" eventSlug="other-event" now={NOW} />).toJSON()).toBeNull();
    rememberHostedEventRow("/exp/gameland/paddle", [{ startsAt: SAT_19.toISOString(), href: "/exp/gameland/paddle" }], { lat: 1, lng: 1, timeZone: "Africa/Lagos" });
    rememberHostedEventRow("/t/gameland/trip", [{ startsAt: SAT_19.toISOString(), href: "/t/gameland/trip" }], { lat: 1, lng: 1, timeZone: "Africa/Lagos" });
    expect(hostedEventContextFor("gameland", "paddle")).toBeNull();
    expect(hostedEventContextFor("gameland", "trip")).toBeNull();
    rememberHostedEventRow("/e/gameland/no-start", [{ startsAt: "soon", href: "/e/gameland/no-start" }], { lat: 1, lng: 1 });
    expect(hostedEventContextFor("gameland", "no-start")).toBeNull();
    // a path that is not in the venue's rows is not remembered
    rememberHostedEventRow("/e/gameland/ghost", [ROW], { lat: 1, lng: 1 });
    expect(hostedEventContextFor("gameland", "ghost")).toBeNull();
  });

  test("X-2 an unreadable venue clock draws nothing: no zone and no forecast offset", () => {
    remember({ timeZone: null });
    mockForecast = { data: { hourlyForecast: hourly7(), utcOffsetSeconds: null } };
    expect(mount(<EventWhenYoudGo brandSlug="gameland" eventSlug="friday-night" now={NOW} />).toJSON()).toBeNull();
    // with the forecast's own offset the clock is readable again
    mockForecast = { data: WEATHER };
    expect(byTestId(mount(<EventWhenYoudGo brandSlug="gameland" eventSlug="friday-night" now={NOW} />), "event-when-you-go")).toHaveLength(1);
  });

  test("X-3 no card drive label: the straight-line estimate from where the viewer is", () => {
    remember({ driveTime: null });
    mockForecast = { data: WEATHER };
    mockViewer = { data: { lat: 6.5, lng: 3.4 } };
    const root = mount(<EventWhenYoudGo brandSlug="gameland" eventSlug="friday-night" now={NOW} />);
    expect(texts(root).some((s: string) => /^\d+ min \(est\.\)$/.test(s))).toBe(true);
    mockViewer = { data: null };
    expect(byTestId(mount(<EventWhenYoudGo brandSlug="gameland" eventSlug="friday-night" now={NOW} />), "sheet-when-drive")).toHaveLength(0);
  });
});

describe("#4490 W7 — pass \"On the day\" (O)", () => {
  const venue = { id: "v1", name: "Gameland", slug: "gameland", brandSlug: "gameland", brandName: "Gameland", address: null, city: "Lagos", lat: 6.45, lng: 3.43, timezone: "Africa/Lagos" };
  const booking = (startsAt: string, over: Record<string, unknown> = {}) => ({
    groupId: "g1", reference: "VB-1", state: "confirmed", venue, offer: { id: "o1", name: "Day pass", entryStyle: null },
    window: { localDate: startsAt.slice(0, 10), startsAt, endsAt: new Date(Date.parse(startsAt) + 3 * 3_600_000).toISOString() },
    passes: [], lines: [], hire: null, hour: null, ...over,
  });

  test("O-1 a Saturday booking 4 days out: weather, drive (est.), Leave by; never a crowd", () => {
    mockForecast = { data: WEATHER };
    mockViewer = { data: { lat: 6.5, lng: 3.4 } };
    const root = mount(<VenueOnTheDay booking={booking(SAT_19.toISOString())} now={NOW} />);
    expect(byTestId(root, "venue-on-the-day")).toHaveLength(1);
    const t = texts(root);
    expect(t).toEqual(expect.arrayContaining(["On the day", "Weather", "Drive", "Leave by"]));
    expect(byTestId(root, "venue-on-the-day-weather")).toHaveLength(1);
    expect(byTestId(root, "venue-on-the-day-drive")).toHaveLength(1);
    expect(byTestId(root, "venue-on-the-day-leave")).toHaveLength(1);
    expect(byTestId(root, "venue-on-the-day-forecast-from")).toHaveLength(0);
    expect(t.join(" ")).not.toMatch(/Crowd|Usually|typical/);
    expect(t.join(" ")).toMatch(/27°C/); // 80°F in Metric
  });

  test("O-1b more than 7 days out: \"The forecast shows from Thu 26 Nov\" and no weather tile", () => {
    mockForecast = { data: WEATHER };
    mockViewer = { data: { lat: 6.5, lng: 3.4 } };
    const root = mount(<VenueOnTheDay booking={booking("2026-12-02T18:00:00Z")} now={NOW} />);
    expect(texts(root)).toContain("The forecast shows from Thu 26 Nov");
    expect(byTestId(root, "venue-on-the-day-weather")).toHaveLength(0);
    expect(byTestId(root, "venue-on-the-day-drive")).toHaveLength(1);
  });

  test("O-2 nothing to say: no weather read, no viewer, a started booking, a booking with no readable zone", () => {
    mockForecast = { data: null };
    expect(mount(<VenueOnTheDay booking={booking(SAT_19.toISOString())} now={NOW} />).toJSON()).toBeNull();
    mockForecast = { data: WEATHER };
    mockViewer = { data: { lat: 6.5, lng: 3.4 } };
    expect(mount(<VenueOnTheDay booking={booking("2026-11-24T09:00:00Z")} now={NOW} />).toJSON()).toBeNull();
    expect(mount(<VenueOnTheDay booking={booking(SAT_19.toISOString(), { venue: { ...venue, timezone: null } })} now={NOW} />).toJSON()).toBeNull();
  });
});

describe("#4490 W7 — the checkout line (C), finished but not mounted until W4", () => {
  test("C-1 both chosen: \"Sat 28 Nov, 19:00 · 27°C · 45% rain · Usually packed\"", () => {
    mockForecast = { data: WEATHER };
    const root = mount(<VenueCheckoutWhenLine lat={6.45} lng={3.43} category="casual_eats" day="2026-11-28" time="19:00" />);
    expect(byTestId(root, "venue-checkout-when-line")).toHaveLength(1);
    expect(texts(root)).toContain("Sat 28 Nov, 19:00 · 27°C · 45% rain · Usually packed");
  });

  test("C-2 one of day or time missing: no line; past the forecast: crowd only; nothing to say: no line", () => {
    mockForecast = { data: WEATHER };
    expect(mount(<VenueCheckoutWhenLine lat={6.45} lng={3.43} category="casual_eats" day="2026-11-28" time={null} />).toJSON()).toBeNull();
    expect(mount(<VenueCheckoutWhenLine lat={6.45} lng={3.43} category="casual_eats" day={null} time="19:00" />).toJSON()).toBeNull();
    expect(texts(mount(<VenueCheckoutWhenLine lat={6.45} lng={3.43} category="casual_eats" day="2026-12-05" time="19:00" />))).toContain("Sat 5 Dec, 19:00 · Usually packed");
    expect(mount(<VenueCheckoutWhenLine lat={6.45} lng={3.43} category={null} day="2026-12-05" time="19:00" />).toJSON()).toBeNull();
  });

  test("C-3 it updates as the chips change", () => {
    mockForecast = { data: WEATHER };
    const root = mount(<VenueCheckoutWhenLine lat={6.45} lng={3.43} category="casual_eats" day="2026-11-28" time="19:00" />);
    TestRenderer.act(() => root.update(<VenueCheckoutWhenLine lat={6.45} lng={3.43} category="casual_eats" day="2026-11-29" time="13:00" />));
    expect(texts(root)).toContain("Sun 29 Nov, 13:00 · 27°C · 45% rain · Usually busy");
  });
});

describe("#4490 W7 — wiring pins (S)", () => {
  const ROOT = path.join(__dirname, "../../../..");
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  test("S-1 the event page draws the block in the host's slot, under the Follow row", () => {
    const src = read("src/screens/Event/ConsumerEventDetailScreen.tsx");
    expect(src).toMatch(/<EventWhenYoudGo[\s\S]{0,200}brandSlug=\{seed\.brandSlug\}[\s\S]{0,120}eventSlug=\{seed\.eventSlug\}/);
    expect(src.indexOf("<PresentedByFollowAndMessage")).toBeLessThan(src.indexOf("<EventWhenYoudGo"));
  });

  test("S-2 both What's on doors remember the row before opening it", () => {
    expect(read("app/b/[brandSlug]/v/[venueSlug].tsx")).toMatch(/rememberHostedEventRow\(href, features\?\.events[\s\S]{0,400}router\.push\(href/);
    expect(read("src/components/ExpandedCardModal.tsx")).toMatch(/rememberHostedEventRow\(path, venueFeatures\.features\.events[\s\S]{0,600}leaveSheetTo\(path/);
  });

  test("S-3 the place sheet and the venue Overview still draw the unchanged block (crowd on)", () => {
    expect(read("src/components/ExpandedCardModal.tsx")).not.toMatch(/showCrowd=\{false\}/);
    expect(read("src/components/venuePage/VenueExplorerLayer.tsx")).not.toMatch(/showCrowd=\{false\}/);
    expect(read("src/components/expandedCard/EventWhenYoudGo.tsx")).toMatch(/showCrowd=\{false\}/);
  });

  test("S-4 the pass mounts On the day only for a held booking", () => {
    expect(read("src/components/purchases/VenuePurchaseDetail.tsx")).toMatch(/\{isLive \? <VenueOnTheDay booking=\{booking\} \/> : null\}/);
  });

  // TEST-MOD-APPROVED #4490 (06-W4): W4 mounted the line (its marker's exit);
  // S-5 now pins where: the choose step for Entry, Group and By the hour only.
  test("S-5 the checkout line is mounted on the W4 choose step for Entry, Group and By the hour only", () => {
    const src = read("src/components/venueOffers/VenueCheckoutWhenLine.tsx");
    expect(src).not.toMatch(/\[TRANSITIONAL\]/);
    const choose = read("src/components/venueOffers/VenueCheckoutChoose.tsx");
    const body = (name: string): string => {
      const start = choose.indexOf(`export function ${name}(`);
      const next = choose.indexOf("\nexport function ", start + 1);
      return choose.slice(start, next < 0 ? undefined : next);
    };
    for (const name of ["EntryChoose", "GroupChoose", "HourChoose"]) expect(body(name)).toMatch(/<VenueCheckoutWhenLine /);
    for (const name of ["HireChoose", "PlanChoose"]) expect(body(name)).not.toMatch(/<VenueCheckoutWhenLine /);
    for (const rel of ["src/components/venueOffers/VenueOfferPane.tsx", "src/components/purchases/VenuePurchaseDetail.tsx", "src/components/ExpandedCardModal.tsx"]) {
      expect(read(rel)).not.toMatch(/VenueCheckoutWhenLine/);
    }
  });

  test("S-6 only the approved new strings, in the places the spec names", () => {
    const en = JSON.parse(read("src/i18n/locales/en/cards.json")) as Record<string, string>;
    expect(en["sheet.when_scheduled_day"]).toBe("Your plan · {{day}} {{time}}");
    expect(en["sheet.when_event"]).toBe("Event · {{time}}");
    expect(en["sheet.when_event_day"]).toBe("Event · {{day}} {{time}}");
    expect(en["sheet.leave_by"]).toBe("Leave by");
    expect(en["pass.on_the_day"]).toBe("On the day");
    expect(en["pass.forecast_from"]).toBe("The forecast shows from {{day}}");
  });
});
