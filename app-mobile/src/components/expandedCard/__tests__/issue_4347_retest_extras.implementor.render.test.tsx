/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 3 retest extras (implementor happy path).
 *
 *   A-1 (P4) a video in the place gallery can be unmuted again: a translated
 *       "Sound" control on the video page toggles the player's `muted`, and
 *       reads "Mute" once on; a photo page shows no control;
 *   K-1 (P3) the deck's curated smart chip uses the schedule check's
 *       15-minute rule: a stop closing 10 min after arrival is flagged, one
 *       closing 20 min after is not (the tester's Q-4 pins the same).
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT: drop the gallery's sound control or its `muted={muted}`
 * (A-1), or put the chip back on getOpenStatusAt's "closed" only (K-1).
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

jest.mock("react-i18next", () => {
  const cards = require("../../../i18n/locales/en/cards.json");
  const interpolate = (value: string, o: Record<string, unknown> = {}) =>
    String(value).replace(/{{\s*(\w+)\s*}}/g, (_m: string, k: string) => (k in o ? String(o[k]) : `{{${k}}}`));
  const details = require("../../../i18n/locales/en/expanded_details.json");
  const common = require("../../../i18n/locales/en/common.json");
  const nested = (obj: Record<string, unknown>, path: string): string | undefined => {
    const v = path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
    return typeof v === "string" ? v : undefined;
  };
  const t = (key: string, o: Record<string, unknown> = {}) => {
    const [ns, leafRaw] = key.includes(":") ? key.split(":") : ["cards", key];
    const leaf = leafRaw;
    if (ns === "common") return interpolate(common[leaf] ?? key, o);
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
// A plain map-rendering stand-in for the sheet's list: react-native-web's
// VirtualizedList re-arms a wheel-handler timer forever under the test renderer.
jest.mock("../../ui/BaseBottomSheet", () => {
  const { View } = jest.requireActual("react-native");
  const R = jest.requireActual("react");
  return {
    BottomSheetFlatList: R.forwardRef((p: any, _ref: unknown) =>
      R.createElement(View, { testID: p.testID }, p.data.map((item: unknown, index: number) => R.createElement(R.Fragment, { key: p.keyExtractor(item, index) }, p.renderItem({ item, index }))))),
    BaseBottomSheet: (p: { children?: React.ReactNode; visible?: boolean }) => (p.visible ? R.createElement(R.Fragment, null, p.children) : null),
  };
});
jest.mock("react-native-reanimated", () => {
  const R = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: { View: (p: Record<string, unknown>) => R.createElement(View, p) },
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    withTiming: (v: unknown) => v,
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
jest.mock("../../../hooks/useCalendarEntries", () => ({ useCalendarEntries: () => ({ data: mockCalendarEntries }) }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }) }));
jest.mock("@react-native-community/datetimepicker", () => () => null);
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock("expo-calendar", () => ({}), { virtual: true });
jest.mock("../../ui/Toast", () => ({ toastManager: { show: jest.fn(), success: jest.fn(), error: jest.fn() } }));

jest.mock("../../../../../packages/card-identity/phone.mjs", () => ({
  dialablePhone: (phone: string | null) => (phone ? { tel: phone, display: phone } : null),
}));

let mockCalendarEntries: unknown[] = [];

const RN = require("react-native");
const { PlaceGallery } = require("../PlaceGallery");
const { PlaceBasics } = require("../PlaceBasics");
const { WhenYoudGo } = require("../WhenYoudGo");
const ActionButtons = require("../ActionButtons").default;
const { NightOutTicketBar } = require("../EventDetailLayout");
const { sheetGalleryMedia, basicsTiles, whenChips } = require("../placeSheetModel");
const { SHEET_GALLERY, WHEN_BLOCK } = require("../spineTokens");
const CI = require("../../../../../packages/card-identity/index.js");

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
// react-native-web's VirtualizedList arms timers; unmounting clears them so
// the lane exits.
afterEach(() => {
  while (mounted.length > 0) {
    const root = mounted.pop()!;
    TestRenderer.act(() => root.unmount());
  }
});
const isComposite = (n: Node) => typeof n.type !== "string";
const byTestId = (r: { root: Node }, id: string) => r.root.findAll((n: Node) => n.props?.testID === id && isComposite(n));
const texts = (r: { root: Node }) =>
  r.root.findAll((n: Node) => isComposite(n) && typeof n.props?.children === "string").map((n: Node) => n.props.children as string);
const flat = (s: unknown): Record<string, unknown> => (Array.isArray(s) ? Object.assign({}, ...s.map(flat)) : ((s as Record<string, unknown>) ?? {}));


const { curatedSmartChip } = require("../../deckCard/deckCardModel");

describe("#4347 retest extras", () => {
  test("A-1 the gallery video can be unmuted with a translated control", () => {
    const media = sheetGalleryMedia(["https://c/v.mp4", "s1"]);
    const r = mount(<PlaceGallery media={media} title="Nok" onOpen={() => undefined} />);
    const player = () => r.root.find((n: Node) => n.type === "EventCoverMedia");
    expect(player().props.muted).toBe(true);
    const sound = byTestId(r, "sheet-gallery-sound")[0];
    expect(sound).toBeDefined();
    expect(sound.props.accessibilityLabel).toBe("Turn on sound");
    expect(texts(r)).toContain("Sound");
    TestRenderer.act(() => sound.props.onPress());
    expect(player().props.muted).toBe(false);
    expect(byTestId(r, "sheet-gallery-sound")[0].props.accessibilityLabel).toBe("Mute sound");
    expect(texts(r)).toContain("Mute");
    const stills = mount(<PlaceGallery media={sheetGalleryMedia(["s1", "s2"])} title="Nok" onOpen={() => undefined} />);
    expect(byTestId(stills, "sheet-gallery-sound")).toHaveLength(0);
  });

  test("A-2 under Reduce Motion the gallery video waits for Play, then plays (#4347 rework S-4)", () => {
    const media = sheetGalleryMedia(["https://c/v.mp4", "s1"]);
    const r = mount(<PlaceGallery media={media} title="Nok" onOpen={() => undefined} reducedMotion />);
    const player = () => r.root.find((n: Node) => n.type === "EventCoverMedia");
    expect([player().props.autoplay, player().props.playbackActive]).toEqual([false, false]);
    const play = byTestId(r, "sheet-gallery-play")[0];
    expect(play.props.accessibilityLabel).toBe("Play · Nok");
    TestRenderer.act(() => play.props.onPress());
    expect([player().props.autoplay, player().props.playbackActive]).toEqual([true, true]);
    expect(byTestId(r, "sheet-gallery-play")).toHaveLength(0);
    // Without Reduce Motion: plays by itself, no Play button.
    const moving = mount(<PlaceGallery media={media} title="Nok" onOpen={() => undefined} />);
    expect(moving.root.find((n: Node) => n.type === "EventCoverMedia").props.autoplay).toBe(true);
    expect(byTestId(moving, "sheet-gallery-play")).toHaveLength(0);
  });

  test("K-1 the deck chip flags a stop that closes within 15 min of arrival", () => {
    const hours = (close: string) => ({
      weekdayDescriptions: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => `${d}: 8:00 AM – ${close}`),
    });
    const at = new Date("2026-11-13T19:50:00Z"); // 7:50pm venue time (offset 0)
    const stop = (close: string) => [{ openingHours: hours(close), utcOffsetMinutes: 0, travelTimeFromUserMin: 0 }];
    expect(curatedSmartChip(stop("8:00 PM"), at)).toMatchObject({ kind: "stopClosedAtArrival", stopNumber: 1 });
    expect(curatedSmartChip(stop("8:10 PM"), at)).toBeNull();
    expect(curatedSmartChip(stop("6:00 PM"), at)).toMatchObject({ kind: "stopClosedAtArrival" });
  });
});
