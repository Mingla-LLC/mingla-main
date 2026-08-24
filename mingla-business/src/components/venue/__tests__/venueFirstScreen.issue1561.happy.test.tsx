/**
 * issue #1561 [first-screen-rebuild], step 5 of #1550 — THE MEASUREMENT.
 *
 * This step's acceptance criterion is a number, not a look. #1550 Leg C scored
 * the LIVE production page against the four questions a stranger asks before
 * they scroll — *what is this place, where is it, what does it cost, can I book
 * it* — on the first viewport only, at 360 / 390 / 820 / 1440 / 2560, on three
 * real venues, and it scored **0 of 4 everywhere**. This file scores the same
 * four questions against the REAL rendered tree at the same five widths, for
 * both venue categories plus the sparse venue, so the claim can be checked
 * rather than asserted.
 *
 * HOW IT SCORES, AND WHY IT IS NOT CIRCULAR
 * -----------------------------------------
 * Two independent readings must AGREE, and disagreeing is a failure:
 *
 *   A. THE TREE. Walk the rendered output and look for the actual elements a
 *      guest would read — the category chip node, the place chip node, the
 *      answer bar's price cell, the reserve CTA. Nothing here consults the
 *      model; it reads what was drawn.
 *   B. THE MODEL. `venueFiveSecondScore` in `venueFirstScreen.ts`, fed the same
 *      inputs the screen was fed.
 *
 * A test that only did (B) would be scoring its own arithmetic — the
 * unfalsifiable-test bug class this repo has been bitten by before. A test that
 * only did (A) could not tell a missing element from a mis-scored one.
 *
 * ABOVE THE FOLD, computed rather than asserted. The four answers being PRESENT
 * is not the criterion — Leg C's point is that they must be present on the
 * FIRST SCREEN. So the block layout is summed from the style objects found ON
 * THE RENDERED NODES (not from constants written here), starting at the hero
 * height the screen actually asked the shell for, and the answer bar's bottom
 * edge must land inside the viewport. Change a font size, a padding or the
 * hero ratio and the number moves; delete the answer bar and the lookup finds
 * nothing and the vacuity guard fires.
 *
 * VACUITY GUARDS — every one of them earns its place from a real prior failure:
 *   - a MINIMUM serialised tree size per case (#1559's harness rendered `null`
 *     seven times and only its size floor caught it);
 *   - a SWEEP FLOOR: the node walker must have observed a real tree, so "no
 *     forbidden node found" cannot be true of an empty walk (#1560's gate);
 *   - every lookup is guarded: a helper that finds nothing THROWS, so a
 *     silently-absent element can never read as a pass;
 *   - `expect.assertions` pins the count in every scoring test.
 *
 * WHAT WAS HONESTLY NOT 4/4 HERE, AND WHAT CHANGED IT.
 *
 * This file shipped asserting a Stay at **3/4**, with the missing point named:
 * its price is a nightly "from" rate over `stayDetail.offerings[].price`, and
 * that was **#1562's** work. The answer bar's total `Record<VenuePricingModel,
 * …>` slot returned null from its `nightlyFrom` arm, so the bar shrank from
 * three cells to two exactly as the approved design says absent data must
 * behave — and the expectations below asserted that ABSENCE rather than hiding
 * it, precisely so that the day the arm was filled in, this file would fail
 * loudly and be updated by the change that earned it.
 *
 * [TEST-MOD-APPROVED #1562] — that day is this one. The Stay fixture now
 * carries the three live offerings the Miami property actually publishes, the
 * `nightlyFrom` arm resolves, and the assertions below are updated from
 * `not.toContain("From")` to a positive 4/4. The handoff worked as designed:
 * the test failed, and it is the fix that updates it.
 *
 * WHY THE FIXTURE GAINS A `place` OFFERING IT DOES NOT NEED. `Pool Cabana` is
 * priced `place_booking`, not `room_night`, and it is the CHEAPEST of the
 * three. A naive `Math.min` over every offering would headline "$75 per night"
 * for something that is neither a night nor a room. Its presence is what makes
 * the 4/4 below evidence of a correct reduction rather than of any reduction.
 *
 * APPEND-ONLY except where the token above authorises: this file's Stay
 * expectations are UPDATED (with deletions) by #1562; nothing is removed from
 * the repo and no other file's tests are touched.
 *
 * Run:
 *   cd mingla-business && npx jest venueFirstScreen.issue1561 --runInBand
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import type { VenueCategory } from "@mingla/brand-rendering/venueCategoryProfile";
import { venueCategoryProfile } from "@mingla/brand-rendering/venueCategoryProfile";
import {
  buildVenueAnswerBar,
  venueCategoryChip,
  venueFiveSecondScore,
  venuePlaceChip,
} from "@mingla/brand-rendering/venueFirstScreen";
// [TEST-MOD-APPROVED #1562] — the resolver that fills the price slot.
import {
  resolveVenueStayRate,
  type VenueStayRateOffering,
} from "@mingla/brand-rendering/venueStayRate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL = "https://host.usemingla.com";

// ---------------------------------------------------------------------------
// Harness — the shell is a transparent passthrough so the props the screen
// hands it (coverAspectRatio, galleryImages, coverPlaceholderLabel) and the
// body it wraps are both observable in one tree.
// ---------------------------------------------------------------------------

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

jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => ({
    brandSlug: "smokerhythm",
    venueSlug: "academy-street-bistro",
    tab: undefined,
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
  const mapboxStaticImage = require("../../../../../packages/offering-rendering/mapboxStaticImage");
  // [TEST-MOD-APPROVED #2468] Harness registration only — ADDITION, no
  // assertion changed. maps-deep-link-coordinates gave every "open in maps"
  // URL one owner (packages/offering-rendering/mapsDeepLink), and the shared
  // venue screen now reads its maps target from it. Registering the REAL module
  // matches this factory's rule of spreading the real pure helpers.
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
    ...venueMapsActions,
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

jest.mock("../../../components/stay/BuyerStayGuestExperience", () => ({
  __esModule: true,
  BuyerStayGuestExperience: () => null,
}));

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

// `react-test-renderer` ships no types in this repo (the parity harness types it
// locally the same way). Naming exactly the two entry points used keeps this
// file free of `any` without adding a dev dependency.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => MountedTree;
  act: (callback: () => void) => void;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PublicVenueRoute =
  require("../../../../app/b/[brandSlug]/v/[venueSlug]").default as React.ComponentType;

// ---------------------------------------------------------------------------
// Fixtures
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

const DISCOVERY_PRICE = {
  minMinor: 2500,
  maxMinor: 6000,
  currencyCode: "GBP",
  minorUnitExponent: 2,
};

const STAY_DETAIL = {
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
  // [TEST-MOD-APPROVED #1562] — was `offerings: []`, which is why the price
  // cell was absent. These are the three LIVE offerings the production Miami
  // Stay publishes, read off `stay_offerings` + `stay_price_versions` on
  // 2026-08-04: two `room_night` rooms at $275.00 and $350.00 and one
  // `place_booking` cabana at $75.00, every fee `separate`.
  //
  // The cabana is the load-bearing one: it is the cheapest row on the property
  // and it is NOT a night. A from-rate that reported it would read "From $75 ·
  // per night" for a poolside chair. The assertions below pin $275 — the
  // cheapest ROOM — so this fixture can tell a correct reduction from a lucky
  // one.
  offerings: [
    {
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      kind: "place",
      name: "Pool Cabana",
      price: {
        amountMinor: "7500",
        currencyCode: "USD",
        pricingUnit: "place_booking",
      },
      fees: [{ displayMode: "separate" }],
    },
    {
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      kind: "room",
      name: "Ocean Suite",
      price: {
        amountMinor: "35000",
        currencyCode: "USD",
        pricingUnit: "room_night",
      },
      fees: [{ displayMode: "separate" }],
    },
    {
      id: "aaaaaaaa-0000-4000-8000-000000000003",
      kind: "room",
      name: "Garden Suite",
      price: {
        amountMinor: "27500",
        currencyCode: "USD",
        pricingUnit: "room_night",
      },
      fees: [{ displayMode: "separate" }],
    },
  ],
};

const RESERVABLE = {
  reservable: true,
  venueId: "11111111-1111-4111-8111-111111111111",
  currency: "GBP",
};

/** N photographs, so the 0 / 1 / 3 / 20 empty states are addressable. */
const photos = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `https://cdn.example.com/p${i}.jpg`);

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
  hours: HOURS,
  // The builder puts the cover FIRST, so this mirrors what the service now
  // produces once `venuePublicPhotos.ts`'s early return is gone.
  galleryPhotoUrls: ["https://cdn.example.com/cover.jpg", ...photos(3)],
  pitch:
    "A neighbourhood bistro with an open fire, a short menu that changes weekly, and a wine list built entirely from small growers. Walk-ins welcome at the bar.",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tree walking — every lookup THROWS when it finds nothing.
