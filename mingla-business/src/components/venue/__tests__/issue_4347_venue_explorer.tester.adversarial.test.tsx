/**
 * #4347 wave 4 — TESTER ADVERSARIAL: the consumer venue route's Explorer layer
 * on the SHARED venue page, mounted for real (same harness as
 * issue_4347_venue_explorer_slots.implementor.happy.test.tsx; only the lazily
 * loaded Explorer layer is stubbed, and here the stub can be made to FAIL).
 *
 *   A-1 a failing Explorer bar must not take the page's reserve action with it
 *       (the boundary renders nothing, but the page has already dropped its
 *       own reserve bar for it) — was pinned (P2), fixed in the rework;
 *   A-2 a deck hand-off is for ONE visit: after the page that used it closes,
 *       the same venue reached again (a shared link, Discover) must not show
 *       the deck bar acting on the old card — was pinned (P2), fixed in the rework;
 *   A-3 a second venue tapped on the deck replaces the first hand-off; the
 *       first venue's page keeps its own reserve bar;
 *   A-4 the Reservations tab: never two reserve buttons on screen (the pane's
 *       own CTA and the bar's) — was pinned (P3), fixed in the rework;
 *   A-5 a Stay from the deck: the bar gets the Stay rail and its gate; the
 *       page's reserve bar is gone, and the Overview block still renders; a
 *       NEW deck tap on a table venue (the Stay visit released its hand-off)
 *       shows the deck bar and not the page's own;
 *   A-6 the loading / error / not-found Close must survive the Explorer
 *       layer failing to load — was pinned (P3), fixed in the rework.
 *
 * FAILS-ON-REVERT (verified by the tester in an isolated worktree, see #4347):
 *   - getDeckVenueHandoff without the placePoolId match -> A-3 fails;
 *   - PublicVenueScreen's web reserve bar without `!hasHostActionBar` -> A-5
 *     fails. (This jest config resolves react-native to react-native-web, so
 *     Platform.OS is "web": the NATIVE branch of the swap is not exercised by
 *     any suite.)
 */
import React from "react";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

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


// ---- #4347 wave 4: the lazily loaded Explorer layer, stubbed, and breakable --
const failing: { bar: boolean; close: boolean } = { bar: false, close: false };
jest.mock(
  "../../../../../app-mobile/src/components/venuePage/VenueExplorerLayer",
  () => {
    const ReactLocal = require("react") as typeof React;
    return {
      __esModule: true,
      VenueExplorerOverview: () => ReactLocal.createElement("ExplorerOverviewStub", null),
      VenueExplorerBar: (props: { context: Record<string, unknown> }) => {
        if (failing.bar) throw new Error("explorer bar failed");
        return ReactLocal.createElement("ExplorerBarStub", {
          canReserve: props.context.canReserve,
          bookingKind: props.context.bookingKind,
          reserveAction: props.context.reserveAction,
          onReserve: props.context.openReservation,
        });
      },
      VenueStateClose: (props: { onPress: () => void }) => {
        if (failing.close) throw new Error("explorer layer failed to load");
        return ReactLocal.createElement("StateCloseStub", { onPress: props.onPress });
      },
    };
  },
);

const handoffModule = require("../../../../../app-mobile/src/components/venuePage/deckVenueHandoff") as {
  setDeckVenueHandoff: (entry: Record<string, unknown>) => void;
  clearDeckVenueHandoff: () => void;
};

const PLACE = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const handoffFor = (placePoolId: string): Record<string, unknown> => ({
  placePoolId,
  card: { id: `card-${placePoolId}`, title: "Academy Street Bistro" },
  currentMode: "solo",
  isSaved: false,
  save: async () => undefined,
  canAccessCurated: true,
});

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
const byTestId = (mounted: Mounted, id: string): TestInstance[] =>
  mounted.root.findAll((node) => node.props?.testID === id);
const restaurant = (tab?: string): CaseData => ({ venue: consumerVenue("restaurant"), stayDetail: null, stayState: "ready", tab });

// The route's Explorer chunks are React.lazy. Their FIRST resolution inside a
// synchronous act() while the deck bar is also suspended spins act's microtask
// queue until the heap runs out (a harness artifact: the same cold mount
// outside act() settles in ~1s). Warm them once, with no hand-off, before any
// case mounts the bar. (The implementor's X-2 depends on X-1 for the same
// reason: `-t X-2` alone runs out of memory.)
beforeAll(async () => {
  const warm = await mountSettled(restaurant());
  warm.unmount();
});

let warn: ReturnType<typeof jest.spyOn> | null = null;
let errorSpy: ReturnType<typeof jest.spyOn> | null = null;
beforeEach(() => {
  warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  handoffModule.clearDeckVenueHandoff();
  failing.bar = false;
  failing.close = false;
  warn?.mockRestore();
  errorSpy?.mockRestore();
});

