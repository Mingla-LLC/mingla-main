/**
 * #4490 spec 08 O1 — the one switch between the legacy order pad and the
 * Till (`venueOrderEntry`), and what the Orders screen offers in each state.
 *
 *  - Till not running here (not released, or the `till` feature off): the
 *    order pad and the open-tabs card work exactly as before.
 *  - Till running and this person may sell: no pad and no tabs card; New order
 *    opens the Till, Open checks opens the Till on its checks (tabs started on
 *    an older app appear there, T18).
 *  - Till running, this person may not sell: neither.
 *
 * The REAL VenueOrdersModule is mounted (bare react-test-renderer); data hooks
 * and the pad/tabs components are stubs so the assertions read what the
 * module renders.
 */
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn((_href: string) => undefined);
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (href: string) => mockPush(href) },
  useRouter: () => ({ push: (href: string) => mockPush(href) }),
}));
const mockHostEl = (name: string) => (props: Record<string, unknown>) => {
  const ReactActual = require("react") as typeof React;
  return ReactActual.createElement(name, props, props.children as React.ReactNode);
};
jest.mock("lucide-react-native", () => ({ __esModule: true, ClipboardList: () => null }));
jest.mock("../../ui/BrandSwitch", () => ({ __esModule: true, BrandSwitch: mockHostEl("BrandSwitch") }));
jest.mock("../../ui/GlassCard", () => ({ __esModule: true, GlassCard: mockHostEl("GlassCard") }));
jest.mock("../../ui/Button", () => ({ __esModule: true, Button: mockHostEl("Button") }));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ __esModule: true, useCurrentBrandRole: () => ({ rank: 60 }) }));
jest.mock("../../../hooks/useQrSpots", () => ({
  __esModule: true,
  useQrSpotVenues: () => ({ data: [] }),
  useQrSpots: () => ({ data: [] }),
}));
jest.mock("../../../hooks/useVenueOrders", () => ({
  __esModule: true,
  useVenueOrders: () => ({ data: [] }),
  useTransitionVenueOrder: () => ({ mutate: () => undefined, isPending: false }),
  useDecideVenueOrderRefund: () => ({ mutate: () => undefined, isPending: false }),
}));
const mockUseVenueTabs = jest.fn((_brand: string | null, _venue: string | null) => ({ data: [] }));
jest.mock("../../../hooks/useVenueOrderTabs", () => ({
  __esModule: true,
  useVenueTabs: (brand: string | null, venue: string | null) => mockUseVenueTabs(brand, venue),
}));
jest.mock("../../../hooks/useVenueListings", () => ({
  __esModule: true,
  useVenueListing: () => ({ data: { id: "venue-o1", claimStatus: "verified" } }),
}));
jest.mock("../../../hooks/useVenueOrderingSettings", () => ({
  __esModule: true,
  useVenueOrderingSettings: () => ({ data: { orderingEnabled: true, paused: false } }),
  useSetVenueOrderingPaused: () => ({ mutate: () => undefined, isPending: false }),
  useSetVenueOrderingEnabled: () => ({ mutate: () => undefined, isPending: false }),
}));
// TEST-MOD-APPROVED #4490 (08-O3 part A): the Orders queue now asks whether to
// show the "Kitchen and bar" entry (useStationsEntry reads auth, features and
// access); this suite renders the module without those providers.
let mockStationsEntry = false;
jest.mock("../../../hooks/useStationsEntry", () => ({ __esModule: true, useStationsEntry: () => mockStationsEntry }));
jest.mock("../VenueOrderCard", () => ({ __esModule: true, VenueOrderCard: () => null }));
jest.mock("../VenueOrderDetailSheet", () => ({ __esModule: true, VenueOrderDetailSheet: () => null }));
jest.mock("../orderPad/VenueOrderPadSheet", () => ({ __esModule: true, VenueOrderPadSheet: mockHostEl("VenueOrderPadSheet") }));
jest.mock("../orderPad/VenueTabsCard", () => ({ __esModule: true, VenueTabsCard: mockHostEl("VenueTabsCard") }));

import { VenueOrdersModule } from "../VenueOrdersModule";
import { venueOrderEntry, type VenueOrderEntry } from "../venueModules";

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
}

