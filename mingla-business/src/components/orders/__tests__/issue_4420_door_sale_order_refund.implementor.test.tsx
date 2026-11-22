/* eslint-disable import/first */
// issue #4420 — refunding a cash or manual door sale from the Orders screen
// failed with `door_sale_refund_path_required`: the order detail route opened
// the provider RefundSheet (refund-order), whose refunds insert the
// issue_4063_guard_door_refund_path trigger refuses for a door order.
//
// WHAT THIS FILE PROVES (the REAL order detail route, mounted)
//   DR-1 a door sale's "Refund order" opens the door refund sheet with that
//        sale, and never mounts the provider RefundSheet.
//   DR-2 a door sale offers no provider "Partial refund" link (the door sheet
//        picks seats itself).
//   DR-3 card money at the door (Tap to Pay, an online-source order) still
//        opens the provider RefundSheet.
//   DR-4 a partially refunded door sale's "Refund again" opens the door sheet.
//   DR-5 the door refund mutation refreshes the order caches as well as the
//        door list, so the Orders screen shows the new status.
//
// FAILS-ON-REVERT: restore app/event/[id]/orders/[oid]/index.tsx or
// src/hooks/useEventDoorSales.ts from origin/main and this goes red.

import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const probe =
  (name: string) =>
  (props: Record<string, unknown>): React.ReactElement =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement(name, props, props.children as React.ReactNode);

let mockOrder: Record<string, unknown> | null = null;
let mockDoorSales: Array<Record<string, unknown>> | undefined;
const mockPush = jest.fn();
const mockInvalidate = jest.fn();

jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "event-4420", oid: "order-4420" }),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));
jest.mock("@tanstack/react-query", () => ({
  QueryClient: class {},
  useQuery: () => ({ data: undefined, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
  useMutation: (options: { mutationFn: unknown; onSuccess?: () => void }) => options,
}));
jest.mock("../../../hooks/useEventOrders", () => ({
  useEventOrderById: () => ({ data: mockOrder, isLoading: false, isError: false }),
}));
jest.mock("../../../hooks/useBrandPayoutScreen", () => ({
  useBrandPayoutScreen: () => ({ data: undefined }),
}));
jest.mock("../../../hooks/useManagedEventRoute", () => ({
  useManagedEventRoute: () => ({
    event: { id: "event-4420", event_type: "event", refundPolicy: null, masterStartAtUtc: null },
    replacementEventId: null,
  }),
}));
jest.mock("../../../hooks/usePublicEvents", () => ({
  usePublicEventById: () => ({ data: undefined }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100, role: "account_owner", accepted: true }),
}));
jest.mock("../../../utils/brandPaymentsPermission", () => ({
  canViewBrandPayments: () => false,
}));
jest.mock("../../../hooks/useEventDoorSales", () => ({
  useEventDoorSales: (eventId: string | null) => ({
    data: eventId === null ? undefined : mockDoorSales,
    isPending: eventId !== null && mockDoorSales === undefined,
  }),
}));
jest.mock("../../../utils/deferAfterDismiss", () => ({
  deferAfterDismiss: (fn: () => void) => fn(),
}));
// #4541 harness registration only — no assertion changed. The detail screen now
// lazy-loads "Answers to {form}" from the forms owner (R1.9); not under test here.
jest.mock("../../forms/formsOwner", () => ({ GuestAnswersCard: (): null => null }));
jest.mock("../../ui/Button", () => ({ Button: probe("ButtonProbe") }));
jest.mock("../../ui/EmptyState", () => ({ EmptyState: probe("EmptyStateProbe") }));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: probe("GlassCardProbe") }));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/IconChrome", () => ({ IconChrome: probe("IconChromeProbe") }));
jest.mock("../../ui/Toast", () => ({ Toast: (): null => null }));
jest.mock("../RefundSheet", () => ({ RefundSheet: probe("ProviderRefundSheetProbe") }));
jest.mock("../CancelOrderDialog", () => ({ CancelOrderDialog: (): null => null }));
jest.mock("../../door/LazyDoorRefundSheet", () => ({
  LazyDoorRefundSheet: probe("DoorRefundSheetProbe"),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OrderDetailRoute = require("../../../../app/event/[id]/orders/[oid]/index")
  .default as React.FC;

const order = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "order-4420",
  eventId: "event-4420",
  brandId: "brand-4420",
  buyer: { name: "Ada Lovelace", email: "", phone: "", marketingOptIn: false },
  lines: [
    {
      orderLineItemId: "line-1",
      ticketTypeId: "ticket-ga",
      ticketNameAtPurchase: "General admission",
      unitPriceGbpAtPurchase: 10,
      isFreeAtPurchase: false,
      quantity: 2,
      refundedQuantity: 0,
      refundedAmountGbp: 0,
    },
  ],
  totalGbpAtPurchase: 20,
  totalCents: 2000,
  refundedAmountCents: 0,
  currency: "GBP",
  paymentMethod: "cash",
  paidAt: "2026-11-15T20:00:00.000Z",
  status: "paid",
  refundedAmountGbp: 0,
  refunds: [],
  cancelledAt: null,
  lastSeenEventUpdatedAt: "2026-11-15T20:00:00.000Z",
  source: "door_sale",
  ...overrides,
});

const doorSale = { id: "order-4420", eventId: "event-4420", brandId: "brand-4420", lines: [], refunds: [] };

const mount = async (): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<OrderDetailRoute />);
  });
  return tree;
};

