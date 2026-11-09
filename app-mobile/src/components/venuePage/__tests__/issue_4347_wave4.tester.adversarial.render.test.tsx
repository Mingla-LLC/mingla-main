/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 4 — TESTER ADVERSARIAL: the Explorer layer's model and bar.
 *
 *   T-1 "When you'd go" against EVERY brand theme in production (read-only
 *       snapshot of public.brands theme_color / theme_gradient, 2026-11-09:
 *       22 distinct themes, one gradient). Each palette is built by the real
 *       resolver, and every pair the block draws is re-measured here with an
 *       independent WCAG 2.x implementation — including the two the model
 *       does not list: the "Experiences here" heading and chevron, which sit
 *       on the PAGE colour, not on the block's surface.
 *   T-2 hostile palettes (3- and 8-digit hex, named colours, hsl, a
 *       translucent page) fall back to the neutral card, never throw.
 *   H-1 the hand-off store: one slot, keyed by place, empty ids never match.
 *   V-1 a double tap on Save calls the deck's save once and leaves once
 *       (pinned, P3).
 *   V-2 a save that fails does not leave the page (no false success).
 *   V-3 Directions with Null Island coordinates goes by the address.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT (verified by the tester in an isolated worktree, see #4347):
 *   - whenColorsFor without the whenColorsPass fallback -> T-2 fails (T-1 is
 *     a live-data check: every production theme passes on its own measures);
 *   - getDeckVenueHandoff without the empty-id guard -> H-1 fails;
 *   - the bar's handleSave calling onLeave before awaiting save -> V-2 fails.
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

const RN = require("react-native");
const { createThemePalette } = require("@mingla/offering-rendering/themePalette");
const { resolveTheme, themeInputFromFields } = require("@mingla/offering-rendering/themeResolver");
const { VenueExplorerBar } = require("../VenueExplorerLayer");
const { NEUTRAL_WHEN_COLORS, whenColorsFor, whenColorPairs, flatten } = require("../venueExplorerModel");
const handoffStore = require("../deckVenueHandoff");

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
  handoffStore.clearDeckVenueHandoff();
});
const isComposite = (n: Node) => typeof n.type !== "string";
const byTestId = (r: { root: Node }, id: string) =>
  r.root.findAll((n: Node) => n.props?.testID === id && isComposite(n) && !(n.parent && n.parent.props?.testID === id));

