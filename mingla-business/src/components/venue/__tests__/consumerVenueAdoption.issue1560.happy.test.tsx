/**
 * #1560 [consumer-adopts-shared] — IMPLEMENTOR happy-path proof.
 *
 * Step 4 of #1550 deletes `app-mobile/src/screens/ConsumerPublicVenueScreen.tsx`
 * and turns `app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx` into an adapter
 * over the shared `PublicVenueScreen`.
 *
 * RENDER PARITY IS NOT THE CRITERION HERE. #1559 was a pure move and had a
 * byte-identical baseline to hold to; this step deliberately CHANGES what the
 * consumer app draws. So the proof is per-capability: for each thing the
 * consumer app did not have, mount the REAL route and find the thing.
 *
 * WHAT IS PROVED, and what the old screen did instead:
 *   G-1 MAP           — a static-map Image. Old: `lat`/`lng` were fetched by
 *                       `select("*")` and dropped by the mapper; the 627-line
 *                       screen contained zero `lat` references.
 *   G-2 ADDRESS TAP   — the address card is a Pressable with a real `onPress`
 *                       and an "Open in maps" hint, and pressing it calls
 *                       `Linking.openURL`. Old: a plain `View` with the
 *                       identical "WHERE YOU'LL BE" label and no handler.
 *   G-3 FULL GALLERY  — all N photographs render. Old: `.slice(0, 4)`.
 *   G-4 BOOKING       — a reserve control exists for a NON-STAY *and* for a
 *                       STAY. Old: the CTA was gated on `!isStay`, so a hotel
 *                       had no way to book at all, and what did render read
 *                       "Find a table" — a fourth competing reserve string.
 *   G-5 BRAND FONT    — `loadThemeFont` is called with the resolved family.
 *                       Old: no `fontFamily` anywhere on the screen.
 *   G-6 PITCH CLAMP   — "Read more" appears for a long pitch.
 *   G-7 TYPICAL SPEND — the discovery-price lede renders from real RPC data.
 *   G-8 ONE OWNER     — the fork file is gone from disk.
 *
 * VACUITY GUARDS — #1559's size floor caught a harness that rendered `null`
 * seven times, where seven `null === null` comparisons would have "passed" and
 * proved nothing. Everything below is built on that lesson:
 *   V-1 a MOUNT FLOOR: every case's serialised tree must exceed a size that a
 *       null / error / not-found render cannot reach;
 *   V-2 an ANTI-ANCHOR per case: the tree must NOT contain the state-view copy
 *       ("Venue not found" / "could not load"), so a failed query masquerading
 *       as a render is caught rather than measured;
 *   V-3 every capability lookup asserts on a value derived from the tree, never
 *       on the mere absence of an exception, and `expect.assertions` pins the
 *       count so a `for` loop that iterates zero times fails;
 *   V-4 the gallery assertion counts EXACTLY the fixture's photo count and the
 *       fixture deliberately carries 7 (> 4), so the old `.slice(0, 4)` would
 *       fail rather than coincide.
 *
 * APPEND-ONLY — new file; modifies/deletes no existing test.
 */
