/**
 * #1595 [venue-host-palette] — the LIGHT-THEME regression proof.
 *
 * WHAT WAS WRONG, in one paragraph. `PublicVenueScreen` is the ONE public venue
 * page every surface mounts, and #1564 made it fully themeable — except for the
 * sheet BEHIND it. `styles.host` hardcoded `backgroundColor: "#0c0e12"`, a
 * near-black nobody chose, in a module whose stated contract (ORCH-1138 A2) is
 * that "every offering primitive + page reads from ONE resolved palette and
 * never a raw hex". The #1550 SPEC named this cleanup by line; the theming step
 * carried the hardcode across with the move instead.
 *
 * WHY "NO BRAND USES A LIGHT PALETTE" WAS THE WRONG TEST, and why this file
 * exists rather than a source grep. `createThemePalette` resolves a NEAR-WHITE
 * page whenever the brand accent fails 3:1 against black — that is, when the
 * accent is DARK. Measured on the shipped function: `#1e3a8a` (deep navy) and
 * `#0f172a` (charcoal) both resolve `page` to a near-white with BLACK primary
 * text. So the trigger is an ordinary, serious brand colour for a hotel, not an
 * exotic pastel. #1564's per-venue `theme_color_override` column is live in
 * production today, so nothing but the absence of a single organiser's colour
 * choice stands between this defect and a real guest.
 *
 * HOW IT PROVES IT. It mounts the REAL route through `react-test-renderer` —
 * the same harness `venueFirstScreen.issue1561.happy.test.tsx` uses and runs in
 * the same required `mingla-business jest (full suite)` lane — with a navy
 * theme, and reads the background off the RENDERED host node. A source
 * assertion could not tell "the constant was deleted" from "the constant was
 * deleted and nothing replaced it", which would be a transparent frame rather
 * than a fixed one.
 *
 * L2 IS THE CASE THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. The light palette's
 * page and the old constant are both opaque hexes; only an equality against the
 * palette distinguishes them.
 *
 * D1 IS NOT REDUNDANT WITH IT. On a DARK brand the page is `#1e120d` — brand
 * amber mixed into near-black — which is close enough to `#0c0e12` to look
 * right and is still not it. A fix that swapped one constant for another would
 * pass L1 and fail D1.
 *
 * FAILS-ON-REVERT, both shapes, measured rather than predicted:
 *
 *   A. Restore `backgroundColor: "#0c0e12"` to the `host` StyleSheet entry and
 *      leave the call site alone. `[styles.host, surface.page]` merges
 *      left-to-right so the constant LOSES and the painted colour is still
 *      correct — L1 stays green, and that is right. L2, D1 and S1 go red: the
 *      dead constant is still serialised into the style array on the node, and
 *      this module's contract is that a raw page hex does not exist here at
 *      all, not merely that it loses today. Someone reordering the array later
 *      would hand the page back to it.
 *   B. Remove `surface.page` from the call site — the true revert. L1, L2, D1
 *      and S1 all go red together.
 *
 * Restored: 5 / 5 green.
 *
 * APPEND-ONLY. This file adds cases; it changes none.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import type { VenueCategory } from "@mingla/brand-rendering/venueCategoryProfile";
import {
  createThemePalette,
  type ThemePalette,
} from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";

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

// ---------------------------------------------------------------------------
// #1595 — palettes, measured from the shipped resolver rather than pinned here
// ---------------------------------------------------------------------------

/** Deep navy. Fails 3:1 on black, clears it on white -> LIGHT page. */
const NAVY = "#1e3a8a";
/** Mingla amber, the colour every production brand actually uses -> DARK page. */
const AMBER = "#eb7825";
/** The exact constant #1595 removed. Named once, asserted against everywhere. */
const REMOVED_CONSTANT = "#0c0e12";

const paletteFor = (color: string): ThemePalette =>
  createThemePalette(resolveTheme({ color, font: "inter", animation: null }, null));

interface Mounted {
  nodes: TreeNode[];
  root: TreeNode;
  json: string;
  unmount: () => void;
}

const mountVenue = (themeColor: string): Mounted => {
  caseData.current = {
    venue: baseVenue("restaurant", { theme: { color: themeColor, font: "inter", animation: null } }),
    menu: [],
    reservable: RESERVABLE,
    reservableState: "ready",
    discoveryPrice: DISCOVERY_PRICE,
    stayDetail: null,
    stayState: "ready",
  };
  viewport.width = 390;
  viewport.isDesktop = false;
  let renderer: MountedTree | null = null;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(React.createElement(PublicVenueRoute));
  });
  if (renderer === null) throw new Error("react-test-renderer produced no tree at all");
  const instance: MountedTree = renderer;
  const tree = instance.toJSON();
  const nodes = walk(tree, []);
  const root = nodes[0];
  if (root === undefined) throw new Error("rendered tree has no element nodes");
  return {
    nodes,
    root,
    json: JSON.stringify(tree),
    unmount: () => {
      TestRenderer.act(() => {
        instance.unmount();
      });
    },
  };
};

