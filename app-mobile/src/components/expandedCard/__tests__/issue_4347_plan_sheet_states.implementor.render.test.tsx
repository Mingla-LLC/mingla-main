/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 3 — the expanded curated plan's states, RENDERED (implementor
 * happy path), from the spec's curated state table:
 *
 *   P-1 happy path: gallery tagged by stop, the four tiles, the route strip,
 *       stop cards with clock times and chips, legs, conditions, getting
 *       there, ends near
 *   P-2 no photo: the short neutral header
 *   P-3 start time changed: the picker, and every time / chip moves
 *   P-4 stop closed at arrival: the red chip and ONE warning with its fixes
 *   P-5 rain on an outdoor stop: the warning and the rain chip
 *   P-6 optional / shop stop: tags, no number
 *   P-7 swapped stop: "Customized" on that stop only, and the swap grid slot
 *   P-8 no location: no "You ->" row
 *   P-9 forecast unavailable: no weather chips, conditions show crowd only
 *   P-10 host experience: no Swap
 *   P-11 large text: the tiles stack
 *   P-12 reduce motion: the route and cards are drawn in place (no timing)
 *   P-13 the sticky navigator: hidden at the top, shown past the route, tap
 *        jumps
 *   P-14 locked plan: Save and Schedule this plan open the paywall
 *   P-15 collab: the plan bar keeps Save / Route all stops / Share / Schedule
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT (verified by deleting the fix line): the time column reading
 * the plan start instead of each arrival (P-3), the warning's start fix
 * (P-4), the Customized tag comparing the original plan (P-7), the "You ->"
 * row's location guard (P-8), the swap gate for host experiences (P-10), the
 * fontScale stack (P-11), the Reduce Motion start value (P-12), the
 * navigator's pointerEvents gate (P-13), the schedule CTA's paywall (P-14).
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

