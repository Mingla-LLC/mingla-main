/**
 * #4347 wave 4 — the consumer venue route's Explorer slots on the SHARED
 * venue page (implementor happy path). Mounts the REAL consumer route and the
 * REAL shared PublicVenueScreen; only the lazily loaded Explorer layer is
 * stubbed (its own render suite is app-mobile's
 * issue_4347_venue_explorer.implementor.render.test.tsx).
 *
 *   X-1 a venue NOT opened from the deck: the Explorer Overview block sits
 *       after the About pitch and before the map, and the page keeps its OWN
 *       reserve bar (no Explorer bar, no Save without the deck card);
 *   X-2 a venue opened from the deck: the Explorer bar REPLACES the page's
 *       reserve bar (never two), receives the page's reserve gate, and its
 *       Reserve raises the page's one reservation sheet;
 *   X-3 a hand-off for another place is ignored;
 *   X-4 a venue that is not public still has a Close.
 *
 * FAILS-ON-REVERT: drop `overviewSlot` from the route (X-1), drop the
 * `hasHostActionBar` swap in PublicVenueScreen (X-2: two bars), or drop the
 * placePoolId match in getDeckVenueHandoff (X-3) — each fails here.
 */
import React from "react";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
// `mingla-business/src/constants/platformUrl.ts` throws at module load without
// this; the shared package chain reaches it through the offering-rendering
// barrel used below.
process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL = "https://host.usemingla.com";

const REPO_ROOT = join(__dirname, "../../../../..");
const CONSUMER_ROUTE = "../../../../../app-mobile/app/b/[brandSlug]/v/[venueSlug]";

// ---------------------------------------------------------------------------
// Case data the mocked consumer hooks hand the route
// ---------------------------------------------------------------------------

interface CaseData {
  venue: Record<string, unknown> | null;
  stayDetail: Record<string, unknown> | null;
  stayState: "loading" | "ready" | "error";
  tab: string | undefined;
}
const caseData: { current: CaseData } = {
  current: { venue: null, stayDetail: null, stayState: "ready", tab: undefined },
};

const openedUrls: string[] = [];
const themeFontRequests: (string | null)[] = [];
const analyticsEvents: { event: string; props: Record<string, unknown> }[] = [];
const organicEvents: string[] = [];

// ---- module mocks: everything OUTSIDE the adapter + the shared screen ------

// NOTE ON RESOLUTION. This suite mounts an app-mobile route from a
// mingla-business jest run, and the two apps have SEPARATE `node_modules` — so
// node resolution from the route reaches `app-mobile/node_modules/...`, which
// CI never installs, and a bare `jest.mock("expo-router")` here would register
// a DIFFERENT resolved path from the one the route requires. `jest.config.cjs`
// anchors both specifiers at this app's copies (identity for every business
// file), which makes the two resolutions converge and these bare mocks apply.
jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => ({
    brandSlug: "smokerhythm",
    venueSlug: "academy-street-bistro",
    tab: caseData.current.tab,
  }),
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
    canGoBack: () => true,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

// The offering-rendering barrel: the REAL pure helpers (theme resolution,
// palette, surface styles, the static-map URL builder) so every value asserted
// below is genuinely computed, with the shell as a transparent passthrough so
// the body it wraps is observable. Same shape as the #1559 harness.
// [TEST-MOD-APPROVED #2508] Harness registration only — ADDITION, no assertion
// changed. The shared copy-address button and map-app chooser draw lucide
// glyphs through `react-native-svg` (a REAL dependency of both apps —
// react-native-svg 15.12.1 — and an existing peer of @mingla/offering-rendering).
// This render config simply cannot resolve it from `packages/`, so it is mocked
// to plain react-native Views, the same idiom
// issue_1890_ari_composer_clearance uses. Nothing this suite asserts is a glyph.
jest.mock(
  "react-native-svg",
  () => {
    const Glyph = (): null => null;
    return {
      __esModule: true,
      default: Glyph,
      Svg: Glyph,
      Path: Glyph,
      Circle: Glyph,
      Rect: Glyph,
      G: Glyph,
      Defs: Glyph,
      Stop: Glyph,
      LinearGradient: Glyph,
    };
  },
  { virtual: true },
);

