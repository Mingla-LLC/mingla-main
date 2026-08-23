/**
 * issue #1562 [hours-and-price], step 6 of #1550 — DOES IT REACH THE PAGE.
 *
 * `venueOpenState.issue1562.happy.test.ts` proves the RESOLVER is right across
 * a faked clock: every status, the boundary minute at both ends, an overnight
 * span, a split day, and a timezone the machine is not in. It proves nothing
 * about whether any of that is drawn. This file mounts the REAL route and reads
 * the REAL rendered tree, which is the half that #1484 taught this repo cannot
 * be inferred: twenty-nine green headless tests and a desktop uncap that was
 * broken on live web.
 *
 * DETERMINISM WITHOUT FAKING THE CLOCK. `PublicVenueScreen` calls `new Date()`
 * itself (it must — "open now" is about the real moment), so a fixture with
 * ordinary 09:00–17:00 hours would make this file flip colour twice a day. The
 * two venue fixtures are therefore chosen so their answer is the same at EVERY
 * instant:
 *
 *   ALWAYS-OPEN    seven days of 00:00–00:00. `close == open` is a full 24
 *                  hours, so the venue is open at every minute of every week.
 *   ALWAYS-CLOSED  seven days flagged closed. Shut at every minute.
 *
 * Both carry a REAL timezone the CI machine is not in, so the rendered strings
 * still come out of the same `Intl` path production uses — this is not a
 * bypass, it is a fixture whose answer does not depend on when it runs.
 *
 * WHAT EACH ASSERTION WOULD CATCH:
 *   - "Right now / Open" missing ⇒ the open-now state did not reach the answer
 *     bar and a phone is back to a bare 24-hour table;
 *   - it present at 1440 but not at 360 ⇒ the indicator is desktop-only again,
 *     which is exactly the defect (the old line rendered ONLY on desktop);
 *   - the hours-card line missing ⇒ the week table is back to seven rows with
 *     no answer at the top of them;
 *   - the STAY carrying a "Right now" cell ⇒ a hotel is advertising trading
 *     hours again, the #1550 Leg C contradiction;
 *   - the price cell's three lines ⇒ the from-rate, the qualifier that must
 *     travel with it, and the quoted total that must REPLACE it.
 *
 * VACUITY GUARDS. Every lookup throws when it finds nothing; a minimum tree
 * size proves the page rendered at all; `expect.assertions` pins each count;
 * and each absence claim is paired with a presence claim on the same tree.
 *
 * APPEND-ONLY — new file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest venueFirstScreen.issue1562 --runInBand
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import type { VenueCategory } from "@mingla/brand-rendering/venueCategoryProfile";
import {
  resolveVenueStayRate,
  venueStayRateQualifier,
  venueStayRateRangeLine,
  type VenueStayRateOffering,
} from "@mingla/brand-rendering/venueStayRate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL = "https://host.usemingla.com";

const viewport: { isDesktop: boolean; width: number } = {
  isDesktop: false,
  width: 390,
};

interface CaseData {
  venue: Record<string, unknown> | null;
  menu: unknown[];
  reservable: Record<string, unknown> | null;
  reservableState: "loading" | "ready" | "error";
  discoveryPrice: Record<string, unknown> | null;
  stayDetail: Record<string, unknown> | null;
  stayState: "loading" | "ready" | "unavailable" | "error";
}
const caseData: { current: CaseData } = {
  current: {
    venue: null,
    menu: [],
    reservable: null,
    reservableState: "ready",
    discoveryPrice: null,
    stayDetail: null,
    stayState: "ready",
  },
};

/**
 * The route's own params. `tab` is mutable because the Stay booking body — the
 * component that PRODUCES a quote — is only mounted while the Reservations tab
 * is active. A quote case that stayed on Overview would never fire
 * `onQuoteChange` and would "prove" the swap against a callback that was never
 * called. The answer bar itself sits ABOVE the tabs and is drawn on both, which
 * is exactly why the swap is visible to a guest at the moment it happens.
 */