jest.mock("react-i18next", () => {
  const cards = require("../../../i18n/locales/en/cards.json");
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
    const plural = typeof o.count === "number" ? `${leaf}_${o.count === 1 ? "one" : "other"}` : leaf;
    return interpolate(cards[plural] ?? cards[leaf] ?? (o.defaultValue as string | undefined) ?? key, o);
  };
  return { useTranslation: () => ({ t, i18n: { language: "en" } }), initReactI18next: {} };
});
jest.mock("expo-image", () => {
  const R = jest.requireActual("react");
  return { Image: (p: Record<string, unknown>) => R.createElement("ExpoImage", p) };
});
jest.mock("@mingla/offering-rendering", () => {
  const R = jest.requireActual("react");
  return { EventCoverMedia: (p: Record<string, unknown>) => R.createElement("EventCoverMedia", p) };
});
jest.mock("../../ui/BaseBottomSheet", () => {
  const { View } = jest.requireActual("react-native");
  const R = jest.requireActual("react");
  return {
    BottomSheetFlatList: R.forwardRef((p: any, _ref: unknown) =>
      R.createElement(View, { testID: p.testID }, p.data.map((item: unknown, index: number) => R.createElement(R.Fragment, { key: p.keyExtractor(item, index) }, p.renderItem({ item, index }))))),
    BaseBottomSheet: (p: { children?: React.ReactNode; visible?: boolean }) => (p.visible ? R.createElement(R.Fragment, null, p.children) : null),
  };
});
// Reanimated as plain values: a shared value is a box, timing functions leave a
// visible marker, so a test can tell an animated value from a drawn one.
const mockTimings: unknown[] = [];
jest.mock("react-native-reanimated", () => {
  const R = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  const marker = (kind: string) => (...args: unknown[]) => {
    mockTimings.push([kind, ...args]);
    return { __anim: kind, to: args[0] };
  };
  const chain = { duration: () => chain };
  return {
    __esModule: true,
    default: { View: R.forwardRef((p: Record<string, unknown>, _r: unknown) => R.createElement(View, p)) },
    useSharedValue: (v: unknown) => R.useRef({ value: v }).current,
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    withTiming: marker("timing"),
    withDelay: (_d: number, v: unknown) => v,
    withSequence: (...v: unknown[]) => v[0],
    Easing: { bezier: () => (x: number) => x },
    FadeOut: chain,
    FadeIn: chain,
    LinearTransition: chain,
    useReducedMotion: () => false,
  };
});
jest.mock("../../../utils/breadcrumbs", () => ({ breadcrumbs: { add: jest.fn(), tap: jest.fn() } }));
jest.mock("../../../services/currencyService", () => ({ convertBetween: (a: number) => a, getServableRate: () => null }));
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
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }) }));
jest.mock("@react-native-community/datetimepicker", () => () => null);
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock("expo-calendar", () => ({}), { virtual: true });
jest.mock("../../ui/Toast", () => ({ toastManager: { show: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../InAppBrowserProvider", () => ({ useOpenInMingla: () => jest.fn() }));
jest.mock("../../../hooks/useIsPlaceOpen", () => ({ useIsPlaceOpen: () => null }));
jest.mock("../../../services/weatherService", () => ({ weatherService: { getWeatherForecast: jest.fn(() => Promise.resolve(null)) } }));
jest.mock("../../../../../packages/card-identity/phone.mjs", () => ({
  dialablePhone: (phone: string | null) => (phone ? { tel: phone, display: phone } : null),
}));

const RN = require("react-native");
const { CuratedPlanBody } = require("../CuratedPlanBody");
const { PlanStopNavigator } = require("../PlanStopNavigator");
const { PlanScrollStore } = require("../planScroll");
const ActionButtons = require("../ActionButtons").default;

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
  mockTimings.length = 0;
});
const isComposite = (n: Node) => typeof n.type !== "string";
const byTestId = (r: { root: Node }, id: string) => r.root.findAll((n: Node) => n.props?.testID === id && isComposite(n));
const textsIn = (n: Node) => n.findAll((x: Node) => isComposite(x) && typeof x.props?.children === "string").map((x: Node) => x.props.children as string);
const texts = (r: { root: Node }) => textsIn(r.root);
const has = (r: { root: Node }, id: string): boolean => byTestId(r, id).length > 0;
const press = (r: { root: Node }, id: string) =>
  TestRenderer.act(() => byTestId(r, id).find((n: Node) => typeof n.props.onPress === "function")!.props.onPress());

const OFFSET = 60;
const week = (line: string) => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => `${d}: ${line}`);
const stop = (over: Record<string, unknown>) => ({
  stopNumber: 1,
  stopLabel: "Then",
  placeId: String(over.placeName).toLowerCase().replace(/\s+/g, "-"),
  placeType: "casual_eats",
  address: `${over.placeName} street`,
  rating: 4.5,
  reviewCount: 10,
  imageUrl: `https://cdn/${String(over.placeName).replace(/\s/g, "")}.jpg`,
  imageUrls: [],
  priceLevelLabel: "",
  priceTier: "comfy",
  priceMin: 10,
  priceMax: 20,
  openingHours: { weekdayDescriptions: week("8:00 AM – 11:00 PM") },
  utcOffsetMinutes: OFFSET,
  isOpenNow: true,
  website: null,
  lat: 6.45,
  lng: 3.43,
  distanceFromUserKm: 3,
  travelTimeFromUserMin: 12,
  travelTimeFromPreviousStopMin: null,
  travelModeFromPreviousStop: "driving",
  aiDescription: "",
  estimatedDurationMinutes: 45,
  ...over,
});
const PLAN = [
  stop({ placeName: "Cafe Neo", estimatedDurationMinutes: 45 }),
  stop({ placeName: "Nike Art", estimatedDurationMinutes: 90, travelTimeFromPreviousStopMin: 6 }),
  stop({ placeName: "Freedom Park", placeType: "nature", comboCategory: "nature", estimatedDurationMinutes: 60, travelTimeFromPreviousStopMin: 15 }),
];
const START = new Date("2026-11-14T13:00:00Z"); // 2pm Lagos
const NOW = new Date("2026-11-14T11:00:00Z");
function forecast(rainHours: number[] = []) {
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    time: `2026-11-14T${String(h).padStart(2, "0")}:00`,
    temperature: 86,
    condition: rainHours.includes(h) ? "Rain" : "Clouds",
    icon: rainHours.includes(h) ? "10d" : "04d",
    precipitation: rainHours.includes(h) ? 0.1 : 0,
    precipitationProbability: rainHours.includes(h) ? 80 : 10,
  }));
  return { hourly, utcOffsetSeconds: OFFSET * 60 };
}

