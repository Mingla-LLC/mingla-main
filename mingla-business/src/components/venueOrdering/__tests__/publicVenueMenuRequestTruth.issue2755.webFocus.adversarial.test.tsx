/**
 * Issue #2755 tester-owned web-focus guard.
 *
 * A native HTML `disabled` button cannot retain browser focus. The public Menu
 * retry therefore uses aria-disabled/busy plus its synchronous activation guard
 * on web while native keeps the ordinary disabled Pressable contract.
 */

import React from "react";
import { Platform } from "react-native";

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
  props: Record<string, unknown> & {
    onFocus?: (event: { currentTarget: unknown }) => void;
    onPress?: () => void;
  };
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

const retryButton = (tree: Tree): Node =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === "Try loading the menu again",
  )[0];

test("web retry stays focusable while aria-disabled and busy", async () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS");
  const retry = jest.fn(() => new Promise<never>(() => undefined));
  let tree!: Tree;

  try {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        page({ state: "error", isFetching: false, onRetry: retry }),
      );
    });
    const control = retryButton(tree);
    await TestRenderer.act(async () => {
      control.props.onFocus?.({
        currentTarget: {
          matches: (selector: string) => selector === ":focus-visible",
        },
      });
      control.props.onPress?.();
    });
    await TestRenderer.act(async () => {
      tree.update(page({ state: "loading", isFetching: true, onRetry: retry }));
    });

    expect(retryButton(tree)).toBe(control);
    expect(retryButton(tree).props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    // RN Web maps Pressable `disabled` to native HTML `disabled`, which makes
    // Chromium drop focus. The activation ref remains the duplicate-tap guard.
    expect(retryButton(tree).props.disabled).not.toBe(true);
    retryButton(tree).props.onPress?.();
    expect(retry).toHaveBeenCalledTimes(1);
  } finally {
    if (platformDescriptor !== undefined) {
      Object.defineProperty(Platform, "OS", platformDescriptor);
    }
    if (tree !== undefined) {
      await TestRenderer.act(async () => tree.unmount());
    }
  }
});