// ── An independent WCAG 2.x contrast (not the package's contrastRatio) ──────
function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not an opaque #rrggbb: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number];
}
function lum(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Read-only snapshot of production (public.brands, distinct theme rows).
const PROD_THEMES: Array<[string, string | null, string | null]> = [
  ["#553BA1", null, "poppins"], ["#1F5137", null, "fraunces"], ["#ff3d9a", null, "bebas_neue"],
  ["#6D3BFF", null, "unbounded"], ["#1274A6", null, "bebas_neue"], ["#eb7825", null, "poppins"],
  ["#EB7825", null, "poppins"], ["#202226", null, "manrope"], ["#C89B3C", null, "dm_serif_display"],
  ["#E41E21", null, "anton"], ["#eb7825", null, "fraunces"], ["#89CFF0", null, null],
  ["#B68A2C", null, "playfair_display"], ["#2563eb", null, "space_grotesk"], ["#D71985", null, "anton"],
  ["#D36A18", null, "bebas_neue"], ["#17171A", null, "space_grotesk"], ["#1E4E8C", null, "plus_jakarta_sans"],
  ["#2563eb", null, null], ["#8A5A3B", null, "dm_serif_display"], ["#ff8a3b", "#ff8a3b,#ff2e63", "Bricolage Grotesque"],
  ["#6F7750", null, "lora"], ["#0A8F8F", null, "fraunces"],
];

describe("#4347 wave 4 — tester adversarial: the Explorer layer", () => {
  beforeEach(() => {
    mockWeather = null;
    mockReservable = null;
    mockExperiences = [];
    mockOpenedMaps.length = 0;
  });

  test("T-1 every production brand theme: the block is legible on its own surface AND the page", () => {
    const report: string[] = [];
    let themed = 0;
    for (const [color, gradient, font] of PROD_THEMES) {
      const input = themeInputFromFields(color, font, null, gradient);
      const palette = createThemePalette(resolveTheme(input, null));
      const { colors, themed: isThemed } = whenColorsFor(palette);
      if (isThemed) themed += 1;
      const page = flatten(palette.page, "#000000") as string;
      const pairs = [
        ...whenColorPairs(colors).map((p: { name: string; fg: string; bg: string; min: number }) => ({ ...p })),
        // Not in the model's list: the Experiences header and chevron sit on the
        // page (the section has no background of its own when themed).
        ...(isThemed
          ? [
              { name: "experiencesHeading/page", fg: colors.heading, bg: page, min: 4.5 },
              { name: "chevron/page", fg: colors.muted, bg: page, min: 3 },
            ]
          : []),
      ];
      for (const p of pairs) {
        const r = ratio(p.fg, p.bg);
        if (r < p.min) report.push(`${color}${gradient ? " (gradient)" : ""} ${p.name} ${r.toFixed(2)} < ${p.min}`);
      }
    }
    expect(report).toEqual([]);
    // The fallback must not be the common case: most real themes keep their colours.
    expect(themed).toBeGreaterThan(PROD_THEMES.length / 2);
  });

  test("T-2 hostile palettes fall back to the neutral card and never throw", () => {
    const base = createThemePalette(resolveTheme({ color: "#2563eb" }, null));
    for (const over of [
      { page: "#fff" },
      { page: "#ffffff80" },
      { page: "white" },
      { page: "hsl(0, 0%, 100%)" },
      { page: "rgba(255,255,255,0.5)", card: "rgba(0,0,0,0.5)", primaryText: "#888888" },
      { primaryText: "transparent" },
      { card: "" },
    ]) {
      const out = whenColorsFor({ ...base, ...over });
      if (out.themed) {
        for (const p of whenColorPairs(out.colors)) expect([JSON.stringify(over), p.name, ratio(p.fg, p.bg) >= p.min]).toEqual([JSON.stringify(over), p.name, true]);
      } else {
        expect(out.colors).toBe(NEUTRAL_WHEN_COLORS);
      }
    }
    expect(whenColorsFor(null).colors).toBe(NEUTRAL_WHEN_COLORS);
  });

  test("H-1 the hand-off: one slot keyed by place; empty or missing ids never match", () => {
    const entry = (placePoolId: string) => ({ placePoolId, card: { id: placePoolId }, currentMode: "solo", isSaved: false, save: async () => undefined, canAccessCurated: true });
    handoffStore.setDeckVenueHandoff(entry("A"));
    handoffStore.setDeckVenueHandoff(entry("B"));
    expect(handoffStore.getDeckVenueHandoff("A")).toBeNull();
    expect(handoffStore.getDeckVenueHandoff("B")?.card.id).toBe("B");
    handoffStore.setDeckVenueHandoff(entry(""));
    expect(handoffStore.getDeckVenueHandoff("")).toBeNull();
    expect(handoffStore.getDeckVenueHandoff(null)).toBeNull();
    expect(handoffStore.getDeckVenueHandoff(undefined)).toBeNull();
    handoffStore.setDeckVenueHandoff(entry("B"));
    handoffStore.clearDeckVenueHandoff();
    expect(handoffStore.getDeckVenueHandoff("B")).toBeNull();
  });

  const VENUE = {
    name: "Ìtàn Garden",
    address: "14 Bourdillon Rd, Ikoyi",
    lat: 6.4474,
    lng: 3.4339,
    placePoolId: "p-1",
    venueCategory: "restaurant",
    hours: [],
  };
  const CARD = { id: "p-1", title: VENUE.name, category: "casual_eats" };
  const barContext = () => ({
    palette: createThemePalette(resolveTheme({ color: "#eb7825" }, null)),
    surface: {},
    theme: resolveTheme({ color: "#eb7825" }, null),
    canReserve: false,
    bookingKind: "table",
    reserveAction: "Reserve a table",
    openReservation: jest.fn(),
  });
  const saveButton = (r: { root: Node }) =>
    r.root.findAll((n: Node) => isComposite(n) && n.props?.accessibilityLabel === "Save" && typeof n.props?.onPress === "function")[0];

  // P3 (pinned): ActionButtons' isSaving guard is React state, so two taps in
  // one frame both pass it; on the venue page that is two deck saves (two
  // right-swipes / collab votes) and two router.back() calls.
  test.failing("V-1 (P3) a double tap on Save saves once and leaves once", async () => {
    const save = jest.fn(async () => {
      await new Promise((res) => setTimeout(res, 10));
    });
    const onLeave = jest.fn();
    const r = mount(
      <VenueExplorerBar context={barContext()} venue={VENUE} handoff={{ placePoolId: "p-1", card: CARD, currentMode: "solo", isSaved: false, save, canAccessCurated: true }} bottomInset={0} onShare={jest.fn()} onLeave={onLeave} />,
    );
    const b = saveButton(r);
    await TestRenderer.act(async () => {
      // Two taps in the same frame, before the "saving" state has rendered.
      const first = b.props.onPress();
      const second = b.props.onPress();
      await Promise.all([first, second]);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  test("V-2 a save that fails stays on the page", async () => {
    const save = jest.fn(async () => {
      throw new Error("vote failed");
    });
    const onLeave = jest.fn();
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const alert = jest.spyOn(RN.Alert, "alert").mockImplementation(() => undefined);
    const r = mount(
      <VenueExplorerBar context={barContext()} venue={VENUE} handoff={{ placePoolId: "p-1", card: CARD, currentMode: "session-1", isSaved: false, save, canAccessCurated: true }} bottomInset={0} onShare={jest.fn()} onLeave={onLeave} />,
    );
    await TestRenderer.act(async () => {
      await saveButton(r).props.onPress();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
    error.mockRestore();
    alert.mockRestore();
  });

  test("V-3 Directions with Null Island coordinates goes by the address, never to 0,0", () => {
    const r = mount(
      <VenueExplorerBar context={barContext()} venue={{ ...VENUE, lat: 0, lng: 0 }} handoff={{ placePoolId: "p-1", card: CARD, currentMode: "solo", isSaved: false, save: jest.fn(), canAccessCurated: true }} bottomInset={0} onShare={jest.fn()} onLeave={jest.fn()} />,
    );
    TestRenderer.act(() => byTestId(r, "venue-primary-directions")[0].props.onPress());
    expect([byTestId(r, "venue-primary-directions").length, mockOpenedMaps.length, JSON.stringify(mockOpenedMaps[0]?.[0] ?? null)]).toEqual([1, 1, JSON.stringify({ label: VENUE.address, geo: null })]);
  });
});
