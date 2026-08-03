/**
 * #1483 [venue-header-public-page] — TESTER ADVERSARIAL suite.
 *
 * DIFFERENT ANGLE from the implementor's happy-path suite
 * (`venuePublicPageActions.issue1483.test.tsx`, which proves the controls
 * render and fire on the ONE verified fixture). This suite attacks the
 * BOUNDARIES, the RACE, and the INVARIANTS the happy path cannot reach:
 *
 *  A-1  EXHAUSTIVE claim-status boundary. The happy path covers exactly one
 *       negative value (`pending_review`). `venue_public_view` is defined
 *       `WHERE claim_status = 'verified'`, so EVERY other member of the
 *       `BrandClaimStatus` union must render zero controls. The matrix is
 *       cross-checked against the union parsed out of `src/types/brand.ts`,
 *       so ADDING a claim status without covering it here FAILS this suite
 *       rather than silently shipping an ungated state.
 *
 *  A-2  LATE-BRAND RACE. `useVenueListing` and `useBrand` are two independent
 *       queries; the brand is fetched by an id that only exists AFTER the
 *       venue resolves, so on a cold open the venue ALWAYS lands first. The
 *       page must survive that window with no controls and NO `PublicUrlError`
 *       (the builders throw on an empty segment), then light both controls up
 *       — pointed at the VENUE url — once the brand arrives.
 *
 *  A-3  LIVE GATE FLIP. A verified venue that an admin suspends mid-session
 *       must lose both controls AND unmount the ShareModal on the very next
 *       render, without throwing.
 *
 *  A-4  PATH-INJECTION / ENCODING. `venue_listings.slug` is DB-constrained to
 *       `^[a-z0-9]{1,32}$`, but `brands.slug` carries only
 *       `CHECK (length(trim(slug)) > 0)` — a brand slug containing `/` or a
 *       space is DB-LEGAL. The built destination must therefore stay a
 *       four-segment `/b/<one>/v/<one>` path with the hostile characters
 *       percent-encoded, never a path that escapes into another route.
 *
 *  A-5  VENUE-URL-NEVER-BRAND-URL. The dead-code button this issue replaces
 *       (`VenueListingContent.tsx:221`) pushed `/b/{brandSlug}` — the BRAND
 *       page. Both the eye AND the share sheet must carry the per-venue URL,
 *       and they must carry the SAME string (one owner per truth).
 *
 *  A-6  NON-RENDER STATES. The loading and not-found branches must expose the
 *       back affordance and NOTHING else — no control, no ShareModal, no URL
 *       construction.
 *
 * FAILS-ON-REVERT: deleting the `claimStatus === "verified"` clause trips A-1;
 * deleting the brand-slug clauses trips A-2; reverting `handleViewPublic` to
 * the brand page trips A-4 + A-5; deleting the `rightSlot` block trips all of
 * A-1/A-2/A-3/A-5.
 *
 * Harness: bare react-test-renderer under the STOCK mingla-business/jest.config.cjs.
 * Unlike the happy-path suite this one drives the tree through `update()` so a
 * SINGLE mounted page can be walked across query-resolution and gate-flip
 * transitions — a remount would hide exactly the stale-state bugs A-2/A-3 hunt.
 */

import fs from "node:fs";
import path from "node:path";

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// platformUrl.ts throws at module load unless the business web origin is set.
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

const platformState: { OS: "ios" | "android" | "web" } = { OS: "ios" };

jest.mock("react-native", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    Platform: {
      get OS(): string {
        return platformState.OS;
      },
      select: (o: Record<string, unknown>): unknown =>
        o[platformState.OS] ?? o.default,
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

jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => ({ venueId: "venue-adversarial" }),
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
  useAuth: () => ({ isAuthReady: true, user: { id: "user-1483-adv" } }),
}));