describe("#4347 wave 4 — tester adversarial: the Explorer layer on the shared venue page", () => {
  // P2 (was pinned; fixed in the wave 4 rework): the route's actionBar returns the boundary ELEMENT, so the
  // shared screen sees a host bar and drops its own reserve bar; when the
  // lazy bar then fails, the boundary renders null and nothing books.
  test("A-1 (P2) a failing Explorer bar leaves the page a way to reserve", async () => {
    handoffModule.setDeckVenueHandoff(handoffFor(PLACE));
    failing.bar = true;
    const mounted = await mountSettled(restaurant());
    expect(host(mounted, "ExplorerBarStub").length).toBe(0);
    expect(byTestId(mounted, "issue-2729-reserve-bar").length).toBeGreaterThan(0);
    mounted.unmount();
  });

  // P2 (was pinned; fixed in the wave 4 rework): the hand-off is only cleared at sign-out, so it outlives the visit.
  test("A-2 (P2) after the deck's visit closes, the same venue from a link has no deck bar", async () => {
    handoffModule.setDeckVenueHandoff(handoffFor(PLACE));
    const fromDeck = await mountSettled(restaurant());
    expect(host(fromDeck, "ExplorerBarStub").length).toBe(1);
    fromDeck.unmount();
    // Later: the same venue from a shared link. Nothing on the deck was tapped.
    const fromLink = await mountSettled(restaurant());
    expect(host(fromLink, "ExplorerBarStub").length).toBe(0);
    expect(byTestId(fromLink, "issue-2729-reserve-bar").length).toBeGreaterThan(0);
    fromLink.unmount();
  });

  test("A-3 a second venue tapped on the deck replaces the first hand-off", async () => {
    handoffModule.setDeckVenueHandoff(handoffFor(PLACE));
    handoffModule.setDeckVenueHandoff(handoffFor(OTHER));
    const mounted = await mountSettled(restaurant());
    expect(host(mounted, "ExplorerBarStub").length).toBe(0);
    expect(byTestId(mounted, "issue-2729-reserve-bar").length).toBeGreaterThan(0);
    mounted.unmount();
  });

  // P3 (was pinned; fixed in the wave 4 rework): the shared bar hides on the Reservations tab (its pane has the
  // CTA); the Explorer bar gets canReserve = the sheet gate and stays.
  test("A-4 (P3) the Reservations tab never shows two reserve buttons", async () => {
    handoffModule.setDeckVenueHandoff(handoffFor(PLACE));
    const mounted = await mountSettled(restaurant("reservations"));
    const bar = host(mounted, "ExplorerBarStub");
    const paneCta = mounted.root.findAll(
      (n) => typeof n.type !== "string" && n.props?.accessibilityRole === "button" && n.props?.accessibilityLabel === "Reserve a table" && typeof n.props?.onPress === "function",
    );
    const barReserves = bar.filter((b) => b.props.canReserve === true).length;
    expect(barReserves + paneCta.length).toBeLessThanOrEqual(1);
    mounted.unmount();
  });

  test("A-5 a Stay from the deck: the bar gets the Stay rail, the page bar is gone, the Overview block stays", async () => {
    handoffModule.setDeckVenueHandoff(handoffFor(PLACE));
    const mounted = await mountSettled({ venue: consumerVenue("stay"), stayDetail: STAY_DETAIL, stayState: "ready", tab: undefined });
    const bar = host(mounted, "ExplorerBarStub");
    expect(bar.length).toBe(1);
    expect(bar[0].props.bookingKind).toBe("stay");
    expect(typeof bar[0].props.reserveAction).toBe("string");
    expect(byTestId(mounted, "issue-2729-reserve-bar").length).toBe(0);
    expect(host(mounted, "ExplorerOverviewStub").length).toBe(1);
    mounted.unmount();
    // The Stay visit released its hand-off (A-2). A NEW deck tap on a table
    // venue: the deck bar shows and the page's own reserve bar does not, so
    // there is exactly one bar carrying the reserve action.
    handoffModule.setDeckVenueHandoff(handoffFor(PLACE));
    const table = await mountSettled(restaurant());
    expect(host(table, "ExplorerBarStub").length).toBe(1);
    expect(byTestId(table, "issue-2729-reserve-bar").length).toBe(0);
    table.unmount();
  });

  // P3 (was pinned; fixed in the wave 4 rework): VenueStateClose lives in the lazily loaded layer module, so a
  // load failure there hides the only way out of a page that could not load.
  test("A-6 (P3) Venue not found keeps a Close when the Explorer layer fails to load", async () => {
    failing.close = true;
    const mounted = await mountSettled({ venue: null, stayDetail: null, stayState: "ready", tab: undefined });
    expect(mounted.json).toContain("Venue not found");
    const closes = mounted.root.findAll(
      (n) => typeof n.props?.onPress === "function" && /close/i.test(String(n.props?.accessibilityLabel ?? n.type)),
    );
    expect(closes.length).toBeGreaterThan(0);
    mounted.unmount();
  });
});