function body(over: Record<string, unknown> = {}) {
  const props = {
    title: "A slow Saturday in Ikoyi",
    kicker: "Curated plan",
    tagline: "Coffee, art, a park",
    stops: PLAN,
    originalStops: PLAN,
    isBrandExperience: false,
    start: START,
    onStartChange: jest.fn(),
    now: NOW,
    viewer: { lat: 6.5, lng: 3.4 },
    fallbackMode: "driving",
    measurementSystem: "Imperial",
    spend: { value: "Moderate", sub: null },
    supplies: [],
    suppliesPurposeLine: null,
    reducedMotion: true,
    active: true,
    onClose: jest.fn(),
    closeLabel: "Close",
    onOpenLightbox: jest.fn(),
    onDirections: jest.fn(),
    onRouteAll: jest.fn(),
    onSwap: jest.fn(),
    swapPanel: () => null,
    onCall: jest.fn(),
    onWebsite: jest.fn(),
    scroll: new PlanScrollStore(),
    onJump: jest.fn(),
    forecastsOverride: PLAN.map(() => forecast()),
    ...over,
  };
  return { props, el: <CuratedPlanBody {...props} /> };
}

describe("#4347 wave 3 — the expanded curated plan", () => {
  test("P-1 happy path: gallery tagged by stop, tiles, route, timed stop cards, conditions, getting there, ends near", () => {
    const root = mount(body().el);
    expect(has(root, "sheet-gallery-tag")).toBe(true);
    expect(texts(root)).toContain("Stop 1 · Cafe Neo");
    expect(texts(root)).toContain("1 / 3");
    expect(byTestId(root, "plan-tile-starts-value")[0].props.children).toBe("2pm · ends ~5:36pm");
    expect(byTestId(root, "plan-tile-travel-value")[0].props.children).toMatch(/^\d+ min by car$/);
    expect(byTestId(root, "plan-tile-spend-value")[0].props.children).toBe("Moderate");
    expect(byTestId(root, "plan-tile-stops-value")[0].props.children).toBe("3 · 3h 36m");
    expect(has(root, "plan-route-stop-2")).toBe(true);
    expect(textsIn(byTestId(root, "plan-stop-1-time")[0]).join("")).toBe("2:51pm");
    expect(texts(root)).toContain("Open until 11pm");
    expect(texts(root).some((x) => /^Usually (quiet|steady|busy|packed) then$/.test(x))).toBe(true);
    expect(texts(root).some((s) => /^☁ 86°F at 2:51pm$/.test(s))).toBe(true);
    expect(texts(root)).toContain("6 min by car · estimated");
    expect(has(root, "plan-conditions")).toBe(true);
    expect(texts(root)).toContain("Weather is the forecast for each arrival time. Crowd is typical, not live.");
    expect(has(root, "plan-leg-you")).toBe(true);
    expect(texts(root)).toContain("Freedom Park, Freedom Park street · around 5:36pm");
    expect(has(root, "plan-warning")).toBe(false);
  });

  test("P-2 no photo: the short neutral header", () => {
    const stops = PLAN.map((s) => ({ ...s, imageUrl: "", imageUrls: [] }));
    const root = mount(body({ stops, originalStops: stops }).el);
    expect(has(root, "sheet-gallery-empty")).toBe(true);
  });

  test("P-3 start time changed: the picker opens, a pick reports it, and every time moves", () => {
    const { props, el } = body();
    const root = mount(el);
    press(root, "plan-tile-starts");
    expect(has(root, "plan-start-picker")).toBe(true);
    const option = root.root.findAll((n: Node) => isComposite(n) && /^plan-start-option-/.test(String(n.props?.testID)) && typeof n.props.onPress === "function")[2];
    TestRenderer.act(() => option.props.onPress());
    expect(props.onStartChange).toHaveBeenCalledTimes(1);
    const later = new Date(START.getTime() + 60 * 60_000);
    TestRenderer.act(() => root.update(<CuratedPlanBody {...props} start={later} />));
    expect(textsIn(byTestId(root, "plan-stop-0-time")[0]).join("")).toBe("3pm");
    expect(textsIn(byTestId(root, "plan-stop-1-time")[0]).join("")).toBe("3:51pm");
    expect(texts(root).some((s) => /86°F at 3:51pm/.test(s))).toBe(true);
  });

  test("P-4 stop closed at arrival: the red chip and ONE warning with Swap and Start-at fixes", () => {
    const stops = PLAN.map((s, i) => (i === 1 ? { ...s, openingHours: { weekdayDescriptions: week("10:00 AM – 2:30 PM") } } : s));
    const { props, el } = body({ stops, originalStops: stops });
    const root = mount(el);
    expect(texts(root)).toContain("Closed at 2:51pm");
    expect(has(root, "plan-warning")).toBe(true);
    expect(texts(root)).toContain("Nike Art is closed when you arrive at 2:51pm.");
    press(root, "plan-warning-fix-swap");
    expect(props.onSwap).toHaveBeenCalledWith(1);
    expect(props.onJump).toHaveBeenCalledWith(1);
    press(root, "plan-warning-fix-start");
    const picked = (props.onStartChange as jest.Mock).mock.calls[0][0] as Date;
    expect(picked.getTime()).toBeLessThan(START.getTime());
  });

  test("P-5 rain on an outdoor stop: the warning and the rain chip", () => {
    const root = mount(body({ forecastsOverride: PLAN.map(() => forecast([16, 17])) }).el);
    expect(has(root, "plan-warning")).toBe(true);
    expect(texts(root)).toContain("Rain likely around 4:36pm. Stop 3, Freedom Park, is outdoors.");
    expect(texts(root).some((s) => /at 4:36pm · rain likely$/.test(s))).toBe(true);
  });

  test("P-6 optional and shop stops: tagged, the optional one unnumbered", () => {
    const stops = [
      stop({ placeName: "Grocer", comboCategory: "groceries", placeType: "groceries" }),
      stop({ placeName: "Petals", optional: true, travelTimeFromPreviousStopMin: 4 }),
      stop({ placeName: "Park", placeType: "nature", travelTimeFromPreviousStopMin: 5 }),
    ];
    const root = mount(body({ stops, originalStops: stops, forecastsOverride: [null, null, null] }).el);
    expect(textsIn(byTestId(root, "plan-stop-0")[0])).toContain("SHOP");
    // #4347 round 2 — an unnumbered stop is labelled "Add-on".
    expect(textsIn(byTestId(root, "plan-stop-1")[0])).toContain("Add-on");
    expect(textsIn(byTestId(root, "plan-stop-1")[0]).some((s) => /^Stop \d/.test(s))).toBe(false);
    expect(textsIn(byTestId(root, "plan-stop-2")[0])).toContain("Stop 2");
    expect(byTestId(root, "plan-tile-stops-value")[0].props.children).toMatch(/^2 · /);
  });

  test("P-7 swapped stop: 'Customized' on that stop only; the swap grid renders in its card", () => {
    const swapped = PLAN.map((s, i) => (i === 1 ? { ...s, placeId: "new-gallery", placeName: "Rele Gallery" } : s));
    const RNText = RN.Text;
    const root = mount(body({ stops: swapped, swapPanel: (i: number) => (i === 1 ? <RNText>GRID</RNText> : null) }).el);
    expect(textsIn(byTestId(root, "plan-stop-1")[0])).toEqual(expect.arrayContaining(["Customized", "GRID"]));
    expect(textsIn(byTestId(root, "plan-stop-0")[0])).not.toContain("Customized");
  });

  test("P-8 no location: no 'You ->' row; stop-to-stop legs still shown", () => {
    const root = mount(body({ viewer: null }).el);
    expect(has(root, "plan-leg-you")).toBe(false);
    expect(has(root, "plan-leg-1")).toBe(true);
  });

  test("P-9 forecast unavailable: no weather chip or warning; the conditions keep the crowd", () => {
    const root = mount(body({ forecastsOverride: [null, null, null] }).el);
    expect(has(root, "plan-stop-0-chip-weather")).toBe(false);
    expect(has(root, "plan-warning")).toBe(false);
    const row = textsIn(byTestId(root, "plan-conditions-row-0")[0]);
    expect(row[1]).toMatch(/^(quiet|steady|busy|packed)$/);
  });

  test("P-10 host experience: no Swap on any stop", () => {
    const root = mount(body({ isBrandExperience: true }).el);
    expect(root.root.findAll((n: Node) => isComposite(n) && /^plan-stop-\d-swap$/.test(String(n.props?.testID))).length).toBe(0);
    expect(has(root, "plan-stop-0-directions")).toBe(true);
  });

  test("P-11 large text: the tiles stack to one column", () => {
    const spy = jest.spyOn(RN, "useWindowDimensions").mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1.3 });
    const root = mount(body().el);
    expect(has(root, "plan-tiles-stacked")).toBe(true);
    spy.mockRestore();
  });

  test("P-12 reduce motion: the route and stop cards are drawn in place, no timing runs", () => {
    mockTimings.length = 0;
    mount(body({ reducedMotion: true }).el);
    expect(mockTimings).toHaveLength(0);
    mount(body({ reducedMotion: false }).el);
    expect(mockTimings.length).toBeGreaterThan(0);
  });

  test("P-13 the navigator: hidden and untouchable at the top, shown past the route, a tap jumps", () => {
    const store = new PlanScrollStore();
    const onJump = jest.fn();
    const stops = PLAN.map((s, i) => ({ key: String(i), ordinal: i + 1, name: s.placeName }));
    const root = mount(<PlanStopNavigator store={store} stops={stops} onJump={onJump} reducedMotion />);
    expect(byTestId(root, "plan-navigator")[0].props.pointerEvents).toBe("none");
    TestRenderer.act(() => {
      store.setRouteBottom(400);
      store.setStopCount(3);
      store.onScroll(450);
    });
    expect(byTestId(root, "plan-navigator")[0].props.pointerEvents).toBe("auto");
    press(root, "plan-navigator-stop-2");
    expect(onJump).toHaveBeenCalledWith(2);
  });

  test("P-14 locked plan: Save and 'Schedule this plan' open the paywall", async () => {
    const onPaywallRequired = jest.fn();
    const onSave = jest.fn();
    const root = mount(
      <ActionButtons
        variant="pinned"
        card={{ id: "plan-1", cardType: "curated", title: "Plan", stops: PLAN } as never}
        onSave={onSave}
        canAccessCurated={false}
        onPaywallRequired={onPaywallRequired}
        primaryScheduleLabel="Schedule this plan"
        reserve={null}
      />,
    );
    press(root, "sheet-primary-schedule");
    const save = root.root.findAll((n: Node) => isComposite(n) && n.props?.accessibilityLabel === "Save" && typeof n.props?.onPress === "function")[0];
    await TestRenderer.act(async () => {
      await save.props.onPress();
    });
    expect(onPaywallRequired).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });

  test("P-15 collab: the plan bar keeps Save, Route all stops, Share and Schedule this plan", () => {
    const RNText = RN.Text;
    const RNView = RN.View;
    const root = mount(
      <RNView>
      <ActionButtons
        variant="pinned"
        card={{ id: "plan-1", cardType: "curated", title: "Plan", stops: PLAN } as never}
        onSave={jest.fn()}
        currentMode="session-123"
        onShare={jest.fn()}
        shareLabel="Share Plan"
        primaryScheduleLabel="Schedule this plan"
        afterSave={<RNText>Route all stops</RNText>}
        reserve={null}
      />
      </RNView>,
    );
    const all = texts(root);
    expect(all).toEqual(expect.arrayContaining(["Save", "Route all stops", "Share", "Schedule this plan"]));
    expect(all).not.toContain("Schedule");
  });
});
