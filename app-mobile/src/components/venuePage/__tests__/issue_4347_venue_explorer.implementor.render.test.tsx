/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 4 — the Explorer layer on a host venue page, rendered
 * (implementor happy path).
 *
 *   O-1 "When you'd go" in the host's palette: themed block, forecast at the
 *       chosen hour, "Usually …" crowd and its bars, "Experiences here" rows
 *       with the Part 1 converted price ("≈");
 *   O-2 a palette that fails contrast draws the block on the neutral white card;
 *   O-3 no forecast: the weather row is hidden, the rest stays;
 *   B-1 a reservable venue: Save · Schedule · Share · "Reserve a table", and
 *       Reserve raises the page's own reservation sheet (one owner);
 *   B-2 no reservations: the main button is Directions, by coordinates;
 *   B-3 Save goes through the deck's own save path with the deck card, then
 *       back to the deck;
 *   S-1 the loading / error / not-found Close goes back.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT: drop `colors` from WhenYoudGo's section style (O-1), the
 * `whenColorsPass` fallback (O-2), the reserve branch of the bar (B-1), or
 * `handoff.save` in the bar's Save (B-3) — each fails here.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

jest.mock("react-i18next", () => {
  const cards = require("../../../i18n/locales/en/cards.json");
  const common = require("../../../i18n/locales/en/common.json");
  const details = require("../../../i18n/locales/en/expanded_details.json");
  const interpolate = (value: string, o: Record<string, unknown> = {}) =>
    String(value).replace(/{{\s*(\w+)\s*}}/g, (_m: string, k: string) => (k in o ? String(o[k]) : `{{${k}}}`));
  const nested = (obj: Record<string, unknown>, path: string): string | undefined => {
    const v = path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
    return typeof v === "string" ? v : undefined;
  };
  const t = (key: string, o: Record<string, unknown> = {}) => {
    const [ns, leaf] = key.includes(":") ? key.split(":") : ["cards", key];
    if (ns === "expanded_details") return interpolate(nested(details, leaf) ?? (o.defaultValue as string | undefined) ?? key, o);
    if (ns === "common") return interpolate(nested(common, leaf) ?? common[leaf] ?? key, o);
    const plural = typeof o.count === "number" ? `${leaf}_${o.count === 1 ? "one" : "other"}` : leaf;
    return interpolate(cards[plural] ?? cards[leaf] ?? (o.defaultValue as string | undefined) ?? key, o);
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
jest.mock("../../ui/BaseBottomSheet", () => ({ BaseBottomSheet: () => null }));
jest.mock("../../../utils/breadcrumbs", () => ({ breadcrumbs: { add: jest.fn(), tap: jest.fn() } }));
jest.mock("../../../services/currencyService", () => ({
  convertBetween: (a: number, from: string, to: string) => (from === to ? a : a / 1500),
  // USD-per-unit rates: 1 NGN = 1/1500 USD.
  getServableRate: (code: string) => (code === "USD" ? 1 : code === "NGN" ? 1500 : null),
}));
jest.mock("../../../services/countryCurrencyService", () => ({ currencySymbolMap: { USD: "$", NGN: "₦" } }));
jest.mock("../../../utils/localeUtils", () => ({ getUserLocale: () => "en-US" }));
jest.mock("../../../services/mixpanelService", () => ({ mixpanelService: new Proxy({}, { get: () => jest.fn() }) }));
jest.mock("../../../services/savedCardsService", () => ({ savedCardsService: {} }));
jest.mock("../../../services/calendarService", () => ({ CalendarService: {} }));
jest.mock("@/src/services/deviceCalendarService", () => ({ DeviceCalendarService: {} }), { virtual: true });
jest.mock("../../../store/appStore", () => ({
  useAppStore: (sel?: (s: { user: { id: string } }) => unknown) => (typeof sel === "function" ? sel({ user: { id: "u1" } }) : { user: { id: "u1" } }),
}));
jest.mock("../../../hooks/useCalendarEntries", () => ({ useCalendarEntries: () => ({ data: [] }) }));
jest.mock("@react-native-community/datetimepicker", () => () => null);
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock("expo-calendar", () => ({}));
jest.mock("../../ui/Toast", () => ({ toastManager: { show: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mockWeather }),
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }),
}));
jest.mock("../../../services/weatherService", () => ({ weatherService: { getWeatherForecast: jest.fn() } }));
jest.mock("../../../hooks/useVenueReservable", () => ({ useVenueReservable: () => ({ data: mockReservable }) }));
jest.mock("../../../hooks/useLocalePreferences", () => ({ useLocalePreferences: () => ({ currency: "USD", measurementSystem: "Metric" }) }));
jest.mock("../../../hooks/useVenueExperiences", () => ({ useVenueExperiences: () => ({ data: mockExperiences }) }));
jest.mock("../../../utils/openMapsTarget", () => ({ openMapsTarget: (...args: unknown[]) => mockOpenedMaps.push(args) }));

