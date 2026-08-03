/**
 * #1483 [venue-header-public-page] — implementor happy-path regression suite.
 *
 * PROVES, by MOUNTING the real `app/venue/[venueId]/index.tsx` route:
 *   1. a `verified` venue whose brand has a slug renders BOTH public-page
 *      controls in the TopBar rightSlot ("View public page" + "Share venue");
 *   2. tapping "View public page" on native pushes EXACTLY
 *      `/b/{brandSlug}/v/{venueSlug}` — the per-venue route, never the brand
 *      page (the dead-code button in VenueListingContent pushed `/b/{slug}`);
 *   3. on web it opens EXACTLY
 *      `https://business.usemingla.com/b/{brandSlug}/v/{venueSlug}` through the
 *      single-owner `openExternal` (never an inline
 *      `window.open(…, "noopener")` re-roll, which returns null even on
 *      success — ORCH-1381/1382);
 *   4. a `pending_review` venue renders NEITHER control. `venue_public_view`
 *      is defined `WHERE claim_status = 'verified'`, so any other state 404s;
 *      the controls are HIDDEN, never disabled;
 *   5. a verified venue whose brand has NO slug also renders neither control
 *      (`venuePublicUrl` would throw PublicUrlError on an empty segment);
 *   6. the page renders the shared `TopBar` + the new `VenueIdentityBand`
 *      (category · city secondary line) instead of the old hand-rolled header.
 *
 * FAILS-ON-REVERT: deleting the `rightSlot` action block, reverting
 * `handleViewPublic` to the brand page, dropping the claim-status gate, or
 * removing the TopBar/identity band each trips at least one case here.
 *
 * Bare react-test-renderer harness under the STOCK mingla-business/jest.config.cjs
 * (the pattern proven by src/components/event/__tests__/
 * EventRouteKeystrokeSurvives.orch0976.test.tsx). The visual primitives the page
 * composes (TopBar / IconChrome / Button / suite shells) are replaced with
 * prop-recording host stubs — the assertion target is WHICH controls the page
 * mounts and WHAT it hands them, not their internal chrome (which has its own
 * render suites).
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// ---------------------------------------------------------------------------
// platformUrl.ts throws at module load unless the business web URL is set;
// provide the canonical production value via expo-constants extra (the exact
// pattern used by src/constants/__tests__/publicUrls.test.ts).
// ---------------------------------------------------------------------------
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://business.usemingla.com",
      },
    },
  },
}));

// Platform.OS is read at TAP time inside handleViewPublic, so a getter lets one
// mounted tree be exercised as native and as web.
const mockPlatformState: { OS: "ios" | "web" } = { OS: "ios" };

jest.mock("react-native", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    Platform: {
      get OS(): string {
        return mockPlatformState.OS;
      },
      select: (o: Record<string, unknown>): unknown =>
        o[mockPlatformState.OS] ?? o.default,
    },
    StyleSheet: {
      create: <T,>(s: T): T => s,
      hairlineWidth: 1,
      flatten: (s: unknown): unknown => s,
    },
    View: "View",
    Text: "Text",
    ActivityIndicator: "ActivityIndicator",
    Pressable: ReactActual.Fragment,
  };
});

const routerPush = jest.fn();
const routerBack = jest.fn();
const routerReplace = jest.fn();
const mockParams: { venueId?: string; focus?: string } = { venueId: "venue-1" };

jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: routerPush,
    back: routerBack,
    replace: routerReplace,
    canGoBack: () => true,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../../context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ isAuthReady: true, user: { id: "user-1483" } }),
}));

// ---- data hooks -----------------------------------------------------------
interface MockVenue {
  id: string;
  brandId: string;
  slug: string;
  name: string;
  city: string | null;
  venueCategory: string;
  coverMediaUrl: string | null;
  coverMediaType: string | null;
  claimStatus: string;
  claimFollowUpAt: string | null;
  rejectionReason: string | null;
}

const mockState: {
  venue: MockVenue | null;
  brandSlug: string | null;
  isWideDesktop: boolean;
  /**
   * Viewport width. 0 is RN-web's documented "no window" value and is the
   * default here, so every pre-existing case keeps the WIDE band layout and is
   * unaffected by the narrow-stack branch.
   */
  width: number;
} = {
  venue: null,
  brandSlug: "smokerhythm",
  isWideDesktop: false,
  width: 0,
};

