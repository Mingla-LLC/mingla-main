/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 2 — TESTER ADVERSARIAL for the expanded single place (0fc2be32d8).
 *
 * The implementor's suites render each piece once with fresh props. This suite
 * attacks what happens AROUND them:
 *
 *   G  the gallery inside a parent that re-renders (ExpandedCardModal rebuilds
 *      `sheetGalleryMedia(...)` — a NEW array — on every render): the page and
 *      the failed-photo set must survive; every photo failing leaves the short
 *      neutral header; the a11y label says where you are.
 *   W  "When you'd go" at the edges: a forecast that does not reach the chosen
 *      hour (stale cache, wrong day) hides the row; the Tonight chip reads the
 *      venue's 19:00 in every time zone, including 30/45-minute offsets and
 *      venues already on "tomorrow"; sunset hides in polar day and night and is
 *      the venue's own date; "Quieter at" never names an hour the status line
 *      calls closed — near closing, across midnight, and with half-hour opens.
 *   M  reduce motion draws the crowd bars at their final heights.
 *   A  the pinned bar against the old band: every behaviour prop the band got,
 *      the pinned bar gets; the Reserve button and VenueReserveSheet share all
 *      three conditions; Call stays reachable in Details when the number is
 *      dialable and is gone everywhere when it is not; nothing dead-taps.
 *   D  every maps link in app-mobile/src goes through the one builder.
 *
 * KNOWN DEFECTS are pinned with `test.failing` (they pass while the defect is
 * present and turn RED once fixed — then flip them to `test`):
 *   G-1 (P2) the gallery jumps back to "1 / N" whenever the sheet re-renders;
 *   G-2 (P2) a failed photo comes back whenever the sheet re-renders;
 *   G-5 (P3) a page's label is "Photo 2 · Nok", not "Photo 2 of 5" (spec);
 *   W-7 (P3) with no opening hours, "Quieter at" still names an hour;
 *   N-1 (P3) the night-out gallery is not told the sheet is hidden / reduce motion;
 *   S-1 (P2) review-mode card switch keeps the previous card's forecast until
 *        (or, with no location, instead of) the new fetch.
 *
 * FAILS-ON-REVERT (verified by the tester in an isolated worktree, see #4347):
 *   - PlaceGallery without the failed-photo filter -> G-3 fails;
 *   - forecastAt falling back to the first hourly row -> W-1 fails;
 *   - sunsetAt without its |cosH| > 1 guard -> W-4 fails;
 *   - WhenYoudGo's open check dropped from quieterHour -> W-6 fails;
 *   - CrowdBar ignoring reducedMotion -> M-1 fails;
 *   - the pinned ActionButtons losing onSchedulePickerModalVisibilityChange
 *     (or any band prop) -> A-1 fails;
 *   - the pinned Reserve gate on two of three conditions -> A-2 fails;
 *   - the pinned bar rendering Call again -> A-3 fails.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
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
    // A visible marker, so a test can tell an animated height from a drawn one.
    withTiming: (v: unknown) => ({ __timing: v }),
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
jest.mock("../../InAppBrowserProvider", () => ({ useOpenInMingla: () => jest.fn() }));
jest.mock("../../../hooks/useIsPlaceOpen", () => ({ useIsPlaceOpen: () => null }));

import * as fs from "fs";
import * as path from "path";

let mockCalendarEntries: unknown[] = [];

const RN = require("react-native");
const { PlaceGallery } = require("../PlaceGallery");
const { WhenYoudGo } = require("../WhenYoudGo");
const ActionButtons = require("../ActionButtons").default;
const PracticalDetailsSection = require("../PracticalDetailsSection").default;
const { sheetGalleryMedia, whenChips, forecastAt, sunsetAt } = require("../placeSheetModel");
const { getOpenStatusAt } = require("../../../utils/openingHoursUtils");

type Node = import("react-test-renderer").ReactTestInstance;
const SRC = path.resolve(__dirname, "../../..");
const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), "utf8");
const MODAL = read("components/ExpandedCardModal.tsx");

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
const byTestId = (r: { root: Node }, id: string) => r.root.findAll((n: Node) => n.props?.testID === id && isComposite(n));
const texts = (r: { root: Node }) =>
  r.root.findAll((n: Node) => isComposite(n) && typeof n.props?.children === "string").map((n: Node) => n.props.children as string);