let mockWeather: unknown = null;
let mockReservable: unknown = null;
let mockExperiences: unknown[] = [];
const mockOpenedMaps: unknown[][] = [];

const { createThemePalette } = require("@mingla/offering-rendering/themePalette");
const { resolveTheme } = require("@mingla/offering-rendering/themeResolver");
const { VenueExplorerOverview, VenueExplorerBar, VenueStateClose } = require("../VenueExplorerLayer");
const { NEUTRAL_WHEN_COLORS, whenColorsFor } = require("../venueExplorerModel");

type Node = import("react-test-renderer").ReactTestInstance;
const mounted: import("react-test-renderer").ReactTestRenderer[] = [];
const mount = (el: React.ReactElement) => {
  let root: import("react-test-renderer").ReactTestRenderer | null = null;
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
});
const isComposite = (n: Node) => typeof n.type !== "string";
// The outermost composite per testID (react-native-web nests several).
const byTestId = (r: { root: Node }, id: string) =>
  r.root.findAll((n: Node) => n.props?.testID === id && isComposite(n) && !(n.parent && n.parent.props?.testID === id));
const texts = (r: { root: Node }) =>
  r.root.findAll((n: Node) => isComposite(n) && typeof n.props?.children === "string").map((n: Node) => n.props.children as string);
const flat = (s: unknown): Record<string, unknown> => (Array.isArray(s) ? Object.assign({}, ...s.map(flat)) : ((s as Record<string, unknown>) ?? {}));

const NOW = new Date("2026-11-08T14:00:00Z");
const HOURLY = Array.from({ length: 72 }, (_, i) => {
  const at = new Date(Date.UTC(2026, 10, 8, i));
  return { time: at.toISOString().slice(0, 16), temperature: 82, weatherCode: 1, precipitation: 0, precipitationProbability: 10, isDay: true };
});

const brandPalette = createThemePalette(resolveTheme({ color: "#eb7825", font: "inter", animation: null }, null));
const context = (palette = brandPalette) => ({
  palette,
  surface: {},
  theme: resolveTheme({ color: "#eb7825", font: "inter", animation: null }, null),
});
const VENUE = {
  name: "Ìtàn Garden",
  address: "14 Bourdillon Rd, Ikoyi",
  lat: 6.4474,
  lng: 3.4339,
  placePoolId: "33333333-3333-4333-8333-333333333333",
  venueCategory: "restaurant",
  hours: [{ weekday: 6, openTime: "12:00", closeTime: "23:00", isClosed: false }],
};
const CARD = { id: VENUE.placePoolId, title: VENUE.name, category: "casual_eats", travelTime: "9 min", utcOffsetMinutes: 0, googlePlaceId: "gp-1" };
const handoff = (save = jest.fn(async () => undefined)) => ({
  placePoolId: VENUE.placePoolId,
  card: CARD,
  currentMode: "solo",
  isSaved: false,
  save,
  canAccessCurated: true,
});
const EXPERIENCE = {
  experience_id: "e1",
  brand_id: "b1",
  brand_slug: "itan-kitchen",
  brand_name: "Ìtàn Kitchen",
  experience_slug: "art-and-supper",
  title: "Lekki Art & Supper Walk",
  description: null,
  cover_media_url: null,
  cover_media_type: null,
  theme: null,
  venue_text: null,
  next_occurrence_at: null,
  price_from_cents: 10000000,
  currency: "NGN",
  is_free: false,
  experience_intents: null,
  stops: [],
};