const routeParams: { tab: string | undefined } = { tab: undefined };

jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => ({
    brandSlug: "smokerhythm",
    venueSlug: "academy-street-bistro",
    tab: routeParams.tab,
  }),
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    back: () => undefined,
    canGoBack: () => true,
  }),
}));

jest.mock("expo-router/head", () => {
  const ReactLocal = require("react") as typeof React;
  const Head = (props: { children?: React.ReactNode }): React.ReactElement =>
    ReactLocal.createElement("ExpoHead", null, props.children);
  return { __esModule: true, default: Head };
});

jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock("@mingla/offering-rendering", () => {
  const ReactLocal = require("react") as typeof React;
  const themeResolver = require("../../../../../packages/offering-rendering/themeResolver");
  const themePalette = require("../../../../../packages/offering-rendering/themePalette");
  const mapboxStaticImage = require("../../../../../packages/offering-rendering/mapboxStaticImage");
  // [TEST-MOD-APPROVED #2468] Harness registration only — ADDITION, no
  // assertion changed. maps-deep-link-coordinates gave every "open in maps"
  // URL one owner (packages/offering-rendering/mapsDeepLink), and the shared
  // venue screen now reads its maps target from it. Registering the REAL module
  // matches this factory's rule of spreading the real pure helpers.
  const mapsDeepLink = require("../../../../../packages/offering-rendering/mapsDeepLink");
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
      ReactLocal.createElement("ShellHeroEyebrow", null, heroEyebrow),
      ReactLocal.createElement("ShellHeroTitle", null, heroTitle),
      ReactLocal.createElement("ShellStickyPanel", null, stickyPanel),
      ReactLocal.createElement("ShellBody", null, children),
    );
  };
  return {
    __esModule: true,
    ...themeResolver,
    ...themePalette,
    ...mapboxStaticImage,
    ...mapsDeepLink,
    useResponsiveLayout: () => ({
      width: viewport.width,
      isDesktop: viewport.isDesktop,
      isPhone: !viewport.isDesktop,
      isWeb: true,
    }),
    ParallaxCoverShell,
  };
});

jest.mock("../../../theme/useThemeFont", () => ({
  __esModule: true,
  useThemeFont: () => ({ loaded: true }),
  loadThemeFont: async () => undefined,
}));

jest.mock("../../../analytics/webAnalytics", () => ({
  __esModule: true,
  captureWeb: () => undefined,
  captureAdClickIds: () => undefined,
}));

jest.mock("../../../services/venueOrganicCaptureService", () => ({
  __esModule: true,
  captureVenueOrganicEvent: async () => undefined,
  settleVenueOrganicJourneyOnConsent: async () => undefined,
}));

jest.mock("../../../services/venueOrganicCapturePolicy", () => ({
  __esModule: true,
  runBuyerVenueOrganicCapture: (_surface: string, run: () => void) => run(),
  settleBuyerVenueOrganicCapture: () => () => undefined,
}));

