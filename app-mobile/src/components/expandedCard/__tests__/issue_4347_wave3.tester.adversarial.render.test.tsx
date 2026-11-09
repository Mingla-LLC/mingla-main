/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 3 + follow-ups — TESTER ADVERSARIAL (rendered).
 *
 * A different angle from issue_4347_plan_sheet_states.implementor.render:
 *
 *   L-1 the plan's route link on iPhone: the follow-up made "Route all stops"
 *       open the WHOLE route on both platforms, so the label must say so
 *       everywhere (the sheet still says "Next stop" on iOS — pinned, P2).
 *   L-2 the route link hands the plan's own travel mode (first leg), not a
 *       default, and the next stop index from the arrival model.
 *   C-1 a start-time change under Reduce Motion: every clock time is the new
 *       value in the SAME commit (no count, no stale frame).
 *   C-2 without Reduce Motion the times COUNT and land exactly on the new
 *       value (driven frame by frame), and a second change mid-count lands on
 *       the latest value.
 *   SW-1 a swap re-times the stops after it, tags ONLY that stop
 *       "Customized", and swapping the original back removes the tag.
 *   SW-2 the swapped-in card enters from the side (swap timing), the others
 *       do not re-enter; under Reduce Motion nothing animates.
 *   N-1 render budget: 2,000 scroll frames re-render the navigator a bounded
 *       number of times, and the PLAN BODY (gallery, warning maths, every
 *       stop card) not at all except for a pulse (pinned, P2: the body
 *       subscribes to the whole scroll snapshot).
 *   N-2 the navigator is untouchable and hidden from screen readers until it
 *       pins, at every scroll position before the route bottom.
 *   B-1 the plan's primary button and the place sheet's share ONE token pair,
 *       at >= 4.5:1, and no #EA580C fill is left on either sheet's buttons.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT (verified by the tester in an isolated worktree, see #4347):
 *   - useCountTo without the `reduced` short-circuit -> C-1 fails;
 *   - useCountTo returning the target at once (no count) -> C-2 fails;
 *   - the swapped-in detection dropped (swappedIn always false) -> SW-2 fails;
 *   - the navigator's pointerEvents gate removed -> N-2 fails;
 *   - CuratedPlanBody's Customized check disabled -> SW-1 fails;
 *   - PINNED_PRIMARY.label back to #FFFFFF on #EB7825 -> B-1 fails.
 */

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
jest.mock("expo-calendar", () => ({}));
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