interface FixtureVenue {
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

/**
 * Mutable query state. The page reads it through the hook mocks on EVERY
 * render, so mutating it and calling `rerender()` reproduces a real
 * query-resolution or admin-decision transition on a live tree.
 */
const q: {
  venue: FixtureVenue | null;
  venueLoading: boolean;
  brandSlug: string | null;
  brandResolved: boolean;
  isWideDesktop: boolean;
} = {
  venue: null,
  venueLoading: false,
  brandSlug: "smokerhythm",
  brandResolved: true,
  isWideDesktop: false,
};

jest.mock("../../../hooks/useVenueListings", () => ({
  __esModule: true,
  useVenueListing: () => ({
    data: q.venueLoading ? undefined : q.venue,
    isLoading: q.venueLoading,
  }),
}));

jest.mock("../../../hooks/useBrands", () => ({
  __esModule: true,
  // `brandResolved: false` is the REAL cold-open shape: React Query returns
  // `undefined` for a query that has not settled, not `null`.
  useBrand: () => ({
    data: !q.brandResolved
      ? undefined
      : q.brandSlug === null
        ? null
        : { id: "brand-1", slug: q.brandSlug, name: "Smoke & Rhythm" },
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
  useResponsiveLayout: () => ({ isWideDesktop: q.isWideDesktop }),
}));

const openExternalMock = jest.fn();
jest.mock("../../../services/guestFunnelLink", () => ({
  __esModule: true,
  openExternal: (dest: string): void => {
    openExternalMock(dest);
  },
}));

// ---- prop-recording host stubs for the visual primitives -------------------
const hostStub = (
  tag: string,
  keys: readonly string[],
): ((props: Record<string, unknown>) => React.ReactElement) => {
  const ReactActual = require("react") as typeof React;
  return (props: Record<string, unknown>): React.ReactElement => {
    const forwarded: Record<string, unknown> = {};
    for (const k of keys) forwarded[k] = props[k];
    return ReactActual.createElement(tag, forwarded, props.rightSlot as never);
  };
};

jest.mock("../../ui/TopBar", () => ({
  __esModule: true,
  TopBar: hostStub("TopBarMock", ["testID", "title", "leftKind", "onBack"]),
}));
jest.mock("../../ui/IconChrome", () => ({
  __esModule: true,
  IconChrome: hostStub("IconChromeMock", [
    "testID",
    "icon",
    "accessibilityLabel",
    "onPress",
  ]),
}));
jest.mock("../../ui/Button", () => ({
  __esModule: true,
  Button: hostStub("ButtonMock", [
    "testID",
    "label",
    "leadingIcon",
    "onPress",
  ]),
}));
jest.mock("../../ui/ShareModal", () => ({
  __esModule: true,
  ShareModal: hostStub("ShareModalMock", ["url", "title", "visible"]),
}));
jest.mock("../../ui/EventCoverMedia", () => ({
  __esModule: true,
  EventCoverMedia: hostStub("CoverMock", ["label", "hue", "mediaUrl"]),
}));

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

import VenueManagementPage from "../../../../app/venue/[venueId]/index";
import { brandPublicUrl, venuePublicUrl } from "../../../constants/publicUrls";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => {
    root: {
      findAll: (
        predicate: (node: {
          type: unknown;
          props: Record<string, unknown>;
        }) => boolean,
      ) => Array<{ type: unknown; props: Record<string, unknown> }>;
    };
    update: (el: React.ReactElement) => void;
    unmount: () => void;
  };
  act: (cb: () => void | Promise<void>) => void;
};

type Tree = ReturnType<typeof TestRenderer.create>;

/** Production fixture: the real verified restaurant (prod, 2026-08-02). */
const ACADEMY: FixtureVenue = {
  id: "a5c44a05-3293-4e66-94a8-d8e2badca15c",
  brandId: "brand-1",
  slug: "academystreetbistro",
  name: "Academy Street Bistro",
  city: "Raleigh",
  venueCategory: "restaurant",
  coverMediaUrl: null,
  coverMediaType: null,
  claimStatus: "verified",
  claimFollowUpAt: null,
  rejectionReason: null,
};

const VENUE_URL = "https://business.usemingla.com/b/smokerhythm/v/academystreetbistro";
const VENUE_PATH = "/b/smokerhythm/v/academystreetbistro";
const BRAND_URL = "https://business.usemingla.com/b/smokerhythm";

const mount = (): Tree => {
  let tree: Tree | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(React.createElement(VenueManagementPage));
  });
  if (tree === null) throw new Error("render produced no tree");
  return tree;
};