jest.mock("../../../hooks/usePublicEvents", () => ({
  __esModule: true,
  usePublicVenueBySlug: () => ({
    data: caseData.current.venue,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
  usePublicBrandBySlug: () => ({ data: null, isLoading: false, isError: false }),
  usePublicVenueReservable: () => ({
    data: caseData.current.reservable,
    isLoading: caseData.current.reservableState === "loading",
    isError: caseData.current.reservableState === "error",
    refetch: async () => undefined,
  }),
  usePublicVenueDiscoveryPrice: () => ({
    data: caseData.current.discoveryPrice,
    isLoading: false,
    isError: false,
  }),
}));

jest.mock("../../../hooks/useMenus", () => ({
  __esModule: true,
  usePublicMenus: () => ({
    data: caseData.current.menu,
    isLoading: false,
    isError: false,
  }),
}));

jest.mock("../../../hooks/usePublicStayDetail", () => ({
  __esModule: true,
  usePublicStayDetail: () => ({
    data: caseData.current.stayDetail,
    isLoading: caseData.current.stayState === "loading",
    isError: caseData.current.stayState === "error",
  }),
}));

/**
 * The Stay booking body is stubbed, and the QUOTE is driven through the SAME
 * `onQuoteChange` callback the real component calls — so the swap under test is
 * the real wiring (body → route state → screen prop → answer bar), not a prop
 * poked directly at the screen. `quoteToReport` is what a case sets.
 */
const quoteToReport: {
  current: { totalMinor: string; currencyCode: string } | null;
} = { current: null };

jest.mock("../../../components/stay/BuyerStayGuestExperience", () => {
  const ReactLocal = require("react") as typeof React;
  const BuyerStayGuestExperience = (props: {
    onQuoteChange?: (
      quote: { totalMinor: string; currencyCode: string } | null,
    ) => void;
  }): null => {
    const { onQuoteChange } = props;
    ReactLocal.useEffect(() => {
      if (onQuoteChange !== undefined) onQuoteChange(quoteToReport.current);
    }, [onQuoteChange]);
    return null;
  };
  return { __esModule: true, BuyerStayGuestExperience };
});

jest.mock("../GuestVenueReservation", () => ({
  __esModule: true,
  GuestVenueReservation: () => null,
}));

jest.mock("../PublicVenueReservationSheet", () => {
  const ReactLocal = require("react") as typeof React;
  const PublicVenueReservationSheet = (props: {
    visible: boolean;
  }): React.ReactElement =>
    ReactLocal.createElement("ReservationSheetStub", { visible: props.visible });
  return { __esModule: true, PublicVenueReservationSheet };
});

jest.mock("../../ui/ShareModal", () => ({
  __esModule: true,
  ShareModal: () => null,
}));

jest.mock("../PublicVenueNotFound", () => ({
  __esModule: true,
  PublicVenueNotFound: () => null,
}));

interface MountedTree {
  toJSON: () => unknown;
  unmount: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => MountedTree;
  act: ((callback: () => void) => void) &
    ((callback: () => Promise<void>) => Promise<void>);
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PublicVenueRoute =
  require("../../../../app/b/[brandSlug]/v/[venueSlug]").default as React.ComponentType;

// ---------------------------------------------------------------------------
// Fixtures — chosen so their answer does not depend on when the suite runs.
// ---------------------------------------------------------------------------

/** 00:00–00:00 seven days: `close == open` ⇒ a full 24 hours, always open. */
const ALWAYS_OPEN_HOURS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  openTime: "00:00",
  closeTime: "00:00",
  isClosed: false,
}));

/** Seven closed days: shut at every instant, and KNOWN to be. */
const ALWAYS_CLOSED_HOURS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  openTime: null,
  closeTime: null,
  isClosed: true,
}));

