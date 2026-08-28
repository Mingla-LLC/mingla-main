import React from "react";
import { AccessibilityInfo, Platform, StyleSheet } from "react-native";
import {
  createThemePalette,
  resolveTheme,
} from "@mingla/offering-rendering";
import {
  PublicVenueScreen,
  type PublicVenueMenuLifecycle,
  type PublicVenueViewModel,
} from "@mingla/brand-rendering/PublicVenueScreen";
import type { PublicMenuGroup } from "@mingla/brand-rendering";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as typeof import("react-native");
  return {
    ...actual,
    AccessibilityInfo: {
      announceForAccessibility: jest.fn(),
    },
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
    children?: unknown;
    onPress?: () => void;
    onFocus?: (event: { currentTarget: unknown }) => void;
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
  brandSlug: "gogi",
  brandName: "Gogi Lagos",
  slug: "lagos",
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
const MENU: PublicMenuGroup[] = [
  {
    menuId: "dinner",
    menuName: "Dinner",
    menuDescription: null,
    items: [
      {
        id: "rice",
        name: "Smoky Rice",
        description: null,
        priceCents: 1800,
        currency: "USD",
      },
    ],
  },
];

const countText = (tree: Tree, text: string): number =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.children === text,
  ).length;

const textNode = (tree: Tree, text: string): Node =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.children === text,
  )[0];

const retryButton = (tree: Tree): Node =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === "Try loading the menu again",
  )[0];

const flatStyle = (node: Node): Record<string, unknown> =>
  StyleSheet.flatten(
    typeof node.props.style === "function"
      ? (node.props.style as (state: { pressed: boolean }) => unknown)({
          pressed: false,
        })
      : node.props.style,
  ) as Record<string, unknown>;

const page = (
  menu: PublicMenuGroup[],
  lifecycle: PublicVenueMenuLifecycle,
  menuBody?: () => React.ReactElement,
): React.ReactElement => (
  <PublicVenueScreen
    venue={VENUE}
    discoveryPrice={null}
    menu={menu}
    menuLifecycle={lifecycle}
    reservable={null}
    initialTab="menu"
    safeAreaInsets={{ top: 0, bottom: 0 }}
    loadThemeFont={() => undefined}
    bookingBody={() => null}
    reservationSheet={() => null}
    ordering={menuBody ? { menuBody } : undefined}
    onAnalytics={() => undefined}
    onShare={() => undefined}
    onClose={() => undefined}
    onOpenBrand={() => undefined}
    onOpenMaps={() => undefined}
  />
);

test("cold failure keeps Menu selected and exposes one guarded retry", async () => {
  const retry = jest.fn(() => Promise.resolve());
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      page([], { state: "error", isFetching: false, onRetry: retry }),
    );
  });
  expect(countText(tree, "Menu couldn’t load")).toBe(1);
  const button = tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === "Try loading the menu again",
  );
  expect(button).toHaveLength(1);
  expect(button[0].props.accessibilityState).toEqual({
    disabled: false,
    busy: false,
  });
  await TestRenderer.act(async () => {
    button[0].props.onPress?.();
    button[0].props.onPress?.();
  });
  expect(retry).toHaveBeenCalledTimes(1);
  await TestRenderer.act(async () => tree.unmount());
});

test("stale failure and refresh retain the exact ordering child mount", async () => {
  let mounts = 0;
  const Probe = (): React.ReactElement => {
    React.useEffect(() => {
      mounts += 1;
    }, []);
    return <span>cached-ordering-tree</span>;
  };
  const body = (): React.ReactElement => <Probe />;
  const retry = () => undefined;
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      page(MENU, { state: "error", isFetching: false, onRetry: retry }, body),
    );
  });
  expect(countText(tree, "Menu may be out of date.")).toBe(1);
  expect(countText(tree, "cached-ordering-tree")).toBe(1);
  await TestRenderer.act(async () => {
    tree.update(
      page(MENU, { state: "ready", isFetching: true, onRetry: retry }, body),
    );
  });
  expect(countText(tree, "Updating menu…")).toBe(1);
  expect(countText(tree, "cached-ordering-tree")).toBe(1);
  expect(mounts).toBe(1);
  await TestRenderer.act(async () => tree.unmount());
});