/**
 * VACUITY FLOOR, inherited from #1559's lesson: that harness rendered `null`
 * seven times and only a size floor noticed. Every assertion below is about a
 * colour being present or absent, and both readings are meaningless on an empty
 * tree.
 */
const MIN_TREE_CHARS = 3000;
const MIN_TREE_NODES = 40;

const assertRealRender = (m: Mounted, label: string): void => {
  if (m.json.length < MIN_TREE_CHARS || m.nodes.length < MIN_TREE_NODES) {
    throw new Error(
      `[${label}] VACUOUS RENDER — ${m.json.length} chars / ${m.nodes.length} nodes ` +
        `(floors ${MIN_TREE_CHARS} / ${MIN_TREE_NODES}). Every colour assertion below ` +
        "would report 'absent' for the wrong reason.",
    );
  }
};

/** Flatten RN's array/nested style prop down to the winning backgroundColor. */
const resolvedBackground = (node: TreeNode): string | undefined => {
  let found: string | undefined;
  const visit = (style: unknown): void => {
    if (style === null || style === undefined) return;
    if (Array.isArray(style)) {
      for (const entry of style) visit(entry);
      return;
    }
    if (typeof style !== "object") return;
    const bg = (style as { backgroundColor?: unknown }).backgroundColor;
    // Left-to-right: a later entry in the array WINS, exactly as RN merges.
    if (typeof bg === "string") found = bg;
  };
  visit(propsOf(node).style);
  return found;
};

describe("#1595 — the venue page host wears the theme, not a constant", () => {
  test("L1 — on a LIGHT-resolving theme the host background is palette.page", () => {
    const m = mountVenue(NAVY);
    try {
      assertRealRender(m, "L1");
      const palette = paletteFor(NAVY);

      // Guard the premise: if the resolver ever stopped producing a light page
      // for this colour, this test would silently become a second dark case.
      expect(palette.primaryText).toBe("#000000");
      expect(palette.page.toLowerCase()).not.toBe(REMOVED_CONSTANT);

      expect(resolvedBackground(m.root)).toBe(palette.page);
    } finally {
      m.unmount();
    }
  });

  test("L2 — the removed constant appears NOWHERE in the light-theme tree", () => {
    const m = mountVenue(NAVY);
    try {
      assertRealRender(m, "L2");
      expect(m.json.toLowerCase()).not.toContain(REMOVED_CONSTANT);
    } finally {
      m.unmount();
    }
  });

  test("D1 — on a DARK-resolving theme the host is the BRAND's page, not the constant", () => {
    const m = mountVenue(AMBER);
    try {
      assertRealRender(m, "D1");
      const palette = paletteFor(AMBER);

      // Premise guard in the other direction.
      expect(palette.primaryText).toBe("#ffffff");

      const background = resolvedBackground(m.root);
      expect(background).toBe(palette.page);
      // The load-bearing half: a dark page and the old constant look alike.
      // Swapping one constant for another must not read as a pass.
      expect((background ?? "").toLowerCase()).not.toBe(REMOVED_CONSTANT);
      expect(m.json.toLowerCase()).not.toContain(REMOVED_CONSTANT);
    } finally {
      m.unmount();
    }
  });

  test("S1 — the StyleSheet carries no page colour of its own", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const file = path.resolve(
      __dirname,
      "../../../../../packages/brand-rendering/PublicVenueScreen.tsx",
    );
    const source = fs.readFileSync(file, "utf8");
    expect(source.length).toBeGreaterThan(0);

    // Comments explaining the removed constant NAME it, and this repo has been
    // bitten by an audit regex matching the prose that described its own target.
    // S0 below proves the stripper before S1 relies on it.
    const code = stripComments(source);
    expect(code).not.toContain(REMOVED_CONSTANT);
    // ...and the host must actually be given the themed surface at its call site.
    expect(code).toContain("[styles.host, surface.page]");
  });

  test("S0 — stripComments removes prose and keeps code, so S1 is a real assertion", () => {
    const stripped = stripComments(
      [
        "// backgroundColor: \"#0c0e12\", <- prose about the old constant",
        "/* host: { backgroundColor: \"#0c0e12\" } */",
        "const live = { backgroundColor: \"#0c0e12\" };",
      ].join("\n"),
    );
    expect(stripped).not.toContain("prose about the old constant");
    expect(stripped).not.toContain("host: {");
    expect(stripped).toContain("const live");
  });
});

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
