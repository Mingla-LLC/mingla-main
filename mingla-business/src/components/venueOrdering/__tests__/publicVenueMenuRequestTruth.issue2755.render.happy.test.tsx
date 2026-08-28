import React from "react";
import {
  PublicVenueScreen,
  type PublicVenueMenuLifecycle,
  type PublicVenueViewModel,
} from "@mingla/brand-rendering/PublicVenueScreen";
import type { PublicMenuGroup } from "@mingla/brand-rendering";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
  props: Record<string, unknown> & { children?: unknown; onPress?: () => void };
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
