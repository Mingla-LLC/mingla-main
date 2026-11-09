/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 retest extras — TESTER ADVERSARIAL: the place gallery's Sound control.
 *
 *   S-1 the choice survives an unrelated sheet re-render (same photos), and a
 *       NEW gallery (another card in review mode) starts muted again;
 *   S-2 the control is a real toggle for assistive tech: role button, its
 *       checked state follows the sound, the label says the next action;
 *   S-3 paging away to a still hides the control; paging back shows it with
 *       the choice kept;
 *   S-4 Reduce Motion: the video does not start playing by itself — was pinned (P3), fixed in the rework
 *       (autoplay ignores reducedMotion; the place sheet passes it in);
 *   S-5 every new key is in all 29 locales, placeholders match, and
 *       "Experiences here" has every plural category each language needs.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT (verified by the tester in an isolated worktree, see #4347):
 *   - the setMuted(true) reset on a content change removed -> S-1 fails;
 *   - the accessibilityState dropped from the control -> S-2 fails.
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
  const nested = (obj: Record<string, unknown>, path: string): string | undefined => {
    const v = path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
    return typeof v === "string" ? v : undefined;
  };
  const t = (key: string, o: Record<string, unknown> = {}) => {
    const [ns, leafRaw] = key.includes(":") ? key.split(":") : ["cards", key];
    const leaf = leafRaw;
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
jest.mock("expo-calendar", () => ({}));
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

const fs = require("fs");
const path = require("path");

const player = (r: { root: Node }) => r.root.find((n: Node) => n.type === "EventCoverMedia");
const sound = (r: { root: Node }) => byTestId(r, "sheet-gallery-sound")[0];
const VIDEO = "https://c/v.mp4";

describe("#4347 gallery Sound — tester adversarial", () => {
  test("S-1 a re-render keeps the choice; another card's gallery starts muted", () => {
    const media = sheetGalleryMedia([VIDEO, "s1"]);
    const onOpen = () => undefined;
    const r = mount(<PlaceGallery media={media} title="Nok" onOpen={onOpen} />);
    TestRenderer.act(() => sound(r).props.onPress());
    expect(player(r).props.muted).toBe(false);
    // Same photos, a NEW array (the sheet rebuilds media every render).
    TestRenderer.act(() => r.update(<PlaceGallery media={sheetGalleryMedia([VIDEO, "s1"])} title="Nok" onOpen={onOpen} />));
    expect(player(r).props.muted).toBe(false);
    // Review mode: the next card, same mounted gallery.
    TestRenderer.act(() => r.update(<PlaceGallery media={sheetGalleryMedia(["https://c/other.mp4", "s9"])} title="Other" onOpen={onOpen} />));
    expect(player(r).props.muted).toBe(true);
    expect(sound(r).props.accessibilityLabel).toBe("Turn on sound");
  });

  test("S-2 an accessible toggle: role, checked state and the next action", () => {
    const r = mount(<PlaceGallery media={sheetGalleryMedia([VIDEO])} title="Nok" onOpen={() => undefined} />);
    const before = sound(r);
    expect(before.props.accessibilityRole).toBe("button");
    expect(before.props.accessibilityState).toEqual({ checked: false });
    TestRenderer.act(() => before.props.onPress());
    TestRenderer.act(() => sound(r).props.onPress());
    TestRenderer.act(() => sound(r).props.onPress());
    expect(sound(r).props.accessibilityState).toEqual({ checked: true });
    expect(sound(r).props.accessibilityLabel).toBe("Mute sound");
    expect(player(r).props.muted).toBe(false);
  });

  test("S-3 paging to a still hides the control; paging back keeps the choice", () => {
    const r = mount(<PlaceGallery media={sheetGalleryMedia([VIDEO, "s1", "s2"])} title="Nok" onOpen={() => undefined} />);
    TestRenderer.act(() => sound(r).props.onPress());
    const pager = r.root.findAll((n: Node) => isComposite(n) && typeof n.props?.onMomentumScrollEnd === "function")[0];
    expect(pager).toBeDefined();
    TestRenderer.act(() => pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 780 } } }));
    expect(byTestId(r, "sheet-gallery-sound")).toHaveLength(0);
    TestRenderer.act(() => pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } }));
    expect(sound(r).props.accessibilityLabel).toBe("Mute sound");
    expect(player(r).props.muted).toBe(false);
  });

  // P3 (was pinned; fixed in the wave 4 rework): PlaceGallery takes reducedMotion but autoplay={active && index === 0}.
  test("S-4 (P3) under Reduce Motion the gallery video does not start by itself", () => {
    const r = mount(<PlaceGallery media={sheetGalleryMedia([VIDEO])} title="Nok" onOpen={() => undefined} reducedMotion />);
    expect(player(r).props.autoplay).toBe(false);
  });

  test("S-5 the new keys in all 29 locales: present, same placeholders, every plural category", () => {
    const root = path.join(__dirname, "../../../i18n/locales");
    const locales = fs.readdirSync(root).filter((d: string) => fs.statSync(path.join(root, d)).isDirectory());
    expect(locales).toHaveLength(29);
    const en = JSON.parse(fs.readFileSync(path.join(root, "en/cards.json"), "utf8"));
    const ph = (v: unknown) => (String(v).match(/{{\s*\w+\s*}}/g) ?? []).map((x) => x.replace(/\s/g, "")).sort().join(",");
    const problems: string[] = [];
    for (const l of locales) {
      const j = JSON.parse(fs.readFileSync(path.join(root, l, "cards.json"), "utf8"));
      for (const k of ["sheet.sound", "sheet.mute", "sheet.sound_on_a11y", "sheet.sound_off_a11y"]) {
        if (typeof j[k] !== "string" || j[k].trim() === "") problems.push(`${l} missing ${k}`);
        else if (ph(j[k]) !== ph(en[k])) problems.push(`${l} placeholders ${k}`);
      }
      let cats: string[] = ["one", "other"];
      try {
        cats = new Intl.PluralRules(l === "bin" ? "en" : l).resolvedOptions().pluralCategories as string[];
      } catch {
        /* unknown to Intl: English rules */
      }
      for (const c of cats) {
        // "many" in es/fr/it/pt is only for millions; a venue never has that many experiences.
        if (c === "many" && ["es", "fr", "it", "pt"].includes(l)) continue;
        const k = `venue_page.experiences_here_${c}`;
        if (typeof j[k] !== "string") problems.push(`${l} missing ${k}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