describe("#4347 wave 4 — the Explorer layer on the host venue page", () => {
  beforeEach(() => {
    mockWeather = { hourlyForecast: HOURLY, utcOffsetSeconds: 0 };
    mockReservable = null;
    mockExperiences = [];
    mockOpenedMaps.length = 0;
  });

  test("O-1 When you'd go in the host palette, with the converted experience price", () => {
    mockExperiences = [EXPERIENCE];
    const r = mount(
      <VenueExplorerOverview context={context()} venue={VENUE} handoff={handoff()} onOpenExperience={jest.fn()} now={NOW} />,
    );
    expect(byTestId(r, "venue-when-themed")).toHaveLength(1);
    const section = byTestId(r, "sheet-when")[0];
    const expected = whenColorsFor(brandPalette).colors;
    expect(flat(section.props.style).backgroundColor).toBe(expected.surface);
    expect(expected.surface).not.toBe(NEUTRAL_WHEN_COLORS.surface);
    const all = texts(r);
    expect(all).toContain("When you'd go");
    expect(byTestId(r, "sheet-when-weather")).toHaveLength(1);
    expect(all.some((s) => s.startsWith("Usually"))).toBe(true);
    expect(all).toContain("9 min (est.)");
    expect(r.root.findAll((n: Node) => n.props?.testID === "sheet-when-bar-active" && isComposite(n)).length).toBeGreaterThanOrEqual(1);
    expect(all).toContain("Experience here");
    expect(all.some((s) => s.includes("≈"))).toBe(true);
  });

  test("O-2 a palette that fails contrast falls back to the neutral white card", () => {
    const grey = {
      ...brandPalette,
      page: "#777777",
      card: "rgba(255,255,255,0.10)",
      primaryText: "#ffffff",
      secondaryText: "rgba(255,255,255,0.78)",
      tertiaryText: "rgba(255,255,255,0.58)",
    };
    const r = mount(<VenueExplorerOverview context={context(grey)} venue={VENUE} handoff={null} onOpenExperience={jest.fn()} now={NOW} />);
    expect(byTestId(r, "venue-when-neutral")).toHaveLength(1);
    expect(flat(byTestId(r, "sheet-when")[0].props.style).backgroundColor).toBe("#FFFFFF");
  });

  test("O-3 no forecast: the weather row is hidden, crowd stays", () => {
    mockWeather = null;
    const r = mount(<VenueExplorerOverview context={context()} venue={VENUE} handoff={null} onOpenExperience={jest.fn()} now={NOW} />);
    expect(byTestId(r, "sheet-when-weather")).toHaveLength(0);
    expect(byTestId(r, "sheet-when-crowd")).toHaveLength(1);
    // No deck card: no drive estimate is invented.
    expect(byTestId(r, "sheet-when-drive")).toHaveLength(0);
  });

  const barContext = (over: Record<string, unknown> = {}) => ({
    ...context(),
    canReserve: true,
    bookingKind: "table",
    reserveAction: "Reserve a table",
    openReservation: jest.fn(),
    ...over,
  });

  test("B-1 reservable: Save, Schedule, Share and Reserve, which opens the page's sheet", () => {
    mockReservable = { reservable: true, brand_id: "b1", venue_id: "v1", currency: "NGN" };
    const ctx = barContext();
    const r = mount(<VenueExplorerBar context={ctx} venue={VENUE} handoff={handoff()} bottomInset={34} onShare={jest.fn()} onLeave={jest.fn()} />);
    expect(byTestId(r, "sheet-action-bar")).toHaveLength(1);
    expect(byTestId(r, "venue-primary-directions")).toHaveLength(0);
    const reserve = byTestId(r, "venue-primary-reserve");
    expect(reserve.length).toBeGreaterThan(0);
    expect(texts(r)).toContain("Reserve a table");
    TestRenderer.act(() => reserve[0].props.onPress());
    expect(ctx.openReservation).toHaveBeenCalledTimes(1);
  });

  test("B-2 no reservations (or the page cannot open its sheet): Directions by coordinates", () => {
    mockReservable = { reservable: true, brand_id: "b1", venue_id: "v1", currency: "NGN" };
    const r = mount(
      <VenueExplorerBar context={barContext({ canReserve: false })} venue={VENUE} handoff={handoff()} bottomInset={0} onShare={jest.fn()} onLeave={jest.fn()} />,
    );
    expect(byTestId(r, "venue-primary-reserve")).toHaveLength(0);
    const directions = byTestId(r, "venue-primary-directions");
    expect(directions.length).toBeGreaterThan(0);
    TestRenderer.act(() => directions[0].props.onPress());
    expect(mockOpenedMaps).toHaveLength(1);
    expect(mockOpenedMaps[0][0]).toEqual({ label: VENUE.address, geo: { lat: VENUE.lat, lng: VENUE.lng } });
  });

  test("B-3 Save uses the deck's save path with the deck card, then goes back", async () => {
    const save = jest.fn(async () => undefined);
    const onLeave = jest.fn();
    const r = mount(<VenueExplorerBar context={barContext()} venue={VENUE} handoff={handoff(save)} bottomInset={0} onShare={jest.fn()} onLeave={onLeave} />);
    const saveButton = r.root.findAll((n: Node) => isComposite(n) && n.props?.accessibilityLabel === "Save" && typeof n.props?.onPress === "function")[0];
    expect(saveButton).toBeDefined();
    await TestRenderer.act(async () => {
      await saveButton.props.onPress();
    });
    expect(save).toHaveBeenCalledWith(CARD);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  test("S-1 the state Close goes back", () => {
    const onPress = jest.fn();
    const r = mount(<VenueStateClose onPress={onPress} topInset={47} />);
    const close = byTestId(r, "venue-state-close")[0];
    expect(close.props.accessibilityLabel).toBe("Close");
    TestRenderer.act(() => close.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