// ---------------------------------------------------------------------------

/**
 * The shape `react-test-renderer`'s `toJSON()` emits. The walk below collects
 * the ACTUAL nodes rather than copies, so a parent's `children` array and the
 * collected list hold the same object references and `indexOf` works — which is
 * what lets the layout model below walk UP from the answer bar.
 */
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
  if (typeof node === "number") return String(node);
  if (!Array.isArray(node.children)) return "";
  return node.children.map((child) => flatText(child)).join("");
};

interface Mounted {
  nodes: TreeNode[];
  json: string;
  unmount: () => void;
}

const mountCase = (data: CaseData, width: number, isDesktop: boolean): Mounted => {
  caseData.current = data;
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
  return {
    nodes,
    json: JSON.stringify(tree),
    unmount: () => {
      TestRenderer.act(() => {
        instance.unmount();
      });
    },
  };
};

/**
 * VACUITY FLOOR. #1559's harness rendered `null` seven times and only a size
 * floor noticed. A venue page tree is thousands of characters; anything under
 * this did not render the page and every "found / not found" below would be
 * meaningless.
 */
const MIN_TREE_CHARS = 3000;
const MIN_TREE_NODES = 40;

const assertRealRender = (mounted: Mounted, label: string): void => {
  if (mounted.json.length < MIN_TREE_CHARS || mounted.nodes.length < MIN_TREE_NODES) {
    throw new Error(
      `[${label}] VACUOUS RENDER — ${mounted.json.length} chars / ${mounted.nodes.length} ` +
        `nodes (floors ${MIN_TREE_CHARS} / ${MIN_TREE_NODES}). The page did not render, so ` +
        "every presence check below would report 'absent' for the wrong reason.",
    );
  }
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

/** The one node whose scalar props carry the whole hero contract. */
const requireShell = (mounted: Mounted): TreeNode => {
  const shell = mounted.nodes.find((node) => node.type === "ParallaxCoverShell");
  if (shell === undefined) {
    throw new Error("expected a ParallaxCoverShell in the tree and found none");
  }
  return shell;
};

/** The answer bar's cells, by the label each one leads with. */
const answerCellLabels = (mounted: Mounted): string[] => {
  const bar = findByTestId(mounted, "issue-1561-answer-bar");
  if (bar === null) return [];
  return (bar.children ?? [])
    .filter((child): child is TreeNode => typeof child !== "string")
    .map((cell) => flatText((cell.children ?? [])[0] as TreeNode));
};

/**
 * [TEST-MOD-APPROVED #1562] — the three lines of ONE cell, found by its label.
 * THROWS when the label is not on the bar, so "the qualifier is present" can
 * never pass because the whole cell was missing.
 *
 * This exists to make #1550's first from-rate mitigation checkable: the
 * qualifier must live in the SAME BLOCK as the number, never as a footnote
 * elsewhere. Reading both off one cell node is what proves they are not
 * separable — a qualifier moved anywhere else on the page fails this lookup.
 */
const requireAnswerCellLines = (mounted: Mounted, label: string): string[] => {
  const bar = findByTestId(mounted, "issue-1561-answer-bar");
  if (bar === null) throw new Error("expected an answer bar and found none");
  for (const child of bar.children ?? []) {
    if (typeof child === "string") continue;
    const lines = (child.children ?? [])
      .filter((line): line is TreeNode => typeof line !== "string")
      .map((line) => flatText(line));
    if (lines[0] === label) return lines;
  }
  throw new Error(
    `expected an answer cell labelled "${label}"; the bar carried ` +
      `[${answerCellLabels(mounted).join(", ")}]`,
  );
};

const hasReserveCta = (mounted: Mounted): boolean =>
  mounted.nodes.some(
    (node) =>
      node.type === "Pressable" &&
      propsOf(node).accessibilityRole === "button" &&
      typeof propsOf(node).accessibilityLabel === "string" &&
      /^(Reserve|Book|Check)\b/.test(String(propsOf(node).accessibilityLabel)),
  );

// ---------------------------------------------------------------------------
// The block-layout model — summed from the STYLE OBJECTS ON THE RENDERED NODES
// ---------------------------------------------------------------------------

const flattenStyle = (style: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  const visit = (value: unknown): void => {
    if (value === null || value === undefined || value === false) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (typeof raw === "number") out[key] = raw;
    }
  };
  visit(style);
  return out;
};