jest.mock("@mingla/offering-rendering", () => {
  const ReactLocal = require("react") as typeof React;
  const themeResolver = require("../../../../../packages/offering-rendering/themeResolver");
  const themePalette = require("../../../../../packages/offering-rendering/themePalette");
  const staticMapImage = require("../../../../../packages/offering-rendering/staticMapImage");
  // [TEST-MOD-APPROVED #2468] maps-deep-link-coordinates — the REAL deep-link
  // builder, in keeping with this factory's stated rule ("the REAL pure
  // helpers ... so every value asserted below is genuinely computed"). The
  // shared venue screen now reads its maps target from it.
  const mapsDeepLink = require("../../../../../packages/offering-rendering/mapsDeepLink");
  // [TEST-MOD-APPROVED #2508] Harness registration only — ADDITION, no
  // assertion changed. maps-app-chooser added the shared "which map app?"
  // chooser + copy-address button, and PublicVenueScreen reaches them through
  // THIS barrel (its only barrel-sourced UI). Registering the REAL module
  // matches this factory's rule of spreading the real helpers, and keeps the
  // venue card's rendered output genuine rather than stubbed away.
  const venueMapsActions = require("../../../../../packages/offering-rendering/VenueMapsActions");
  const ParallaxCoverShell = (
    props: Record<string, unknown>,
  ): React.ReactElement => {
    const { children, heroEyebrow, heroTitle, stickyPanel, ...rest } = props as {
      children?: React.ReactNode;
      heroEyebrow?: React.ReactNode;
      heroTitle?: React.ReactNode;
      stickyPanel?: React.ReactNode;
    };
    return ReactLocal.createElement(
      "ParallaxCoverShell",
      rest,
      ReactLocal.createElement("ShellBody", null, children),
    );
  };
  return {
    __esModule: true,
    ...themeResolver,
    ...themePalette,
    ...staticMapImage,
    // #4334 F-1 (merge adoption) — the REAL shared map renderer, as the #1559 harness registers it.
    StaticMapImage: require("../../../../../packages/offering-rendering/StaticMapFrame").StaticMapImage,
    ...mapsDeepLink,
    ...venueMapsActions,
    // The consumer app is phone-only for this route (its `useResponsiveLayout`
    // returns isDesktop:false unconditionally on native), so the phone branch
    // is the one a consumer guest actually gets.
    useResponsiveLayout: () => ({
      width: 390,
      isDesktop: false,
      isPhone: true,
      isWeb: false,
    }),
    ParallaxCoverShell,
  };
});

jest.mock("../../../../../app-mobile/src/hooks/usePublicVenue", () => ({
  __esModule: true,
  usePublicVenue: () => ({
    data: caseData.current.venue,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: () => undefined,
  }),
}));

jest.mock("../../../../../app-mobile/src/hooks/useStayGuest", () => ({
  __esModule: true,
  usePublicStayDetail: () => ({
    data: caseData.current.stayDetail,
    isLoading: caseData.current.stayState === "loading",
    isError: caseData.current.stayState === "error",
  }),
}));

jest.mock("../../../../../app-mobile/src/theme/useConsumerThemeFont", () => ({
  __esModule: true,
  useConsumerThemeFont: (family: string | null | undefined) => {
    themeFontRequests.push(family ?? null);
    return { loaded: true };
  },
  loadConsumerThemeFont: async () => undefined,
}));

// [TEST-MOD-APPROVED #1719] The adopted route now delegates sharing to the
// canonical consumer content-share adapter. This suite owns venue rendering,
// not the native share side effect, so keep that platform boundary mocked just
// like Linking and analytics while #1719 exercises the real adapter separately.
jest.mock("../../../../../app-mobile/src/services/contentShareAdapter", () => ({
  __esModule: true,
  shareContent: jest.fn(async () => undefined),
}));