jest.mock("../../../hooks/useVenueListings", () => ({
  __esModule: true,
  useVenueListing: () => ({ data: mockState.venue, isLoading: false }),
}));

jest.mock("../../../hooks/useBrands", () => ({
  __esModule: true,
  useBrand: () => ({
    data:
      mockState.brandSlug === null
        ? null
        : { id: "brand-1", slug: mockState.brandSlug, displayName: "Brand" },
  }),
}));

jest.mock("../../../hooks/useBrandPlacePipelineState", () => ({
  __esModule: true,
  useVenuePipelineState: () => ({ data: null }),
}));

jest.mock("../../../hooks/useVenueClaimFeedback", () => ({
  __esModule: true,
  useVenueClaimOpenCount: () => 0,
}));

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  __esModule: true,
  useResponsiveLayout: () => ({
    isWideDesktop: mockState.isWideDesktop,
    isWeb: true,
    width: mockState.width,
  }),
}));

// ---- external-open owner (ORCH-1381/1382 single owner) --------------------
const openExternalMock = jest.fn();
jest.mock("../../../services/guestFunnelLink", () => ({
  __esModule: true,
  openExternal: (dest: string): void => {
    openExternalMock(dest);
  },
}));

// ---- visual primitives: prop-recording host stubs -------------------------
jest.mock("../../ui/TopBar", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    TopBar: (props: {
      title?: string;
      rightSlot?: React.ReactNode;
      testID?: string;
    }): React.ReactElement =>
      ReactActual.createElement(
        "TopBarMock",
        { testID: props.testID, title: props.title },
        props.rightSlot,
      ),
  };
});

jest.mock("../../ui/IconChrome", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    IconChrome: (props: {
      icon: string;
      accessibilityLabel: string;
      onPress?: () => void;
      testID?: string;
    }): React.ReactElement =>
      ReactActual.createElement("IconChromeMock", {
        icon: props.icon,
        accessibilityLabel: props.accessibilityLabel,
        onPress: props.onPress,
        testID: props.testID,
      }),
  };
});

jest.mock("../../ui/Button", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    Button: (props: {
      label: string;
      leadingIcon?: string;
      onPress?: () => void;
      testID?: string;
    }): React.ReactElement =>
      ReactActual.createElement("ButtonMock", {
        label: props.label,
        leadingIcon: props.leadingIcon,
        onPress: props.onPress,
        testID: props.testID,
      }),
  };
});

jest.mock("../../ui/ShareModal", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    ShareModal: (props: { url: string; title: string }): React.ReactElement =>
      ReactActual.createElement("ShareModalMock", {
        url: props.url,
        title: props.title,
      }),
  };
});

jest.mock("../../ui/Toast", () => ({ __esModule: true, Toast: (): null => null }));
jest.mock("../../stay/StaySuiteShell", () => ({
  __esModule: true,
  StaySuiteShell: (): null => null,
}));
jest.mock("../VenueSuiteShell", () => ({
  __esModule: true,
  VenueSuiteShell: (): null => null,
}));
jest.mock("../VenueModulePillRow", () => ({
  __esModule: true,
  VenueModulePillRow: (): null => null,
}));
jest.mock("../../brand/VenueClaimFeedbackSheet", () => ({
  __esModule: true,
  VenueClaimFeedbackSheet: (): null => null,
}));
jest.mock("../../brand/VenueClaimStatusBanner", () => ({
  __esModule: true,
  VenueClaimStatusBanner: (): null => null,
}));