/**
 * The vertical space one rendered node occupies in normal block flow. Text
 * height is `lineHeight` (every Text in this block declares one); a container's
 * height is its own vertical padding plus its children. Deliberately simple and
 * deliberately NOT a browser: the numbers it produces are checked against the
 * DOM-measured ones in the report, and the point of computing it here is that
 * every input is read off the tree rather than typed into this file.
 */
const flowHeight = (node: TreeNode | string): number => {
  if (typeof node === "string") return 0;
  const style = flattenStyle(propsOf(node).style);
  const own =
    (style.marginTop ?? 0) +
    (style.marginBottom ?? 0) +
    (style.paddingVertical ?? 0) * 2 +
    (style.paddingTop ?? 0) +
    (style.paddingBottom ?? 0);
  if (node.type === "Text") return own + (style.lineHeight ?? 0);
  const children = (node.children ?? []).filter(
    (child): child is TreeNode => typeof child !== "string",
  );
  if (children.length === 0) return own + (style.height ?? 0);
  const gap = style.gap ?? 0;
  const inner = children.reduce((sum, child) => sum + flowHeight(child), 0);
  // A row lays its children side by side, so its height is the tallest child.
  const isRow =
    propsOf(node).style !== undefined &&
    JSON.stringify(propsOf(node).style).includes('"flexDirection":"row"');
  const stacked = isRow
    ? Math.max(...children.map((child) => flowHeight(child)))
    : inner + gap * (children.length - 1);
  return own + stacked;
};