test("every state owns its approved typography, color, and heading role", async () => {
  const palette = createThemePalette(resolveTheme(VENUE.theme, null));
  const retry = () => undefined;
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      page([], { state: "loading", isFetching: true, onRetry: retry }),
    );
  });
  expect(flatStyle(textNode(tree, "Loading menu…"))).toMatchObject({
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "400",
    color: palette.secondaryText,
  });

  await TestRenderer.act(async () => {
    tree.update(page([], { state: "error", isFetching: false, onRetry: retry }));
  });
  const coldError = textNode(tree, "Menu couldn’t load");
  expect(coldError.props.accessibilityRole).toBe("header");
  expect(flatStyle(coldError)).toMatchObject({
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "800",
    color: palette.primaryText,
  });
  expect(flatStyle(textNode(tree, "Try again in a moment."))).toMatchObject({
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "400",
    color: palette.secondaryText,
  });

  await TestRenderer.act(async () => {
    tree.update(
      page(MENU, { state: "ready", isFetching: true, onRetry: retry }),
    );
  });
  expect(flatStyle(textNode(tree, "Updating menu…"))).toMatchObject({
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400",
    color: palette.secondaryText,
  });

  await TestRenderer.act(async () => {
    tree.update(
      page(MENU, { state: "error", isFetching: false, onRetry: retry }),
    );
  });
  const staleError = textNode(tree, "Menu may be out of date.");
  expect(staleError.props.accessibilityRole).toBeUndefined();
  expect(flatStyle(staleError)).toMatchObject({
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400",
    color: palette.secondaryText,
  });
  await TestRenderer.act(async () => tree.unmount());
});

test("the custom retry ring is keyboard-only on web and never reaches native", async () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS");
  const retry = () => undefined;
  let tree!: Tree;
  try {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        page([], { state: "error", isFetching: false, onRetry: retry }),
      );
    });
    await TestRenderer.act(async () => {
      retryButton(tree).props.onFocus?.({
        currentTarget: { matches: () => true },
      });
    });
    expect(flatStyle(retryButton(tree)).outlineWidth).toBeUndefined();

    Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
    await TestRenderer.act(async () => {
      tree.update(page([], { state: "error", isFetching: false, onRetry: retry }));
      retryButton(tree).props.onFocus?.({
        currentTarget: { matches: () => false },
      });
    });
    expect(flatStyle(retryButton(tree)).outlineWidth).toBeUndefined();
    await TestRenderer.act(async () => {
      retryButton(tree).props.onFocus?.({
        currentTarget: { matches: (selector: string) => selector === ":focus-visible" },
      });
    });
    expect(flatStyle(retryButton(tree))).toMatchObject({
      outlineWidth: 3,
      outlineOffset: -4,
    });
  } finally {
    if (platformDescriptor !== undefined) {
      Object.defineProperty(Platform, "OS", platformDescriptor);
    }
    if (tree !== undefined) {
      await TestRenderer.act(async () => tree.unmount());
    }
  }
});