// The route + the REAL VenueIdentityBand / listingStatusView / publicUrls.
import VenueManagementPage from "../../../../app/venue/[venueId]/index";

// react-test-renderer ships no bundled types; CJS-require it the way the #976
// suites do (proven under this stock config), against this local shape.
interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  parent: TestNode | null;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}

const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => {
    root: TestNode;
    unmount: () => void;
  };
  act: (cb: () => void | Promise<void>) => void;
};

const VERIFIED_VENUE: MockVenue = {
  id: "venue-1",
  brandId: "brand-1",
  slug: "academystreetbistro",
  name: "Academy Street Bistro",
  city: "London",
  venueCategory: "restaurant",
  coverMediaUrl: null,
  coverMediaType: null,
  claimStatus: "verified",
  claimFollowUpAt: null,
  rejectionReason: null,
};

type Tree = ReturnType<typeof TestRenderer.create>;

const mount = (): Tree => {
  let tree: Tree | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(React.createElement(VenueManagementPage));
  });
  if (tree === null) throw new Error("render produced no tree");
  return tree;
};

/** The venueSuiteStore deactivate() on unmount is a real state update. */
const unmount = (tree: Tree): void => {
  TestRenderer.act(() => {
    tree.unmount();
  });
};

/**
 * Host instances only. react-test-renderer's findAll matches BOTH the composite
 * element and the host element it returns, so an unfiltered lookup double-counts
 * every stub.
 */
const byTestID = (tree: Tree, testID: string): TestNode[] =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props?.testID === testID,
  );

/**
 * The venue-name Text is the only host node in the band carrying
 * `numberOfLines={2}` — its PARENT is the text column whose measure the 320pt
 * defect starved. Returning the column lets a test ask the one structural
 * question that matters: is the status chip competing for this column's width,
 * or does the name own the whole thing?
 */
const hostParent = (node: TestNode): TestNode => {
  let cursor = node.parent;
  // Composite (function-component) instances sit between host nodes; skip them.
  while (cursor !== null && typeof cursor.type !== "string") {
    cursor = cursor.parent;
  }
  if (cursor === null) throw new Error("no host parent");
  return cursor;
};

const nameColumn = (tree: Tree): TestNode => {
  const nameText = tree.root.findAll(
    (node) => typeof node.type === "string" && node.props?.numberOfLines === 2,
  );
  if (nameText.length !== 1) {
    throw new Error(`expected exactly one 2-line name, got ${nameText.length}`);
  }
  return hostParent(nameText[0]);
};

/**
 * Status chips inside a subtree. Host-filtered for the same reason `byTestID`
 * is: findAll matches the composite AND the host it returns, so an unfiltered
 * count is always doubled.
 */
const chipsInside = (node: TestNode): number =>
  node.findAll(
    (n) =>
      typeof n.type === "string" &&
      n.props?.testID === "venue-page-status-chip",
  ).length;

/** The chip's immediate wrapper View — the thing whose flex behaviour decides
 *  whether the chip can be squeezed into truncating. */
const chipWrapper = (tree: Tree): TestNode => {
  const chip = byTestID(tree, "venue-page-status-chip");
  if (chip.length !== 1) {
    throw new Error(`expected exactly one status chip, got ${chip.length}`);
  }
  return hostParent(chip[0]);
};

const allText = (tree: Tree): string =>
  tree.root
    .findAll((node) => typeof node.props?.children === "string")
    .map((node) => String(node.props.children))
    .join(" | ");