import React from "react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// `mingla-business/src/constants/platformUrl.ts` throws at module load without
// this; the shared package chain reaches it through the offering-rendering
// barrel used below.
process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL = "https://business.usemingla.com";

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
jest.mock("@mingla/offering-rendering", () => {
  const ReactLocal = require("react") as typeof React;
  const themeResolver = require("../../../../../packages/offering-rendering/themeResolver");
  const themePalette = require("../../../../../packages/offering-rendering/themePalette");
  const mapboxStaticImage = require("../../../../../packages/offering-rendering/mapboxStaticImage");
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
    ...mapboxStaticImage,
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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const routeModule = require(CONSUMER_ROUTE);
  const Route = (routeModule.default ?? routeModule) as React.ComponentType;
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

const findPressables = (
  root: TestInstance,
  label: string,
): TestInstance[] =>
  root.findAll(
    (node) =>
      node.props.accessibilityRole === "button" &&
      node.props.accessibilityLabel === label,
  );

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

describe("#1560 the consumer app adopts the shared venue page", () => {
  test("G-8 the forked screen is gone — exactly one file renders this page", () => {
    expect(
      existsSync(
        join(REPO_ROOT, "app-mobile/src/screens/ConsumerPublicVenueScreen.tsx"),
      ),
    ).toBe(false);
    // ...and the route that replaced it is real, not an empty stub.
    expect(
      existsSync(
        join(REPO_ROOT, "app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx"),
      ),
    ).toBe(true);
  });

  test("G-1 a restaurant now renders the MAP the buyer page always had", () => {
    expect.assertions(6);
    const mounted = mountRoute({
      venue: consumerVenue("restaurant"),
      stayDetail: null,
      stayState: "ready",
      tab: undefined,
    });
    assertRealRender(mounted, "map");
    // The static map is fetched ONLY through the vendor-neutral `static-map`
    // proxy; the URL is built from the venue's lat/lng, which is the exact pair
    // the old mapper dropped. Asserting on the coordinates (not just "an image
    // exists") is what makes this fail if lat/lng go missing again.
    expect(mounted.json).toContain("static-map");
    expect(mounted.json).toContain("51.5361");
    mounted.unmount();
  });

  test("G-2 the address card is TAPPABLE and opens maps", () => {
    expect.assertions(8);
    const mounted = mountRoute({
      venue: consumerVenue("restaurant"),
      stayDetail: null,
      stayState: "ready",
      tab: undefined,
    });
    assertRealRender(mounted, "address");
    expect(mounted.json).toContain("Open in maps");
    // `findAll` returns the composite Pressable AND the host node it renders,
    // so the count is >= 1 rather than exactly 1; what matters is that at least
    // one node carries this accessible name AND a live handler.
    const cards = findPressables(
      mounted.root,
      "Open Academy Street Bistro in maps",
    );
    expect(cards.length).toBeGreaterThanOrEqual(1);
    const onPress = cards[0]?.props.onPress;
    expect(typeof onPress).toBe("function");
    openedUrls.length = 0;
    TestRenderer.act(() => {
      (onPress as () => void)();
    });
    // The dead card in the deleted screen had no handler at all, so this is
    // the assertion that separates "an address is printed" from "it works".
    expect(openedUrls).toEqual([
      "https://www.google.com/maps/search/?api=1&query=12%20Academy%20Street%2C%20London%20N1%204AB",
    ]);
    mounted.unmount();
  });

  test("G-3 EVERY photograph renders, not the first four", () => {
    expect.assertions(5 + GALLERY.length);
    const mounted = mountRoute({
      venue: consumerVenue("restaurant"),
      stayDetail: null,
      stayState: "ready",
      tab: undefined,
    });
    assertRealRender(mounted, "gallery");
    // GALLERY carries 7 URLs on purpose: `.slice(0, 4)` would drop g5..g7.
    expect(GALLERY.length).toBeGreaterThan(4);
    for (const url of GALLERY) {
      expect(mounted.json.includes(url) ? url : `MISSING:${url}`).toBe(url);
    }
    mounted.unmount();
  });

  test("G-4a a NON-STAY has a booking button, wired to the reserve sheet", () => {
    expect.assertions(9);
    const mounted = mountRoute({
      venue: consumerVenue("restaurant"),
      stayDetail: null,
      stayState: "ready",
      tab: undefined,
    });
    assertRealRender(mounted, "book-restaurant");
    // The wording is the category profile's ONE verb — never "Find a table",
    // the fourth string the deleted screen hardcoded.
    const ctas = findPressables(mounted.root, "Reserve a table");
    expect(ctas.length).toBeGreaterThanOrEqual(1);
    expect(mounted.json).not.toContain("Find a table");
    const onPress = ctas[0]?.props.onPress;
    expect(typeof onPress).toBe("function");
    analyticsEvents.length = 0;
    TestRenderer.act(() => {
      (onPress as () => void)();
    });
    // Pressing it must actually raise the native reserve rail — the sheet's
    // `visible` prop is the one owner of that state, so reading it back off the
    // rendered stub is the difference between "a button exists" and "it books".
    const sheetVisibility = mounted.root
      .findAll((n) => n.type === "VenueReserveSheetStub")
      .map((n) => n.props.visible);
    expect(sheetVisibility).toContain(true);
    expect(analyticsEvents.map((e) => e.event)).toContain(
      "public_venue_reservation_started",
    );
    mounted.unmount();
  });

  test("G-4c the RESERVATIONS pane can book on its own", () => {
    expect.assertions(8);
    // Deep-linked straight to ?tab=reservations. The shared sticky bar is
    // deliberately hidden on that tab (it would duplicate an inline form), so
    // on this surface — whose booking rail is a MODAL that cannot render as a
    // pane — the pane's own control is the only way through. Without it the
    // Reservations tab is a dead end, which is what the consumer app shipped.
    const mounted = mountRoute({
      venue: consumerVenue("restaurant"),
      stayDetail: null,
      stayState: "ready",
      tab: "reservations",
    });
    assertRealRender(mounted, "reservations-pane", 2000);
    expect(mounted.json).toContain("Choose your party, date, and a real available time.");
    const ctas = findPressables(mounted.root, "Reserve a table");
    expect(ctas.length).toBeGreaterThanOrEqual(1);
    const onPress = ctas[0]?.props.onPress;
    expect(typeof onPress).toBe("function");
    TestRenderer.act(() => {
      (onPress as () => void)();
    });
    expect(
      mounted.root
        .findAll((n) => n.type === "VenueReserveSheetStub")
        .map((n) => n.props.visible),
    ).toContain(true);
    mounted.unmount();
  });

  test("G-4b a STAY has a booking button — it previously had NONE", () => {
    expect.assertions(8);
    const mounted = mountRoute({
      venue: consumerVenue("stay"),
      stayDetail: STAY_DETAIL,
      stayState: "ready",
      tab: undefined,
    });
    assertRealRender(mounted, "book-stay");
    // The deleted screen gated its CTA on `!isStay`, so this control did not
    // exist on a hotel at all — no accessible name, no press target.
    const ctas = findPressables(mounted.root, "Reserve this Stay");
    expect(ctas.length).toBeGreaterThanOrEqual(1);
    expect(typeof ctas[0]?.props.onPress).toBe("function");
    // ...and the Stay page shows check-in/check-out where a restaurant shows
    // trading hours, so the hotel is not being handed a restaurant's screen.
    expect(mounted.json).toContain("CHECK-IN");
    expect(mounted.json).toContain("15:00");
    mounted.unmount();
  });

  test("G-5/G-6/G-7 brand font, pitch clamp and typical spend all land", () => {
    expect.assertions(8);
    themeFontRequests.length = 0;
    const mounted = mountRoute({
      venue: consumerVenue("restaurant"),
      stayDetail: null,
      stayState: "ready",
      tab: undefined,
    });
    assertRealRender(mounted, "theme");
    // G-5 — the deleted screen never applied a brand font anywhere.
    expect(themeFontRequests).toContain("Inter_500Medium");
    expect(mounted.json).toContain("Inter_500Medium");
    // G-6 — the pitch is long enough to clamp, so the toggle must be offered.
    expect(mounted.json).toContain("Read more");
    // G-7 — the typical-spend lede, from the discovery-price band the consumer
    // read model did not carry before this step.
    expect(mounted.json).toContain("Typical spend");
    mounted.unmount();
  });

  test("the shared screen is the ONLY thing the route renders", () => {
    expect.assertions(6);
    const mounted = mountRoute({
      venue: consumerVenue("restaurant"),
      stayDetail: null,
      stayState: "ready",
      tab: undefined,
    });
    assertRealRender(mounted, "one-owner");
    // The identity block, hours table and gallery label all come from the
    // shared module; the route contributes none of them.
    expect(mounted.json).toContain("VERIFIED VENUE");
    // ...and the route still mirrors the shared screen's analytics into the
    // organic-engagement capture, which is the wiring the deleted screen owned.
    expect(organicEvents).toContain("page_view");
    mounted.unmount();
  });
});