jest.mock("../../../../../app-mobile/src/services/postHogService", () => ({
  __esModule: true,
  postHogService: {
    capture: (event: string, props: Record<string, unknown>) => {
      analyticsEvents.push({ event, props });
    },
  },
}));

jest.mock(
  "../../../../../app-mobile/src/services/venueOrganicCaptureService",
  () => ({
    __esModule: true,
    captureVenueOrganicEvent: async (
      _ids: unknown,
      eventType: string,
    ): Promise<void> => {
      organicEvents.push(eventType);
    },
  }),
);

jest.mock(
  "../../../../../app-mobile/src/services/nativeAdAttributionService",
  () => ({
    __esModule: true,
    captureNativeStayRouteAttribution: async () => undefined,
  }),
);

// The two PAYMENT-RAIL slots — stubbed so their props land in the tree and the
// native Stripe / bottom-sheet chains are never loaded under node.
jest.mock(
  "../../../../../app-mobile/src/components/expandedCard/VenueReserveSheet",
  () => {
    const ReactLocal = require("react") as typeof React;
    return {
      __esModule: true,
      VenueReserveSheet: (props: Record<string, unknown>) =>
        ReactLocal.createElement("VenueReserveSheetStub", props),
    };
  },
);
jest.mock(
  "../../../../../app-mobile/src/components/stay/ConsumerStayGuestExperience",
  () => {
    const ReactLocal = require("react") as typeof React;
    return {
      __esModule: true,
      ConsumerStayGuestExperience: (props: Record<string, unknown>) =>
        ReactLocal.createElement("ConsumerStayGuestExperienceStub", props),
    };
  },
);

// `Linking.openURL` is what "tappable address" ultimately means. The manual
// react-native mock this config uses has no Linking, so it is provided here and
// its calls are recorded.
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  return {
    ...actual,
    Linking: {
      openURL: (url: string) => {
        openedUrls.push(url);
        return Promise.resolve(true);
      },
    },
    Share: { share: () => Promise.resolve({ action: "sharedAction" }) },
  };
});

// ---------------------------------------------------------------------------
// Fixtures — real-shaped rows off `venue_public_view`, not placeholders
// ---------------------------------------------------------------------------