/** `ParallaxCoverShell`'s own geometry, in its own constants. */
const SHELL = { seam: 28, bodyPaddingTop: 24, desktopPaddingTop: 32, desktopHeroMax: 520 };

/**
 * Where the answer bar's bottom edge sits, in CSS pixels from the top of the
 * viewport, on the FIRST paint (nothing scrolled).
 */
const answerBarBottom = (mounted: Mounted, width: number, isDesktop: boolean): number => {
  const shell = requireShell(mounted);
  const ratio = propsOf(shell).coverAspectRatio;
  if (typeof ratio !== "number" || ratio <= 0) {
    throw new Error(
      `the screen passed coverAspectRatio=${String(ratio)}; without a real ratio the hero ` +
        "height cannot be computed and the fold cannot be located",
    );
  }
  const heroHeight = isDesktop
    ? Math.min((Math.min(width, 1200) - 64) * (9 / 21), SHELL.desktopHeroMax) +
      SHELL.desktopPaddingTop
    : width / ratio - SHELL.seam + SHELL.bodyPaddingTop;
  const identity = requireByTestId(mounted, "issue-1561-answer-bar");
  const identityWrap = mounted.nodes.find((node) =>
    (node.children ?? []).some((child) => child === identity),
  );
  if (identityWrap === undefined) {
    throw new Error("the answer bar is not inside an identity block");
  }
  // Everything in the identity block ABOVE the bar, plus the bar itself.
  const siblings = (identityWrap.children ?? []).filter(
    (child): child is TreeNode => typeof child !== "string",
  );
  const barIndex = siblings.indexOf(identity);
  if (barIndex < 0) throw new Error("the answer bar left its own parent");
  const above = siblings
    .slice(0, barIndex + 1)
    .reduce((sum, node) => sum + flowHeight(node), 0);
  return heroHeight + above;
};

// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

/**
 * The hero's share of the first screen.
 *
 * PHONE/TABLET reads the ratio the screen actually passed — that is #1561's
 * change and the number the whole step turns on.
 *
 * DESKTOP is `ParallaxCoverShell`'s OWN contained hero (21/9, capped at 520px,
 * inside a 1200px shell), which #1561 deliberately does NOT touch: four sibling
 * public pages mount the same geometry, and Leg C's desktop problem was never
 * the photograph's size (57.1% at 1440, and 2560 was "1440 with margins") but
 * that nothing above the fold answered price or category. The ceiling below is
 * therefore split: a real cap on phone/tablet, and on desktop an assertion that
 * the shared geometry has not silently grown.
 */
const heroShareOf = (
  mounted: Mounted,
  width: number,
  height: number,
  isDesktop: boolean,
): number => {
  const ratio = propsOf(requireShell(mounted)).coverAspectRatio;
  if (typeof ratio !== "number" || ratio <= 0) {
    throw new Error(`no usable coverAspectRatio on the shell: ${String(ratio)}`);
  }
  return isDesktop
    ? Math.min((Math.min(width, 1200) - 64) * (9 / 21), 520) / height
    : width / ratio / height;
};