test("announces first failure, repeat failure, and recovery once each", async () => {
  const announce = AccessibilityInfo.announceForAccessibility as jest.Mock;
  announce.mockClear();
  const retry = jest.fn(() => undefined);
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      page([], { state: "error", isFetching: false, onRetry: retry }),
    );
  });
  expect(announce.mock.calls).toEqual([["Menu couldn’t load"]]);

  await TestRenderer.act(async () => {
    tree.update(page([], { state: "error", isFetching: false, onRetry: retry }));
  });
  expect(announce).toHaveBeenCalledTimes(1);

  await TestRenderer.act(async () => retryButton(tree).props.onPress?.());
  await TestRenderer.act(async () => {
    tree.update(page([], { state: "error", isFetching: true, onRetry: retry }));
  });
  await TestRenderer.act(async () => {
    tree.update(page([], { state: "error", isFetching: false, onRetry: retry }));
  });
  expect(announce.mock.calls).toEqual([
    ["Menu couldn’t load"],
    ["Menu couldn’t load"],
  ]);

  await TestRenderer.act(async () => retryButton(tree).props.onPress?.());
  await TestRenderer.act(async () => {
    tree.update(page([], { state: "error", isFetching: true, onRetry: retry }));
  });
  await TestRenderer.act(async () => {
    tree.update(page(MENU, { state: "ready", isFetching: false, onRetry: retry }));
  });
  expect(announce.mock.calls).toEqual([
    ["Menu couldn’t load"],
    ["Menu couldn’t load"],
    ["Menu loaded."],
  ]);
  await TestRenderer.act(async () => tree.unmount());
});

test("manual stale retry retains copy, child identity, and the focused control", async () => {
  let mounts = 0;
  const Probe = (): React.ReactElement => {
    React.useEffect(() => {
      mounts += 1;
    }, []);
    return <span>stale-retry-tree</span>;
  };
  const body = (): React.ReactElement => <Probe />;
  const retry = jest.fn(() => new Promise<never>(() => undefined));
  let tree!: Tree;

  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      page(MENU, { state: "error", isFetching: false, onRetry: retry }, body),
    );
  });
  const control = retryButton(tree);
  await TestRenderer.act(async () => {
    control.props.onFocus?.({
      currentTarget: { matches: (selector: string) => selector === ":focus-visible" },
    });
    control.props.onPress?.();
  });
  await TestRenderer.act(async () => {
    tree.update(
      page(MENU, { state: "ready", isFetching: true, onRetry: retry }, body),
    );
  });

  expect(retry).toHaveBeenCalledTimes(1);
  expect(retryButton(tree)).toBe(control);
  expect(retryButton(tree).props.accessibilityState).toEqual({
    disabled: true,
    busy: true,
  });
  expect(retryButton(tree).props["aria-disabled"]).toBe(true);
  expect(retryButton(tree).props["aria-busy"]).toBe(true);
  expect(retryButton(tree).props.disabled).toBeUndefined();
  expect(flatStyle(retryButton(tree))).toMatchObject({
    outlineWidth: 3,
    outlineOffset: -4,
  });
  expect(countText(tree, "Menu may be out of date.")).toBe(1);
  expect(countText(tree, "Updating menu…")).toBe(0);
  expect(countText(tree, "stale-retry-tree")).toBe(1);
  expect(mounts).toBe(1);
  await TestRenderer.act(async () => tree.unmount());
});

test("native retry keeps Pressable disabled semantics without web ARIA props", async () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS");
  const retry = jest.fn(() => new Promise<never>(() => undefined));
  let tree!: Tree;
  try {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        page([], { state: "error", isFetching: false, onRetry: retry }),
      );
    });
    await TestRenderer.act(async () => {
      retryButton(tree).props.onPress?.();
    });
    await TestRenderer.act(async () => {
      tree.update(page([], { state: "loading", isFetching: true, onRetry: retry }));
    });

    expect(retryButton(tree).props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(retryButton(tree).props.disabled).toBe(true);
    expect(retryButton(tree).props["aria-disabled"]).toBeUndefined();
    expect(retryButton(tree).props["aria-busy"]).toBeUndefined();
    expect(flatStyle(retryButton(tree)).outlineWidth).toBeUndefined();
  } finally {
    if (platformDescriptor !== undefined) {
      Object.defineProperty(Platform, "OS", platformDescriptor);
    }
    if (tree !== undefined) {
      await TestRenderer.act(async () => tree.unmount());
    }
  }
});
