/**
 * Tester-owned #2735 adversarial proof.
 *
 * Unlike the implementor happy path, this begins on Overview, rapidly selects
 * Menu twice while the real lazy promise is pending, then proves resolution
 * neither blanks the committed tree nor replays analytics. It subsequently
 * drives the real Buyer surface off -> on -> off to catch a total renderer
 * that works only on its first mount.
 */

import React from "react";
import type { PublicMenuGroup } from "@mingla/brand-rendering";
import {
  PublicVenueScreen,
  type PublicVenueAnalyticsEvent,
  type PublicVenueOrderingSlotContext,
  type PublicVenueViewModel,
} from "@mingla/brand-rendering/PublicVenueScreen";
import { PublicMenuSections } from "@mingla/brand-rendering/PublicMenuSections";
import type { BuyerVenueOrdering } from "../useBuyerVenueOrdering";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

jest.mock("../../../hooks/usePublicMenuBundle", () => ({
  __esModule: true,
  usePublicMenuBundle: () => ({ data: { windows: {} } }),
}));

const ORDERING_OFF = {
  state: "off" as const,
  venueId: "11111111-1111-4111-8111-111111111111",
  venueName: "Gogi",
  spotState: "none" as const,
  spot: null,
  serviceChargeBps: 0,
  serviceChargeLabel: "Service charge",
  tipsEnabled: false,
  tipPresetsBps: null,
  counterPickupEnabled: false,
  prepTimeMinutes: null,
};

const EMPTY_CART: BuyerVenueOrdering["cart"] = {
  state: {
    lines: [],
    view: "browse",
    openItemId: null,
    tip: { bps: null, flatCents: null },
    tipTouched: false,
    partySize: null,
    buyer: { name: "", email: "", phone: "" },
  },
  count: 0,
  add: jest.fn(),
  setQuantity: jest.fn(),
  setNotes: jest.fn(),
  clear: jest.fn(),
  setView: jest.fn(),
  openItem: jest.fn(),
  setTip: jest.fn(),
  setPartySize: jest.fn(),
  patchBuyer: jest.fn(),
  hydrateSitting: jest.fn(),
  roundSettled: jest.fn(),
};

const ordering: { current: BuyerVenueOrdering } = {
  current: {
    config: ORDERING_OFF,
    scanned: false,
    modifiersByItemId: {},
    cart: EMPTY_CART,
    preview: null,
    previewStatus: "idle",
    previewError: null,
    submitting: false,
    submitError: null,
    submit: jest.fn(),
    live: null,
    actionPending: false,
    actionError: null,
    cancelOrder: jest.fn(),
    requestRefund: jest.fn(),
    orderMore: jest.fn(),
    askPartySize: false,
    tipRemembered: false,
  },
};

jest.mock("../useBuyerVenueOrdering", () => ({
  __esModule: true,
  useBuyerVenueOrdering: () => ordering.current,
}));

import { BuyerVenueOrderingSurface } from "../BuyerVenueOrderingSlots";

interface RenderNode {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown; onPress?: () => void };
}

interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const MENU: PublicMenuGroup[] = [
  {
    menuId: "breakfast",
    menuName: "Breakfast",
    menuDescription: null,
    items: [
      {
        id: "plantain-stack",
        name: "Plantain Sunrise Stack",
        description: "Plantain, eggs and pepper sauce",
        priceCents: 1450000,
        currency: "NGN",
      },
    ],
  },
  {
    menuId: "dinner",
    menuName: "Dinner",
    menuDescription: null,
    items: [
      {
        id: "suya-rice",
        name: "Smoked Suya Rice Bowl",
        description: "Suya, jollof rice and greens",
        priceCents: 1850000,
        currency: "NGN",
      },
    ],
  },
];