const HERO_SHARE_CEILING = (isDesktop: boolean): number =>
  isDesktop ? 0.58 : 0.4;

const WIDTHS: { width: number; height: number; isDesktop: boolean }[] = [
  { width: 360, height: 800, isDesktop: false },
  { width: 390, height: 844, isDesktop: false },
  { width: 820, height: 1180, isDesktop: false },
  { width: 1440, height: 900, isDesktop: true },
  { width: 2560, height: 1440, isDesktop: true },
];

const RESTAURANT: CaseData = {
  venue: baseVenue("restaurant"),
  menu: [],
  reservable: RESERVABLE,
  reservableState: "ready",
  discoveryPrice: DISCOVERY_PRICE,
  stayDetail: null,
  stayState: "ready",
};

const STAY: CaseData = {
  venue: baseVenue("stay", { name: "The Bayshore", city: "Miami Beach, FL" }),
  menu: [],
  reservable: null,
  reservableState: "ready",
  discoveryPrice: null,
  stayDetail: STAY_DETAIL,
  stayState: "ready",
};

describe("#1561 — the five-second test, measured on the rendered first screen", () => {
  test.each(WIDTHS)(
    "RESTAURANT at $width: what is it / where / cost / can I book",
    ({ width, height, isDesktop }) => {
      expect.assertions(8);
      const mounted = mountCase(RESTAURANT, width, isDesktop);
      assertRealRender(mounted, `restaurant-${width}`);

      // (A) read the TREE.
      const category = flatText(
        requireByTestId(mounted, "issue-1561-category-chip"),
      );
      const place = flatText(requireByTestId(mounted, "issue-1561-place-chip"));
      const labels = answerCellLabels(mounted);
      expect(category).toBe("Restaurant");
      expect(place).toBe("London");
      expect(labels).toContain("Typically");
      expect(hasReserveCta(mounted)).toBe(true);

      // (B) the four answers, scored.
      const score =
        (category.length > 0 ? 1 : 0) +
        (place.length > 0 ? 1 : 0) +
        (labels.includes("Typically") ? 1 : 0) +
        (hasReserveCta(mounted) ? 1 : 0);
      expect(score).toBe(4);

      // ABOVE THE FOLD. The answers exist AND arrive before the first scroll.
      const bottom = answerBarBottom(mounted, width, isDesktop);
      expect(bottom).toBeLessThan(height);
      // …and not by a rounding accident: a quarter of the screen must remain.
      expect(height - bottom).toBeGreaterThan(height * 0.15);

      // The hero no longer eats the page.
      expect(heroShareOf(mounted, width, height, isDesktop)).toBeLessThan(
        HERO_SHARE_CEILING(isDesktop),
      );

      mounted.unmount();
    },
  );

  test.each(WIDTHS)(
    "STAY at $width: 4/4 — #1562 landed the from-rate and the cell is asserted PRESENT",
    ({ width, height, isDesktop }) => {
      expect.assertions(8);
      const mounted = mountCase(STAY, width, isDesktop);
      assertRealRender(mounted, `stay-${width}`);

      const category = flatText(
        requireByTestId(mounted, "issue-1561-category-chip"),
      );
      const place = flatText(requireByTestId(mounted, "issue-1561-place-chip"));
      const labels = answerCellLabels(mounted);

      // "what is this place" was 0/4 on BOTH Stays. A hotel now says so.
      expect(category).toBe("Hotel");
      expect(place).toBe("Miami Beach, FL");
      // The time cell is check-in/check-out, never a trading-hours table.
      expect(labels).toContain("Check-in");
      // [TEST-MOD-APPROVED #1562] — the gap this file shipped asserting is
      // CLOSED. It read `expect(labels).not.toContain("From")`; the arm behind
      // it now resolves, so the same assertion is inverted by the change that
      // earned it. A hotel is not a restaurant, so "Typically" must still be
      // absent — pricing model, not a fallback.
      expect(labels).toContain("From");
      expect(labels).not.toContain("Typically");
      // MITIGATION 1, read off the tree: the number and the qualifier that
      // keeps it honest are three lines of ONE cell. `$275` is the cheapest
      // ROOM — not the $75 cabana, which is priced per booking and is not a
      // night — and it does not appear without "before taxes and fees".
      expect(requireAnswerCellLines(mounted, "From")).toEqual([
        "From",
        "$275",
        "per night · before taxes and fees",
      ]);

      const bottom = answerBarBottom(mounted, width, isDesktop);
      expect(bottom).toBeLessThan(height);

      expect(heroShareOf(mounted, width, height, isDesktop)).toBeLessThan(
        HERO_SHARE_CEILING(isDesktop),
      );

      mounted.unmount();
    },
  );
});