/** Re-render the SAME tree so state (and stale state) survives the transition. */
const rerender = (tree: Tree): void => {
  TestRenderer.act(() => {
    tree.update(React.createElement(VenueManagementPage));
  });
};

const unmount = (tree: Tree): void => {
  TestRenderer.act(() => {
    tree.unmount();
  });
};

/** Host instances only — findAll matches the composite AND its host output. */
const byTestID = (
  tree: Tree,
  testID: string,
): Array<{ type: unknown; props: Record<string, unknown> }> =>
  tree.root.findAll(
    (n) => typeof n.type === "string" && n.props?.testID === testID,
  );

const shareModals = (
  tree: Tree,
): Array<{ type: unknown; props: Record<string, unknown> }> =>
  tree.root.findAll((n) => n.type === "ShareModalMock");

/** Every control the gate owns, in one place. */
const controlCount = (tree: Tree): number =>
  byTestID(tree, "venue-page-view-public").length +
  byTestID(tree, "venue-page-share").length +
  shareModals(tree).length;

/**
 * Every `BrandClaimStatus` member that is NOT publicly reachable
 * (`venue_public_view` is defined `WHERE claim_status = 'verified'`).
 * A-1a proves this list stays exhaustive against the union in
 * `src/types/brand.ts`.
 */
const NON_PUBLIC_STATUSES = [
  "none",
  "pending_review",
  "rejected",
  "suspended",
  "revoked",
] as const;