const HOURS = [
  { weekday: 0, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { weekday: 1, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { weekday: 2, openTime: "09:00", closeTime: "22:30", isClosed: false },
  { weekday: 3, openTime: "09:00", closeTime: "22:30", isClosed: false },
  { weekday: 4, openTime: "10:00", closeTime: "23:00", isClosed: false },
  { weekday: 5, openTime: "10:00", closeTime: "23:00", isClosed: false },
  { weekday: 6, openTime: null, closeTime: null, isClosed: true },
];

/**
 * SEVEN photographs, deliberately. Four or fewer and the old `.slice(0, 4)`
 * would have produced the same tree, and G-3 would prove nothing (V-4).
 */
const GALLERY = [
  "https://cdn.example.com/g1.jpg",
  "https://cdn.example.com/g2.jpg",
  "https://cdn.example.com/g3.jpg",
  "https://cdn.example.com/g4.jpg",
  "https://cdn.example.com/g5.jpg",
  "https://cdn.example.com/g6.jpg",
  "https://cdn.example.com/g7.jpg",
];

const LONG_PITCH =
  "A neighbourhood bistro with an open fire, a short menu that changes weekly, " +
  "and a wine list built entirely from small growers. Walk-ins welcome at the " +
  "bar; the dining room books up quickly at weekends, so reserve ahead if you " +
  "want the corner table.";

const consumerVenue = (
  venueCategory: "restaurant" | "stay" | "play" | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  brandSlug: "smokerhythm",
  brandName: "Smoke & Rhythm",
  slug: "academy-street-bistro",
  name: "Academy Street Bistro",
  venueCategory,
  address: "12 Academy Street, London N1 4AB",
  city: "London",
  lat: 51.5361,
  lng: -0.1035,
  placePoolId: "33333333-3333-4333-8333-333333333333",
  coverMediaUrl: "https://cdn.example.com/cover.jpg",
  coverMediaType: "image",
  coverHue: 24,
  pitch: LONG_PITCH,
  theme: { color: "#eb7825", font: "inter", animation: null },
  hours: HOURS,
  galleryPhotoUrls: GALLERY,
  menu: [],
  discoveryPrice:
    venueCategory === "stay"
      ? null
      : {
          minMinor: 2500,
          maxMinor: 6000,
          currencyCode: "GBP",
          minorUnitExponent: 2,
        },
  reservability:
    venueCategory === "stay"
      ? { state: "unavailable", venueId: null, currency: null }
      : {
          state: "available",
          venueId: "11111111-1111-4111-8111-111111111111",
          currency: "GBP",
        },
  ...overrides,
});

const STAY_DETAIL = {
  venueId: "11111111-1111-4111-8111-111111111111",
  checkInTime: "15:00:00",
  checkOutTime: "11:00",
  houseRules: "No parties. Quiet hours after 22:00.",
  rooms: [],
  places: [],
  placeWindows: [],
};

// ---------------------------------------------------------------------------
// Mount harness
// ---------------------------------------------------------------------------

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface MountedTree {
  toJSON: () => unknown;
  unmount: () => void;
  root: TestInstance;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => MountedTree;
  act: (callback: () => void) => void;
};

interface Mounted {
  root: TestInstance;
  json: string;
  unmount: () => void;
}

const mountRoute = (data: CaseData): Mounted => {
  caseData.current = data;
  jest.useFakeTimers().setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
  // Loading the route is the step most likely to fail for an ENVIRONMENT reason
  // rather than a product reason (cross-app transform, a missing peer, a mock
  // that did not apply). Whatever it throws must arrive with a readable
  // message: ts-jest surfaces a transform failure as a throw whose `message`
  // is EMPTY, which reaches the reporter as five blank lines under a `●`
  // heading and tells a reader nothing at all.
  let routeModule: { default?: React.ComponentType };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    routeModule = require(CONSUMER_ROUTE);
  } catch (err) {
    const detail =
      err instanceof Error
        ? `${err.message || "(empty message)"}\n${err.stack ?? ""}`
        : JSON.stringify(err);
    throw new Error(
      `could not load the consumer venue route (${CONSUMER_ROUTE}): ${detail}`,
    );
  }
  const Route = (routeModule.default ??
    routeModule) as unknown as React.ComponentType;
  let renderer: MountedTree | null = null;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(React.createElement(Route));
  });
  if (renderer === null) throw new Error("consumer venue route did not mount");
  const mounted: MountedTree = renderer;
  // Flush the tab reducer's mount dispatches so the tree is the settled one.
  TestRenderer.act(() => undefined);
  jest.useRealTimers();
  return {
    root: mounted.root,
    json: JSON.stringify(mounted.toJSON()),
    // Wrapped in act(): unmounting flushes the reducer's cleanup, and an
    // unwrapped update logs a React warning into every run's output.
    unmount: () =>
      TestRenderer.act(() => {
        mounted.unmount();
      }),
  };
};

/** The state views (loading / error / not-found) — the ANTI-ANCHORS (V-2). */
const STATE_COPY = [
  "Venue not found",
  "This venue could not load",
  "Loading venue",
];

/**
 * V-1 mount floor. A `null` render serialises to 4 chars and a state view
 * (loading / error / not-found) to well under 1,000; the real page is an order
 * of magnitude above both. The floor is per-case because the Reservations pane
 * legitimately mounts fewer sections than a full Overview — a single global
 * number would have to be low enough to be meaningless for the big cases.
 */
const assertRealRender = (
  mounted: Mounted,
  label: string,
  floor = 6000,
): void => {
  expect(`${label}:${mounted.json.length > floor}`).toBe(`${label}:true`);
  // V-2 anti-anchors.
  for (const copy of STATE_COPY) {
    expect(`${label}:${mounted.json.includes(copy)}`).toBe(`${label}:false`);
  }
};