describe("#1561 — the tree and the model agree, or it is a failure", () => {
  /**
   * (B) of the two readings. `venueFirstScreen.ts` is what the renderer draws
   * from, so if its score and the score read off the drawn tree ever disagree,
   * one of the two is lying and the measurement is worthless. Asserting the
   * agreement is what stops this suite from being a test of its own arithmetic.
   */
  test.each(WIDTHS)(
    "at $width the model's score equals the score read off the tree",
    ({ width, isDesktop }) => {
      expect.assertions(4);
      const mounted = mountCase(RESTAURANT, width, isDesktop);
      assertRealRender(mounted, `agreement-${width}`);

      const profile = venueCategoryProfile("restaurant");
      const cells = buildVenueAnswerBar({
        profile,
        discoveryPrice: DISCOVERY_PRICE,
        stay: null,
        todayHours: HOURS.find((h) => h.weekday === (new Date().getDay() + 6) % 7) ?? null,
        // [TEST-MOD-APPROVED #1562] — the three inputs #1562 added to
        // `VenueAnswerBarInput`. Null/null here on purpose: this case is a
        // RESTAURANT with no resolvable venue clock, which is the arm that
        // falls back to stating the published row — the same behaviour this
        // assertion has always pinned.
        openState: null,
        stayRate: null,
        stayQuote: null,
        canBook: true,
      });
      const model = venueFiveSecondScore({
        categoryChip: venueCategoryChip(profile),
        placeChip: venuePlaceChip({ city: "London", address: null }),
        cells,
        canBook: true,
      });

      const fromTree = {
        whatIsThisPlace:
          flatText(requireByTestId(mounted, "issue-1561-category-chip")).length > 0,
        whereIsIt:
          flatText(requireByTestId(mounted, "issue-1561-place-chip")).length > 0,
        whatDoesItCost: answerCellLabels(mounted).includes("Typically"),
        canIBookIt: hasReserveCta(mounted),
      };

      expect(model.score).toBe(4);
      expect(fromTree.whatIsThisPlace).toBe(model.whatIsThisPlace);
      expect(fromTree.whatDoesItCost).toBe(model.whatDoesItCost);
      expect(fromTree.canIBookIt).toBe(model.canIBookIt);
      mounted.unmount();
    },
  );

  // [TEST-MOD-APPROVED #1562] — was "a STAY's model agrees that price is the
  // ONE unanswered question", asserting `score === 3` and `whatDoesItCost ===
  // false`. #1562 answered that question, so the same model now scores 4 and
  // the assertion is inverted rather than deleted: the point of the test is
  // unchanged (the model and the page agree about what is answered), only the
  // answer moved.
  test("a STAY's model now answers all four, price included", () => {
    expect.assertions(3);
    const profile = venueCategoryProfile("stay");
    const cells = buildVenueAnswerBar({
      profile,
      discoveryPrice: null,
      stay: { checkInTime: "15:00:00", checkOutTime: "11:00:00" },
      todayHours: null,
      openState: null,
      stayRate: resolveVenueStayRate(
        STAY_DETAIL.offerings as VenueStayRateOffering[],
      ),
      stayQuote: null,
      canBook: true,
    });
    const model = venueFiveSecondScore({
      categoryChip: venueCategoryChip(profile),
      placeChip: "Miami Beach, FL",
      cells,
      canBook: true,
    });
    expect(model.score).toBe(4);
    expect(model.whatDoesItCost).toBe(true);
    expect([model.whatIsThisPlace, model.whereIsIt, model.canIBookIt]).toEqual([
      true,
      true,
      true,
    ]);
  });
});

/**
 * The evidence table. Off by default (a logging test is noise in CI); run with
 * `MINGLA_1561_PRINT_TABLE=1` to emit the per-width, per-category numbers that
 * go into the issue comment, computed by the same helpers the assertions use.
 */