const button = (tree: Renderer, label: string): TestInstance | undefined =>
  tree.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === label)[0];
const all = (tree: Renderer, type: string): TestInstance[] =>
  tree.root.findAll((n) => n.type === type);

beforeEach(() => {
  mockPush.mockReset();
  mockInvalidate.mockReset();
  mockDoorSales = [doorSale];
});

describe("#4420 refunding a door sale from Orders uses the door refund path", () => {
  test("DR-1 Refund order opens the door sheet with that sale, never the provider sheet", async () => {
    mockOrder = order();
    const tree = await mount();
    const refund = button(tree, "Refund order");
    expect(refund).toBeDefined();
    expect(all(tree, "DoorRefundSheetProbe")[0]?.props.visible).toBe(false);
    await act(async () => {
      (refund!.props.onPress as () => void)();
    });
    const sheet = all(tree, "DoorRefundSheetProbe")[0];
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.sale).toBe(doorSale);
    expect(all(tree, "ProviderRefundSheetProbe")).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test("DR-2 a door sale offers no provider Partial refund link", async () => {
    mockOrder = order();
    const tree = await mount();
    expect(
      tree.root.findAll((n) => n.props.accessibilityLabel === "Partial refund"),
    ).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test("DR-3 card money at the door still refunds through the provider sheet", async () => {
    mockOrder = order({ source: "online_checkout", paymentMethod: "tap_to_pay" });
    const tree = await mount();
    await act(async () => {
      (button(tree, "Refund order")!.props.onPress as () => void)();
    });
    expect(all(tree, "ProviderRefundSheetProbe")).toHaveLength(1);
    expect(all(tree, "DoorRefundSheetProbe")).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test("DR-4 Refund again on a partly refunded door sale opens the door sheet", async () => {
    mockOrder = order({ status: "refunded_partial", refundedAmountGbp: 10, refundedAmountCents: 1000 });
    const tree = await mount();
    await act(async () => {
      (button(tree, "Refund again")!.props.onPress as () => void)();
    });
    expect(all(tree, "DoorRefundSheetProbe")[0].props.visible).toBe(true);
    expect(all(tree, "ProviderRefundSheetProbe")).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test("DR-4b while the door list loads the button waits; if it fails, it opens the door sale screen", async () => {
    mockOrder = order();
    mockDoorSales = undefined;
    let tree = await mount();
    expect(button(tree, "Refund order")!.props.disabled).toBe(true);
    await act(async () => tree.unmount());
    mockDoorSales = [];
    tree = await mount();
    await act(async () => {
      (button(tree, "Refund order")!.props.onPress as () => void)();
    });
    expect(mockPush).toHaveBeenCalledWith("/event/event-4420/door/order-4420");
    expect(all(tree, "ProviderRefundSheetProbe")).toHaveLength(0);
    await act(async () => tree.unmount());
  });
});

describe("#4420 a door refund refreshes the Orders screen", () => {
  test("DR-5 the door refund mutation invalidates the event's order caches too", () => {
    const actual = jest.requireActual("../../../hooks/useEventDoorSales") as {
      useRefundDoorSale: (eventId: string | null) => { onSuccess: () => void };
    };
    actual.useRefundDoorSale("event-4420").onSuccess();
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["door-sales", "event-4420"] });
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["event-orders", "event-4420"] });
  });
});