// ---- #4347 wave 4: the lazily loaded Explorer layer, stubbed --------------
const explorerBarContexts: Record<string, unknown>[] = [];
jest.mock(
  "../../../../../app-mobile/src/components/venuePage/VenueExplorerLayer",
  () => {
    const ReactLocal = require("react") as typeof React;
    return {
      __esModule: true,
      VenueExplorerOverview: (props: { context: { palette: { page: string } } }) =>
        ReactLocal.createElement("ExplorerOverviewStub", { page: props.context.palette.page }),
      VenueExplorerBar: (props: { context: Record<string, unknown> }) => {
        explorerBarContexts.push(props.context);
        return ReactLocal.createElement("ExplorerBarStub", {
          canReserve: props.context.canReserve,
          bookingKind: props.context.bookingKind,
          onReserve: props.context.openReservation,
        });
      },
    };
  },
);

const handoffModule = require("../../../../../app-mobile/src/components/venuePage/deckVenueHandoff") as {
  setDeckVenueHandoff: (entry: Record<string, unknown>) => void;
  clearDeckVenueHandoff: () => void;
};

const PLACE = "33333333-3333-4333-8333-333333333333";
const handoffFor = (placePoolId: string): Record<string, unknown> => ({
  placePoolId,
  card: { id: placePoolId, title: "Academy Street Bistro" },
  currentMode: "solo",
  isSaved: false,
  save: async () => undefined,
  canAccessCurated: true,
});

/** Mount, then let the lazy Explorer chunks resolve. */
const mountSettled = async (data: CaseData): Promise<Mounted> => {
  const first = mountRoute(data);
  await TestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return first;
};
const host = (mounted: Mounted, type: string): TestInstance[] =>
  mounted.root.findAll((node) => node.type === type);

// #4347 rework — X-2 order dependence. The route's Explorer chunks are
// React.lazy; their FIRST resolution inside a synchronous act() while the deck
// bar is also suspended spins act's microtask queue until the heap runs out (a
// harness artifact). Warm them once, with no hand-off, before any case runs,
// so every case (`-t X-2` on its own included) starts from resolved chunks.
beforeAll(async () => {
  const warm = await mountSettled({ venue: consumerVenue("restaurant"), stayDetail: null, stayState: "ready", tab: undefined });
  warm.unmount();
});

afterEach(() => {
  handoffModule.clearDeckVenueHandoff();
  explorerBarContexts.length = 0;
});