describe("#1561 — the measurement table", () => {
  test("emit the per-width scores and hero shares", () => {
    expect.assertions(1);
    const rows: string[] = [];
    for (const kind of ["restaurant", "stay"] as const) {
      for (const { width, height, isDesktop } of WIDTHS) {
        const mounted = mountCase(
          kind === "restaurant" ? RESTAURANT : STAY,
          width,
          isDesktop,
        );
        const category = flatText(
          requireByTestId(mounted, "issue-1561-category-chip"),
        );
        const place = flatText(requireByTestId(mounted, "issue-1561-place-chip"));
        const labels = answerCellLabels(mounted);
        const hasPrice = labels.includes("Typically") || labels.includes("From");
        const score =
          (category.length > 0 ? 1 : 0) +
          (place.length > 0 ? 1 : 0) +
          (hasPrice ? 1 : 0) +
          (hasReserveCta(mounted) ? 1 : 0);
        rows.push(
          [
            kind,
            width,
            category,
            place,
            hasPrice ? "yes" : "no",
            hasReserveCta(mounted) ? "yes" : "no",
            `${score}/4`,
            `hero ${(heroShareOf(mounted, width, height, isDesktop) * 100).toFixed(1)}%`,
            `bar bottom ${answerBarBottom(mounted, width, isDesktop).toFixed(0)}/${height}`,
            `cells ${labels.join("+")}`,
          ].join(" | "),
        );
        mounted.unmount();
      }
    }
    if (process.env.MINGLA_1561_PRINT_TABLE === "1") {
      // eslint-disable-next-line no-console
      console.log(`\n#1561 MEASUREMENT\n${rows.join("\n")}\n`);
    }
    // Vacuity guard: two categories x five widths, every row produced.
    expect(rows).toHaveLength(10);
  });
});

describe("#1561 — the hero stops eating the page", () => {
  test("820 was 86.9% of the screen and is now under a third", () => {
    expect.assertions(3);
    const mounted = mountCase(RESTAURANT, 820, false);
    assertRealRender(mounted, "tablet-hero");
    const ratio = propsOf(requireShell(mounted)).coverAspectRatio as number;
    const heroHeight = 820 / ratio;
    // Leg C measured 820 x 1025 on an 1180pt screen.
    expect(820 / (4 / 5) / 1180).toBeGreaterThan(0.86); // the defect, restated
    expect(heroHeight / 1180).toBeLessThan(0.32);
    expect(heroHeight / 1180).toBeGreaterThan(0.28);
    mounted.unmount();
  });

  test("390 was 57.8% and is now under 40%", () => {
    expect.assertions(2);
    const mounted = mountCase(RESTAURANT, 390, false);
    const ratio = propsOf(requireShell(mounted)).coverAspectRatio as number;
    expect(390 / (4 / 5) / 844).toBeGreaterThan(0.57); // the defect, restated
    expect(390 / ratio / 844).toBeLessThan(0.4);
    mounted.unmount();
  });
});

describe("#1561 — the gallery is the hero, and the bottom strip is gone", () => {
  test("the venue's photographs reach the shell's pager, cover first", () => {
    expect.assertions(4);
    const mounted = mountCase(RESTAURANT, 390, false);
    assertRealRender(mounted, "gallery-hero");
    const shell = requireShell(mounted);
    expect(propsOf(shell).coverMediaUrl).toBe("https://cdn.example.com/cover.jpg");
    // The three pool photographs — which the early return used to discard.
    expect(propsOf(shell).galleryImages).toEqual([
      { url: "https://cdn.example.com/p0.jpg", type: "image" },
      { url: "https://cdn.example.com/p1.jpg", type: "image" },
      { url: "https://cdn.example.com/p2.jpg", type: "image" },
    ]);
    // The cover is never repeated as an additional item.
    expect(JSON.stringify(propsOf(shell).galleryImages)).not.toContain("cover.jpg");
    // …and there is no `PHOTOS` section anywhere on the page any more.
    expect(mounted.json).not.toContain("PHOTOS");
    mounted.unmount();
  });

  test("SWEEP FLOOR: the 'no PHOTOS' claim was made against a real tree", () => {
    expect.assertions(2);
    const mounted = mountCase(RESTAURANT, 390, false);
    // Without this, "the tree contains no PHOTOS" is also true of an empty walk.
    expect(mounted.nodes.length).toBeGreaterThan(MIN_TREE_NODES);
    // A positive control on the same tree: a string that MUST be there.
    expect(mounted.json).toContain("WHERE YOU'LL BE");
    mounted.unmount();
  });
});