const { PINNED_PRIMARY } = require("../spineTokens");
const { pinnedPrimaryStyles } = require("../pinnedPrimary");
const React_ = require("react");
const timeOf = (root: { root: Node }, i: number) => textsIn(byTestId(root, `plan-stop-${i}-time`)[0]).join("");

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const [r, g2, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g2 + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("#4347 wave 3 — tester adversarial (rendered)", () => {
  // P2 (pinned): the follow-up routes ALL stops on iPhone too, but the label
  // still reads "Next stop" there (CuratedPlanBody.tsx:501, ExpandedCardModal.tsx:2035/2039).
  test.failing("L-1 (P2) on iPhone the route link says it routes every stop", () => {
    const prev = RN.Platform.OS;
    Object.defineProperty(RN.Platform, "OS", { configurable: true, get: () => "ios" });
    try {
      const root = mount(body().el);
      const link = byTestId(root, "plan-route-all")[0];
      expect(link.props.accessibilityLabel).toBe("Route all stops");
    } finally {
      Object.defineProperty(RN.Platform, "OS", { configurable: true, get: () => prev });
    }
  });

  test("L-2 the route link hands over the plan's own travel mode and the next stop from the arrival model", () => {
    const walking = PLAN.map((s, i) => (i === 0 ? s : { ...s, travelModeFromPreviousStop: "walking" }));
    const { props, el } = body({ stops: walking, originalStops: walking, fallbackMode: "driving", now: new Date("2026-11-14T13:50:00Z") });
    const root = mount(el);
    press(root, "plan-route-all");
    // 13:50Z is 2:50pm Lagos: Cafe Neo (2:00-2:45) is left, Nike Art (2:51) is next.
    expect(props.onRouteAll).toHaveBeenCalledWith(1, "walking");
  });

  test("C-1 Reduce Motion: a start change shows every new time in the same commit", () => {
    // A frame clock that never ticks: anything that counts would stay on the old value.
    const g = globalThis as unknown as Record<string, unknown>;
    const savedRaf = g.requestAnimationFrame;
    const savedCaf = g.cancelAnimationFrame;
    g.requestAnimationFrame = () => 1;
    g.cancelAnimationFrame = () => undefined;
    try {
      const { props, el } = body({ reducedMotion: true });
      const root = mount(el);
      expect(timeOf(root, 2)).toBe("4:36pm");
      TestRenderer.act(() => root.update(<CuratedPlanBody {...props} start={new Date(START.getTime() + 150 * 60_000)} />));
      expect([timeOf(root, 0), timeOf(root, 1), timeOf(root, 2)]).toEqual(["4:30pm", "5:21pm", "7:06pm"]);
      TestRenderer.act(() => root.unmount());
      mounted.pop();
    } finally {
      g.requestAnimationFrame = savedRaf;
      g.cancelAnimationFrame = savedCaf;
    }
  });

  test("C-2 with motion: the times count frame by frame and land exactly on the latest value", () => {
    const frames: Array<() => void> = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const savedRaf = g.requestAnimationFrame;
    const savedCaf = g.cancelAnimationFrame;
    g.requestAnimationFrame = (cb: () => void) => frames.push(cb);
    g.cancelAnimationFrame = () => undefined;
    let clock = 1_000_000;
    const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const { props, el } = body({ reducedMotion: false });
      const root = mount(el);
      TestRenderer.act(() => root.update(<CuratedPlanBody {...props} start={new Date(START.getTime() + 60 * 60_000)} />));
      const drain = (ms: number) => {
        for (let k = 0; k < 40 && frames.length > 0; k += 1) {
          clock += ms;
          const batch = frames.splice(0);
          TestRenderer.act(() => batch.forEach((f) => f()));
        }
      };
      clock += 50;
      const one = frames.splice(0);
      TestRenderer.act(() => one.forEach((f) => f()));
      const mid = timeOf(root, 2);
      expect(mid).not.toBe("4:36pm");
      expect(mid).not.toBe("5:36pm"); // still counting
      // A second change mid-count.
      TestRenderer.act(() => root.update(<CuratedPlanBody {...props} start={new Date(START.getTime() + 90 * 60_000)} />));
      drain(100);
      expect([timeOf(root, 0), timeOf(root, 1), timeOf(root, 2)]).toEqual(["3:30pm", "4:21pm", "6:06pm"]);
    } finally {
      while (mounted.length > 0) {
        const r = mounted.pop()!;
        TestRenderer.act(() => r.unmount());
      }
      now.mockRestore();
      g.requestAnimationFrame = savedRaf;
      g.cancelAnimationFrame = savedCaf;
    }
  });

  test("SW-1 a swap re-times the stops after it, tags only that stop, and swapping back removes the tag", () => {
    const { props, el } = body({ reducedMotion: true });
    const root = mount(el);
    const longer = PLAN.map((s, i) => (i === 1 ? { ...s, placeId: "rele", placeName: "Rele Gallery", estimatedDurationMinutes: 120 } : s));
    TestRenderer.act(() => root.update(<CuratedPlanBody {...props} stops={longer} />));
    expect(textsIn(byTestId(root, "plan-stop-1")[0])).toContain("Customized");
    expect(textsIn(byTestId(root, "plan-stop-0")[0])).not.toContain("Customized");
    expect(textsIn(byTestId(root, "plan-stop-2")[0])).not.toContain("Customized");
    expect(timeOf(root, 1)).toBe("2:51pm"); // the swapped stop arrives when the old one did
    expect(timeOf(root, 2)).toBe("5:06pm"); // 30 min more dwell moves stop 3
    TestRenderer.act(() => root.update(<CuratedPlanBody {...props} stops={PLAN} />));
    expect(texts(root)).not.toContain("Customized");
    expect(timeOf(root, 2)).toBe("4:36pm");
  });

  test("SW-2 only the swapped-in card enters (from the side); Reduce Motion animates nothing", () => {
    const { props, el } = body({ reducedMotion: false });
    const root = mount(el);
    mockTimings.length = 0;
    const swapped = PLAN.map((s, i) => (i === 1 ? { ...s, placeId: "rele", placeName: "Rele Gallery" } : s));
    TestRenderer.act(() => root.update(<CuratedPlanBody {...props} stops={swapped} />));
    // Exactly one card entrance ran, with the swap duration.
    const { PLAN_MOTION } = require("../motionTokens");
    const entrances = mockTimings.filter((m) => Array.isArray(m) && m[0] === "timing" && (m[2] as { duration?: number })?.duration === PLAN_MOTION.swapMs);
    expect(entrances).toHaveLength(1);
    const reduced = body({ reducedMotion: true });
    const r2 = mount(reduced.el);
    mockTimings.length = 0;
    TestRenderer.act(() => r2.update(<CuratedPlanBody {...reduced.props} stops={swapped} />));
    expect(mockTimings).toHaveLength(0);
  });

  // P2 (pinned): CuratedPlanBody calls usePlanScroll(scroll) for the pulse, so
  // every navigator fill / active change re-renders the whole plan body.
  test.failing("N-1 (P2) a long scroll never re-renders the plan body (only the navigator)", () => {
    const store = new PlanScrollStore();
    const commits: Record<string, number> = { body: 0, nav: 0 };
    const onRender = (id: string) => {
      commits[id] = (commits[id] ?? 0) + 1;
    };
    const { props } = body({ scroll: store });
    const navStops = PLAN.map((s, i) => ({ key: String(i), ordinal: i + 1, name: s.placeName }));
    mount(
      <RN.View>
        <React_.Profiler id="body" onRender={onRender}>
          <CuratedPlanBody {...props} />
        </React_.Profiler>
        <React_.Profiler id="nav" onRender={onRender}>
          <PlanStopNavigator store={store} stops={navStops} onJump={jest.fn()} reducedMotion />
        </React_.Profiler>
      </RN.View>,
    );
    TestRenderer.act(() => {
      store.setBodyY(0);
      store.setRouteBottom(600);
      store.setPlanY(900);
      [0, 420, 840].forEach((y, i) => store.setStopY(i, y));
    });
    commits.body = 0;
    commits.nav = 0;
    for (let y = 0; y < 2000; y += 4) TestRenderer.act(() => store.onScroll(y));
    expect(commits.nav).toBeGreaterThan(0);
    expect(commits.nav).toBeLessThanOrEqual(30);
    expect(commits.body).toBe(0);
  });

  test("N-2 before it pins the navigator takes no touch and is hidden from screen readers at every position", () => {
    const store = new PlanScrollStore();
    const navStops = PLAN.map((s, i) => ({ key: String(i), ordinal: i + 1, name: s.placeName }));
    const root = mount(<PlanStopNavigator store={store} stops={navStops} onJump={jest.fn()} reducedMotion />);
    TestRenderer.act(() => {
      store.setBodyY(200);
      store.setRouteBottom(400);
      store.setStopCount(3);
    });
    for (let y = 0; y <= 589; y += 31) {
      TestRenderer.act(() => store.onScroll(y));
      const bar = byTestId(root, "plan-navigator")[0];
      expect([y, bar.props.pointerEvents, bar.props.importantForAccessibility, bar.props.accessibilityElementsHidden]).toEqual([y, "none", "no-hide-descendants", true]);
    }
    TestRenderer.act(() => store.onScroll(600));
    expect(byTestId(root, "plan-navigator")[0].props.pointerEvents).toBe("auto");
    TestRenderer.act(() => store.reset());
    expect(byTestId(root, "plan-navigator")[0].props.pointerEvents).toBe("none");
  });

  test("B-1 one primary token pair at >= 4.5:1; no #EA580C button fill left on either sheet", () => {
    expect(contrast(PINNED_PRIMARY.fill, PINNED_PRIMARY.label)).toBeGreaterThanOrEqual(4.5);
    expect(RN.StyleSheet.flatten(pinnedPrimaryStyles.button).backgroundColor).toBe(PINNED_PRIMARY.fill);
    expect(RN.StyleSheet.flatten(pinnedPrimaryStyles.label).color).toBe(PINNED_PRIMARY.label);
    const root = mount(
      <ActionButtons
        variant="pinned"
        card={{ id: "plan-1", cardType: "curated", title: "Plan", stops: PLAN } as never}
        onSave={jest.fn()}
        primaryScheduleLabel="Schedule this plan"
        reserve={null}
      />,
    );
    const schedule = byTestId(root, "sheet-primary-schedule")[0];
    expect(RN.StyleSheet.flatten(schedule.props.style).backgroundColor).toBe(PINNED_PRIMARY.fill);
    const fs = require("fs");
    const path = require("path");
    for (const rel of ["../../ExpandedCardModal.tsx", "../ActionButtons.tsx", "../CuratedPlanBody.tsx", "../PlanSections.tsx", "../PlanStopCard.tsx", "../PlanSummary.tsx"]) {
      const src = fs.readFileSync(path.join(__dirname, rel), "utf8");
      expect([rel, /backgroundColor:\s*["']#ea580c["']/i.test(src)]).toEqual([rel, false]);
    }
  });
});