function mount(orderEntry: VenueOrderEntry | undefined): Node {
  const TestRenderer = require("react-test-renderer");
  let tree: { root: Node } | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      React.createElement(VenueOrdersModule, {
        brandId: "brand-o1",
        venueId: "venue-o1",
        ...(orderEntry === undefined ? {} : { orderEntry }),
      }),
    );
  });
  return (tree as unknown as { root: Node }).root;
}
const byType = (root: Node, type: string): Node[] => root.findAll((n) => n.type === type);
const byTestId = (root: Node, id: string): Node[] => root.findAll((n) => n.props?.testID === id && typeof n.type === "string");

describe("08-O1 the pad / Till switch", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseVenueTabs.mockClear();
  });

  test("OE-1 the one rule: Till not running → pad; running → Till for sellers, nothing for others", () => {
    expect(venueOrderEntry({ tillReleased: false, tillFeatureOn: true, canSell: true })).toBe("pad");
    expect(venueOrderEntry({ tillReleased: true, tillFeatureOn: false, canSell: true })).toBe("pad");
    expect(venueOrderEntry({ tillReleased: false, tillFeatureOn: false, canSell: false })).toBe("pad");
    expect(venueOrderEntry({ tillReleased: true, tillFeatureOn: true, canSell: true })).toBe("till");
    expect(venueOrderEntry({ tillReleased: true, tillFeatureOn: true, canSell: false })).toBe("none");
  });

  test("OE-2 Till off (and the default): the pad, New order and the tabs card exactly as before", () => {
    for (const entry of [undefined, "pad"] as const) {
      const root = mount(entry);
      expect(byType(root, "VenueOrderPadSheet")).toHaveLength(1);
      expect(byType(root, "VenueTabsCard")).toHaveLength(1);
      expect(byTestId(root, "venue-orders-new-order")).toHaveLength(1);
      expect(byTestId(root, "venue-orders-new-order-till")).toHaveLength(0);
      expect(byTestId(root, "venue-orders-open-checks-till")).toHaveLength(0);
      expect(mockUseVenueTabs).toHaveBeenLastCalledWith("brand-o1", "venue-o1");
    }
  });

  test("OE-3 Till on: no pad, no tabs card, no legacy tabs read; New order and Open checks open the Till", () => {
    const root = mount("till");
    expect(byType(root, "VenueOrderPadSheet")).toHaveLength(0);
    expect(byType(root, "VenueTabsCard")).toHaveLength(0);
    expect(byTestId(root, "venue-orders-new-order")).toHaveLength(0);
    expect(mockUseVenueTabs).toHaveBeenLastCalledWith(null, null);
    const TestRenderer = require("react-test-renderer");
    TestRenderer.act(() => {
      (byTestId(root, "venue-orders-new-order-till")[0].props.onPress as () => void)();
    });
    expect(mockPush).toHaveBeenLastCalledWith("/venue/venue-o1/till");
    TestRenderer.act(() => {
      (byTestId(root, "venue-orders-open-checks-till")[0].props.onPress as () => void)();
    });
    expect(mockPush).toHaveBeenLastCalledWith("/venue/venue-o1/till?checks=1");
  });

  test("OE-4 Till on, may not sell: neither the pad nor the Till is offered", () => {
    const root = mount("none");
    expect(byType(root, "VenueOrderPadSheet")).toHaveLength(0);
    expect(byType(root, "VenueTabsCard")).toHaveLength(0);
    expect(byTestId(root, "venue-orders-new-order")).toHaveLength(0);
    expect(byTestId(root, "venue-orders-new-order-till")).toHaveLength(0);
    expect(byTestId(root, "venue-orders-open-checks-till")).toHaveLength(0);
  });

  test("OE-5 (08-O3) the Kitchen and bar entry shows only when the station rule says so", () => {
    mockStationsEntry = false;
    expect(byTestId(mount("till"), "venue-orders-open-stations")).toHaveLength(0);
    mockStationsEntry = true;
    expect(byTestId(mount("none"), "venue-orders-open-stations")).toHaveLength(1);
    mockStationsEntry = false;
  });
});