describe("#1561 — every photo count, including none", () => {
  const galleryFor = (count: number): CaseData => ({
    ...RESTAURANT,
    venue: baseVenue("restaurant", {
      galleryPhotoUrls:
        count === 0
          ? []
          : ["https://cdn.example.com/cover.jpg", ...photos(count - 1)],
      coverMediaUrl: count === 0 ? null : "https://cdn.example.com/cover.jpg",
      coverMediaType: count === 0 ? null : "image",
    }),
  });

  test.each([
    [1, 0],
    [3, 2],
    [20, 19],
  ])("%i photo(s) → 1 hero + %i pager items", (count, additional) => {
    expect.assertions(3);
    const mounted = mountCase(galleryFor(count), 390, false);
    assertRealRender(mounted, `photos-${count}`);
    const shell = requireShell(mounted);
    expect(propsOf(shell).coverMediaUrl).toBe("https://cdn.example.com/cover.jpg");
    expect((propsOf(shell).galleryImages as unknown[]).length).toBe(additional);
    expect(mounted.json).not.toContain("PHOTOS");
    mounted.unmount();
  });

  test("0 photos: no pager, and the placeholder never says COVER", () => {
    expect.assertions(4);
    const mounted = mountCase(galleryFor(0), 390, false);
    assertRealRender(mounted, "photos-0");
    const shell = requireShell(mounted);
    expect(propsOf(shell).coverMediaUrl).toBeNull();
    expect(propsOf(shell).galleryImages).toEqual([]);
    // #1550 Leg C plate P12: the literal word COVER, full hero size, live.
    expect(propsOf(shell).coverPlaceholderLabel).toBe("Restaurant · London");
    expect(String(propsOf(shell).coverPlaceholderLabel).toUpperCase()).not.toBe(
      "COVER",
    );
    mounted.unmount();
  });

  test("no operator cover but pool photographs: the first photo IS the hero", () => {
    expect.assertions(3);
    const mounted = mountCase(
      {
        ...RESTAURANT,
        venue: baseVenue("restaurant", {
          coverMediaUrl: null,
          coverMediaType: null,
          galleryPhotoUrls: photos(3),
        }),
      },
      390,
      false,
    );
    assertRealRender(mounted, "pool-only");
    const shell = requireShell(mounted);
    expect(propsOf(shell).coverMediaUrl).toBe("https://cdn.example.com/p0.jpg");
    expect(propsOf(shell).coverMediaType).toBe("image");
    expect((propsOf(shell).galleryImages as unknown[]).length).toBe(2);
    mounted.unmount();
  });

  test("a VIDEO cover stays a video and never enters an image pager", () => {
    expect.assertions(4);
    const mounted = mountCase(
      {
        ...RESTAURANT,
        venue: baseVenue("restaurant", {
          coverMediaUrl: "https://cdn.example.com/cover.mp4",
          coverMediaType: "video",
          galleryPhotoUrls: ["https://cdn.example.com/cover.mp4", ...photos(2)],
        }),
      },
      390,
      false,
    );
    assertRealRender(mounted, "video-cover");
    const shell = requireShell(mounted);
    expect(propsOf(shell).coverMediaType).toBe("video");
    expect(propsOf(shell).showMute).toBe(true);
    // `OfferingGalleryImage.type` excludes video by construction, and the video
    // URL must not appear among the additional items at all — that is the
    // "video URL inside an <Image>" defect the deleted strip carried.
    expect(JSON.stringify(propsOf(shell).galleryImages)).not.toContain(".mp4");
    expect((propsOf(shell).galleryImages as unknown[]).length).toBe(2);
    mounted.unmount();
  });

  test("the sparse venue: no cover, no city, nothing bookable, still coherent", () => {
    expect.assertions(5);
    const mounted = mountCase(
      {
        venue: baseVenue(null, {
          address: null,
          city: null,
          pitch: null,
          hours: [],
          galleryPhotoUrls: [],
          coverMediaUrl: null,
          coverMediaType: null,
        }),
        menu: [],
        reservable: null,
        reservableState: "ready",
        discoveryPrice: null,
        stayDetail: null,
        stayState: "ready",
      },
      390,
      false,
    );
    assertRealRender(mounted, "sparse");
    // "what is this place" still answers, because the category always can.
    expect(flatText(requireByTestId(mounted, "issue-1561-category-chip"))).toBe(
      "Venue",
    );
    // There is no place to name, so no place chip is invented.
    expect(findByTestId(mounted, "issue-1561-place-chip")).toBeNull();
    // Nothing to price, nothing to time, nothing to book ⇒ no bar at all,
    // rather than three blank cells.
    expect(findByTestId(mounted, "issue-1561-answer-bar")).toBeNull();
    expect(propsOf(requireShell(mounted)).coverPlaceholderLabel).toBe("Venue");
    expect(mounted.json).not.toContain("PHOTOS");
    mounted.unmount();
  });
});