const VENUE: PublicVenueViewModel = {
  id: ORDERING_OFF.venueId,
  brandId: "22222222-2222-4222-8222-222222222222",
  brandSlug: "gogilagos",
  brandName: "Gogi Lagos",
  slug: "gogi",
  name: "Gogi",
  address: null,
  city: "Lagos",
  lat: 6.4281,
  lng: 3.4219,
  venueCategory: "restaurant",
  coverMediaUrl: null,
  coverMediaType: null,
  theme: { color: "#ba5d18", font: "inter", animation: null },
  hours: [],
  timezone: "Africa/Lagos",
  galleryPhotoUrls: [],
  pitch: null,
};

const count = (tree: RenderTree, label: string): number =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.children === label,
  ).length;
const countAdd = (tree: RenderTree): number =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel ===
        "Add Plantain Sunrise Stack to your order",
  ).length;

test("Buyer never commits a blank menu through rapid activation and off-on-off truth changes", async () => {
  let resolveLazy!: (module: { default: typeof BuyerVenueOrderingSurface }) => void;
  const lazyModule = new Promise<{ default: typeof BuyerVenueOrderingSurface }>(
    (resolve) => {
      resolveLazy = resolve;
    },
  );
  const LazySurface = React.lazy(() => lazyModule);
  const analytics: PublicVenueAnalyticsEvent[] = [];
  const page = (): React.ReactElement => (
    <PublicVenueScreen
      venue={VENUE}
      discoveryPrice={null}
      menu={MENU}
      reservable={null}
      reservabilityState="ready"
      initialTab="overview"
      safeAreaInsets={{ top: 0, bottom: 0 }}
      loadThemeFont={() => undefined}
      bookingBody={() => null}
      reservationSheet={() => null}
      ordering={{
        menuBody: (context: PublicVenueOrderingSlotContext) => (
          <React.Suspense
            fallback={
              <PublicMenuSections
                groups={context.menu}
                palette={context.palette}
                surface={context.surface}
                theme={context.theme}
              />
            }
          >
            <LazySurface
              palette={context.palette}
              surface={context.surface}
              theme={context.theme}
              brandSlug="gogilagos"
              venueSlug="gogi"
              spotCode={null}
              entrySource={null}
              menu={context.menu}
              timezone="Africa/Lagos"
            />
          </React.Suspense>
        ),
      }}
      onAnalytics={(event) => analytics.push(event)}
      onShare={() => undefined}
      onClose={() => undefined}
      onOpenBrand={() => undefined}
      onOpenMaps={() => undefined}
    />
  );
  let tree!: RenderTree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(page());
  });

  const menuTab = tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "tab" &&
      node.props.accessibilityLabel === "Menu",
  )[0];
  await TestRenderer.act(async () => {
    menuTab.props.onPress?.();
    menuTab.props.onPress?.();
  });
  expect(count(tree, "Plantain Sunrise Stack")).toBe(1);
  const eventsBeforeResolution = analytics.length;

  await TestRenderer.act(async () => {
    resolveLazy({ default: BuyerVenueOrderingSurface });
    await lazyModule;
  });
  expect(count(tree, "MENU")).toBe(1);
  expect(count(tree, "Plantain Sunrise Stack")).toBe(1);
  expect(count(tree, "Smoked Suya Rice Bowl")).toBe(1);
  expect(countAdd(tree)).toBe(0);
  expect(analytics).toHaveLength(eventsBeforeResolution);

  ordering.current = {
    ...ordering.current,
    config: { ...ORDERING_OFF, state: "on", counterPickupEnabled: true },
  };
  await TestRenderer.act(async () => tree.update(page()));
  expect(count(tree, "Plantain Sunrise Stack")).toBe(1);
  expect(countAdd(tree)).toBe(1);

  ordering.current = { ...ordering.current, config: ORDERING_OFF };
  await TestRenderer.act(async () => tree.update(page()));
  expect(count(tree, "MENU")).toBe(1);
  expect(count(tree, "Plantain Sunrise Stack")).toBe(1);
  expect(count(tree, "Smoked Suya Rice Bowl")).toBe(1);
  expect(countAdd(tree)).toBe(0);
  await TestRenderer.act(async () => tree.unmount());
});