describe("#1483 — venue page header + public-page actions", () => {
  beforeEach(() => {
    routerPush.mockClear();
    openExternalMock.mockClear();
    mockPlatformState.OS = "ios";
    mockState.venue = { ...VERIFIED_VENUE };
    mockState.brandSlug = "smokerhythm";
    mockState.isWideDesktop = false;
    mockState.width = 0;
  });

  test("verified venue + brand slug: BOTH controls render in the TopBar right slot", () => {
    const tree = mount();

    const view = byTestID(tree, "venue-page-view-public");
    const share = byTestID(tree, "venue-page-share");
    expect(view).toHaveLength(1);
    expect(share).toHaveLength(1);
    expect(view[0].props.accessibilityLabel).toBe("View public page");
    expect(view[0].props.icon).toBe("eye");
    expect(share[0].props.accessibilityLabel).toBe("Share venue");
    expect(share[0].props.icon).toBe("share");

    unmount(tree);
  });

  test("native tap pushes EXACTLY /b/{brandSlug}/v/{venueSlug}", () => {
    const tree = mount();

    const onPress = byTestID(tree, "venue-page-view-public")[0].props
      .onPress as () => void;
    TestRenderer.act(() => {
      onPress();
    });

    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith(
      "/b/smokerhythm/v/academystreetbistro",
    );
    // Never the brand page (the VenueListingContent dead-code defect).
    expect(routerPush).not.toHaveBeenCalledWith("/b/smokerhythm");
    expect(openExternalMock).not.toHaveBeenCalled();

    unmount(tree);
  });

  test("web tap opens the absolute public URL through the openExternal owner", () => {
    mockPlatformState.OS = "web";
    const tree = mount();

    const onPress = byTestID(tree, "venue-page-view-public")[0].props
      .onPress as () => void;
    TestRenderer.act(() => {
      onPress();
    });

    expect(openExternalMock).toHaveBeenCalledTimes(1);
    expect(openExternalMock).toHaveBeenCalledWith(
      "https://business.usemingla.com/b/smokerhythm/v/academystreetbistro",
    );
    expect(routerPush).not.toHaveBeenCalled();

    unmount(tree);
  });

  test("desktop promotes the eye to a labelled 'View public page' Button", () => {
    mockState.isWideDesktop = true;
    const tree = mount();

    const view = byTestID(tree, "venue-page-view-public");
    expect(view).toHaveLength(1);
    expect(view[0].props.label).toBe("View public page");
    expect(view[0].props.leadingIcon).toBe("eye");
    // The share control stays an IconChrome at every width.
    expect(byTestID(tree, "venue-page-share")).toHaveLength(1);

    unmount(tree);
  });

  test("ShareModal is mounted with the venue's exact public URL", () => {
    const tree = mount();

    const share = tree.root.findAll((node) => node.type === "ShareModalMock");
    expect(share).toHaveLength(1);
    expect(share[0].props.url).toBe(
      "https://business.usemingla.com/b/smokerhythm/v/academystreetbistro",
    );
    expect(share[0].props.title).toBe("Academy Street Bistro");

    unmount(tree);
  });

  test("pending_review venue renders NEITHER control (hidden, never disabled)", () => {
    mockState.venue = { ...VERIFIED_VENUE, claimStatus: "pending_review" };
    const tree = mount();

    expect(byTestID(tree, "venue-page-view-public")).toHaveLength(0);
    expect(byTestID(tree, "venue-page-share")).toHaveLength(0);
    expect(tree.root.findAll((n) => n.type === "ShareModalMock")).toHaveLength(0);
    // No disabled ghost either — the controls are absent, not inert.
    expect(
      tree.root.findAll((n) => n.type === "IconChromeMock"),
    ).toHaveLength(0);

    unmount(tree);
  });

  test("verified venue with NO brand slug renders NEITHER control", () => {
    mockState.brandSlug = null;
    const tree = mount();

    expect(byTestID(tree, "venue-page-view-public")).toHaveLength(0);
    expect(byTestID(tree, "venue-page-share")).toHaveLength(0);

    unmount(tree);
  });

  test("header is the shared TopBar + the venue identity band, not the old row", () => {
    const tree = mount();

    const topBar = byTestID(tree, "venue-page-topbar");
    expect(topBar).toHaveLength(1);
    expect(topBar[0].props.title).toBe("Venue");

    expect(byTestID(tree, "venue-page-identity-band")).toHaveLength(1);
    const text = allText(tree);
    expect(text).toContain("Academy Street Bistro");
    expect(text).toContain("Restaurant · London");
    expect(text).toContain("Live on Mingla");

    unmount(tree);
  });

  // ---------------------------------------------------------------------
  // #1483 P2 — the 320pt narrow-stack fix.
  //
  // At 320pt the three-column band gave the name only 77.9pt (measured in
  // headless Chromium through react-native-web), which broke "Academy Street
  // Bistro" MID-WORD as "Academ / y Stre…". The row was never overflowing —
  // `body` has flex-basis 0% so free space is always positive and flexShrink
  // on the chip is a no-op — so the only lever is to stop the chip competing
  // for the same row. Below 375 it stacks INSIDE the text column instead,
  // which takes the name from 77.9pt to 220pt and leaves the chip at its
  // natural, never-truncated width.
  // ---------------------------------------------------------------------

  test("at 320pt the chip stacks INSIDE the name column so the name owns the full measure", () => {
    mockState.width = 320;
    const tree = mount();

    // Exactly one chip — stacked, not duplicated.
    expect(byTestID(tree, "venue-page-status-chip")).toHaveLength(1);
    // The structural fix: the chip is a DESCENDANT of the name's column, so it
    // no longer takes width away from it.
    expect(
      chipsInside(nameColumn(tree)),
    ).toBe(1);
    // The name keeps its two-line clamp.
    expect(
      tree.root.findAll(
        (n) => typeof n.type === "string" && n.props?.numberOfLines === 2,
      ),
    ).toHaveLength(1);

    unmount(tree);
  });

  test("at 320pt the chip wrapper never shrinks, so the chip cannot truncate", () => {
    mockState.width = 320;
    const tree = mount();

    // A shrinking wrapper is what would squeeze the single-line chip text into
    // "Live on Min…" — a worse outcome than the name wrapping. The narrow
    // wrapper is a plain row that takes the chip's natural width.
    const wrapper = chipWrapper(tree).props.style as Record<string, unknown>;
    expect(wrapper.flexShrink).not.toBe(1);
    expect(wrapper.flexDirection).toBe("row");

    unmount(tree);
  });

  test("the 375pt boundary is EXCLUSIVE: 374 stacks, 375 is byte-identical to before", () => {
    mockState.width = 374;
    const narrow = mount();
    expect(
      chipsInside(nameColumn(narrow)),
    ).toBe(1);
    unmount(narrow);

    mockState.width = 375;
    const wide = mount();
    // Chip back in its own trailing column — NOT inside the name column.
    expect(
      chipsInside(nameColumn(wide)),
    ).toBe(0);
    expect(byTestID(wide, "venue-page-status-chip")).toHaveLength(1);
    // And that trailing column is the non-shrinking one.
    expect(
      (chipWrapper(wide).props.style as Record<string, unknown>).flexShrink,
    ).toBe(0);
    unmount(wide);
  });

  test("width 0 (SSR / headless, RN-web's no-window value) renders the WIDE band", () => {
    mockState.width = 0;
    const tree = mount();

    // A server render must match every shipping device, not the 320 fallback.
    expect(
      chipsInside(nameColumn(tree)),
    ).toBe(0);

    unmount(tree);
  });

  test("a stay venue titles the bar 'Stay' and labels the band 'Stay'", () => {
    mockState.venue = {
      ...VERIFIED_VENUE,
      venueCategory: "stay",
      name: "Mingla Stay",
      city: null,
    };
    const tree = mount();

    expect(byTestID(tree, "venue-page-topbar")[0].props.title).toBe("Stay");
    // No city → the category stands alone (Constitution #9, no fabricated data).
    expect(allText(tree)).toContain("Stay");
    expect(allText(tree)).not.toContain("Stay · ");
    // Same gate for both categories — the stay's controls still render.
    expect(byTestID(tree, "venue-page-view-public")).toHaveLength(1);

    unmount(tree);
  });
});