describe("#4347 wave 4 — the Explorer slots on the shared venue page", () => {
  test("X-1 not from the deck: the Overview block after About, and the page keeps its own reserve bar", async () => {
    const mounted = await mountSettled({ venue: consumerVenue("restaurant"), stayDetail: null, stayState: "ready", tab: undefined });
    const overview = host(mounted, "ExplorerOverviewStub");
    expect(overview).toHaveLength(1);
    expect(typeof overview[0].props.page).toBe("string");
    expect(
      mounted.root.findAll((n) => n.props?.testID === "issue-2729-reserve-bar").length,
    ).toBeGreaterThan(0);
    expect(host(mounted, "ExplorerBarStub")).toHaveLength(0);
    mounted.unmount();
  });

  test("X-1b the Overview block sits after the About pitch and before the map", async () => {
    const mounted = await mountSettled({ venue: consumerVenue("restaurant"), stayDetail: null, stayState: "ready", tab: undefined });
    // findAll walks the tree in document order.
    const order = mounted.root.findAll(() => true);
    const at = (pred: (n: TestInstance) => boolean): number => order.findIndex(pred);
    const slotAt = at((n) => n.type === "ExplorerOverviewStub");
    const pitchAt = at((n) => typeof n.props?.children === "string" && (n.props.children as string).includes("neighbourhood bistro"));
    // #4334 (merge adoption) — the map is the shared StaticMapImage box now; it
    // requests no image before layout, so the box itself is the anchor.
    const mapAt = at((n) => typeof n.type === "function" && n.type.name === "StaticMapImage");
    expect(slotAt).toBeGreaterThan(-1);
    expect(pitchAt).toBeGreaterThan(-1);
    expect(mapAt).toBeGreaterThan(-1);
    expect(slotAt).toBeGreaterThan(pitchAt);
    expect(slotAt).toBeLessThan(mapAt);
    mounted.unmount();
  });

  test("X-2 from the deck: the Explorer bar replaces the page's reserve bar and opens its one sheet", async () => {
    handoffModule.setDeckVenueHandoff(handoffFor(PLACE));
    const mounted = await mountSettled({ venue: consumerVenue("restaurant"), stayDetail: null, stayState: "ready", tab: undefined });
    const bar = host(mounted, "ExplorerBarStub");
    expect(bar).toHaveLength(1);
    expect(bar[0].props.canReserve).toBe(true);
    expect(bar[0].props.bookingKind).toBe("table");
    expect(mounted.root.findAll((n) => n.props?.testID === "issue-2729-reserve-bar")).toHaveLength(0);
    expect(mounted.root.findAll((n) => n.props?.testID === "issue-2729-reserve-cta")).toHaveLength(0);
    const sheetBefore = host(mounted, "VenueReserveSheetStub");
    expect(sheetBefore.every((s) => s.props.visible !== true)).toBe(true);
    TestRenderer.act(() => {
      (bar[0].props.onReserve as () => void)();
    });
    const sheetAfter = host(mounted, "VenueReserveSheetStub");
    expect(sheetAfter).toHaveLength(1);
    expect(sheetAfter[0].props.visible).toBe(true);
    expect(analyticsEvents.some((e) => e.event === "public_venue_reservation_started" && e.props.source_tab === "host_action_bar")).toBe(true);
    mounted.unmount();
  });

  test("X-3 a hand-off for another place is ignored", async () => {
    handoffModule.setDeckVenueHandoff(handoffFor("44444444-4444-4444-8444-444444444444"));
    const mounted = await mountSettled({ venue: consumerVenue("restaurant"), stayDetail: null, stayState: "ready", tab: undefined });
    expect(host(mounted, "ExplorerBarStub")).toHaveLength(0);
    expect(mounted.root.findAll((n) => n.props?.testID === "issue-2729-reserve-bar").length).toBeGreaterThan(0);
    mounted.unmount();
  });

  test("X-4 a venue that is not public still has a Close", async () => {
    const mounted = await mountSettled({ venue: null, stayDetail: null, stayState: "ready", tab: undefined });
    expect(mounted.json).toContain("Venue not found");
    // #4347 rework (A-6) — the Close is the route's STATIC leaf module now, so
    // it is the real button here, not a stub of the lazy layer.
    const close = mounted.root.findAll(
      (n) => typeof n.type !== "string" && n.props?.testID === "venue-state-close",
    );
    expect(close).toHaveLength(1);
    expect(close[0].props.accessibilityLabel).toBe("Close");
    expect(typeof close[0].props.onPress).toBe("function");
    mounted.unmount();
  });

  test("X-5 the deck hand-off is released when its visit closes", async () => {
    handoffModule.setDeckVenueHandoff(handoffFor(PLACE));
    const fromDeck = await mountSettled({ venue: consumerVenue("restaurant"), stayDetail: null, stayState: "ready", tab: undefined });
    expect(host(fromDeck, "ExplorerBarStub")).toHaveLength(1);
    fromDeck.unmount();
    const again = await mountSettled({ venue: consumerVenue("restaurant"), stayDetail: null, stayState: "ready", tab: undefined });
    expect(host(again, "ExplorerBarStub")).toHaveLength(0);
    expect(again.root.findAll((n) => n.props?.testID === "issue-2729-reserve-bar").length).toBeGreaterThan(0);
    again.unmount();
  });

  test("X-6 on the Reservations tab the Explorer bar offers no second Reserve", async () => {
    handoffModule.setDeckVenueHandoff(handoffFor(PLACE));
    const mounted = await mountSettled({ venue: consumerVenue("restaurant"), stayDetail: null, stayState: "ready", tab: "reservations" });
    const bar = host(mounted, "ExplorerBarStub");
    expect(bar).toHaveLength(1);
    expect(bar[0].props.canReserve).toBe(false);
    mounted.unmount();
  });
});