describe("#1483 adversarial — claim-status boundary, late-brand race, path integrity", () => {
  beforeEach(() => {
    routerPush.mockClear();
    routerBack.mockClear();
    routerReplace.mockClear();
    openExternalMock.mockClear();
    platformState.OS = "ios";
    q.venue = { ...ACADEMY };
    q.venueLoading = false;
    q.brandSlug = "smokerhythm";
    q.brandResolved = true;
    q.isWideDesktop = false;
  });

  // ---------------------------------------------------------------- A-1 ----
  test("A-1a: the covered claim-status matrix is EXHAUSTIVE over BrandClaimStatus", () => {
    // Guards the matrix below against a future union member shipping ungated.
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../types/brand.ts"),
      "utf8",
    );
    const union = /export type BrandClaimStatus =([\s\S]*?);/.exec(src);
    expect(union).not.toBeNull();
    const declared = Array.from(
      (union as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g),
    ).map((m) => m[1]);

    expect(declared.length).toBeGreaterThan(0);
    expect([...declared].sort()).toEqual(
      [...NON_PUBLIC_STATUSES, "verified"].sort(),
    );
  });

  test.each(NON_PUBLIC_STATUSES)(
    "A-1b: claim_status '%s' renders NO eye, NO share, NO ShareModal — hidden, never a disabled ghost",
    (claimStatus) => {
      q.venue = { ...ACADEMY, claimStatus };
      const tree = mount();

      expect(byTestID(tree, "venue-page-view-public")).toHaveLength(0);
      expect(byTestID(tree, "venue-page-share")).toHaveLength(0);
      expect(shareModals(tree)).toHaveLength(0);
      // Not merely absent from the right slot — absent from the whole page,
      // and no inert/greyed stand-in of any kind.
      expect(
        tree.root.findAll((n) => n.type === "IconChromeMock"),
      ).toHaveLength(0);
      expect(tree.root.findAll((n) => n.type === "ButtonMock")).toHaveLength(0);
      // The page is still usable: the shared bar (and its back affordance) is
      // present in every one of these states.
      expect(byTestID(tree, "venue-page-topbar")).toHaveLength(1);

      unmount(tree);
    },
  );

  test("A-1c: the SAME fixture flipped to 'verified' does render all three — the matrix is not vacuous", () => {
    const tree = mount();
    expect(byTestID(tree, "venue-page-view-public")).toHaveLength(1);
    expect(byTestID(tree, "venue-page-share")).toHaveLength(1);
    expect(shareModals(tree)).toHaveLength(1);
    unmount(tree);
  });

  test("A-1d: a non-verified venue is gated even on desktop, where the eye is a labelled Button", () => {
    q.isWideDesktop = true;
    q.venue = { ...ACADEMY, claimStatus: "suspended" };
    const tree = mount();

    expect(tree.root.findAll((n) => n.type === "ButtonMock")).toHaveLength(0);
    expect(controlCount(tree)).toBe(0);

    unmount(tree);
  });

  // ---------------------------------------------------------------- A-2 ----
  test("A-2a: brand query resolving AFTER the venue never throws PublicUrlError and never leaks a half-built control", () => {
    // Cold open: the venue has landed, the brand query has NOT settled.
    q.brandResolved = false;
    const tree = mount();

    // The verified venue is on screen (band + bar), but the brand slug that
    // both URLs need does not exist yet.
    expect(byTestID(tree, "venue-page-identity-band")).toHaveLength(1);
    expect(controlCount(tree)).toBe(0);

    // The window closes: the brand arrives on a LIVE tree (not a remount).
    q.brandResolved = true;
    rerender(tree);

    expect(byTestID(tree, "venue-page-view-public")).toHaveLength(1);
    expect(byTestID(tree, "venue-page-share")).toHaveLength(1);
    expect(shareModals(tree)[0].props.url).toBe(VENUE_URL);

    unmount(tree);
  });

  test("A-2b: tapping the eye the instant the brand lands pushes the venue path, not a partial one", () => {
    q.brandResolved = false;
    const tree = mount();
    q.brandResolved = true;
    rerender(tree);

    const onPress = byTestID(tree, "venue-page-view-public")[0].props
      .onPress as () => void;
    TestRenderer.act(() => {
      onPress();
    });

    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith(VENUE_PATH);
    // No `/b/undefined/...`, no `/b//v/...`, no bare brand path.
    const pushed = String(routerPush.mock.calls[0][0]);
    expect(pushed).not.toContain("undefined");
    expect(pushed).not.toContain("null");
    expect(pushed).not.toContain("//v/");

    unmount(tree);
  });

  test("A-2c: a brand that resolves with NO slug keeps the page alive and the controls off", () => {
    q.brandResolved = false;
    const tree = mount();
    expect(controlCount(tree)).toBe(0);

    // The query settles, but this brand genuinely has no slug.
    q.brandResolved = true;
    q.brandSlug = null;
    rerender(tree);

    expect(controlCount(tree)).toBe(0);
    expect(byTestID(tree, "venue-page-topbar")).toHaveLength(1);

    unmount(tree);
  });

  // ---------------------------------------------------------------- A-3 ----
  test("A-3: verified -> suspended on a mounted page drops both controls AND unmounts the ShareModal", () => {
    const tree = mount();
    expect(controlCount(tree)).toBe(3);

    // An admin suspends the listing; the venue query refetches under the page.
    q.venue = { ...ACADEMY, claimStatus: "suspended" };
    rerender(tree);

    expect(byTestID(tree, "venue-page-view-public")).toHaveLength(0);
    expect(byTestID(tree, "venue-page-share")).toHaveLength(0);
    // The modal must go too: it is the only other holder of the public URL.
    expect(shareModals(tree)).toHaveLength(0);
    // And the page did not blow up on the way down.
    expect(byTestID(tree, "venue-page-topbar")).toHaveLength(1);
    expect(byTestID(tree, "venue-page-identity-band")).toHaveLength(1);

    unmount(tree);
  });

  // ---------------------------------------------------------------- A-4 ----
  test("A-4a: a DB-legal brand slug containing '/' cannot escape the /b/<one>/v/<one> shape", () => {
    // venue_listings.slug is CHECK ~ '^[a-z0-9]{1,32}$', but brands.slug only
    // carries CHECK (length(trim(slug)) > 0) — this value is insertable.
    q.brandSlug = "smokerhythm/v/hijacked";
    const tree = mount();

    const onPress = byTestID(tree, "venue-page-view-public")[0].props
      .onPress as () => void;
    TestRenderer.act(() => {
      onPress();
    });

    const pushed = String(routerPush.mock.calls[0][0]);
    // Exactly four segments: "", "b", <brand>, "v", <venue> -> 5 split parts.
    expect(pushed.split("/")).toHaveLength(5);
    expect(pushed).toBe("/b/smokerhythm%2Fv%2Fhijacked/v/academystreetbistro");
    // The trailing segment is still the venue — the injection did not steal it.
    expect(pushed.endsWith("/v/academystreetbistro")).toBe(true);

    unmount(tree);
  });

  test("A-4b: a brand slug containing spaces and non-ASCII is percent-encoded in the shared URL", () => {
    q.brandSlug = "smoke & rhythm café";
    const tree = mount();

    const url = String(shareModals(tree)[0].props.url);
    expect(url).toBe(
      "https://business.usemingla.com/b/smoke%20%26%20rhythm%20caf%C3%A9/v/academystreetbistro",
    );
    // A raw space would break every SMS/WhatsApp/email share intent.
    expect(url).not.toContain(" ");

    unmount(tree);
  });

  // ---------------------------------------------------------------- A-5 ----
  test("A-5a: the share sheet carries the VENUE url, never the BRAND url (the dead-button defect)", () => {
    const tree = mount();

    const url = String(shareModals(tree)[0].props.url);
    expect(url).toBe(venuePublicUrl({ brandSlug: "smokerhythm", venueSlug: "academystreetbistro" }));
    expect(url).not.toBe(brandPublicUrl("smokerhythm"));
    expect(url).not.toBe(BRAND_URL);
    // Structural, not just string-inequality: the /v/ segment must be there.
    expect(url).toContain("/v/academystreetbistro");

    unmount(tree);
  });

  test("A-5b: the eye and the share sheet resolve to the SAME destination on web (one owner per truth)", () => {
    platformState.OS = "web";
    const tree = mount();

    const shared = String(shareModals(tree)[0].props.url);
    const onPress = byTestID(tree, "venue-page-view-public")[0].props
      .onPress as () => void;
    TestRenderer.act(() => {
      onPress();
    });

    expect(openExternalMock).toHaveBeenCalledTimes(1);
    expect(String(openExternalMock.mock.calls[0][0])).toBe(shared);
    expect(routerPush).not.toHaveBeenCalled();

    unmount(tree);
  });

  test("A-5c: on Android the eye pushes the in-app path, never an external open", () => {
    platformState.OS = "android";
    const tree = mount();

    const onPress = byTestID(tree, "venue-page-view-public")[0].props
      .onPress as () => void;
    TestRenderer.act(() => {
      onPress();
    });

    expect(routerPush).toHaveBeenCalledWith(VENUE_PATH);
    expect(openExternalMock).not.toHaveBeenCalled();

    unmount(tree);
  });

  // ---------------------------------------------------------------- A-6 ----
  test("A-6a: the loading branch exposes back and nothing else — no control, no URL built", () => {
    q.venueLoading = true;
    const tree = mount();

    expect(byTestID(tree, "venue-page-topbar-loading")).toHaveLength(1);
    expect(controlCount(tree)).toBe(0);
    expect(
      byTestID(tree, "venue-page-topbar-loading")[0].props.leftKind,
    ).toBe("back");

    unmount(tree);
  });

  test("A-6b: the not-found branch exposes back and nothing else", () => {
    q.venue = null;
    const tree = mount();

    expect(byTestID(tree, "venue-page-topbar-not-found")).toHaveLength(1);
    expect(controlCount(tree)).toBe(0);
    expect(
      byTestID(tree, "venue-page-topbar-not-found")[0].props.leftKind,
    ).toBe("back");

    unmount(tree);
  });

  test("A-6c: back is wired on the live page and reaches the router", () => {
    const tree = mount();

    const onBack = byTestID(tree, "venue-page-topbar")[0].props
      .onBack as () => void;
    expect(typeof onBack).toBe("function");
    TestRenderer.act(() => {
      onBack();
    });
    expect(routerBack).toHaveBeenCalledTimes(1);

    unmount(tree);
  });
});
