/**
 * Tester-owned #2735 Consumer adversarial proof.
 *
 * Drives the actual Consumer host across an unresolved lazy boundary and then
 * repeatedly changes resolved ordering truth. Every committed state must own
 * exactly one real menu body; the native payment transport alone is mocked.
 */

import React from "react";
import type { PublicMenuGroup } from "@mingla/brand-rendering";
import {
  PublicVenueScreen,
  type PublicVenueOrderingSlotContext,
  type PublicVenueViewModel,
} from "@mingla/brand-rendering/PublicVenueScreen";
import { PublicMenuSections } from "@mingla/brand-rendering/PublicMenuSections";
import type { ConsumerVenueOrdering } from "../../../../../app-mobile/src/components/venueOrdering/useConsumerVenueOrdering";

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
      isWeb: false,
    }),
    useVenueMapsActions: () => ({ requestOpenMaps: () => undefined }),
    VenueCopyAddressButton: () => null,
    MapsAppChooserDialog: () => null,
  };
});

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

const EMPTY_CART: ConsumerVenueOrdering["cart"] = {
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

const ordering: { current: ConsumerVenueOrdering } = {
  current: {
    config: ORDERING_OFF,
    configReady: true,
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
    retryPayment: jest.fn(),
    orderMore: jest.fn(),
    askPartySize: false,
    tipRemembered: false,
  },
};

jest.mock(
  "../../../../../app-mobile/src/components/venueOrdering/useConsumerVenueOrdering",
  () => ({
    __esModule: true,
    useConsumerVenueOrdering: () => ordering.current,
  }),
);
jest.mock(
  "../../../../../app-mobile/src/components/ui/BaseBottomSheet",
  () => ({
    __esModule: true,
    BaseBottomSheet: () => null,
    BottomSheetTextInput: () => null,
  }),
);

import { ConsumerVenueOrderingSurface } from "../../../../../app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots";

interface RenderNode {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
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
    menuId: "small-plates",
    menuName: "Small Plates",
    menuDescription: null,
    items: [
      {
        id: "pepper-wings",
        name: "Charred Pepper Wings",
        description: "Pepper glaze and herbs",
        priceCents: 1250000,
        currency: "NGN",
      },
    ],
  },
  {
    menuId: "mains",
    menuName: "Mains",
    menuDescription: null,
    items: [
      {
        id: "goat-rice",
        name: "Smoky Goat Rice",
        description: "Goat, rice and greens",
        priceCents: 1950000,
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
      node.props.accessibilityLabel === "Add Charred Pepper Wings to your order",
  ).length;

test("Consumer never loses or duplicates items when resolved truth toggles off-on-off", async () => {
  let resolveLazy!: (
    module: { default: typeof ConsumerVenueOrderingSurface },
  ) => void;
  const lazyModule = new Promise<{
    default: typeof ConsumerVenueOrderingSurface;
  }>((resolve) => {
    resolveLazy = resolve;
  });
  const LazySurface = React.lazy(() => lazyModule);
  const page = (): React.ReactElement => (
    <PublicVenueScreen
      venue={VENUE}
      discoveryPrice={null}
      menu={MENU}
      reservable={null}
      reservabilityState="ready"
      initialTab="menu"
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
              menuWindows={{}}
              timezone="Africa/Lagos"
            />
          </React.Suspense>
        ),
      }}
      onAnalytics={() => undefined}
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
  expect(count(tree, "Charred Pepper Wings")).toBe(1);
  expect(count(tree, "Smoky Goat Rice")).toBe(1);

  await TestRenderer.act(async () => {
    resolveLazy({ default: ConsumerVenueOrderingSurface });
    await lazyModule;
  });
  expect(count(tree, "MENU")).toBe(1);
  expect(count(tree, "Charred Pepper Wings")).toBe(1);
  expect(count(tree, "Smoky Goat Rice")).toBe(1);
  expect(countAdd(tree)).toBe(0);

  ordering.current = {
    ...ordering.current,
    config: { ...ORDERING_OFF, state: "on", counterPickupEnabled: true },
  };
  await TestRenderer.act(async () => tree.update(page()));
  expect(count(tree, "Charred Pepper Wings")).toBe(1);
  expect(count(tree, "Smoky Goat Rice")).toBe(1);
  expect(countAdd(tree)).toBe(1);

  ordering.current = { ...ordering.current, config: ORDERING_OFF };
  await TestRenderer.act(async () => tree.update(page()));
  expect(count(tree, "MENU")).toBe(1);
  expect(count(tree, "Charred Pepper Wings")).toBe(1);
  expect(count(tree, "Smoky Goat Rice")).toBe(1);
  expect(countAdd(tree)).toBe(0);
  await TestRenderer.act(async () => tree.unmount());
});
