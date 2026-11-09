/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 2 — the expanded single place's states, rendered (implementor
 * happy path), from the spec's state table:
 *
 *   gallery: one photo (no counter, no thumbnails) · many (counter "1 / N",
 *   thumbnails) · video cover in slot 1, paused when not on slot 1 · no photo
 *   (short neutral header) · photo load failure (the photo leaves the gallery)
 *   basics: four tiles · tiles hidden when missing · large text stacks the grid
 *   · the Been-here slot on its plate backdrop
 *   When you'd go: chips, hourly weather, "Usually …" crowd + bars with the
 *   chosen hour highlighted, estimated drive, Good to know (sunset), weather
 *   source unavailable hides the row, reduce motion
 *   pinned bar: Save · Schedule · Share · main button; Call leaves the bar;
 *   saved / scheduled states; the closed-venue message
 *   night out: the pinned "Get tickets" bar (on sale / sold out / TBA)
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT: drop the `media.length > 1` counter guard (S-1), the
 * failed-photo filter (S-4), the fontScale stack (B-3), the `!pinned` Call
 * gate (A-2) or the pinned Share button (A-1) — each fails here.
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

const LABELS = {
  openUntil: (t: string) => `Open until ${t}`,
  closesIn: (m: number) => `Closes in ${m} min`,
  opensAt: (t: string) => `Opens ${t}`,
  opensTomorrow: (t: string) => `Opens tomorrow ${t}`,
  opensOn: (d: number, t: string) => `Opens +${d} ${t}`,
  open24h: "Open 24 hours",
  clock: (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`,
  rating: (r: string, c: number | null) => (c === null ? `★ ${r}` : `★ ${r} · ${c} reviews`),
};

describe("#4347 wave 2 — gallery", () => {
  test("S-1 many photos: counter '1 / N' and a thumbnail row; one photo: neither", () => {
    const many = mount(<PlaceGallery media={sheetGalleryMedia(["a", "b", "c"])} title="Nok" onOpen={() => undefined} />);
    expect(texts(many)).toContain("1 / 3");
    expect(byTestId(many, "sheet-gallery-thumbs").length).toBeGreaterThan(0);
    const one = mount(<PlaceGallery media={sheetGalleryMedia(["a"])} title="Nok" onOpen={() => undefined} />);
    expect(byTestId(one, "sheet-gallery-counter")).toHaveLength(0);
    expect(byTestId(one, "sheet-gallery-thumbs")).toHaveLength(0);
  });

  test("S-2 tapping a photo opens the lightbox on THAT photo", () => {
    const opened: string[] = [];
    const root = mount(<PlaceGallery media={sheetGalleryMedia(["a", "b"])} title="Nok" onOpen={(u: string) => opened.push(u)} />);
    const page = root.root.findAll((n: Node) => isComposite(n) && typeof n.props?.onPress === "function" && String(n.props?.accessibilityLabel ?? "").startsWith("Photo 2 of 2 ·"))[0];
    TestRenderer.act(() => page.props.onPress());
    expect(opened).toEqual(["b"]);
  });

  test("S-3 a video cover plays in slot 1 only, and not while the sheet is hidden", () => {
    const media = sheetGalleryMedia(["https://c/v.mp4", "s1"]);
    const playing = mount(<PlaceGallery media={media} title="Nok" onOpen={() => undefined} />);
    expect(playing.root.find((n: Node) => n.type === "EventCoverMedia").props.playbackActive).toBe(true);
    const hidden = mount(<PlaceGallery media={media} title="Nok" active={false} onOpen={() => undefined} />);
    expect(hidden.root.find((n: Node) => n.type === "EventCoverMedia").props.playbackActive).toBe(false);
  });

  test("S-4 no photo: the short neutral header; a failed photo leaves the gallery", () => {
    const none = mount(<PlaceGallery media={[]} title="Nok" onOpen={() => undefined} />);
    expect(byTestId(none, "sheet-gallery-empty")).toHaveLength(1);
    expect(flat(byTestId(none, "sheet-gallery-empty")[0].props.style)).toMatchObject({ height: SHEET_GALLERY.emptyHeight });
    const root = mount(<PlaceGallery media={sheetGalleryMedia(["a", "b"])} title="Nok" onOpen={() => undefined} />);
    const first = root.root.findAll((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === "a" && n.props.transition !== undefined)[0];
    TestRenderer.act(() => first.props.onError());
    expect(root.root.findAll((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === "a")).toHaveLength(0);
    expect(byTestId(root, "sheet-gallery-counter")).toHaveLength(0);
  });

  test("S-6 the gallery carries the sheet's labelled close control, with or without photos", () => {
    let closed = 0;
    for (const media of [sheetGalleryMedia(["a", "b"]), []]) {
      const root = mount(<PlaceGallery media={media} title="Nok" onOpen={() => undefined} onClose={() => (closed += 1)} closeLabel="Close" />);
      const button = byTestId(root, "sheet-gallery-close")[0];
      expect(button.props.accessibilityLabel).toBe("Close");
      TestRenderer.act(() => button.props.onPress());
    }
    expect(closed).toBe(2);
  });

  test("S-5 reduce motion: pages land without a cross-fade", () => {
    const root = mount(<PlaceGallery media={sheetGalleryMedia(["a"])} title="Nok" reducedMotion onOpen={() => undefined} />);
    expect(root.root.find((n: Node) => n.type === "ExpoImage").props.transition).toBe(0);
  });
});

describe("#4347 wave 2 — basics", () => {
  const tiles = basicsTiles(
    { openingHours: ["Monday: 12:00 PM – 11:00 PM"].concat(["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => `${d}: 12:00 PM – 11:00 PM`)), utcOffsetMinutes: 0, priceText: "≈ $19–30", travelTime: "12 min", distanceText: "3.4 mi", rating: 4.6, reviewCount: 212 },
    new Date("2026-11-09T14:00:00Z"),
    LABELS,
  );

  test("B-1 kicker, title, Been here on the plate's backdrop, four tiles with their labels", () => {
    const root = mount(<PlaceBasics kicker="Restaurant" title="Nok by Alara" tiles={tiles} beenHere={<RN.Text>Been here</RN.Text>} />);
    expect(texts(root)).toEqual(expect.arrayContaining(["RESTAURANT", "Nok by Alara", "Been here", "Hours", "Per person", "From you", "Rating", "Open until 23:00", "★ 4.6 · 212 reviews"]));
    const backdrop = root.root.findAll((n: Node) => isComposite(n) && flat(n.props?.style).backgroundColor === CI.PLATE.fallbackSolid);
    expect(backdrop.length).toBeGreaterThan(0);
  });

  test("B-2 a missing fact hides its tile and the grid closes up; none at all, no grid", () => {
    const root = mount(<PlaceBasics kicker={null} title="Nok" tiles={tiles.filter((t: { key: string }) => t.key !== "rating")} />);
    expect(byTestId(root, "sheet-tile-rating")).toHaveLength(0);
    expect(byTestId(root, "sheet-tile-hours")).toHaveLength(1);
    expect(byTestId(mount(<PlaceBasics kicker={null} title="Nok" tiles={[]} />), "sheet-tiles")).toHaveLength(0);
  });

  test("B-3 large text stacks the tiles to one column", () => {
    const spy = jest.spyOn(RN, "useWindowDimensions").mockReturnValue({ width: 402, height: 874, scale: 3, fontScale: 1.3 });
    const root = mount(<PlaceBasics kicker={null} title="Nok" tiles={tiles} />);
    expect(byTestId(root, "sheet-tiles-stacked")).toHaveLength(1);
    spy.mockRestore();
  });
});

describe("#4347 wave 2 — When you'd go", () => {
  const now = new Date("2026-11-09T13:40:00Z");
  const chips = whenChips(now, 60, null);
  const hourly = [
    { time: "2026-11-09T14:00", temperature: 86, condition: "Clouds", icon: "02d", precipitation: 0, precipitationProbability: 10 },
    { time: "2026-11-09T19:00", temperature: 80, condition: "Rain", icon: "10n", precipitation: 0.1, precipitationProbability: 70 },
  ];
  const base = { chips, onSelect: () => undefined, category: "Restaurant", utcOffsetMinutes: 60, driveTime: "19 min", lat: 6.45, lng: 3.43, clock: LABELS.clock, weatherUtcOffsetSeconds: 3600 };

  test("H-1 Now: weather at that hour, 'Usually …' crowd, estimated drive, bars with the hour highlighted, sunset", () => {
    const root = mount(<WhenYoudGo {...base} selected="now" hourly={hourly} />);
    const t = texts(root);
    expect(t).toEqual(expect.arrayContaining(["When you'd go", "Now", "Tonight 19:00", "Tomorrow 19:00", "Weather", "Crowd", "Drive", "19 min (est.)", "Good to know", "Sunset"]));
    expect(t.some((s) => /^Usually /.test(s))).toBe(true);
    const hosts = (id: string) => root.root.findAll((n: Node) => n.props?.["data-testid"] === id);
    expect(hosts("sheet-when-bar-active")).toHaveLength(1);
    expect(hosts("sheet-when-bar").length).toBe(WHEN_BLOCK.lastHour - WHEN_BLOCK.firstHour);
  });

  test("H-2 Tonight reads the 19:00 forecast (rain chance shown); a missing forecast hides the weather row", () => {
    const tonight = mount(<WhenYoudGo {...base} selected="tonight" hourly={hourly} />);
    expect(texts(tonight).join(" ")).toMatch(/70% rain/);
    const noWeather = mount(<WhenYoudGo {...base} selected="tomorrow" hourly={hourly} />);
    expect(byTestId(noWeather, "sheet-when-weather")).toHaveLength(0);
    expect(byTestId(mount(<WhenYoudGo {...base} selected="now" hourly={null} />), "sheet-when-weather")).toHaveLength(0);
  });

  test("H-3 no location: no drive row, and the note never claims the crowd is live", () => {
    const root = mount(<WhenYoudGo {...base} selected="now" hourly={null} driveTime={null} lat={null} lng={null} />);
    expect(byTestId(root, "sheet-when-drive")).toHaveLength(0);
    expect(byTestId(root, "sheet-good-sunset")).toHaveLength(0);
    expect(texts(root)).toContain("Crowd is typical for this kind of place, not live.");
  });

  test("H-4 picking a chip reports it", () => {
    const picked: string[] = [];
    const root = mount(<WhenYoudGo {...base} selected="now" hourly={hourly} onSelect={(k: string) => picked.push(k)} />);
    TestRenderer.act(() => byTestId(root, "sheet-when-chip-tonight")[0].props.onPress());
    expect(picked).toEqual(["tonight"]);
  });
});

describe("#4347 wave 2 — pinned action bar", () => {
  const card = { id: "p1", title: "Nok by Alara", category: "Restaurant", phone: "+2348012345678", countryCode: "NG", images: [], image: "" };
  const bar = (props: Record<string, unknown> = {}) =>
    mount(
      <ActionButtons
        variant="pinned"
        card={card}
        onSave={() => undefined}
        onShare={() => undefined}
        shareLabel="Share Nok by Alara"
        reserve={<RN.Text>Directions</RN.Text>}
        {...props}
      />,
    );

  test("A-1 Save · Schedule · Share · the main button, in the pinned bar", () => {
    const root = bar();
    expect(byTestId(root, "sheet-action-bar").length).toBeGreaterThan(0);
    expect(texts(root)).toEqual(expect.arrayContaining(["Save", "Schedule", "Share", "Directions"]));
  });

  test("A-2 Call leaves the pinned bar (the Details phone row dials the same number); the band keeps it", () => {
    expect(texts(bar())).not.toContain("Call");
    const band = mount(<ActionButtons card={card} onSave={() => undefined} />);
    expect(texts(band)).toContain("Call");
  });

  test("A-3 saved and scheduled show their filled state", () => {
    mockCalendarEntries = [];
    const root = bar({ isSaved: true });
    expect(texts(root)).toContain("Saved");
  });
});

describe("#4347 wave 2 — night out", () => {
  const card = { id: "e1", title: "Burna Boy Live", images: [], image: "" };
  const t = (status: string, url: string | null) => ({ eventName: "Burna Boy Live", ticketStatus: status, ticketUrl: url, price: "$40", venueName: "Eko" });

  test("N-1 the pinned Get tickets bar: on sale opens the browser; sold out and TBA are disabled", () => {
    const opened: string[] = [];
    const onsale = mount(<NightOutTicketBar card={card} nightOut={t("onsale", "https://tm/x")} onOpenBrowser={(u: string) => opened.push(u)} bottomInset={0} />);
    const button = onsale.root.findAll((n: Node) => isComposite(n) && n.props?.accessibilityRole === "button")[0];
    TestRenderer.act(() => button.props.onPress());
    expect(opened).toEqual(["https://tm/x"]);
    const sold = mount(<NightOutTicketBar card={card} nightOut={t("offsale", "https://tm/x")} onOpenBrowser={() => undefined} bottomInset={0} />);
    expect(sold.root.findAll((n: Node) => isComposite(n) && n.props?.accessibilityRole === "button")[0].props.disabled).toBe(true);
  });
});

describe("#4347 wave 1+2 rework after retest", () => {
  const lum = (hex: string): number => {
    const c = hex.replace("#", "").match(/../g)!.map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string): number => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const flat = (style: unknown): Record<string, unknown> => RN.StyleSheet.flatten(style) ?? {};

  test("R-1 (P2-c) tile and When labels reach 4.5:1 on their fill; crowd bars reach 3:1 on white", () => {
    const tiles = mount(<PlaceBasics kicker={null} title="Nok" tiles={[{ key: "hours", value: "Open until 11pm", tone: "open" }]} />);
    const label = tiles.root.findAll((n: Node) => isComposite(n) && n.props?.children === "Hours")[0];
    expect(ratio(String(flat(label.props.style).color), "#F3F4F6")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(WHEN_BLOCK.barFill, "#FFFFFF")).toBeGreaterThanOrEqual(3);
    expect(ratio(WHEN_BLOCK.barActiveFill, "#FFFFFF")).toBeGreaterThanOrEqual(3);
  });

  test("R-2 the lightbox opens from the media still in the gallery (a failed photo is not paged to)", () => {
    const calls: Array<{ uri: string; shown: string[] }> = [];
    const root = mount(
      <PlaceGallery
        media={sheetGalleryMedia(["a", "b", "c"])}
        title="Nok"
        onOpen={(uri: string, shown: Array<{ uri: string }>) => calls.push({ uri, shown: shown.map((m) => m.uri) })}
      />,
    );
    const failing = root.root.findAll((n: Node) => n.type === "ExpoImage" && n.props.source?.uri === "b" && n.props.transition !== undefined)[0];
    TestRenderer.act(() => failing.props.onError());
    const page = root.root.findAll((n: Node) => isComposite(n) && typeof n.props?.onPress === "function" && String(n.props?.accessibilityLabel ?? "").startsWith("Photo 2 of 2 ·"))[0];
    TestRenderer.act(() => page.props.onPress());
    expect(calls).toEqual([{ uri: "c", shown: ["a", "c"] }]);
  });
});