const counter = (r: { root: Node }) => texts(r).find((s) => /^\d+ \/ \d+$/.test(s)) ?? null;
const clock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

// ─────────────────────────────────────────────────────────────────────────────
// G — the gallery inside a sheet that re-renders
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors ExpandedCardModal: the media array is REBUILT on every render. */
function SheetLike({ images, tick }: { images: string[]; tick: number }) {
  const media = sheetGalleryMedia(images, images[0]);
  return <PlaceGallery key="g" media={media} title={`Nok ${tick > -1 ? "" : ""}`.trim()} onOpen={() => undefined} />;
}
const IMAGES = ["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"];
const thumb = (r: { root: Node }, n: number) =>
  r.root.findAll((x: Node) => isComposite(x) && typeof x.props?.onPress === "function" && x.props?.accessibilityLabel === `Photo ${n}`)[0];

describe("G — the gallery survives the sheet re-rendering", () => {
  test("G-0 a thumbnail jump moves the counter (the harness drives the real pager state)", () => {
    const root = mount(<SheetLike images={IMAGES} tick={0} />);
    expect(counter(root)).toBe("1 / 3");
    TestRenderer.act(() => thumb(root, 3).props.onPress());
    expect(counter(root)).toBe("3 / 3");
  });

  test("G-1 (P2) after a jump to photo 3, an unrelated sheet re-render keeps '3 / 3'", () => {
    const root = mount(<SheetLike images={IMAGES} tick={0} />);
    TestRenderer.act(() => thumb(root, 3).props.onPress());
    TestRenderer.act(() => root.update(<SheetLike images={IMAGES} tick={1} />));
    expect(counter(root)).toBe("3 / 3");
  });

  test("G-2 (P2) a photo that failed stays out after an unrelated sheet re-render", () => {
    const root = mount(<SheetLike images={IMAGES} tick={0} />);
    const failing = root.root.findAll((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === IMAGES[1] && n.props.transition !== undefined)[0];
    TestRenderer.act(() => failing.props.onError());
    TestRenderer.act(() => root.update(<SheetLike images={IMAGES} tick={1} />));
    expect(root.root.findAll((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === IMAGES[1])).toHaveLength(0);
    expect(counter(root)).toBe("1 / 2");
  });

  test("G-3 every photo failing leaves the short neutral header and no counter; one survivor drops counter + thumbs", () => {
    const root = mount(<PlaceGallery media={sheetGalleryMedia(IMAGES)} title="Nok" onOpen={() => undefined} />);
    for (const uri of IMAGES.slice(0, 2)) {
      const img = root.root.findAll((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === uri && n.props.transition !== undefined)[0];
      TestRenderer.act(() => img.props.onError());
    }
    expect(counter(root)).toBeNull();
    expect(byTestId(root, "sheet-gallery-thumbs")).toHaveLength(0);
    const last = root.root.findAll((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === IMAGES[2] && n.props.transition !== undefined)[0];
    TestRenderer.act(() => last.props.onError());
    expect(byTestId(root, "sheet-gallery-empty")).toHaveLength(1);
    expect(root.root.findAll((n: Node) => n.type === "ExpoImage")).toHaveLength(0);
  });

  test("G-4 a video in slot 1 is never handed to the lightbox; no photo means no tappable page", () => {
    const opened: string[] = [];
    const media = sheetGalleryMedia(["https://cdn/v.mp4", ...IMAGES]);
    const root = mount(<PlaceGallery media={media} title="Nok" onOpen={(u: string) => opened.push(u)} />);
    const pages = root.root.findAll((n: Node) => isComposite(n) && typeof n.props?.onPress === "function" && / · Nok$/.test(String(n.props?.accessibilityLabel ?? "")));
    expect(pages[0].props.disabled).toBe(true);
    const empty = mount(<PlaceGallery media={[]} title="Nok" onOpen={(u: string) => opened.push(u)} />);
    expect(empty.root.findAll((n: Node) => isComposite(n) && typeof n.props?.onPress === "function")).toHaveLength(0);
  });

  test("G-5 (P3) a page announces its position: 'Photo 2 of 3' (spec: gallery announces position)", () => {
    const root = mount(<PlaceGallery media={sheetGalleryMedia(IMAGES)} title="Nok" onOpen={() => undefined} />);
    const labels = root.root.findAll((n: Node) => isComposite(n) && typeof n.props?.onPress === "function").map((n: Node) => String(n.props.accessibilityLabel));
    expect(labels.some((l) => /Photo 2 of 3/.test(l))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// W — When you'd go, at the edges
// ─────────────────────────────────────────────────────────────────────────────

const base = {
  onSelect: () => undefined,
  category: "casual_eats",
  driveTime: "19 min",
  clock,
};

describe("W — forecast, sunset and 'quieter at' at the edges", () => {
  test("W-1 a forecast that does not reach the chosen hour hides the row (stale cache, wrong day)", () => {
    const now = new Date("2026-11-09T13:40:00Z");
    const stale = [
      { time: "2026-11-07T14:00", temperature: 91, condition: "Clear", icon: "01d", precipitation: 0 },
      { time: "2026-11-07T19:00", temperature: 84, condition: "Clear", icon: "01n", precipitation: 0 },
    ];
    for (const selected of ["now", "tonight", "tomorrow"]) {
      const root = mount(<WhenYoudGo {...base} chips={whenChips(now, 60, null)} selected={selected} hourly={stale} weatherUtcOffsetSeconds={3600} utcOffsetMinutes={60} />);
      expect(byTestId(root, "sheet-when-weather")).toHaveLength(0);
      expect(texts(root).join(" ")).not.toMatch(/9\d°|8\d°/);
    }
    expect(forecastAt([], now, 3600)).toBeNull();
    expect(forecastAt(stale, now, 3600)).toBeNull();
  });

  test("W-2 Tonight reads the VENUE's 19:00 row in every zone, including 30/45-minute offsets and a venue already on tomorrow", () => {
    // Device clock is irrelevant: the instant is fixed; only the venue offset moves.
    const now = new Date("2026-11-09T09:10:00Z");
    for (const offsetMin of [60, -480, 330, 345, 780, -600]) {
      const chips = whenChips(now, offsetMin, null);
      const venueNow = new Date(now.getTime() + offsetMin * 60_000);
      const day = (d: Date) => d.toISOString().slice(0, 10);
      const tonight = chips.find((c: { key: string }) => c.key === "tonight");
      const tomorrow = chips.find((c: { key: string }) => c.key === "tomorrow")!;
      const target = tonight ?? tomorrow;
      const targetDay = tonight ? day(venueNow) : day(new Date(venueNow.getTime() + 86_400_000));
      const hourly = [18, 19, 20].map((h) => ({ time: `${targetDay}T${String(h).padStart(2, "0")}:00`, temperature: h, condition: "Clear", icon: "01n", precipitation: 0 }));
      expect(forecastAt(hourly, target.at, offsetMin * 60)?.temperature).toBe(19);
    }
  });

  test("W-3 sunset is the VENUE's own date: Los Angeles at Tonight 7pm shows that evening's sunset, ~4:5x pm", () => {
    const now = new Date("2026-11-09T22:00:00Z"); // 14:00 PST
    const chips = whenChips(now, -480, null);
    const root = mount(<WhenYoudGo {...base} chips={chips} selected="tonight" hourly={null} utcOffsetMinutes={-480} lat={34.05} lng={-118.24} />);
    const row = byTestId(root, "sheet-good-sunset")[0];
    const value = row.findAll((n: Node) => isComposite(n) && typeof n.props?.children === "string").map((n: Node) => n.props.children as string).pop()!;
    const [h, m] = value.split(":").map(Number);
    expect(h * 60 + m).toBeGreaterThanOrEqual(16 * 60 + 40);
    expect(h * 60 + m).toBeLessThanOrEqual(17 * 60 + 5);
  });

  test("W-4 polar night and polar day: no sunset row, never an invented time", () => {
    const cases: [number, number, string][] = [
      [78.22, 15.65, "2026-12-15T12:00:00Z"], // Longyearbyen, polar night
      [69.65, 18.96, "2026-06-21T12:00:00Z"], // Tromsø, midnight sun
      [-77.85, 166.67, "2026-12-21T12:00:00Z"], // McMurdo, polar day
    ];
    for (const [lat, lng, iso] of cases) {
      const now = new Date(iso);
      expect(sunsetAt(lat, lng, now)).toBeNull();
      const root = mount(<WhenYoudGo {...base} chips={whenChips(now, 60, null)} selected="now" hourly={null} utcOffsetMinutes={60} lat={lat} lng={lng} />);
      expect(byTestId(root, "sheet-good-sunset")).toHaveLength(0);
    }
    // ...and a high latitude that still has a sunset gets one (Tromsø, 9 Nov).
    expect(sunsetAt(69.65, 18.96, new Date("2026-11-09T09:00:00Z"))).not.toBeNull();
    expect(sunsetAt(Number.NaN, 3, new Date())).toBeNull();
    expect(sunsetAt(91, 3, new Date())).toBeNull();
  });

  const quieterShown = (root: { root: Node }): number | null => {
    const row = byTestId(root, "sheet-good-quieter")[0];
    if (!row) return null;
    const value = row.findAll((n: Node) => isComposite(n) && typeof n.props?.children === "string").map((n: Node) => n.props.children as string).pop()!;
    return Number(value.split(":")[0]);
  };

  const week = (line: (d: string) => string) =>
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => `${d}: ${line(d)}`);
  const SCHEDULES: Record<string, string[]> = {
    lunchOnly: week(() => "11:00 AM – 2:00 PM"),
    split: week(() => "11:00 AM – 2:00 PM, 5:00 PM – 10:00 PM"),
    halfHourOpen: week(() => "6:30 PM – 11:30 PM"),
    overnightBar: week((d) => (d === "Friday" || d === "Saturday" ? "6:00 PM – 2:00 AM" : "Closed")),
    earlyClose: week(() => "7:00 AM – 9:00 PM"),
  };

  test("W-6 'Quieter at' never names an hour the status line calls closed (near closing, split, half-hour, past midnight)", () => {
    const offset = 60;
    const violations: string[] = [];
    let shown = 0;
    // Walk a Friday and a Saturday in 15-minute steps, every category curve.
    for (const [name, hours] of Object.entries(SCHEDULES)) {
      for (const category of ["casual_eats", "fine_dining", "drink"]) {
        for (let q = 0; q < 2 * 24 * 4; q += 1) {
          const at = new Date(Date.UTC(2026, 10, 13, 0, 0) - offset * 60_000 + q * 15 * 60_000);
          const root = mount(<WhenYoudGo {...base} category={category} chips={[{ key: "now", at }]} selected="now" hourly={null} utcOffsetMinutes={offset} openingHours={hours} />);
          const h = quieterShown(root);
          if (h !== null) {
            shown += 1;
            const venue = new Date(at.getTime() + offset * 60_000);
            const named = new Date(Date.UTC(venue.getUTCFullYear(), venue.getUTCMonth(), venue.getUTCDate(), h, 0) - offset * 60_000);
            const status = getOpenStatusAt(hours, named, offset);
            if (!status || status.kind === "closed" || named.getTime() <= at.getTime()) {
              violations.push(`${name}/${category} at ${venue.toISOString().slice(0, 16)} -> ${h}:00 (${status?.kind ?? "unknown"})`);
            }
          }
          TestRenderer.act(() => mounted.pop()!.unmount());
        }
      }
    }
    expect(violations).toEqual([]);
    // Not vacuous: the hint did appear, many times, across these schedules.
    expect(shown).toBeGreaterThan(20);
  });

  test("W-7 (P3) with no opening hours, 'Quieter at' is hidden (an hour we cannot say is open is not offered)", () => {
    const at = new Date("2026-11-13T11:30:00Z"); // Fri 12:30 venue (+60): casual_eats 70 -> 35 at 14:00
    const root = mount(<WhenYoudGo {...base} chips={[{ key: "now", at }]} selected="now" hourly={null} utcOffsetMinutes={60} openingHours={undefined} />);
    expect(quieterShown(root)).toBeNull();
  });

  test("M-1 reduce motion: every crowd bar is drawn at its final height (no timing animation)", () => {
    const at = new Date("2026-11-13T11:30:00Z");
    const root = mount(<WhenYoudGo {...base} chips={[{ key: "now", at }]} selected="now" hourly={null} utcOffsetMinutes={60} reducedMotion />);
    const bars = root.root.findAll((n: Node) => isComposite(n) && /^sheet-when-bar/.test(String(n.props?.testID ?? "")));
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      const style = RN.StyleSheet.flatten(bar.props.style);
      expect(typeof style.height).toBe("number");
    }
    const animated = mount(<WhenYoudGo {...base} chips={[{ key: "now", at }]} selected="now" hourly={null} utcOffsetMinutes={60} />);
    const animatedBars = animated.root.findAll((n: Node) => isComposite(n) && /^sheet-when-bar/.test(String(n.props?.testID ?? "")));
    expect(animatedBars.some((b: Node) => typeof RN.StyleSheet.flatten(b.props.style).height !== "number")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A — the pinned bar against the old band
// ─────────────────────────────────────────────────────────────────────────────

/** The JSX attribute names of the Nth `<ActionButtons` element in a source. */
function propsOf(src: string, from: number): Set<string> {
  const start = src.indexOf("<ActionButtons", from);
  let depth = 0;
  let i = start;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0 && src[i - 1] === "/") break;
  }
  const tag = src.slice(start, i);
  const names = new Set<string>();
  let d = 0;
  let token = "";
  for (const ch of tag) {
    if (ch === "{") d += 1;
    if (ch === "}") d -= 1;
    if (d === 0 && /[A-Za-z]/.test(ch)) token += ch;
    else {
      if (d === 0 && ch === "=" && token) names.add(token);
      token = "";
    }
  }
  return names;
}

describe("A — pinned bar parity with the old band", () => {
  const pinnedAt = MODAL.indexOf('variant="pinned"');
  const pinnedStart = MODAL.lastIndexOf("<ActionButtons", pinnedAt);
  const bandStart = MODAL.indexOf("<ActionButtons", pinnedStart + 10);
  const pinned = propsOf(MODAL, pinnedStart);
  const band = propsOf(MODAL, bandStart);

  test("A-1 every behaviour prop the band gets (paywall, schedule gate, picker gate, removal), the pinned bar gets", () => {
    expect(pinnedStart).toBeGreaterThan(-1);
    expect(bandStart).toBeGreaterThan(pinnedStart);
    for (const name of [
      "onSave",
      "onClose",
      "isSaved",
      "userPreferences",
      "currentMode",
      "onCardRemoved",
      "onScheduleSuccess",
      "onSchedulePickerModalVisibilityChange",
      "onPaywallRequired",
      "canAccessCurated",
      "reserve",
    ]) {
      expect({ name, band: band.has(name) }).toEqual({ name, band: true });
      expect({ name, pinned: pinned.has(name) }).toEqual({ name, pinned: true });
    }
    // The picker gate is the ROOT sheet's gate, on both.
    const tagOf = (start: number) => MODAL.slice(start, MODAL.indexOf("/>", MODAL.indexOf("reserve=", start)) + 2);
    expect(tagOf(pinnedStart)).toMatch(/onSchedulePickerModalVisibilityChange=\{setIsSchedulePickerOpen\}/);
  });

  test("A-2 'Reserve a table' and VenueReserveSheet share ALL THREE conditions (no button that opens nothing)", () => {
    const three = /venueReservable\?\.reservable === true &&\s*venueReservable\.brand_id !== null &&\s*venueReservable\.venue_id !== null/;
    const reserveAt = MODAL.indexOf('testID="sheet-primary-reserve"');
    const gateWindow = MODAL.slice(MODAL.lastIndexOf("reserve={", reserveAt), reserveAt);
    expect(gateWindow).toMatch(three);
    const sheetAt = MODAL.indexOf("<VenueReserveSheet");
    expect(MODAL.slice(sheetAt - 300, sheetAt)).toMatch(three);
    // And the "else" arm is a real action (Directions), not an empty slot.
    expect(MODAL.slice(reserveAt, reserveAt + 1500)).toMatch(/testID="sheet-primary-directions"[\s\S]*onPress=\{sheetDirections\}/);
  });

  const card = { id: "p1", title: "Nok by Alara", category: "Restaurant", phone: "08012345678", countryCode: "NG", images: [], image: "" };

  test("A-3 Call: gone from the pinned bar, and the Details row dials the SAME composed number when dialable", () => {
    const bar = mount(<ActionButtons variant="pinned" card={card} onSave={() => undefined} onShare={() => undefined} shareLabel="Share" reserve={null} />);
    expect(texts(bar)).not.toContain("Call");
    const details = mount(<PracticalDetailsSection phone={card.phone} countryCode="NG" address="1 Bourdillon Rd" onLinkUnavailable={() => undefined} />);
    const phoneRow = details.root.findAll((n: Node) => isComposite(n) && typeof n.props?.url === "string" && n.props.url.startsWith("tel:"));
    expect(phoneRow).toHaveLength(1);
    expect(phoneRow[0].props.url).toBe(`tel:${card.phone}`);
    const none = mount(<PracticalDetailsSection phone={undefined} address="1 Bourdillon Rd" onLinkUnavailable={() => undefined} />);
    expect(none.root.findAll((n: Node) => isComposite(n) && typeof n.props?.url === "string" && String(n.props.url).startsWith("tel:"))).toHaveLength(0);
  });

  test("A-4 nothing in the pinned bar dead-taps: every button acts, is labelled, and a busy/saved one says so", () => {
    let shared = 0;
    const root = mount(
      <ActionButtons
        variant="pinned"
        card={card}
        onSave={() => undefined}
        isSaved
        onShare={() => (shared += 1)}
        shareLabel="Share Nok by Alara"
        reserve={<RN.TouchableOpacity accessibilityRole="button" accessibilityLabel="Directions to Nok" onPress={() => undefined}><RN.Text>Directions</RN.Text></RN.TouchableOpacity>}
      />,
    );
    // The touchables themselves (react-native-web's inner View repeats the role).
    const buttons = root.root.findAll((n: Node) => isComposite(n) && n.type !== RN.View && n.props?.accessibilityRole === "button" && n.props?.accessibilityLabel !== undefined);
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) {
      expect(typeof b.props.onPress).toBe("function");
      expect(String(b.props.accessibilityLabel).length).toBeGreaterThan(0);
    }
    const share = buttons.find((b: Node) => b.props.accessibilityLabel === "Share Nok by Alara")!;
    TestRenderer.act(() => share.props.onPress());
    expect(shared).toBe(1);
    const busy = mount(<ActionButtons variant="pinned" card={card} onSave={() => undefined} onShare={() => (shared += 1)} shareLabel="Share" shareBusy reserve={null} />);
    const busyShare = busy.root.findAll((n: Node) => isComposite(n) && n.props?.accessibilityLabel === "Share" && n.props?.accessibilityRole === "button")[0];
    expect(busyShare.props.disabled).toBe(true);
    expect(busyShare.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  });

  test("A-5 the paywall fires from the pinned bar exactly as from the band", () => {
    for (const variant of ["pinned", "band"] as const) {
      const hits: string[] = [];
      const root = mount(
        <ActionButtons
          variant={variant}
          card={{ ...card, cardType: "curated" }}
          canAccessCurated={false}
          onPaywallRequired={() => hits.push(variant)}
          onSave={() => hits.push("SAVED-WITHOUT-PAYWALL")}
          onShare={() => undefined}
          shareLabel="Share"
          reserve={null}
        />,
      );
      for (const label of ["Save", "Schedule"]) {
        const b = root.root.findAll((n: Node) => isComposite(n) && typeof n.props?.onPress === "function" && texts({ root: n }).includes(label))[0];
        TestRenderer.act(() => {
          b.props.onPress();
        });
      }
      expect(hits).toEqual([variant, variant]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D / N / S — maps links, night out, stale forecast on a card switch
// ─────────────────────────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("D / N / S", () => {
  test("D-1 no raw maps URL is composed anywhere in app-mobile/src (the builder owns them)", () => {
    const raw = /(https?:\/\/(www\.)?google\.[a-z.]+\/maps|https?:\/\/maps\.apple\.com|maps:\/\/|comgooglemaps:\/\/|["'`]geo:)/;
    // The legacy builder, and THE one directions helper itself.
    const allowed = new Set([path.join(SRC, "utils/mapsUrl.ts"), path.join(SRC, "components/expandedCard/placeDirections.ts")]);
    const hits = walk(SRC)
      .filter((f) => !allowed.has(f))
      .flatMap((f) =>
        fs
          .readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => ({ f, i, line }))
          .filter(({ line }) => raw.test(line) && !/^\s*(\/\/|\*)/.test(line)),
      )
      .map(({ f, i, line }) => `${path.relative(SRC, f)}:${i + 1} ${line.trim()}`);
    expect(hits).toEqual([]);
    // mapsUrl.ts's builder has no caller left in the app.
    expect(walk(SRC).filter((f) => /buildMapsUrl\(/.test(fs.readFileSync(f, "utf8")) && !f.endsWith("mapsUrl.ts"))).toEqual([]);
    // The sheet, the night out and the timeline all route through the one helper.
    for (const rel of ["components/ExpandedCardModal.tsx", "components/expandedCard/TimelineSection.tsx", "components/expandedCard/PracticalDetailsSection.tsx"]) {
      const s = read(rel);
      expect({ rel, helper: /openPlaceDirections\(/.test(s) }).toEqual({ rel, helper: true });
      expect({ rel, raw: /openMapsTarget\(|Linking\.openURL\([^)]*maps/.test(s) }).toEqual({ rel, raw: false });
    }
  });

  test("N-1 (P3) the night-out gallery is told when the sheet is hidden and when Reduce Motion is on", () => {
    const src = read("components/expandedCard/EventDetailLayout.tsx");
    const at = src.indexOf("<PlaceGallery");
    const tag = src.slice(at, src.indexOf("/>", at));
    expect(tag).toMatch(/\bactive=/);
    expect(tag).toMatch(/\breducedMotion=/);
  });

  test("S-1 (P2) switching cards while the sheet is open drops the previous card's forecast before fetching", () => {
    const at = MODAL.indexOf("// Fetch additional data when modal opens");
    const effect = MODAL.slice(at, MODAL.indexOf("}, [visible, card", at));
    const openBranch = effect.slice(effect.indexOf("if (visible && card)"), effect.indexOf("} else {"));
    expect(openBranch).toMatch(/setWeatherData\(null\)/);
  });
});