/** Ordinary hours, used only where the case does NOT read the open state. */
const WEEKDAY_HOURS = [
  { weekday: 0, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { weekday: 1, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { weekday: 2, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { weekday: 3, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { weekday: 4, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { weekday: 5, openTime: "10:00", closeTime: "23:00", isClosed: false },
  { weekday: 6, openTime: null, closeTime: null, isClosed: true },
];

/**
 * The three LIVE offerings the production Miami Stay publishes, read off
 * `stay_offerings` + `stay_price_versions` on 2026-08-04. The `place` cabana is
 * the cheapest row and is NOT a night — its presence is what makes "$275"
 * evidence of a correct reduction rather than of any reduction.
 */
const STAY_OFFERINGS: VenueStayRateOffering[] = [
  {
    price: {
      amountMinor: "7500",
      currencyCode: "USD",
      pricingUnit: "place_booking",
    },
    fees: [{ displayMode: "separate" }],
  },
  {
    price: {
      amountMinor: "35000",
      currencyCode: "USD",
      pricingUnit: "room_night",
    },
    fees: [{ displayMode: "separate" }],
  },
  {
    price: {
      amountMinor: "27500",
      currencyCode: "USD",
      pricingUnit: "room_night",
    },
    fees: [{ displayMode: "separate" }],
  },
];

/** The same property, with every fee marked included by the hotel. */
const ALL_IN_OFFERINGS: VenueStayRateOffering[] = STAY_OFFERINGS.map(
  (offering) => ({
    price: offering.price,
    fees: offering.fees.map(() => ({ displayMode: "included" as const })),
  }),
);

const stayDetail = (
  offerings: VenueStayRateOffering[],
): Record<string, unknown> => ({
  venueId: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  brandSlug: "smokerhythm",
  brandName: "Smoke & Rhythm",
  venueSlug: "academy-street-bistro",
  venueName: "The Bayshore",
  propertyKind: "hotel",
  timezone: "America/New_York",
  defaultBookingMode: "instant",
  checkInTime: "15:00:00",
  checkOutTime: "11:00:00",
  bookingHorizonDays: 365,
  houseRules: null,
  offerings,
});

const RESERVABLE = {
  reservable: true,
  venueId: "11111111-1111-4111-8111-111111111111",
  currency: "USD",
};

const baseVenue = (
  venueCategory: VenueCategory | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  brandSlug: "smokerhythm",
  brandName: "Smoke & Rhythm",
  slug: "academy-street-bistro",
  name: "Academy Street Bistro",
  address: "12 Academy Street, London N1 4AB",
  city: "London",
  countryCode: "GB",
  lat: 51.5361,
  lng: -0.1035,
  venueCategory,
  contactEmail: "hello@example.com",
  contactPhone: "+442071234567",
  coverMediaUrl: "https://cdn.example.com/cover.jpg",
  coverMediaType: "image",
  placePoolId: "33333333-3333-4333-8333-333333333333",
  theme: { color: "#eb7825", font: "inter", animation: null },
  coverHue: 24,
  defaultCurrency: "GBP",
  hours: WEEKDAY_HOURS,
  // A zone the CI runner is not in, so the rendered strings come out of the
  // same `Intl` path production uses rather than the machine's own clock.
  timezone: "America/New_York",
  galleryPhotoUrls: ["https://cdn.example.com/cover.jpg"],
  pitch: "A neighbourhood bistro with an open fire and a short weekly menu.",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tree walking — every lookup THROWS when it finds nothing.
// ---------------------------------------------------------------------------

interface TreeNode {
  type: string;
  props?: Record<string, unknown>;
  children?: (TreeNode | string)[] | null;
}

const walk = (node: unknown, out: TreeNode[]): TreeNode[] => {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (typeof node !== "object") return out;
  const candidate = node as TreeNode;
  if (typeof candidate.type === "string") out.push(candidate);
  walk(candidate.children, out);
  return out;
};

const propsOf = (node: TreeNode): Record<string, unknown> => node.props ?? {};

const flatText = (node: TreeNode | string | null | undefined): string => {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (!Array.isArray(node.children)) return "";
  return node.children.map((child) => flatText(child)).join("");
};

interface Mounted {
  nodes: TreeNode[];
  json: string;
  unmount: () => void;
}

const mountCase = (
  data: CaseData,
  width: number,
  isDesktop: boolean,
  quote: { totalMinor: string; currencyCode: string } | null = null,
  tab: string | undefined = undefined,
): Mounted => {
  caseData.current = data;
  quoteToReport.current = quote;
  routeParams.tab = tab;
  viewport.width = width;
  viewport.isDesktop = isDesktop;
  let renderer: MountedTree | null = null;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(React.createElement(PublicVenueRoute));
  });
  if (renderer === null) {
    throw new Error("react-test-renderer produced no tree at all");
  }
  const instance: MountedTree = renderer;
  const tree = instance.toJSON();
  const nodes = walk(tree, []);
  const json = JSON.stringify(tree);
  // VACUITY FLOOR — #1559's harness rendered `null` seven times and only a size
  // floor noticed. Anything under this did not render the page, and every
  // presence/absence check below would be meaningless.
  if (json.length < 3000 || nodes.length < 40) {
    throw new Error(
      `VACUOUS RENDER — ${json.length} chars / ${nodes.length} nodes ` +
        "(floors 3000 / 40). The page did not render.",
    );
  }
  return {
    nodes,
    json,
    unmount: () => {
      TestRenderer.act(() => {
        instance.unmount();
      });
    },
  };
};

/**
 * The same mount, awaited.
 *
 * The Stay booking body is `React.lazy` on this route (#1390 keeps the Stripe
 * Payment Element off the buyer-web boot path), so its module resolves in a
 * MICROTASK. A synchronous `act` renders the Suspense FALLBACK and stops, which
 * means a sync mount can never observe anything the body does — including
 * calling `onQuoteChange`. An async `act` drains the microtask queue and lets
 * the real body mount, its effect run, the route's state update, and the answer
 * bar re-render, all inside one flush.
 *
 * This is the difference between testing the quote swap and testing a
 * suspense placeholder.
 */
const mountCaseAsync = async (
  data: CaseData,
  width: number,
  isDesktop: boolean,
  quote: { totalMinor: string; currencyCode: string } | null,
  tab: string | undefined,
): Promise<Mounted> => {
  caseData.current = data;
  quoteToReport.current = quote;
  routeParams.tab = tab;
  viewport.width = width;
  viewport.isDesktop = isDesktop;
  let renderer: MountedTree | null = null;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(PublicVenueRoute));
  });
  if (renderer === null) {
    throw new Error("react-test-renderer produced no tree at all");
  }
  const instance: MountedTree = renderer;
  // A second flush: the first resolved the lazy module and mounted the body;
  // the body's effect fires during it and sets state on the ROUTE, which is a
  // render this flush commits.
  await TestRenderer.act(async () => {
    await Promise.resolve();
  });
  const tree = instance.toJSON();
  const nodes = walk(tree, []);
  const json = JSON.stringify(tree);
  if (json.length < 3000 || nodes.length < 40) {
    throw new Error(
      `VACUOUS RENDER — ${json.length} chars / ${nodes.length} nodes.`,
    );
  }
  return {
    nodes,
    json,
    unmount: () => {
      TestRenderer.act(() => {
        instance.unmount();
      });
    },
  };
};

const findByTestId = (mounted: Mounted, testID: string): TreeNode | null =>
  mounted.nodes.find((node) => propsOf(node).testID === testID) ?? null;

const requireByTestId = (mounted: Mounted, testID: string): TreeNode => {
  const found = findByTestId(mounted, testID);
  if (found === null) {
    throw new Error(`expected a node with testID="${testID}" and found none`);
  }
  return found;
};

/** Every answer cell as its three lines, in render order. */
const answerCells = (mounted: Mounted): string[][] => {
  const bar = findByTestId(mounted, "issue-1561-answer-bar");
  if (bar === null) return [];
  return (bar.children ?? [])
    .filter((child): child is TreeNode => typeof child !== "string")
    .map((cell) =>
      (cell.children ?? [])
        .filter((line): line is TreeNode => typeof line !== "string")
        .map((line) => flatText(line)),
    );
};

/** ONE cell by its label. THROWS when absent, naming what WAS on the bar. */
const requireCell = (mounted: Mounted, label: string): string[] => {
  const cells = answerCells(mounted);
  const found = cells.find((lines) => lines[0] === label);
  if (found === undefined) {
    throw new Error(
      `expected an answer cell labelled "${label}"; the bar carried ` +
        `[${cells.map((lines) => lines[0]).join(", ")}]`,
    );
  }
  return found;
};

const cellLabels = (mounted: Mounted): string[] =>
  answerCells(mounted).map((lines) => lines[0]);

const WIDTHS: { width: number; isDesktop: boolean }[] = [
  { width: 360, isDesktop: false },
  { width: 390, isDesktop: false },
  { width: 820, isDesktop: false },
  { width: 1440, isDesktop: true },
  { width: 2560, isDesktop: true },
];

const restaurantCase = (hours: unknown[]): CaseData => ({
  venue: baseVenue("restaurant", { hours }),
  menu: [],
  reservable: RESERVABLE,
  reservableState: "ready",
  discoveryPrice: {
    minMinor: 2500,
    maxMinor: 6000,
    currencyCode: "GBP",
    minorUnitExponent: 2,
  },
  stayDetail: null,
  stayState: "ready",
});

const stayCase = (offerings: VenueStayRateOffering[]): CaseData => ({
  venue: baseVenue("stay", {
    name: "The Bayshore",
    city: "Miami Beach, FL",
    defaultCurrency: "USD",
  }),
  menu: [],
  reservable: null,
  reservableState: "ready",
  discoveryPrice: null,
  stayDetail: stayDetail(offerings),
  stayState: "ready",
});

// ═══════════════════════════════════════════════════════════════════════════
// TIME
// ═══════════════════════════════════════════════════════════════════════════

describe("#1562 — open now, at EVERY width", () => {
  /**
   * THE DEFECT THIS REPLACES rendered only on desktop. A phone got a bare
   * 24-hour table and no indicator at all, on the surface every advert and
   * every share actually lands on. So the assertion is parameterised over the
   * same five widths #1550 Leg C measured, and 360 matters as much as 1440.
   */
  test.each(WIDTHS)("at $width an OPEN venue says so", ({ width, isDesktop }) => {
    expect.assertions(3);
    const mounted = mountCase(restaurantCase(ALWAYS_OPEN_HOURS), width, isDesktop);
    // The answer bar's time cell — three lines of one cell.
    expect(requireCell(mounted, "Right now").slice(0, 2)).toEqual([
      "Right now",
      "Open",
    ]);
    // …and the same state at the head of the week table, from the same resolver.
    expect(flatText(requireByTestId(mounted, "issue-1562-hours-state"))).toBe(
      "Open now · until 00:00",
    );
    // The old string is GONE. Paired with the two presence checks above, so
    // this absence cannot pass on an empty tree.
    expect(mounted.json).not.toContain("Open today");
    mounted.unmount();
  });

  test.each(WIDTHS)(
    "at $width a CLOSED venue says so too",
    ({ width, isDesktop }) => {
      expect.assertions(3);
      const mounted = mountCase(
        restaurantCase(ALWAYS_CLOSED_HOURS),
        width,
        isDesktop,
      );
      const cell = requireCell(mounted, "Right now");
      expect(cell.slice(0, 2)).toEqual(["Right now", "Closed"]);
      // A permanently-shut venue has no next opening, so no third line.
      expect(cell).toHaveLength(2);
      expect(flatText(requireByTestId(mounted, "issue-1562-hours-state"))).toBe(
        "Closed",
      );
      mounted.unmount();
    },
  );

  test("open and closed produce DIFFERENT trees — the state is real", () => {
    expect.assertions(1);
    // Without this, every assertion above could pass against a renderer that
    // ignored the state and printed a constant.
    const open = mountCase(restaurantCase(ALWAYS_OPEN_HOURS), 390, false);
    const shut = mountCase(restaurantCase(ALWAYS_CLOSED_HOURS), 390, false);
    expect(requireCell(open, "Right now")[1]).not.toBe(
      requireCell(shut, "Right now")[1],
    );
    open.unmount();
    shut.unmount();
  });

  test("NO timezone ⇒ no claim, on any surface", () => {
    expect.assertions(3);
    // The shape a client sees from a deployment whose `venue_public_view`
    // predates this issue's migration. The page must state nothing about now
    // rather than fall back to the visitor's device weekday.
    const mounted = mountCase(
      {
        ...restaurantCase(ALWAYS_OPEN_HOURS),
        venue: baseVenue("restaurant", {
          hours: ALWAYS_OPEN_HOURS,
          timezone: null,
        }),
      },
      390,
      false,
    );
    expect(cellLabels(mounted)).not.toContain("Right now");
    expect(findByTestId(mounted, "issue-1562-hours-state")).toBeNull();
    // POSITIVE CONTROL on the same tree: the page really did render, and the
    // week table is still there carrying all seven days.
    expect(mounted.json).toContain("HOURS");
    mounted.unmount();
  });

  test("a HOTEL never grows a trading-hours cell", () => {
    expect.assertions(3);
    // #1550 Leg C photographed a live Miami property publishing
    // "Mon–Sat 09:00–17:00" beside its own "Check-in 15:00". The category
    // profile makes that unrepresentable; this asserts it stays that way even
    // though the venue row carries hours AND a timezone.
    const mounted = mountCase(stayCase(STAY_OFFERINGS), 390, false);
    expect(cellLabels(mounted)).not.toContain("Right now");
    expect(findByTestId(mounted, "issue-1562-hours-state")).toBeNull();
    // …and it DOES answer time, the way a hotel answers it.
    expect(requireCell(mounted, "Check-in").slice(0, 2)).toEqual([
      "Check-in",
      "15:00",
    ]);
    mounted.unmount();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PRICE — the three mitigations, each read off the rendered tree
// ═══════════════════════════════════════════════════════════════════════════

describe("#1562 — a hotel finally shows a price", () => {
  test.each(WIDTHS)(
    "at $width the from-rate and its qualifier are ONE cell",
    ({ width, isDesktop }) => {
      expect.assertions(2);
      const mounted = mountCase(stayCase(STAY_OFFERINGS), width, isDesktop);
      // MITIGATION 1 — the number and the qualifier are three lines of the SAME
      // cell. Reading both off one node is what proves they are not separable:
      // a qualifier moved anywhere else on the page fails this lookup.
      expect(requireCell(mounted, "From")).toEqual([
        "From",
        "$275",
        "per night · before taxes and fees",
      ]);
      // $75 is the cabana — priced per BOOKING, not a night. It must not be the
      // headline, at any width.
      expect(requireCell(mounted, "From")[1]).not.toBe("$75");
      mounted.unmount();
    },
  );

  test("MITIGATION 2 — a quote REPLACES the from-rate in the same slot", async () => {
    expect.assertions(5);
    const before = mountCase(stayCase(STAY_OFFERINGS), 390, false, null);
    const beforeCell = requireCell(before, "From");
    expect(beforeCell[1]).toBe("$275");
    before.unmount();

    // The quote arrives the way it really does: the guest is on the
    // Reservations tab, the booking body calls `onQuoteChange`, the route holds
    // it, the screen reads it, the bar above the tabs swaps. Nothing here pokes
    // a prop at the screen directly — the whole path is exercised.
    const after = await mountCaseAsync(
      stayCase(STAY_OFFERINGS),
      390,
      false,
      { totalMinor: "82600", currencyCode: "USD" },
      "reservations",
    );
    // Same slot: the price cell is still the FIRST cell on the bar…
    expect(cellLabels(after)[0]).toBe("Your dates");
    // …the from-rate is GONE (not shown alongside, not pushed elsewhere)…
    expect(cellLabels(after)).not.toContain("From");
    // …and the number is the real quoted total, all-in.
    expect(requireCell(after, "Your dates")).toEqual([
      "Your dates",
      "$826",
      "total · taxes and fees included",
    ]);
    // Same slot means same POSITION and same cell count.
    expect(cellLabels(after)).toHaveLength(cellLabels(before).length);
    after.unmount();
  });

  test("MITIGATION 3 — the qualifier reads itself from the fee rows", () => {
    expect.assertions(3);
    const separate = mountCase(stayCase(STAY_OFFERINGS), 390, false);
    const allIn = mountCase(stayCase(ALL_IN_OFFERINGS), 390, false);
    // Identical prices, identical everything — the ONLY difference between the
    // two fixtures is `fees[].displayMode`, so a qualifier that did not read
    // the data would print the same string twice.
    expect(requireCell(separate, "From")[2]).toBe(
      "per night · before taxes and fees",
    );
    expect(requireCell(allIn, "From")[2]).toBe(
      "per night · all-in, taxes and fees included",
    );
    expect(requireCell(separate, "From")[1]).toBe(requireCell(allIn, "From")[1]);
    separate.unmount();
    allIn.unmount();
  });

  test("the Overview lede carries the RANGE the one-number cell cannot", () => {
    expect.assertions(2);
    const mounted = mountCase(stayCase(STAY_OFFERINGS), 390, false);
    expect(flatText(requireByTestId(mounted, "issue-1562-stay-rate-lede"))).toBe(
      "Rooms $275–$350 · per night · before taxes and fees",
    );
    // The lede and the cell share ONE qualifier resolver, so they cannot drift.
    const rate = resolveVenueStayRate(STAY_OFFERINGS);
    if (rate === null) throw new Error("the fixture produced no rate at all");
    expect(venueStayRateRangeLine(rate)).toContain(venueStayRateQualifier(rate));
    mounted.unmount();
  });

  test("no ROOM-NIGHT offering ⇒ no price cell, and the bar shrinks", () => {
    expect.assertions(3);
    // A Stay selling only day-use cabanas has no nightly rate. The design's
    // rule for absent data is that the cell disappears rather than showing a
    // blank — and emphatically not that "$75 per night" is printed.
    const mounted = mountCase(
      stayCase([STAY_OFFERINGS[0]]),
      390,
      false,
    );
    expect(cellLabels(mounted)).not.toContain("From");
    expect(mounted.json).not.toContain("$75");
    // POSITIVE CONTROL: the bar is still there with its other cells.
    expect(cellLabels(mounted)).toContain("Check-in");
    mounted.unmount();
  });

  test("offerings that DISAGREE on currency ⇒ no cell, never a mixed number", () => {
    expect.assertions(3);
    const mixed: VenueStayRateOffering[] = [
      {
        price: {
          amountMinor: "27500",
          currencyCode: "USD",
          pricingUnit: "room_night",
        },
        fees: [],
      },
      {
        price: {
          amountMinor: "20000",
          currencyCode: "EUR",
          pricingUnit: "room_night",
        },
        fees: [],
      },
    ];
    const mounted = mountCase(stayCase(mixed), 390, false);
    expect(cellLabels(mounted)).not.toContain("From");
    expect(findByTestId(mounted, "issue-1562-stay-rate-lede")).toBeNull();
    // POSITIVE CONTROL: the SAME two rooms in ONE currency do produce a cell,
    // so the absence above is the currency rule and not a broken fixture.
    const single = mountCase(
      stayCase([mixed[0], { ...mixed[1], price: { ...mixed[1].price, currencyCode: "USD" } }]),
      390,
      false,
    );
    expect(requireCell(single, "From")[1]).toBe("$200");
    mounted.unmount();
    single.unmount();
  });

  test("zero fee rows is NOT evidence of all-in", () => {
    expect.assertions(2);
    // `[].every(...)` is true, so a naive implementation calls a property with
    // no configured fees "all-in". That is a fabricated claim about tax.
    const noFees: VenueStayRateOffering[] = [
      {
        price: {
          amountMinor: "27500",
          currencyCode: "USD",
          pricingUnit: "room_night",
        },
        fees: [],
      },
    ];
    const rate = resolveVenueStayRate(noFees);
    if (rate === null) throw new Error("the fixture produced no rate at all");
    expect(rate.allIn).toBe(false);
    // …and an offering that really IS marked included does report true, so the
    // `false` above is the empty-array rule rather than a stuck flag.
    const included = resolveVenueStayRate(ALL_IN_OFFERINGS);
    expect(included === null ? "no rate" : included.allIn).toBe(true);
  });
});
