/**
 * Issue #2735 — Consumer public venue Menu survives the real lazy transition.
 *
 * The native-payment hook boundary is mocked, but the shared venue screen,
 * React.lazy/Suspense transition, PublicMenuSections fallback and actual
 * ConsumerVenueOrderingSurface all render for real.
 */

import React from "react";
import {
  createThemePalette,
  offeringSurfaceStyles,
  resolveTheme,
} from "@mingla/offering-rendering";
import type { PublicMenuGroup } from "@mingla/brand-rendering";
import {
  PublicVenueScreen,
  type PublicVenueOrderingSlotContext,
  type PublicVenueViewModel,
} from "@mingla/brand-rendering/PublicVenueScreen";
import { PublicMenuSections } from "@mingla/brand-rendering/PublicMenuSections";

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

const EMPTY_CART = {
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

const mockConsumerOrdering = {
  current: {
    config: ORDERING_OFF as Omit<typeof ORDERING_OFF, "state"> & {
      state: "off" | "on";
    },
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
    useConsumerVenueOrdering: () => mockConsumerOrdering.current,
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

interface ConsumerVenueOrderingSurfaceTestProps {
  palette: PublicVenueOrderingSlotContext["palette"];
  surface: PublicVenueOrderingSlotContext["surface"];
  theme: PublicVenueOrderingSlotContext["theme"];
  brandSlug: string;
  venueSlug: string;
  spotCode: string | null;
  entrySource: string | null;
  menu: PublicMenuGroup[];
  menuWindows: Record<
    string,
    { start: string | null; end: string | null; days: number[] | null }
  >;
  timezone: string | null;
}

type ConsumerVenueOrderingSurfaceTestComponent =
  React.ComponentType<ConsumerVenueOrderingSurfaceTestProps>;

const { ConsumerVenueOrderingSurface } = require("../../../../../app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots") as {
  ConsumerVenueOrderingSurface: ConsumerVenueOrderingSurfaceTestComponent;
};

interface RenderNode {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
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
    menuDescription: "Morning plates",
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
    menuDescription: "Evening plates",
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
  id: "11111111-1111-4111-8111-111111111111",
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

const itemCount = (tree: RenderTree, label: string): number =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.children === label,
  ).length;

const assertStableMenu = (tree: RenderTree): void => {
  expect(itemCount(tree, "MENU")).toBe(1);
  expect(itemCount(tree, "Breakfast")).toBe(1);
  expect(itemCount(tree, "Dinner")).toBe(1);
  expect(itemCount(tree, "Plantain Sunrise Stack")).toBe(1);
  expect(itemCount(tree, "Smoked Suya Rice Bowl")).toBe(1);
  const menuTab = tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "tab" &&
      node.props.accessibilityLabel === "Menu",
  );
  expect(menuTab).toHaveLength(1);
  expect(menuTab[0].props.accessibilityState).toEqual({ selected: true });
};

const theme = resolveTheme(VENUE.theme, null);
const palette = createThemePalette(theme);
const surface = offeringSurfaceStyles(palette);

const renderConsumerSurface = async (): Promise<RenderTree> => {
  let tree!: RenderTree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <ConsumerVenueOrderingSurface
        palette={palette}
        surface={surface}
        theme={theme}
        brandSlug="gogilagos"
        venueSlug="gogi"
        spotCode={mockConsumerOrdering.current.scanned ? "table-12" : null}
        entrySource={mockConsumerOrdering.current.scanned ? "qr" : null}
        menu={MENU}
        menuWindows={{}}
        timezone="Africa/Lagos"
      />,
    );
  });
  return tree;
};

test("Consumer ordering-off Menu remains populated after the actual lazy surface resolves", async () => {
  let resolveLazy!: (
    module: { default: ConsumerVenueOrderingSurfaceTestComponent },
  ) => void;
  const lazyModule = new Promise<{
    default: ConsumerVenueOrderingSurfaceTestComponent;
  }>((resolve) => {
    resolveLazy = resolve;
  });
  const LazyConsumerSurface = React.lazy(() => lazyModule);
  let tree!: RenderTree;

  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <PublicVenueScreen
        venue={VENUE}
        discoveryPrice={null}
        menu={MENU}
        menuLifecycle={{ state: "ready", isFetching: false, onRetry: () => {} }}
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
              <LazyConsumerSurface
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
      />,
    );
  });

  const mounted = tree;
  assertStableMenu(mounted);
  expect(
    mounted.root.findAll((node) => node.type === ConsumerVenueOrderingSurface),
  ).toHaveLength(0);

  await TestRenderer.act(async () => {
    resolveLazy({
      default: ConsumerVenueOrderingSurface,
    });
    await lazyModule;
  });

  assertStableMenu(mounted);
  expect(
    mounted.root.findAll((node) => node.type === ConsumerVenueOrderingSurface),
  ).toHaveLength(1);
  await TestRenderer.act(async () => mounted.unmount());
});

test("Consumer preserves one honest notice above one display menu when ordering is unavailable", async () => {
  mockConsumerOrdering.current = {
    ...mockConsumerOrdering.current,
    config: ORDERING_OFF,
    scanned: true,
  };
  const tree = await renderConsumerSurface();
  expect(itemCount(tree, "Gogi isn't taking orders through Mingla yet.")).toBe(1);
  expect(itemCount(tree, "Plantain Sunrise Stack")).toBe(1);
  expect(itemCount(tree, "Smoked Suya Rice Bowl")).toBe(1);
  expect(
    tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityLabel ===
          "Add Plantain Sunrise Stack to your order",
    ),
  ).toHaveLength(0);
  await TestRenderer.act(async () => tree.unmount());
});

test("Consumer keeps the existing orderable menu without a duplicate display list", async () => {
  mockConsumerOrdering.current = {
    ...mockConsumerOrdering.current,
    config: {
      ...ORDERING_OFF,
      state: "on",
      counterPickupEnabled: true,
    },
    scanned: false,
  };
  const tree = await renderConsumerSurface();
  expect(itemCount(tree, "Plantain Sunrise Stack")).toBe(1);
  expect(itemCount(tree, "Smoked Suya Rice Bowl")).toBe(1);
  expect(
    tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityLabel ===
          "Add Plantain Sunrise Stack to your order",
    ),
  ).toHaveLength(1);
  await TestRenderer.act(async () => tree.unmount());
});
