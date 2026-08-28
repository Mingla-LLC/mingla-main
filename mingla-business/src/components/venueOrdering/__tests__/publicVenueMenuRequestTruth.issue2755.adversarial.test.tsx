/**
 * Issue #2755 tester-owned adversarial guard.
 *
 * A manual retry is not a new cold load. React Query clears `isError` while
 * the refetch is in flight, so this test drives the exact error -> fetching
 * transition that a real Buyer route produces and pins the design contract:
 * keep the error copy and focused retry control in place, but disabled/busy.
 */

import React from "react";

import {
  PublicVenueScreen,
  type PublicVenueMenuLifecycle,
  type PublicVenueViewModel,
} from "@mingla/brand-rendering/PublicVenueScreen";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-native", () => {
  const actual = jest.requireActual(
    "react-native",
  ) as typeof import("react-native");
  return {
    ...actual,
    AccessibilityInfo: { announceForAccessibility: jest.fn() },
  };
});

jest.mock("@mingla/offering-rendering", () => {
  const ReactLocal = require("react") as typeof React;
  const themeResolver = require("../../../../../packages/offering-rendering/themeResolver");
  const themePalette = require("../../../../../packages/offering-rendering/themePalette");
  return {
    __esModule: true,
    ...themeResolver,
    ...themePalette,
    ParallaxCoverShell: ({ children }: { children?: React.ReactNode }) =>
      ReactLocal.createElement("ParallaxCoverShell", null, children),
    buildStaticMapUrl: () => null,
    normalizeMapsGeo: () => null,
    canOpenMapsTarget: () => false,
    useResponsiveLayout: () => ({
      width: 390,
      isDesktop: false,
      isPhone: true,
      isWeb: true,
    }),
    useVenueMapsActions: () => ({ requestOpenMaps: () => undefined }),
    VenueCopyAddressButton: () => null,
    MapsAppChooserDialog: () => null,
  };
});

interface Node {
  type: unknown;
  props: Record<string, unknown> & { onPress?: () => void };
}

interface Tree {
  root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const VENUE: PublicVenueViewModel = {
  id: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  brandSlug: "gogilagos",
  brandName: "Gogi Lagos",
  slug: "gogi",
  name: "Gogi",
  address: null,
  city: "Lagos",
  lat: 6.4,
  lng: 3.4,
  venueCategory: "restaurant",
  coverMediaUrl: null,
  coverMediaType: null,
  theme: null,
  hours: [],
  timezone: "Africa/Lagos",
  galleryPhotoUrls: [],
  pitch: null,
};

const page = (lifecycle: PublicVenueMenuLifecycle): React.ReactElement => (
  <PublicVenueScreen
    venue={VENUE}
    discoveryPrice={null}
    menu={[]}
    menuLifecycle={lifecycle}
    reservable={null}
    initialTab="menu"
    safeAreaInsets={{ top: 0, bottom: 0 }}
    loadThemeFont={() => undefined}
    bookingBody={() => null}
    reservationSheet={() => null}
    onAnalytics={() => undefined}
    onShare={() => undefined}
    onClose={() => undefined}
    onOpenBrand={() => undefined}
    onOpenMaps={() => undefined}
  />
);

const textCount = (tree: Tree, text: string): number =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.children === text,
  ).length;

const retryButtons = (tree: Tree): Node[] =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === "Try loading the menu again",
  );

test("manual cold-error retry keeps the same copy and retry control while fetching", async () => {
  const retry = jest.fn(() => new Promise<never>(() => undefined));
  let tree!: Tree;

  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      page({ state: "error", isFetching: false, onRetry: retry }),
    );
  });
  expect(textCount(tree, "Menu couldn’t load")).toBe(1);
  expect(retryButtons(tree)).toHaveLength(1);

  await TestRenderer.act(async () => {
    retryButtons(tree)[0].props.onPress?.();
  });
  expect(retry).toHaveBeenCalledTimes(1);

  // This is the real Buyer query transition during refetch: `isError` clears
  // and `isFetching` becomes true. The retry-owned presentation must not turn
  // back into a cold loading pane or replace the focused control.
  await TestRenderer.act(async () => {
    tree.update(page({ state: "loading", isFetching: true, onRetry: retry }));
  });

  expect(textCount(tree, "Menu couldn’t load")).toBe(1);
  expect(textCount(tree, "Try again in a moment.")).toBe(1);
  expect(textCount(tree, "Loading menu…")).toBe(0);
  expect(retryButtons(tree)).toHaveLength(1);
  expect(retryButtons(tree)[0].props.accessibilityState).toEqual({
    disabled: true,
    busy: true,
  });

  await TestRenderer.act(async () => tree.unmount());
});
